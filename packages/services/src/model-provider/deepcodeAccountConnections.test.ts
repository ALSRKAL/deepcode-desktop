/** DeepCode account models: the plan's list from the gateway decides what the picker shows. */
import { describe, expect, it } from "vitest";
import {
  DeepcodeAccountAccessConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  createAccountProviderConfigResolver,
} from "@zcode/provider";
import { createDeepcodeAccountConnectionResolver } from "./deepcodeAccountConnections.js";

const GATEWAY = "https://gw.test/v1";
const KEY = `sk-dc-${"k".repeat(43)}`;

function deepcodeEntries() {
  const entry = (type: string) =>
    new ProviderConfig({
      access: new DeepcodeAccountAccessConfig(),
      api: new ProviderApiConfig({ type: type as never, baseUrl: GATEWAY }),
      builtinModelIds: ["static-model"],
    });
  return new ProviderConfigMap([
    ["account:deepcode", entry("openai-chat-completions")],
    ["account:deepcode:messages", entry("anthropic-messages")],
    ["account:deepcode:responses", entry("openai-responses")],
    ["account:deepcode:google", entry("google-generative-ai")],
  ] as never);
}

function gateway(response: () => Response) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const input = () => ({ configRevision: "r1", configuredProviders: deepcodeEntries(), previousProviders: ProviderConfigMap.empty() });

describe("DeepCode account connection resolver", () => {
  it("publishes each plan model once, under the entry of its native API", async () => {
    const g = gateway(() =>
      Response.json({
        data: [
          { id: "deepseek-v4.1-flash", api_type: "openai-chat-completions" },
          { id: "claude-haiku-5-5", api_type: "anthropic-messages" },
          { id: "gpt-6-luna", api_type: "openai-responses" },
          { id: "gemini-4-argon", api_type: "google-generative-ai" },
          { id: "beam-free" },
        ],
      }),
    );
    const resolve = createDeepcodeAccountConnectionResolver({ loadDeviceKey: async () => KEY, fetchImpl: g.fetchImpl });
    const connections = await resolve(input());
    expect(g.calls).toEqual([{ url: `${GATEWAY}/models`, auth: `Bearer ${KEY}` }]);
    const models = Object.fromEntries(connections.map((c) => [c.providerId, "models" in c ? c.models : c.status]));
    expect(models).toEqual({
      "account:deepcode": ["deepseek-v4.1-flash", "beam-free"],
      "account:deepcode:messages": ["claude-haiku-5-5"],
      "account:deepcode:responses": ["gpt-6-luna"],
      "account:deepcode:google": ["gemini-4-argon"],
    });

    // Through the real provider resolver: the static build-time list is replaced.
    const resolved = await createAccountProviderConfigResolver(resolve)(input());
    expect(resolved.providers.get("account:deepcode" as never)?.builtinModelIds).toEqual(["deepseek-v4.1-flash", "beam-free"]);
    expect(resolved.states["account:deepcode"]?.availability).toBe("available");
  });

  it("signed out: every DeepCode entry is unavailable and the gateway is not called", async () => {
    const g = gateway(() => Response.json({ data: [] }));
    const resolve = createDeepcodeAccountConnectionResolver({ loadDeviceKey: async () => null, fetchImpl: g.fetchImpl });
    const connections = await resolve(input());
    expect(g.calls).toHaveLength(0);
    expect(connections.every((c) => c.status === "unavailable")).toBe(true);
    const resolved = await createAccountProviderConfigResolver(resolve)(input());
    expect(resolved.states["account:deepcode"]?.availability).toBe("unavailable");
    // The build-time static list must not leak through while signed out.
    expect(resolved.providers.get("account:deepcode" as never)?.builtinModelIds).toEqual([]);
  });

  it("revoked key → credential-failed; gateway down → unknown (keeps the previous list)", async () => {
    const revoked = createDeepcodeAccountConnectionResolver({
      loadDeviceKey: async () => KEY,
      fetchImpl: gateway(() => Response.json({ error: { code: "key_revoked" } }, { status: 401 })).fetchImpl,
    });
    const r1 = await revoked(input());
    expect(r1.every((c) => c.status === "unavailable" && c.unavailableReason === "credential-failed")).toBe(true);

    const down = createDeepcodeAccountConnectionResolver({
      loadDeviceKey: async () => KEY,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect((await down(input())).every((c) => c.status === "unknown")).toBe(true);
  });

  it("ignores providers that are not DeepCode accounts", async () => {
    const resolve = createDeepcodeAccountConnectionResolver({ loadDeviceKey: async () => KEY, fetchImpl: gateway(() => Response.json({ data: [] })).fetchImpl });
    expect(await resolve({ ...input(), configuredProviders: ProviderConfigMap.empty() })).toEqual([]);
  });
});
