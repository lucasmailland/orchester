// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testProviderConnection } from "@/lib/providers";

const fetchMock = vi.fn<typeof fetch>();

/** A model reachable by its own id. */
function onDemand(id: string, name: string, provider = "Amazon") {
  return {
    modelArn: `arn:aws:bedrock:us-east-1::foundation-model/${id}`,
    modelId: id,
    modelName: name,
    providerName: provider,
    outputModalities: ["TEXT"],
    inferenceTypesSupported: ["ON_DEMAND"],
  };
}
/** A model that answers only through an inference profile. */
function profileOnly(id: string, name: string, provider = "Meta") {
  return {
    modelArn: `arn:aws:bedrock:us-east-1::foundation-model/${id}`,
    modelId: id,
    modelName: name,
    providerName: provider,
    outputModalities: ["TEXT"],
    inferenceTypesSupported: ["INFERENCE_PROFILE"],
  };
}

function respond(models: unknown[], profiles: unknown[] = []) {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/inference-profiles")) {
      return Response.json({ inferenceProfileSummaries: profiles });
    }
    return Response.json({ modelSummaries: models });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("asks the control plane, not the runtime host, with the key as a bearer", async () => {
  respond([onDemand("amazon.nova-pro-v1:0", "Nova Pro")]);
  await testProviderConnection("bedrock", "test-key", "eu-west-1");
  const [url, init] = fetchMock.mock.calls[0]!;
  // The runtime host has no way to list anything; this is a different service.
  expect(String(url)).toContain("https://bedrock.eu-west-1.amazonaws.com/foundation-models");
  expect(String(url)).not.toContain("bedrock-runtime");
  expect((init!.headers as Record<string, string>).authorization).toBe("Bearer test-key");
});

it("defaults to us-east-1 when no region is configured", async () => {
  respond([onDemand("amazon.nova-pro-v1:0", "Nova Pro")]);
  await testProviderConnection("bedrock", "test-key");
  expect(String(fetchMock.mock.calls[0]![0])).toContain("bedrock.us-east-1.amazonaws.com");
});

it("derives the control plane from a runtime URL the operator already typed", async () => {
  respond([onDemand("amazon.nova-pro-v1:0", "Nova Pro")]);
  await testProviderConnection(
    "bedrock",
    "test-key",
    "https://bedrock-runtime.us-west-2.amazonaws.com"
  );
  expect(String(fetchMock.mock.calls[0]![0])).toContain("https://bedrock.us-west-2.amazonaws.com/");
});

it("returns each model prefixed so the router knows where it goes", async () => {
  respond([onDemand("amazon.nova-pro-v1:0", "Nova Pro")]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.ok).toBe(true);
  expect(result.models).toEqual([
    {
      id: "bedrock:amazon.nova-pro-v1:0",
      name: "Amazon Nova Pro",
      contextWindow: 300_000,
      tier: "smart",
    },
  ]);
});

it("hands back the profile id for a model the bare id cannot reach", async () => {
  // Calling the bare id here answers "isn't supported with on-demand
  // throughput. Retry with the ID or ARN of an inference profile" — which is
  // the whole reason the profiles are fetched.
  const model = profileOnly("meta.llama4-maverick-17b-instruct-v1:0", "Llama 4 Maverick");
  respond(
    [model],
    [
      {
        inferenceProfileId: "us.meta.llama4-maverick-17b-instruct-v1:0",
        status: "ACTIVE",
        models: [{ modelArn: model.modelArn }],
      },
    ]
  );
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models?.map((m) => m.id)).toEqual([
    "bedrock:us.meta.llama4-maverick-17b-instruct-v1:0",
  ]);
});

it("leaves out a model that has neither on-demand nor a profile", async () => {
  // Listing it would put an id in the picker that answers with an error.
  respond([profileOnly("meta.llama3-1-405b-instruct-v1:0", "Llama 3.1 405B")]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.ok).toBe(false);
  expect(result.error).toContain("no text models");
});

it("ignores a profile that is not active", async () => {
  const model = profileOnly("meta.llama4-scout-17b-instruct-v1:0", "Llama 4 Scout");
  respond(
    [model],
    [
      {
        inferenceProfileId: "us.whatever",
        status: "INACTIVE",
        models: [{ modelArn: model.modelArn }],
      },
    ]
  );
  expect((await testProviderConnection("bedrock", "test-key")).ok).toBe(false);
});

it("keeps one entry for a model that has several regional profiles", async () => {
  const model = profileOnly("amazon.nova-2-lite-v1:0", "Nova 2 Lite", "Amazon");
  respond(
    [model],
    [
      { inferenceProfileId: "us.amazon.nova-2-lite-v1:0", models: [{ modelArn: model.modelArn }] },
      { inferenceProfileId: "eu.amazon.nova-2-lite-v1:0", models: [{ modelArn: model.modelArn }] },
    ]
  );
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models).toHaveLength(1);
});

it("drops models that are past their end of life", async () => {
  respond([
    {
      ...onDemand("cohere.command-r-v1:0", "Command R", "Cohere"),
      modelLifecycle: { status: "LEGACY" },
    },
    onDemand("amazon.nova-pro-v1:0", "Nova Pro"),
  ]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models?.map((m) => m.name)).toEqual(["Amazon Nova Pro"]);
});

it("drops models that produce something other than text", async () => {
  respond([
    { ...onDemand("amazon.titan-image-generator-v1", "Titan Image"), outputModalities: ["IMAGE"] },
    onDemand("amazon.nova-pro-v1:0", "Nova Pro"),
  ]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models?.map((m) => m.name)).toEqual(["Amazon Nova Pro"]);
});

it("reports a context window of zero rather than inventing one", async () => {
  // The AWS APIs do not return it, and a wrong number here would be read as
  // fact. The picker hides a zero.
  respond([onDemand("amazon.unknown-model-v9:0", "Something New")]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models?.[0]!.contextWindow).toBe(0);
});

it("still lists what it can when the profiles call fails", async () => {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("/inference-profiles")) throw new Error("network down");
    return Response.json({ modelSummaries: [onDemand("amazon.nova-pro-v1:0", "Nova Pro")] });
  });
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.ok).toBe(true);
  expect(result.models).toHaveLength(1);
});

it.each([401, 403])("says what a %s actually means rather than just the number", async (status) => {
  fetchMock.mockResolvedValue(new Response("AccessDenied", { status }));
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.ok).toBe(false);
  // A key scoped to the runtime only is the likely cause, and the operator has
  // no way to guess that from a bare 403.
  expect(result.error).toContain("not only Bedrock Runtime");
});

it("surfaces any other status with the body", async () => {
  fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.error).toContain("500");
  expect(result.error).toContain("boom");
});

it("does not put the key in an error message", async () => {
  fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
  const result = await testProviderConnection("bedrock", "ABSKsecretvalue");
  expect(result.error).not.toContain("ABSKsecretvalue");
});

it("sorts the list so a long one is readable", async () => {
  respond([onDemand("z.model", "Zeta"), onDemand("a.model", "Alpha"), onDemand("m.model", "Mid")]);
  const result = await testProviderConnection("bedrock", "test-key");
  expect(result.models?.map((m) => m.name)).toEqual(["Amazon Alpha", "Amazon Mid", "Amazon Zeta"]);
});
