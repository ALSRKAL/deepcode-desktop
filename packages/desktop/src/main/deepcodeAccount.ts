/**
 * DeepCode 订阅账号的 main 进程装配（docs/plan/01 §6–§7，doc 00 §4.1）。
 *
 * - 设备密钥只存在于 main 与加密凭据文件中：renderer 通过 IPC 只拿到账号状态与
 *   订阅快照，永远拿不到密钥（D-05）。
 * - CLI agent 在请求期从同一个凭据文件读取密钥（adapters/auth/deepcode-device-key），
 *   因此登录/登出对已运行的 agent 立即生效，密钥也不进入 agent 子进程 env。
 * - deep link `deepcodestudio://auth?token&state` 由 handleDeepLink 的 onAuthCallback
 *   交给这里；state 校验与 PKCE 兑换在 @zcode/deepcode 的 auth service 内。
 */
import { hostname } from "node:os";
import { BrowserWindow, ipcMain, shell } from "electron";
import {
  DEEPCODE_DEVICE_CREDENTIAL_KEY,
  createDeepCodeAuthService,
  type DeepCodeAuthService,
  type DeepCodeSession,
} from "@zcode/deepcode";
import {
  PlatformChannels,
  type DeepCodeAuthState,
  type DeepCodeSubscriptionStatusResult,
} from "@zcode/shared";

/** 非秘密的会话摘要（用户/计划/网关地址），重启后恢复 HUD 用。 */
export const DEEPCODE_SESSION_CREDENTIAL_KEY = "deepcode.session";

const STATUS_TIMEOUT_MS = 10_000;

export interface DeepCodeCredentialStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DeepCodeAccountDeps {
  credentials: DeepCodeCredentialStore;
  webOrigin: string;
  appVersion: string;
  platform?: NodeJS.Platform;
  arch?: string;
  openExternal?: (url: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  broadcast?: (state: DeepCodeAuthState) => void;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface DeepCodeAccount {
  readonly auth: DeepCodeAuthService;
  getAuthState(): Promise<DeepCodeAuthState>;
  startSignIn(): Promise<void>;
  signOut(): Promise<void>;
  fetchSubscriptionStatus(): Promise<DeepCodeSubscriptionStatusResult>;
  openPortal(path: string): Promise<void>;
  /** handleDeepLink 的 onAuthCallback：同步返回“已消化”，兑换异步完成。 */
  handleAuthCallback(url: URL): boolean;
}

/** 门户路径白名单：同源绝对路径，不允许协议/authority/反斜杠。 */
export function isSafePortalPath(path: string): boolean {
  return /^\/[A-Za-z0-9/_\-.?=&%]*$/.test(path) && !path.startsWith("//") && !path.includes("..");
}

function sessionToState(
  session: DeepCodeSession | null,
  pending: boolean,
  lastError: string | null,
): DeepCodeAuthState {
  return {
    signedIn: session !== null,
    pending,
    user: session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null,
    plan: session ? { id: session.plan.id, tier: session.plan.tier, name: session.plan.name } : null,
    lastError,
  };
}

function parseStoredSession(raw: string | null): DeepCodeSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DeepCodeSession;
    if (value && typeof value.gatewayBaseUrl === "string" && value.user && value.plan) return value;
  } catch {
    // 损坏的摘要只影响 HUD 展示：当作未知会话，密钥仍在则状态接口会刷新。
  }
  return null;
}

export function createDeepCodeAccount(deps: DeepCodeAccountDeps): DeepCodeAccount {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  let pending = false;
  let lastError: string | null = null;

  const auth = createDeepCodeAuthService({
    credentials: deps.credentials,
    webOrigin: deps.webOrigin,
    device: {
      device_name: (hostname() || "desktop").slice(0, 100),
      os: `${platform}-${arch}`.slice(0, 50),
      app_version: deps.appVersion.slice(0, 50),
    },
    openExternal: deps.openExternal ?? ((url) => shell.openExternal(url)),
    fetchImpl,
    logger: deps.logger,
  });

  async function loadSession(): Promise<DeepCodeSession | null> {
    const key = await deps.credentials.load(DEEPCODE_DEVICE_CREDENTIAL_KEY);
    if (!key) return null;
    return (await auth.getSession()) ?? parseStoredSession(await deps.credentials.load(DEEPCODE_SESSION_CREDENTIAL_KEY));
  }

  async function currentState(): Promise<DeepCodeAuthState> {
    return sessionToState(await loadSession(), pending, lastError);
  }

  async function notify(): Promise<void> {
    if (!deps.broadcast) return;
    deps.broadcast(await currentState());
  }

  async function clearLocal(): Promise<void> {
    await deps.credentials.delete(DEEPCODE_DEVICE_CREDENTIAL_KEY);
    await deps.credentials.delete(DEEPCODE_SESSION_CREDENTIAL_KEY);
  }

  return {
    auth,

    getAuthState: currentState,

    async startSignIn() {
      lastError = null;
      pending = true;
      await auth.startSignIn();
      await notify();
    },

    async signOut() {
      pending = false;
      lastError = null;
      await auth.signOut();
      await deps.credentials.delete(DEEPCODE_SESSION_CREDENTIAL_KEY);
      await notify();
    },

    handleAuthCallback(url: URL) {
      if (!pending) {
        // 没有本进程发起的登录：可能是重放或伪造链接，直接丢弃（D-04）。
        deps.logger.warn("[deepcode] auth deep link without a pending sign-in; dropped");
        return false;
      }
      void auth
        .completeFromDeepLink(url.toString())
        .then(async (session) => {
          pending = false;
          lastError = null;
          await deps.credentials.save(DEEPCODE_SESSION_CREDENTIAL_KEY, JSON.stringify(session));
          deps.logger.info("[deepcode] signed in", { userId: session.user.id });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // state 不匹配不结束待处理登录：真正的回调可能还在路上。
          if (!message.includes("state mismatch")) pending = false;
          lastError = /exchange failed: \d+ (\w+)/.exec(message)?.[1] ?? "sign_in_failed";
          deps.logger.warn("[deepcode] sign-in failed", { reason: lastError });
        })
        .finally(() => {
          void notify();
        });
      return true;
    },

    async fetchSubscriptionStatus(): Promise<DeepCodeSubscriptionStatusResult> {
      const apiKey = await deps.credentials.load(DEEPCODE_DEVICE_CREDENTIAL_KEY);
      const session = await loadSession();
      if (!apiKey || !session) return { ok: false, code: "signed_out" };
      const base = session.gatewayBaseUrl.replace(/\/+$/, "");
      let response: Response;
      try {
        response = await fetchImpl(`${base}/subscription/status`, {
          headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, code: "network_error" };
      }
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; renewUrl?: string } }
        | null;
      if (response.ok && body) {
        return { ok: true, status: body, receivedAt: Date.now() };
      }
      const code = body?.error?.code ?? `http_${response.status}`;
      if (response.status === 401 && (code === "key_revoked" || code === "invalid_api_key")) {
        // 设备在门户被撤销（E2E 场景 5）：本地登出，HUD 回到登录态。
        await clearLocal();
        await auth.signOut().catch(() => undefined);
        await notify();
        return { ok: false, code: "signed_out" };
      }
      return { ok: false, code, ...(body?.error?.renewUrl ? { renewUrl: body.error.renewUrl } : {}) };
    },

    async openPortal(path: string) {
      if (!isSafePortalPath(path)) {
        deps.logger.warn("[deepcode] refused portal path");
        return;
      }
      await (deps.openExternal ?? ((url: string) => shell.openExternal(url)))(
        new URL(path, deps.webOrigin).toString(),
      );
    },
  };
}

/** 注册 renderer 可调用的 IPC；返回 disposer。 */
export function registerDeepCodeAccountIpc(account: DeepCodeAccount): () => void {
  ipcMain.handle(PlatformChannels.DeepCodeGetAuthState, () => account.getAuthState());
  ipcMain.handle(PlatformChannels.DeepCodeStartSignIn, () => account.startSignIn());
  ipcMain.handle(PlatformChannels.DeepCodeSignOut, () => account.signOut());
  ipcMain.handle(PlatformChannels.DeepCodeFetchSubscriptionStatus, () =>
    account.fetchSubscriptionStatus(),
  );
  ipcMain.handle(PlatformChannels.DeepCodeOpenPortal, (_event, path: unknown) =>
    typeof path === "string" ? account.openPortal(path) : undefined,
  );
  return () => {
    for (const channel of [
      PlatformChannels.DeepCodeGetAuthState,
      PlatformChannels.DeepCodeStartSignIn,
      PlatformChannels.DeepCodeSignOut,
      PlatformChannels.DeepCodeFetchSubscriptionStatus,
      PlatformChannels.DeepCodeOpenPortal,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}

/** 向所有窗口广播账号状态变化。 */
export function broadcastDeepCodeAuthState(state: DeepCodeAuthState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PlatformChannels.DeepCodeAuthChanged, state);
  }
}
