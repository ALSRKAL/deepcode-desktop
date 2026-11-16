import { describe, expect, it } from "vitest";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { buildRegistryModelSelectGroups } from "./modelSelectionGroups.js";
import { isDeepCodeLockedValue } from "./deepcodeModels.js";

function view(models: string[]): ModelSelectionView {
  return {
    providers: [
      {
        providerId: "account:deepcode",
        providerName: "DeepCode Studio",
        config: { api: { type: "openai-chat-completions", baseUrl: "https://x/v1" }, access: { type: "deepcode-account" } },
        models: models.map((modelId) => ({ modelId, config: { properties: { inputFormat: { supportsImage: false } } } })),
      },
    ],
  } as unknown as ModelSelectionView;
}

const labels = {
  deepcode: {
    planBadge: (tier: string) => tier.toUpperCase(),
    lockedMessage: (tier: string) => `needs ${tier}`,
    premiumGroupLabel: "Premium",
    onRequestBadge: "On request",
    onRequestMessage: "ask us",
  },
};

describe("DeepCode model menu", () => {
  it("shows the DeepCode name with the real model, cheapest first", () => {
    const [group] = buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view(["deepcode-fast-agent", "deepcode-default"]), labels);
    const available = group!.items.filter((i) => !i.lockedBadge);
    expect(available.map((i) => [i.name, i.detail])).toEqual([
      ["DeepCode Default", "DeepSeek V4.1 Flash"],
      ["DeepCode Fast Agent", "GLM 5.3 Flash"],
    ]);
  });

  it("lists the plan's missing models as locked with the plan that has them", () => {
    const [group] = buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view(["deepcode-default"]), labels);
    const locked = group!.items.filter((i) => i.lockedBadge);
    expect(locked.map((i) => `${i.name}:${i.lockedBadge}`)).toEqual([
      "DeepCode Lite:STARTER",
      "DeepCode General:STARTER",
      "DeepCode Fast Agent:STARTER",
      "DeepCode Mid:PRO",
      "DeepCode Coder Pro:PRO",
      "DeepCode Architect:TEAM",
    ]);
    expect(locked.every((i) => isDeepCodeLockedValue(i.value))).toBe(true);
  });

  it("adds the premium on-request group with names only, all locked", () => {
    const groups = buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view(["deepcode-default"]), labels);
    const premium = groups.find((g) => g.key === "deepcode-premium-on-request")!;
    expect(premium.items.map((i) => i.detail)).toEqual(["Anthropic", "OpenAI", "Google", "xAI"]);
    expect(premium.items.every((i) => i.lockedBadge === "On request")).toBe(true);
  });

  it("adds nothing for callers that do not ask, or when signed out", () => {
    expect(buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view(["deepcode-default"]))[0]!.items).toHaveLength(1);
    expect(buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view([]), labels).some((g) => g.key === "deepcode-premium-on-request")).toBe(false);
  });
});
