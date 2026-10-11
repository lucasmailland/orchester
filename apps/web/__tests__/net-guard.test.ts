import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  _setResolverForTests,
  assertPublicDbHost,
  assertPublicUrl,
  BlockedDestinationError,
  isBlockedAddress,
  readBodyCapped,
  ResponseTooLargeError,
  safeFetch,
} from "@/lib/net-guard";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.20.30",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // carrier-grade NAT
    "0.0.0.0",
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "255.255.255.255",
    "240.0.0.1", // reserved
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:7f00:1", // same, hex form
    "::ffff:a9fe:a9fe", // mapped metadata IP
    "64:ff9b::7f00:1", // NAT64 of loopback
    "2002:7f00:1::", // 6to4 of loopback
    "ff02::1", // multicast
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );
});

describe("assertPublicUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "http://localhost/",
    "http://127.0.0.1:3000/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", // decimal form, normalized by URL to 127.0.0.1
    "http://0x7f000001/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    // Single-label names are what a container network resolves to its
    // neighbours: the database, the memory server, the cache.
    "http://mnemosyne-server:3939/v1/facts",
    "http://postgres:5432/",
    "http://redis/",
  ])("blocks %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow(BlockedDestinationError);
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "gopher://example.com/"])(
    "blocks the non-http scheme in %s",
    (url) => {
      expect(() => assertPublicUrl(url)).toThrow();
    }
  );

  it("accepts a public https URL", () => {
    expect(assertPublicUrl("https://example.com/hook").hostname).toBe("example.com");
  });

  it("accepts a host named in NET_GUARD_ALLOWED_HOSTS", () => {
    vi.stubEnv("NET_GUARD_ALLOWED_HOSTS", "ollama, 10.0.0.5");
    expect(assertPublicUrl("http://ollama:11434/api").hostname).toBe("ollama");
    expect(assertPublicUrl("http://10.0.0.5/").hostname).toBe("10.0.0.5");
    expect(() => assertPublicUrl("http://10.0.0.6/")).toThrow(BlockedDestinationError);
  });
});

describe("assertPublicDbHost", () => {
  it.each([
    "postgres://user:pw@postgres:5432/db",
    "postgresql://user:pw@127.0.0.1/db",
    "postgres://user:pw@orchester-postgres/db",
  ])("blocks %s", (cs) => {
    expect(() => assertPublicDbHost(cs)).toThrow(BlockedDestinationError);
  });

  it("accepts a public database host", () => {
    expect(() => assertPublicDbHost("postgres://u:p@db.example.com:5432/x")).not.toThrow();
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith("/redirect?to=")) {
        res.writeHead(302, { location: decodeURIComponent(req.url.slice("/redirect?to=".length)) });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`internal ${req.method} ${req.url}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  afterEach(() => {
    vi.unstubAllEnvs();
    _setResolverForTests(undefined);
  });

  it("refuses an internal literal before connecting", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(BlockedDestinationError);
  });

  it("refuses a public-looking name that resolves to an internal address", async () => {
    // DNS rebinding: the name passes every string check; only the address
    // the socket is about to connect to tells the truth.
    _setResolverForTests(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(safeFetch(`http://rebind.example.com:${port}/`)).rejects.toThrow(
      BlockedDestinationError
    );
  });

  it("refuses when any of the resolved addresses is internal", async () => {
    _setResolverForTests(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]);
    await expect(safeFetch(`http://mixed.example.com:${port}/`)).rejects.toThrow(
      BlockedDestinationError
    );
  });

  it("fetches an allowed host and returns its body", async () => {
    vi.stubEnv("NET_GUARD_ALLOWED_HOSTS", "127.0.0.1");
    const res = await safeFetch(`http://127.0.0.1:${port}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("internal GET /ok");
  });

  it("refuses a redirect into the internal network", async () => {
    // The first hop is allowed; the Location it returns is not.
    vi.stubEnv("NET_GUARD_ALLOWED_HOSTS", "127.0.0.1");
    const target = encodeURIComponent(`http://localhost:${port}/secret`);
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect?to=${target}`)).rejects.toThrow(
      BlockedDestinationError
    );
  });

  it("follows a redirect to an allowed destination", async () => {
    vi.stubEnv("NET_GUARD_ALLOWED_HOSTS", "127.0.0.1");
    const target = encodeURIComponent(`http://127.0.0.1:${port}/landed`);
    const res = await safeFetch(`http://127.0.0.1:${port}/redirect?to=${target}`, {
      method: "POST",
      body: "x",
    });
    expect(await res.text()).toBe("internal GET /landed"); // 302 turns POST into GET
  });

  it("stops after too many redirects", async () => {
    vi.stubEnv("NET_GUARD_ALLOWED_HOSTS", "127.0.0.1");
    const loop = `http://127.0.0.1:${port}/redirect?to=${encodeURIComponent(
      `http://127.0.0.1:${port}/redirect?to=x`
    )}`;
    await expect(safeFetch(loop, { maxRedirects: 0 })).rejects.toThrow(/redirect/i);
  });
});

describe("readBodyCapped", () => {
  it("returns a body within the limit", async () => {
    const buf = await readBodyCapped(new Response("hello"), 10);
    expect(buf.toString()).toBe("hello");
  });

  it("refuses a body whose declared length is over the limit, without reading it", async () => {
    const res = new Response("x".repeat(5), { headers: { "content-length": "999" } });
    await expect(readBodyCapped(res, 10)).rejects.toThrow(ResponseTooLargeError);
  });

  it("stops reading once a body without a declared length passes the limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(4));
      },
    });
    await expect(readBodyCapped(new Response(stream), 10)).rejects.toThrow(ResponseTooLargeError);
    expect(pulled).toBeLessThan(10);
  });
});
