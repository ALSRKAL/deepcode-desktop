/**
 * 订阅 HUD 状态仓（docs/plan/01 §7.2，D-01/D-02）。
 *
 * 三个数据源按权威度合并：stream notice（精确、即时）> 轮询 status（服务器事实）
 * > 响应头快照（pre-request）。notice/轮询携带 serverTime，newer-wins；headers
 * 无时间戳，只在没有更新数据时兜底。daysLeft 永远是派生值（expiresAt − 校偏时钟），
 * 不落 store；severity 由阈值派生（ok / warn ≥80% / critical ≥95% 或 ≤3 天 / locked）。
 *
 * 本文件刻意不依赖 React：合并逻辑是纯函数，D-01 直接单测。
 */
import { create } from "zustand";
import type { DeepCodeUsageUpdated } from "@zcode/shared";
import type { SubscriptionStatusResponse } from "@zcode/deepcode";

export type SubscriptionSeverity = "ok" | "warn" | "critical" | "locked";
export type LockReason = NonNullable<SubscriptionStatusResponse["lock"]>["reason"] | "signed_out";

export interface SubscriptionState {
  status: "idle" | "loading" | "ready" | "error" | "signed_out";
  snapshot: SubscriptionStatusResponse | null;
  /** 最后一次数据到达的本地单调时钟（Date.now()）。 */
  receivedAt: number | null;
  /** serverTime − 本地时钟，倒计时用。 */
  serverSkewMs: number;
  /** 最近的 stream notice（最高权威）。 */
  lastNotice: DeepCodeUsageUpdated | null;
  lock: { reason: LockReason; renewUrl: string } | null;
  lastError: string | null;

  applyStatus(s: SubscriptionStatusResponse, now?: number): void;
  applyUsageNotice(n: DeepCodeUsageUpdated, now?: number): void;
  applyHeaders(h: { creditsRemaining: number; percentUsed: number; planName?: string }, now?: number): void;
  setLockFromError(code: string, renewUrl?: string): void;
  refresh(): Promise<void>;
  reset(): void;
}

/** gateway 错误码 → lock（docs/plan/01 §7.2，D-02）。 */
export function lockFromError(code: string): LockReason | null {
  switch (code) {
    case "quota_exhausted":
      return "quota_exhausted";
    case "subscription_expired":
      return "expired";
    case "key_revoked":
      return "signed_out";
    case "rate_limited":
    case "model_not_allowed":
    case "invalid_api_key":
    case "upstream_unavailable":
    case "bad_request":
    case "internal":
      return null;
    default:
      return null;
  }
}

/** severity 阈值（docs/plan/01 §7.2）：≥80% warn，≥95% 或 ≤3 天 critical，locked 覆盖一切。 */
export function severityOfInput(percentUsed: number, daysLeft: number, locked: boolean): SubscriptionSeverity {
  if (locked) return "locked";
  if (percentUsed >= 95 || daysLeft <= 3) return "critical";
  if (percentUsed >= 80) return "warn";
  return "ok";
}

/** daysLeft 派生：校偏后的 now 与 expiresAt，向上取整，下限 0。 */
export function deriveDaysLeft(expiresAtIso: string, nowMs: number, skewMs: number): number {
  const correctedNow = nowMs + skewMs;
  const diff = new Date(expiresAtIso).getTime() - correctedNow;
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function parseServerSkew(serverTimeIso: string, nowMs: number): number {
  const serverMs = new Date(serverTimeIso).getTime();
  return Number.isFinite(serverMs) ? serverMs - nowMs : 0;
}

export function createSubscriptionStore() {
  return create<SubscriptionState>((set, get) => ({
    status: "idle",
    snapshot: null,
    receivedAt: null,
    serverSkewMs: 0,
    lastNotice: null,
    lock: null,
    lastError: null,

    applyStatus(snapshot, now = Date.now()) {
      set((state) => ({
        status: "ready",
        // 轮询是服务器事实：覆盖 headers 兜底；notice 若比这次轮询新则保留。
        snapshot,
        receivedAt: now,
        serverSkewMs: parseServerSkew(snapshot.serverTime, now),
        lock:
          snapshot.lock !== null
            ? { reason: snapshot.lock.reason, renewUrl: snapshot.lock.renewUrl }
            : null,
        lastError: null,
        // notice 的 remaining 比 pre-request 轮询更精确：只有当 notice 缺失或
        // 属于更旧的响应时才让轮询清掉它。
        lastNotice:
          state.lastNotice && state.lastNotice.creditsRemaining === snapshot.credits.remaining
            ? state.lastNotice
            : state.lastNotice,
      }));
    },

    applyUsageNotice(notice, now = Date.now()) {
      const current = get().snapshot;
      set((state) => {
        if (!current) {
          return { lastNotice: notice, receivedAt: now };
        }
        // notice 是 post-request 权威值：直接推进本地余额快照（不是服务器事实，
        // 但比 pre-request 轮询新）。percentUsed 反推 used/limit。
        const used = Math.max(
          0,
          Math.min(current.credits.limit, current.credits.limit - notice.creditsRemaining),
        );
        return {
          status: "ready",
          lastNotice: notice,
          receivedAt: now,
          snapshot: {
            ...current,
            credits: {
              ...current.credits,
              remaining: notice.creditsRemaining,
              used,
              percentUsed: current.credits.limit > 0 ? (used / current.credits.limit) * 100 : 100,
            },
          },
        };
      });
    },

    applyHeaders(headers, now = Date.now()) {
      const current = get().snapshot;
      // 最低权威（docs/plan/01 §7.1 优先级 3）：headers 是 pre-request 快照且无
      // 时间戳，任何轮询/notice 都比它新。只有完全没有快照时才标记接收时间；
      // 不构造假快照、也不覆盖已有数据。
      if (!current) {
        set({ receivedAt: now });
      }
    },

    setLockFromError(code, renewUrl) {
      const reason = lockFromError(code);
      if (!reason) return;
      set({ lock: { reason, renewUrl: renewUrl ?? "/dashboard/billing" } });
    },

    async refresh() {
      set({ status: get().snapshot ? "ready" : "loading" });
      // 实际轮询由 useSubscription 服务 hook 执行（含 RPC 与错误分类）；
      // store 只承接结果，保持本文件无网络依赖、可纯测。
    },

    reset() {
      set({
        status: "signed_out",
        snapshot: null,
        receivedAt: null,
        serverSkewMs: 0,
        lastNotice: null,
        lock: { reason: "signed_out", renewUrl: "/sign-in" },
        lastError: null,
      });
    },
  }));
}

export type SubscriptionStore = ReturnType<typeof createSubscriptionStore>;

/** 应用级单例：HUD 组件直接使用（docs/plan/01 §7.2 一个 owner）。 */
export const useSubscriptionStore = createSubscriptionStore();
