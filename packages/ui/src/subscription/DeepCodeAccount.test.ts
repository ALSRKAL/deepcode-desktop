/** D-07 / D-02（renderer 侧）：main 代查结果如何落进 subscriptionStore。 */
import { describe, expect, it } from "vitest";
import type { DeepCodeAccountBridge, DeepCodeSubscriptionStatusResult } from "@zcode/shared";
import { createSubscriptionStore } from "@/store/subscriptionStore.js";
import { accountInitials, refreshDeepCodeSubscription } from "@/subscription/DeepCodeAccount.js";
import { portalPathFromRenewUrl } from "@/subscription/SubscriptionHud.js";

const STATUS = {
  plan: { id: "p", tier: "pro", name: { en: "Pro", ar: "احترافي" } },
  status: "active",
  credits: { limit: 100, used: 10, remaining: 90, percentUsed: 10 },
  period: { startsAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", daysLeft: 16 },
  limits: { rpm: 60, allowedModels: ["m1"] },
  lock: null,
  serverTime: "2026-11-15T00:00:00Z",
};

function bridge(result: DeepCodeSubscriptionStatusResult): DeepCodeAccountBridge {
  return {
    getAuthState: async () => ({ signedIn: true, pending: false, user: null, plan: null, lastError: null }),
    startSignIn: async () => {},
    signOut: async () => {},
    fetchSubscriptionStatus: async () => result,
    openPortal: async () => {},
    onAuthChanged: () => () => {},
  };
}

describe("refreshDeepCodeSubscription", () => {
  it("applies a schema-valid status snapshot", async () => {
    const store = createSubscriptionStore();
    await refreshDeepCodeSubscription(bridge({ ok: true, status: STATUS, receivedAt: 1 }), store.getState());
    expect(store.getState().status).toBe("ready");
    expect(store.getState().snapshot?.credits.remaining).toBe(90);
  });

  it("ignores a malformed status instead of corrupting the HUD", async () => {
    const store = createSubscriptionStore();
    await refreshDeepCodeSubscription(bridge({ ok: true, status: { credits: "x" }, receivedAt: 1 }), store.getState());
    expect(store.getState().snapshot).toBeNull();
  });

  it("maps gateway lock codes to the lock modal and signed_out to a reset", async () => {
    const store = createSubscriptionStore();
    await refreshDeepCodeSubscription(
      bridge({ ok: false, code: "quota_exhausted", renewUrl: "https://portal.test/dashboard/billing?r=1" }),
      store.getState(),
    );
    expect(store.getState().lock?.reason).toBe("quota_exhausted");

    await refreshDeepCodeSubscription(bridge({ ok: false, code: "signed_out" }), store.getState());
    expect(store.getState().status).toBe("signed_out");
  });

  it("keeps the last snapshot on a network error", async () => {
    const store = createSubscriptionStore();
    await refreshDeepCodeSubscription(bridge({ ok: true, status: STATUS, receivedAt: 1 }), store.getState());
    await refreshDeepCodeSubscription(bridge({ ok: false, code: "network_error" }), store.getState());
    expect(store.getState().snapshot?.credits.remaining).toBe(90);
    expect(store.getState().lock).toBeNull();
  });
});

describe("portalPathFromRenewUrl", () => {
  it("keeps only path and query, never the origin", () => {
    expect(portalPathFromRenewUrl("https://evil.test/dashboard/billing?x=1")).toBe("/dashboard/billing?x=1");
    expect(portalPathFromRenewUrl("/ar/dashboard/billing")).toBe("/ar/dashboard/billing");
    expect(portalPathFromRenewUrl(undefined)).toBe("/dashboard/billing");
  });
});

describe("account identity in the sidebar", () => {
  it("shows initials from the website account name, in any script", () => {
    expect(accountInitials("Mohammed Aref Saeed Alsrkal", "m@x.com")).toBe("MA");
    expect(accountInitials("محمد السركال", "m@x.com")).toBe("ما");
    expect(accountInitials("alsrkal", "m@x.com")).toBe("A");
  });
  it("falls back to the email when the account has no name", () => {
    expect(accountInitials(null, "owner@deepcode.dev")).toBe("O");
    expect(accountInitials("   ", "")).toBe("?");
  });
});
