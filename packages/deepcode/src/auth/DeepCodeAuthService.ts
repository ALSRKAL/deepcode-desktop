/**
 * DeepCode 登录服务（docs/plan/01 §6，doc 00 §4.1 时序）。
 *
 * 流程：
 * 1. startSignIn：生成 128-bit state + PKCE verifier（S256 challenge），打开系统
 *    浏览器到 `https://<web>/auth/desktop?state&code_challenge&device_name&os`。
 *    state 与 verifier 只保存在本进程内存，5 分钟有效期。
 * 2. 浏览器完成登录与同意后，302 到 `deepcodestudio://auth?token=<一次性码>&state`，
 *    OS 把 deep link 送回主进程 → handleDeepLink → completeFromDeepLink。
 * 3. completeFromDeepLink：校验 state 与待处理请求一致（防伪造/重放），带
 *    code_verifier 调 POST /api/desktop/exchange，返回的设备密钥只写 credential
 *    存储（host 私有，加密落盘），不进 renderer。
 * 4. signOut：删除凭据并调 DELETE /api/desktop/device 撤销服务端设备密钥。
 *
 * 安全边界（docs/plan/01 §6）：renderer 永远看不到密钥；401 key_revoked 由
 * 调用方（gateway 请求层）触发本地登出。
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { DEEPCODE_DEEP_LINK_SCHEME, DeepCodeExchangeResponseSchema, type DeepCodeExchangeResponse } from "./contracts.js";

export const DEEPCODE_DEVICE_CREDENTIAL_KEY = "deepcode.deviceKey";

export interface DeepCodeSession {
  user: DeepCodeExchangeResponse["user"];
  plan: DeepCodeExchangeResponse["plan"];
  gatewayBaseUrl: string;
}

export interface DeepCodeAuthStart {
  state: string;
  loginUrl: string;
}

export interface DeepCodeAuthService {
  /** 生成 state/PKCE 并返回系统浏览器登录 URL；同刻只允许一个待处理请求。 */
  startSignIn(): Promise<DeepCodeAuthStart>;
  /** deep link 回调：校验 state，兑换设备密钥并落凭据。 */
  completeFromDeepLink(url: string): Promise<DeepCodeSession>;
  /** 是否有待处理（或已完成）的登录上下文。 */
  hasPendingSignIn(): boolean;
  signOut(): Promise<void>;
  getSession(): Promise<DeepCodeSession | null>;
}

const PENDING_TTL_MS = 5 * 60_000;

const DEVICE_INFO_SCHEMA = z.object({
  device_name: z.string().min(1).max(100),
  os: z.string().min(1).max(50),
  app_version: z.string().max(50).optional(),
});

export interface DeepCodeAuthServiceDeps {
  /** ICredentialService 的最小面（避免拖入整个 services 类型面）。 */
  credentials: { load(key: string): Promise<string | null>; save(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
  /** DeepCode Web origin（构建期 DEEPCODE_WEB_ORIGIN；测试可注入 http://127.0.0.1）。 */
  webOrigin: string;
  /** 当前设备信息（consent 页展示 + exchange 载荷）。 */
  device: z.infer<typeof DEVICE_INFO_SCHEMA>;
  /** 打开系统浏览器；由主进程注入 shell.openExternal。 */
  openExternal: (url: string) => void | Promise<void>;
  /** 可注入的 fetch（测试）。默认全局 fetch。 */
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
}

interface PendingSignIn {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

export function createDeepCodeAuthService(deps: DeepCodeAuthServiceDeps): DeepCodeAuthService {
  const device = DEVICE_INFO_SCHEMA.parse(deps.device);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let pending: PendingSignIn | null = null;
  let lastSession: DeepCodeSession | null = null;

  const buildLoginUrl = (state: string, challenge: string): string => {
    const url = new URL("/auth/desktop", deps.webOrigin);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("device_name", device.device_name);
    url.searchParams.set("os", device.os);
    if (device.app_version) url.searchParams.set("app_version", device.app_version);
    return url.toString();
  };

  return {
    async startSignIn() {
      const state = randomBytes(16).toString("base64url");
      const { verifier, challenge } = pkcePair();
      pending = { state, codeVerifier: verifier, createdAt: now() };
      const loginUrl = buildLoginUrl(state, challenge);
      deps.logger?.info("[deepcode] sign-in started", { webOrigin: deps.webOrigin });
      await deps.openExternal(loginUrl);
      return { state, loginUrl };
    },

    hasPendingSignIn() {
      return pending !== null || lastSession !== null;
    },

    async completeFromDeepLink(url: string) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("[deepcode] deep link is not a valid URL");
      }
      if (parsed.protocol !== `${DEEPCODE_DEEP_LINK_SCHEME}:`) {
        throw new Error(`[deepcode] unexpected deep link scheme: ${parsed.protocol}`);
      }
      if (parsed.host !== "auth" && parsed.hostname !== "auth") {
        // workspace/open 等其他入口由原有 handler 处理，这里直接忽略。
        throw new Error("[deepcode] deep link is not an auth callback");
      }
      const token = parsed.searchParams.get("token");
      const state = parsed.searchParams.get("state");
      if (!token || !state) {
        throw new Error("[deepcode] auth deep link is missing token/state");
      }
      if (!pending) {
        throw new Error("[deepcode] no pending sign-in; dropping link");
      }
      if (pending.state !== state) {
        // state 不匹配 = 伪造或跨窗口串扰：静默丢弃（docs/plan/01 §6）。
        throw new Error("[deepcode] state mismatch; dropping link");
      }
      if (now() - pending.createdAt > PENDING_TTL_MS) {
        pending = null;
        throw new Error("[deepcode] pending sign-in expired; start again from the app");
      }

      const res = await fetchImpl(new URL("/api/desktop/exchange", deps.webOrigin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: token,
          code_verifier: pending.codeVerifier,
          device: {
            name: device.device_name,
            os: device.os,
            app_version: device.app_version,
          },
        }),
      });
      pending = null;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        throw new Error(`[deepcode] exchange failed: ${res.status} ${body?.error?.code ?? ""}`);
      }
      const exchange = DeepCodeExchangeResponseSchema.parse(await res.json());
      // 密钥只进 credential 存储（host 私有 + 加密落盘）；renderer 不可见。
      await deps.credentials.save(DEEPCODE_DEVICE_CREDENTIAL_KEY, exchange.apiKey);
      lastSession = {
        user: exchange.user,
        plan: exchange.plan,
        gatewayBaseUrl: exchange.gatewayBaseUrl,
      };
      deps.logger?.info("[deepcode] device key stored", { userId: exchange.user.id });
      return lastSession;
    },

    async signOut() {
      const apiKey = await deps.credentials.load(DEEPCODE_DEVICE_CREDENTIAL_KEY);
      await deps.credentials.delete(DEEPCODE_DEVICE_CREDENTIAL_KEY);
      lastSession = null;
      if (apiKey) {
        // 服务端撤销失败不阻断本地登出：密钥已删，下次请求自然 401。
        await fetchImpl(new URL("/api/desktop/device", deps.webOrigin), {
          method: "DELETE",
          headers: { authorization: `Bearer ${apiKey}` },
        }).catch(() => undefined);
      }
      deps.logger?.info("[deepcode] signed out");
    },

    async getSession() {
      const apiKey = await deps.credentials.load(DEEPCODE_DEVICE_CREDENTIAL_KEY);
      if (!apiKey) return null;
      return lastSession;
    },
  };
}
