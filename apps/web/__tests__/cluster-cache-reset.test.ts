import { describe, it, expect } from "vitest";
import net from "node:net";
import { broadcastInvalidation, stopListener } from "@/lib/tenant/cluster-cache";

// Finishes the startup handshake, then resets the socket on the first query:
// a database going away while the connection opens.
function resettingPostgres(): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let started = false;
    socket.on("data", () => {
      if (started) return socket.resetAndDestroy();
      started = true;
      const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
      const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
      socket.write(Buffer.concat([authOk, ready]));
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("cluster-cache when the database resets", () => {
  it("a broadcast fails quietly, leaving no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const server = await resettingPostgres();
    const prev = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] =
      `postgres://u@127.0.0.1:${(server.address() as net.AddressInfo).port}/db`;
    try {
      await broadcastInvalidation({ kind: "workspace", key: "*" });
      await new Promise((r) => setTimeout(r, 100));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      if (prev === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prev;
      await stopListener();
      server.close();
    }
  });
});
