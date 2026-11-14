/**
 * DeepCode 云端契约的桌面端镜像。权威 zod schema 在根仓库 @deepcode/shared
 * （apps/web 与 apps/gateway 消费）；本文件是 fork 内的 vendored 副本
 * （docs/plan/00 §2：desktop workspace 不引用外部 workspace，防止上游
 * architecture 检查失效）。两边由 scripts/codemod/sync-deepcode-contracts.mjs
 * 保持同步（schema 变更时重跑）。
 */
import { z } from "zod";

export const DEEPCODE_DEEP_LINK_SCHEME = "deepcodestudio";

export const PlanTierSchema = z.enum(["free", "starter", "pro", "team"]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const SubscriptionStatusResponseSchema = z.object({
  plan: z.object({
    id: z.string(),
    tier: PlanTierSchema,
    name: z.object({ en: z.string(), ar: z.string() }),
  }),
  status: z.enum(["trialing", "active", "past_due", "canceled", "expired"]),
  credits: z.object({
    limit: z.number().int(),
    used: z.number().int(),
    remaining: z.number().int(),
    percentUsed: z.number(),
  }),
  period: z.object({
    startsAt: z.string(),
    expiresAt: z.string(),
    daysLeft: z.number().int().nonnegative(),
  }),
  limits: z.object({ rpm: z.number().int(), allowedModels: z.array(z.string()) }),
  lock: z
    .object({ reason: z.enum(["quota_exhausted", "expired", "suspended", "payment_failed"]), renewUrl: z.string() })
    .nullable(),
  serverTime: z.string(),
});
export type SubscriptionStatusResponse = z.infer<typeof SubscriptionStatusResponseSchema>;

/** `: deepcode-usage {json}` SSE 尾注释负载（docs/plan/00 §5）。 */
export const StreamUsageNoticeSchema = z.object({
  requestId: z.string(),
  model: z.string(),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cachedInput: z.number().int(),
    reasoning: z.number().int(),
  }),
  creditsCharged: z.number().int(),
  creditsRemaining: z.number().int(),
  percentUsed: z.number(),
  estimated: z.boolean(),
});
export type StreamUsageNotice = z.infer<typeof StreamUsageNoticeSchema>;

/** GET /v1/sync/manifest 响应（docs/plan/01 §8.2；per-item Ed25519 签名）。 */
export const SyncManifestSchema = z.object({
  revision: z.number().int(),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      sha256: z.string(),
      url: z.string(),
      minTier: PlanTierSchema,
      signature: z.string(),
    }),
  ),
  mcpPresets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      minTier: PlanTierSchema,
      config: z.object({
        transport: z.enum(["stdio", "sse", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().optional(),
        env: z.array(z.object({ name: z.string(), description: z.string() })).default([]),
      }),
      signature: z.string(),
    }),
  ),
});
export type SyncManifest = z.infer<typeof SyncManifestSchema>;

export const DeepCodeExchangeResponseSchema = z.object({
  apiKey: z.string().startsWith("sk-dc-"),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    locale: z.string(),
  }),
  plan: z.object({
    id: z.string(),
    tier: PlanTierSchema,
    name: z.object({ en: z.string(), ar: z.string() }),
  }),
  gatewayBaseUrl: z.string(),
});
export type DeepCodeExchangeResponse = z.infer<typeof DeepCodeExchangeResponseSchema>;
