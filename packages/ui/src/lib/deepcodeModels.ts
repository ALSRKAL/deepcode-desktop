/**
 * DeepCode 模型在选择器中的展示（owner 要求 2026-11-16）：
 * - 品牌名旁显示实际上游模型，用户知道自己在用哪个模型；
 * - 当前计划不含的模型也列出但锁定，标注所需计划，点击打开订阅页；
 * - 大厂高端模型（Anthropic、OpenAI、Google、xAI）只作“按需开通”的占位，不可选。
 * 可用性仍由网关按计划下发（宿主 registry），这里只决定展示；计划与网关
 * packages/db/src/catalog.ts 的 SYNTHETIC_PLAN_LAYOUT / TRIAL_PLAN 保持一致。
 */
export type DeepCodePlanTier = "free" | "trial" | "starter" | "pro" | "team";

export interface DeepCodeModelInfo {
  id: string;
  name: string;
  /** The upstream model behind the DeepCode name. */
  detail: string;
  /** Lowest plan that includes the model. */
  plan: DeepCodePlanTier;
}

/** Cheapest → strongest, the order users see. */
export const DEEPCODE_MODELS: readonly DeepCodeModelInfo[] = [
  // Free plan (owner decision 2026-11-23): both run on OpenCode Go. Hy4 is $0;
  // DeepSeek Flash is metered against the free plan's credits.
  { id: "hy4-flash-free", name: "Hy4 Flash Free", detail: "Free · no credits", plan: "free" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek Flash", detail: "DeepSeek V4.1 Flash", plan: "free" },
  { id: "deepcode-default", name: "DeepCode Default", detail: "DeepSeek V4.1 Flash", plan: "trial" },
  { id: "deepcode-lite", name: "DeepCode Lite", detail: "GLM 4.7 Flash", plan: "starter" },
  { id: "deepcode-general", name: "DeepCode General", detail: "GPT-OSS 120B", plan: "starter" },
  { id: "deepcode-fast-agent", name: "DeepCode Fast Agent", detail: "GLM 5.3 Flash", plan: "starter" },
  { id: "deepcode-mid", name: "DeepCode Mid", detail: "Qwen 3.8 27B", plan: "pro" },
  { id: "deepcode-coder-pro", name: "DeepCode Coder Pro", detail: "GLM 5.3", plan: "pro" },
  { id: "deepcode-architect", name: "DeepCode Architect", detail: "Kimi K3.1 Pro", plan: "team" },
];

/** Frontier models shown as "on request" only (names, never selectable). */
export const DEEPCODE_PREMIUM_PLACEHOLDERS: readonly { id: string; name: string; detail: string }[] = [
  { id: "anthropic", name: "Claude Opus · Sonnet", detail: "Anthropic" },
  { id: "openai", name: "GPT", detail: "OpenAI" },
  { id: "google", name: "Gemini Pro", detail: "Google" },
  { id: "xai", name: "Grok", detail: "xAI" },
];

/** Value prefix of locked menu entries; the toolbar opens the plans page for these. */
export const DEEPCODE_LOCKED_VALUE_PREFIX = "deepcode-locked:";

export function isDeepCodeProviderId(providerId: string): boolean {
  return providerId === "account:deepcode" || providerId.startsWith("account:deepcode:");
}

export function deepCodeModelInfo(modelId: string): DeepCodeModelInfo | undefined {
  return DEEPCODE_MODELS.find((m) => m.id === modelId);
}

export function isDeepCodeLockedValue(value: string): boolean {
  return value.startsWith(DEEPCODE_LOCKED_VALUE_PREFIX);
}
