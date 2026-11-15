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
import { LogIn, LogOut } from "lucide-react";
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

  return (
    <div className="flex items-start gap-1" data-testid="deepcode-account-signed-in">
      <div className="min-w-0 flex-1">
        <SubscriptionHudChip />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={signOut}
        aria-label={intl.formatMessage({ id: "deepcode.account.signOut" })}
        title={auth.user?.email ?? undefined}
      >
        <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </Button>
    </div>
  );
}
