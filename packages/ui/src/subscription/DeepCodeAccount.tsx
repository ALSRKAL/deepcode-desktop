/**
 * DeepCode 账号接入（docs/plan/01 §6–§7）：把 main 进程的账号桥接到 subscriptionStore
 * 与 HUD。密钥永远留在 main；这里只拿账号状态与 schema 校验过的订阅快照。
 *
 * - DeepCodeAccountSync：根级挂载一次，轮询 /v1/subscription/status（经 main 代查），
 *   窗口重新获得焦点与账号变化时立即刷新；渲染锁定模态。
 * - DeepCodeAccountChip：侧栏底部入口，未登录显示登录按钮，已登录显示 HUD chip。
 */
import { useCallback, useEffect, useState } from "react";
import type { DeepCodeAccountBridge, DeepCodeAuthState } from "@zcode/shared";
import { SubscriptionStatusResponseSchema } from "@zcode/deepcode";
import { ExternalLink, LogIn, LogOut } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { Button } from "@/components/ui/button.js";
import { useSubscriptionStore } from "@/store/subscriptionStore.js";
import { SubscriptionHudChip, SubscriptionLockModal } from "@/subscription/SubscriptionHud.js";

export const DEEPCODE_STATUS_POLL_MS = 60_000;

const SIGNED_OUT: DeepCodeAuthState = {
  signedIn: false,
  pending: false,
  user: null,
  plan: null,
  lastError: null,
};

/** 拉一次订阅状态并写入 store；导出供测试。 */
export async function refreshDeepCodeSubscription(
  bridge: DeepCodeAccountBridge,
  store: ReturnType<typeof useSubscriptionStore.getState>,
): Promise<void> {
  void store.refresh();
  const result = await bridge.fetchSubscriptionStatus();
  if (result.ok) {
    const parsed = SubscriptionStatusResponseSchema.safeParse(result.status);
    if (parsed.success) {
      store.applyStatus(parsed.data, result.receivedAt);
    }
    return;
  }
  if (result.code === "signed_out") {
    store.reset();
    return;
  }
  // 网关错误码（quota_exhausted / subscription_expired / …）转为锁定；网络错误保留旧快照。
  store.setLockFromError(result.code, result.renewUrl);
}

export function useDeepCodeAuthState(bridge: DeepCodeAccountBridge | undefined): DeepCodeAuthState {
  const [state, setState] = useState<DeepCodeAuthState>(SIGNED_OUT);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.getAuthState().then((next) => {
      if (!cancelled) setState(next);
    });
    const dispose = bridge.onAuthChanged((next) => setState(next));
    return () => {
      cancelled = true;
      dispose();
    };
  }, [bridge]);
  return state;
}

export function DeepCodeAccountSync() {
  const platform = usePlatform();
  const bridge = platform.deepcode;
  const auth = useDeepCodeAuthState(bridge);

  useEffect(() => {
    if (!bridge) return;
    const store = useSubscriptionStore.getState();
    if (!auth.signedIn) {
      store.reset();
      return;
    }
    const run = () => void refreshDeepCodeSubscription(bridge, useSubscriptionStore.getState());
    run();
    const timer = setInterval(run, DEEPCODE_STATUS_POLL_MS);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [bridge, auth.signedIn, auth.user?.id]);

  if (!bridge) return null;
  return <SubscriptionLockModal />;
}

export function DeepCodeAccountChip() {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const bridge = platform.deepcode;
  const auth = useDeepCodeAuthState(bridge);
  const signIn = useCallback(() => void bridge?.startSignIn(), [bridge]);
  const signOut = useCallback(() => void bridge?.signOut(), [bridge]);
  const openAccount = useCallback(() => void bridge?.openPortal("/dashboard"), [bridge]);

  if (!bridge) return null;

  if (!auth.signedIn) {
    return (
      <div className="flex flex-col gap-1" data-testid="deepcode-account-signed-out">
        <Button type="button" variant="outline" size="sm" onClick={signIn} className="w-full gap-2">
          <LogIn className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{intl.formatMessage({ id: "deepcode.account.signIn" })}</span>
        </Button>
        {auth.pending ? (
          <p role="status" className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "deepcode.account.waiting" })}
          </p>
        ) : auth.lastError ? (
          <p role="alert" className="text-ui-sm text-danger">
            {intl.formatMessage({ id: "deepcode.account.error" })}
          </p>
        ) : null}
      </div>
    );
  }

  const email = auth.user?.email ?? "";
  const displayName = auth.user?.name?.trim() || email;
  return (
    <div className="flex flex-col gap-2" data-testid="deepcode-account-signed-in">
      {/* The account that is signed in on the website: same name, email and brand colours. */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-[#111827] text-[12px] font-semibold text-[#F8FAFC] ring-1 ring-[#22D3EE]/70"
        >
          {accountInitials(auth.user?.name ?? null, email)}
        </span>
        <div className="min-w-0 flex-1" data-testid="deepcode-account-identity">
          <p className="truncate text-ui-sm font-medium text-foreground">{displayName}</p>
          {displayName !== email ? (
            <p className="truncate text-ui-xs text-foreground-subtle" dir="ltr">
              {email}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={openAccount}
          aria-label={intl.formatMessage({ id: "deepcode.account.manage" })}
          title={intl.formatMessage({ id: "deepcode.account.manage" })}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={signOut}
          aria-label={intl.formatMessage({ id: "deepcode.account.signOut" })}
          title={intl.formatMessage({ id: "deepcode.account.signOut" })}
        >
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </Button>
      </div>
      <SubscriptionHudChip />
    </div>
  );
}

/** Up to two initials from the account name (any script), else the email's first letter. */
export function accountInitials(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  const fromName = letters.map((w) => Array.from(w)[0]!).join("");
  return (fromName || Array.from(email)[0] || "?").toLocaleUpperCase();
}
