/**
 * 订阅 HUD 组件族（docs/plan/01 §7.3，D-03）。
 *
 * 状态矩阵（每种状态都实现）：loading（骨架，无布局抖动）、ready、stale
 * （>5 分钟未更新）、error（重试）、signed_out。severity 用图标 + 文本表达，
 * 不只靠颜色（无障碍 §7.3）；进度条 role=progressbar + aria-valuenow。
 * 视觉 token 映射到上游语义层：cyan 正常、amber ≥80%、red ≥95% / 锁定。
 */
import { useEffect, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  severityOfInput,
  useSubscriptionStore,
  type SubscriptionSeverity,
} from "@/store/subscriptionStore.js";
import { Progress } from "@/components/ui/progress.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

const STALE_AFTER_MS = 5 * 60_000;

export function severityColor(level: SubscriptionSeverity): string {
  switch (level) {
    case "warn":
      return "text-warning";
    case "critical":
      return "text-danger";
    case "locked":
      return "text-danger";
    default:
      return "text-brand";
  }
}

export function useSubscriptionViewState() {
  const store = useSubscriptionStore();
  const [now, setNow] = useState(() => Date.now());
  // 60s 心跳驱动 stale 判定与倒计时，不与 store 更新耦合。
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const snapshot = store.snapshot;
  const stale =
    snapshot !== null && store.receivedAt !== null && now - store.receivedAt > STALE_AFTER_MS;
  const daysLeft =
    snapshot !== null
      ? Math.max(0, Math.ceil((new Date(snapshot.period.expiresAt).getTime() - (now + store.serverSkewMs)) / 86_400_000))
      : null;
  const severity: SubscriptionSeverity =
    store.lock !== null
      ? "locked"
      : snapshot === null
        ? "ok"
        : severityOfInput(snapshot.credits.percentUsed, daysLeft ?? 30, false);
  return { store, snapshot, stale, daysLeft, severity };
}

/** 侧栏底部 chip：计划名 + 细进度条 + 剩余额（紧凑数字）+ 天数。 */
export function SubscriptionHudChip({ compact = false }: { compact?: boolean }) {
  const { intl, locale } = useZCodeIntl();
  const { store, snapshot, stale, daysLeft, severity } = useSubscriptionViewState();

  if (store.status === "signed_out" || (store.status === "idle" && !snapshot)) {
    return null;
  }
  if (!snapshot) {
    return <div className="h-6 w-full animate-pulse rounded bg-surface-raised" aria-hidden="true" />;
  }
  const remaining = snapshot.credits.remaining.toLocaleString("en-US", { notation: "compact" });
  const label = intl.formatMessage({ id: "deepcode.hud.credits" }, { remaining });
  return (
    <div className="w-full px-2 py-1" data-testid="subscription-hud-chip">
      <div className="flex items-center justify-between text-ui-sm">
        <span className="truncate text-foreground-subtle">{snapshot.plan.name[locale === "ar" ? "ar" : "en"]}</span>
        <span className={`tabular-nums ${severityColor(severity)}`}>
          {severity === "critical" || severity === "locked" ? "⚠ " : ""}
          {remaining}
        </span>
      </div>
      <Progress
        value={snapshot.credits.used}
        max={snapshot.credits.limit || 1}
        className="mt-1 h-1"
        aria-label={label}
      />
      {!compact ? (
        <div className="mt-0.5 flex justify-between text-[11px] text-foreground-subtle tabular-nums">
          <span>{stale ? intl.formatMessage({ id: "deepcode.hud.stale" }) : intl.formatMessage({ id: "deepcode.hud.expiresIn" }, { days: daysLeft ?? 0 })}</span>
          {/* 用户需要同时看到已用与总额，而不只是剩余数和进度条。 */}
          <span data-testid="subscription-hud-used">
            {intl.formatMessage(
              { id: "deepcode.hud.usedOf" },
              {
                used: snapshot.credits.used.toLocaleString("en-US", { notation: "compact" }),
                limit: snapshot.credits.limit.toLocaleString("en-US", { notation: "compact" }),
              },
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** 锁定模态：app 级阻塞对话框，focus trap 由 Radix Dialog 提供。 */
/** renewUrl 可能是门户绝对地址或相对路径；只把 path+query 交给 main（同源打开）。 */
export function portalPathFromRenewUrl(renewUrl: string | undefined): string {
  if (!renewUrl) return "/dashboard/billing";
  try {
    const url = new URL(renewUrl, "https://portal.invalid");
    return `${url.pathname}${url.search}` || "/dashboard/billing";
  } catch {
    return "/dashboard/billing";
  }
}

export function SubscriptionLockModal() {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const { store } = useSubscriptionViewState();
  const lock = store.lock;
  if (!lock || store.status === "signed_out") return null;

  const copyByReason: Record<string, { title: string; body: string; action: string }> = {
    quota_exhausted: {
      title: intl.formatMessage({ id: "deepcode.lock.quota.title" }),
      body: intl.formatMessage({ id: "deepcode.lock.quota.body" }),
      action: intl.formatMessage({ id: "deepcode.lock.action.renew" }),
    },
    expired: {
      title: intl.formatMessage({ id: "deepcode.lock.expired.title" }),
      body: intl.formatMessage({ id: "deepcode.lock.expired.body" }),
      action: intl.formatMessage({ id: "deepcode.lock.action.renew" }),
    },
    suspended: {
      title: intl.formatMessage({ id: "deepcode.lock.suspended.title" }),
      body: intl.formatMessage({ id: "deepcode.lock.suspended.body" }),
      action: intl.formatMessage({ id: "deepcode.lock.action.contact" }),
    },
    payment_failed: {
      title: intl.formatMessage({ id: "deepcode.lock.payment.title" }),
      body: intl.formatMessage({ id: "deepcode.lock.payment.body" }),
      action: intl.formatMessage({ id: "deepcode.lock.action.payment" }),
    },
    signed_out: {
      title: intl.formatMessage({ id: "deepcode.lock.signedOut.title" }),
      body: intl.formatMessage({ id: "deepcode.lock.signedOut.body" }),
      action: intl.formatMessage({ id: "deepcode.lock.action.signIn" }),
    },
  };
  // A brand-new account has never subscribed: invite it to choose a plan instead of
  // telling it that a subscription it never had "expired".
  const neverSubscribed = lock.reason === "expired" && store.snapshot?.plan.id === "none";
  // The 24-hour free trial ended: say so and invite a plan (not "subscription expired").
  const trialEnded = (lock.reason === "expired" || lock.reason === "quota_exhausted") && store.snapshot?.plan.id === "trial";
  const copy = trialEnded
    ? {
        title: intl.formatMessage({ id: "deepcode.lock.trialEnded.title" }),
        body: intl.formatMessage({ id: "deepcode.lock.trialEnded.body" }),
        action: intl.formatMessage({ id: "deepcode.lock.action.choosePlan" }),
      }
    : neverSubscribed
    ? {
        title: intl.formatMessage({ id: "deepcode.lock.noPlan.title" }),
        body: intl.formatMessage({ id: "deepcode.lock.noPlan.body" }),
        action: intl.formatMessage({ id: "deepcode.lock.action.choosePlan" }),
      }
    : (copyByReason[lock.reason] ?? copyByReason.expired!);

  return (
    <Dialog open>
      <DialogContent
        role="alertdialog"
        aria-label={copy.title}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              // 门户在系统浏览器打开（main 校验同源路径）；未登录时直接走 PKCE 登录。
              if (lock.reason === "signed_out") {
                void platform.deepcode?.startSignIn();
                return;
              }
              void platform.deepcode?.openPortal(portalPathFromRenewUrl(lock.renewUrl));
            }}
          >
            {copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** composer 上方配额提醒：≥80% 常驻提示，锁定时替换发送提示。 */
export function ComposerQuotaNotice() {
  const { intl } = useZCodeIntl();
  const { store, severity, snapshot } = useSubscriptionViewState();
  if (store.lock !== null || !snapshot) return null;
  if (severity !== "warn" && severity !== "critical") return null;
  return (
    <div
      role="status"
      data-testid="composer-quota-notice"
      className={`mx-2 mb-1 rounded px-2 py-1 text-ui-sm ${
        severity === "critical" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"
      }`}
    >
      {severity === "critical"
        ? intl.formatMessage({ id: "deepcode.quota.critical" }, { percent: Math.round(snapshot.credits.percentUsed) })
        : intl.formatMessage({ id: "deepcode.quota.warn" }, { percent: Math.round(snapshot.credits.percentUsed) })}
    </div>
  );
}
