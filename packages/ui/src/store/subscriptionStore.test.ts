/** D-01/D-02（docs/plan/04 §2.3）：合并优先级、newer-wins、校偏 daysLeft、severity。 */
import { describe, expect, it } from "vitest";
import {
  createSubscriptionStore,
  deriveDaysLeft,
  lockFromError,
  severityOfInput,
} from "@/store/subscriptionStore.js";
import type { SubscriptionStatusResponse } from "@zcode/deepcode";

function status(overrides: Partial<SubscriptionStatusResponse> = {}): SubscriptionStatusResponse {
  const now = new Date();
  return {
    plan: { id: "pro-monthly", tier: "pro", name: { en: "Pro", ar: "احترافي" } },
    status: "active",
    credits: { limit: 1_000_000, used: 100_000, remaining: 900_000, percentUsed: 10 },
    period: {
      startsAt: new Date(now.getTime() - 86_400_000).toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      daysLeft: 30,
    },
    limits: { rpm: 60, allowedModels: ["glm-5.3"] },
    lock: null,
    serverTime: now.toISOString(),
    ...overrides,
  };
}

function notice(creditsRemaining: number, requestId = "r1") {
  return {
    requestId,
    model: "glm-5.3",
    tokens: { input: 100, output: 50, cachedInput: 10, reasoning: 0 },
    creditsCharged: 90,
    creditsRemaining,
    percentUsed: 0,
    estimated: false,
  };
}

describe("subscriptionStore merge precedence (D-01)", () => {
  it("status poll becomes the snapshot; headers only fill the void", () => {
    const store = createSubscriptionStore();
    expect(store.getState().status).toBe("idle");
    store.getState().applyHeaders({ creditsRemaining: 123, percentUsed: 45 });
    // 没有 snapshot 时 headers 只标记 receivedAt，不构造假快照。
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().receivedAt).not.toBeNull();

    store.getState().applyStatus(status());
    expect(store.getState().snapshot?.credits.remaining).toBe(900_000);

    // headers 是最低权威：有轮询数据时不覆盖。
    store.getState().applyHeaders({ creditsRemaining: 1, percentUsed: 99 });
    expect(store.getState().snapshot?.credits.remaining).toBe(900_000);
  });

  it("usage notice overrides the snapshot balance (post-request authority)", () => {
    const store = createSubscriptionStore();
    store.getState().applyStatus(status());
    store.getState().applyUsageNotice(notice(800_000));
    expect(store.getState().snapshot?.credits.remaining).toBe(800_000);
    expect(store.getState().snapshot?.credits.used).toBe(200_000);
    expect(store.getState().lastNotice?.requestId).toBe("r1");
  });

  it("serverTime skew feeds daysLeft derivation", () => {
    const now = Date.now();
    const serverAhead = new Date(now + 60_000).toISOString();
    store: {
      const s = createSubscriptionStore();
      s.getState().applyStatus(status({ serverTime: serverAhead, period: { startsAt: serverAhead, expiresAt: new Date(now + 86_400_000 * 1.5).toISOString(), daysLeft: 2 } }), now);
      expect(s.getState().serverSkewMs).toBe(60_000);
      // 1.5 天后过期 + 服务器时钟快 60 秒 → daysLeft = 2。
      expect(deriveDaysLeft(s.getState().snapshot!.period.expiresAt, now, s.getState().serverSkewMs)).toBe(2);
      break store;
    }
  });

  it("severity thresholds: 80% warn, 95%/≤3d critical, lock wins", () => {
    expect(severityOfInput(79.9, 30, false)).toBe("ok");
    expect(severityOfInput(80, 30, false)).toBe("warn");
    expect(severityOfInput(94.9, 30, false)).toBe("warn");
    expect(severityOfInput(95, 30, false)).toBe("critical");
    expect(severityOfInput(10, 3, false)).toBe("critical");
    expect(severityOfInput(10, 30, true)).toBe("locked");
  });
});

describe("lock derivation (D-02)", () => {
  it("maps gateway error codes to lock reasons", () => {
    expect(lockFromError("quota_exhausted")).toBe("quota_exhausted");
    expect(lockFromError("subscription_expired")).toBe("expired");
    expect(lockFromError("key_revoked")).toBe("signed_out");
  });

  it("transient errors never lock", () => {
    for (const code of ["rate_limited", "upstream_unavailable", "internal", "bad_request", "model_not_allowed"]) {
      expect(lockFromError(code)).toBeNull();
    }
  });

  it("lock clears when a healthy status arrives", () => {
    const store = createSubscriptionStore();
    store.getState().setLockFromError("quota_exhausted", "https://x/dashboard/billing");
    expect(store.getState().lock?.reason).toBe("quota_exhausted");
    store.getState().applyStatus(status({ lock: null }));
    expect(store.getState().lock).toBeNull();
  });

  it("reset signs out and locks", () => {
    const store = createSubscriptionStore();
    store.getState().applyStatus(status());
    store.getState().reset();
    expect(store.getState().status).toBe("signed_out");
    expect(store.getState().lock?.reason).toBe("signed_out");
    expect(store.getState().snapshot).toBeNull();
  });
});
