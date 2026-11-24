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
  /** Owner-only Synthetic models: non-owners must not even see a locked row. */
  ownerOnly?: boolean;
}

/**
 * Cheapest → strongest, the order users see.
 *
 * Public plans are OpenCode Go only (owner decision 2026-11-23). The Synthetic
 * branded models remain for the owner's private plan and are hidden entirely
 * from every other account.
 */
export const DEEPCODE_MODELS: readonly DeepCodeModelInfo[] = [
  // Free / trial (OpenCode Go).
  { id: "hy4-flash-free", name: "Hy4 Flash Free", detail: "Free · no credits", plan: "free" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek Flash", detail: "DeepSeek V4.1 Flash", plan: "free" },
  // New Go model added by the admin catalog sync (available from Starter/trial).
  { id: "hungerg-free", name: "HungerG Free", detail: "Stealth reasoning model", plan: "starter" },
  // Starter (Go economy).
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", detail: "Zhipu GLM 5.3 Flash", plan: "starter" },
  { id: "glm-5.2", name: "GLM-5.2", detail: "Zhipu GLM 5.2", plan: "starter" },
  { id: "longcat-2.0", name: "LongCat-2.0", detail: "LongCat 2.0", plan: "starter" },
  { id: "mimo-v2.6-flash", name: "MiMo-V2.6-Flash", detail: "Xiaomi MiMo V2.6 Flash", plan: "starter" },
  { id: "minimax-m3", name: "MiniMax-M3", detail: "MiniMax M3", plan: "starter" },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", detail: "Qwen 3.7 Plus", plan: "starter" },
  { id: "hy4", name: "Hy4", detail: "Tencent Hy4", plan: "starter" },
  { id: "hy3", name: "Hy3", detail: "Tencent Hy3", plan: "starter" },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", detail: "Moonshot Kimi K2.7 Code", plan: "starter" },
  // Pro (Go mid).
  { id: "qwen3.8-flash", name: "Qwen3.8 Flash", detail: "Qwen 3.8 Flash", plan: "pro" },
  { id: "hy4-preview", name: "Hy4 preview", detail: "Tencent Hy4 preview", plan: "pro" },
  { id: "gemini-4-argon", name: "Gemini 4 Argon", detail: "Google Gemini 4 Argon", plan: "pro" },
  { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash", detail: "MiniMax M3.1 Flash", plan: "pro" },
  // Team (Go premium).
  { id: "glm-5.3", name: "GLM-5.3", detail: "Zhipu GLM 5.3", plan: "team" },
  { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro", detail: "Moonshot Kimi K3.1 Pro", plan: "team" },
  { id: "kimi-k3", name: "Kimi K3", detail: "Moonshot Kimi K3", plan: "team" },
  { id: "step-5-preview", name: "Step 5 Preview", detail: "StepFun Step 5 Preview", plan: "team" },
  { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro", detail: "Xiaomi MiMo V2.6 Pro", plan: "team" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", detail: "DeepSeek V4 Pro", plan: "team" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", detail: "OpenAI GPT-6 Luna", plan: "team" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", detail: "OpenAI GPT-5.6 Luna", plan: "team" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", detail: "Anthropic Claude Haiku 5.5", plan: "team" },
  { id: "grok-4.7", name: "Grok 4.7", detail: "xAI Grok 4.7", plan: "team" },
  { id: "qwen4-max", name: "Qwen4 Max", detail: "Qwen 4 Max", plan: "team" },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", detail: "Qwen 3.8 Max", plan: "team" },
  // Owner-only Synthetic models (private plan).
  { id: "deepcode-default", name: "DeepCode Default", detail: "DeepSeek V4.1 Flash", plan: "team", ownerOnly: true },
  { id: "deepcode-lite", name: "DeepCode Lite", detail: "GLM 4.7 Flash", plan: "team", ownerOnly: true },
  { id: "deepcode-general", name: "DeepCode General", detail: "GPT-OSS 120B", plan: "team", ownerOnly: true },
  { id: "deepcode-fast-agent", name: "DeepCode Fast Agent", detail: "GLM 5.3 Flash", plan: "team", ownerOnly: true },
  { id: "deepcode-mid", name: "DeepCode Mid", detail: "Qwen 3.8 27B", plan: "team", ownerOnly: true },
  { id: "deepcode-coder-pro", name: "DeepCode Coder Pro", detail: "GLM 5.3", plan: "team", ownerOnly: true },
  { id: "deepcode-architect", name: "DeepCode Architect", detail: "Kimi K3.1 Pro", plan: "team", ownerOnly: true },
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
