/**
 * DeepCode 账号 main 装配（docs/plan/01 §6，D-04/D-05 的主进程部分，E2E 场景 1/5）。
 * 用内存凭据与假 fetch 走完整链路：发起登录 → deep link 回调 → PKCE 兑换 → 落凭据
 * → 代查订阅状态 → 撤销后本地登出；以及门户路径校验与重启后的会话恢复。
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

const { createDeepCodeAccount, isSafePortalPath, DEEPCODE_SESSION_CREDENTIAL_KEY } = await import(
  "./deepcodeAccount.js"
);

const KEY = `sk-dc-${"k".repeat(43)}`;
const WEB = "https://portal.test";
const GATEWAY = "https://gw.test/v1";
const logger = { info: () => {}, warn: () => {} };

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    load: async (k: string) => data.get(k) ?? null,
    save: async (k: string, v: string) => void data.set(k, v),
    delete: async (k: string) => void data.delete(k),
  };
}

const STATUS = {
  plan: { id: "p", tier: "pro", name: { en: "Pro", ar: "احترافي" } },
  status: "active",
  credits: { limit: 100, used: 10, remaining: 90, percentUsed: 10 },
  period: { startsAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", daysLeft: 16 },
  limits: { rpm: 60, allowedModels: ["m1"] },
  lock: null,
  serverTime: "2026-11-15T00:00:00Z",
};

function harness(gatewayResponse: () => Response = () => Response.json(STATUS)) {
  const credentials = memoryStore();
  const opened: string[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const broadcasts: unknown[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${WEB}/api/desktop/exchange`) {
      const body = JSON.parse(String(init?.body)) as { code_verifier: string };
      const challenge = new URL(opened[0]!).searchParams.get("code_challenge");
      const ok = createHash("sha256").update(body.code_verifier).digest("base64url") === challenge;
      if (!ok) return Response.json({ error: { code: "pkce_mismatch" } }, { status: 401 });
      return Response.json({
        apiKey: KEY,
        user: { id: "u1", email: "a@b.test", name: "A", locale: "ar" },
        plan: { id: "p", tier: "pro", name: { en: "Pro", ar: "احترافي" } },
        gatewayBaseUrl: GATEWAY,
      });
    }
    if (url === `${GATEWAY}/subscription/status`) return gatewayResponse();
    if (url === `${WEB}/api/desktop/device`) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const make = () =>
    createDeepCodeAccount({
      credentials,
      webOrigin: WEB,
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      openExternal: async (url) => void opened.push(url),
      fetchImpl,
      broadcast: (s) => broadcasts.push(s),
      logger,
    });
  return { account: make(), make, credentials, opened, calls, broadcasts };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe("DeepCode account (main process)", () => {
  it("signs in through the browser, stores the key only in credentials, and reports state without the key", async () => {
    const h = harness();
    await h.account.startSignIn();
    const login = new URL(h.opened[0]!);
    expect(login.origin + login.pathname).toBe(`${WEB}/auth/desktop`);
    expect(login.searchParams.get("os")).toBe("linux-x64");
    expect((await h.account.getAuthState()).pending).toBe(true);

    const state = login.searchParams.get("state")!;
    expect(h.account.handleAuthCallback(new URL(`deepcodestudio://auth?token=code1&state=${state}`))).toBe(true);
    await settle();

    expect(h.credentials.data.get("deepcode.deviceKey")).toBe(KEY);
    const auth = await h.account.getAuthState();
    expect(auth).toMatchObject({ signedIn: true, pending: false, user: { email: "a@b.test" } });
    expect(JSON.stringify(auth)).not.toContain(KEY);
    expect(JSON.stringify(h.broadcasts)).not.toContain(KEY);
  });

  it("drops an auth link when no sign-in is pending (replay / forged link)", async () => {
    const h = harness();
    expect(h.account.handleAuthCallback(new URL("deepcodestudio://auth?token=x&state=y"))).toBe(false);
    await settle();
    expect(h.calls).toHaveLength(0);
    expect(h.credentials.data.size).toBe(0);
  });

  it("a state mismatch is rejected and keeps the real sign-in pending", async () => {
    const h = harness();
    await h.account.startSignIn();
    h.account.handleAuthCallback(new URL("deepcodestudio://auth?token=x&state=forged"));
    await settle();
    expect(h.calls).toHaveLength(0);
    expect((await h.account.getAuthState()).pending).toBe(true);
  });

  it("fetches subscription status with the device key as Bearer, and restores the session after restart", async () => {
    const h = harness();
    await h.account.startSignIn();
    const state = new URL(h.opened[0]!).searchParams.get("state")!;
    h.account.handleAuthCallback(new URL(`deepcodestudio://auth?token=c&state=${state}`));
    await settle();
    expect(h.credentials.data.has(DEEPCODE_SESSION_CREDENTIAL_KEY)).toBe(true);

    const restarted = h.make();
    expect((await restarted.getAuthState()).signedIn).toBe(true);
    const result = await restarted.fetchSubscriptionStatus();
    expect(result).toMatchObject({ ok: true, status: STATUS });
    const call = h.calls.find((c) => c.url === `${GATEWAY}/subscription/status`)!;
    expect(new Headers(call.init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("a revoked device key signs the app out locally (E2E scenario 5)", async () => {
    const h = harness(() => Response.json({ error: { code: "key_revoked" } }, { status: 401 }));
    await h.account.startSignIn();
    const state = new URL(h.opened[0]!).searchParams.get("state")!;
    h.account.handleAuthCallback(new URL(`deepcodestudio://auth?token=c&state=${state}`));
    await settle();

    expect(await h.account.fetchSubscriptionStatus()).toEqual({ ok: false, code: "signed_out" });
    expect(h.credentials.data.has("deepcode.deviceKey")).toBe(false);
    expect((await h.account.getAuthState()).signedIn).toBe(false);
  });

  it("passes gateway lock codes through with the renew URL", async () => {
    const h = harness(() =>
      Response.json({ error: { code: "quota_exhausted", renewUrl: `${WEB}/dashboard/billing` } }, { status: 402 }),
    );
    await h.account.startSignIn();
    const state = new URL(h.opened[0]!).searchParams.get("state")!;
    h.account.handleAuthCallback(new URL(`deepcodestudio://auth?token=c&state=${state}`));
    await settle();
    expect(await h.account.fetchSubscriptionStatus()).toEqual({
      ok: false,
      code: "quota_exhausted",
      renewUrl: `${WEB}/dashboard/billing`,
    });
  });

  it("opens only same-origin portal paths", async () => {
    expect(isSafePortalPath("/dashboard/billing")).toBe(true);
    expect(isSafePortalPath("/ar/dashboard?tab=keys")).toBe(true);
    for (const bad of ["//evil.test/x", "https://evil.test", "javascript:alert(1)", "/a/../../b", "dashboard"]) {
      expect(isSafePortalPath(bad)).toBe(false);
    }
    const h = harness();
    await h.account.openPortal("//evil.test/x");
    await h.account.openPortal("/dashboard/billing");
    expect(h.opened).toEqual([`${WEB}/dashboard/billing`]);
  });
});
