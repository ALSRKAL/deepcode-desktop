import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppErrorBoundary, Root, ZCodeIntlProvider } from "@zcode/ui";
import type { RemoteServiceAccess } from "@zcode/client";
import type { WebRemoteControlBootstrapResult } from "@zcode/shared";
import { MobileRemoteControlClient, readPairingParamsFromLocation } from "./protocol.js";
import { presentMobileConnection, type MobileConnectionSnapshot } from "./connectionPresentation.js";
import { findKnownDeviceDisplay, rememberKnownDeviceDisplay } from "./knownDeviceDisplayCache.js";
import { pickBridgeWorkspace } from "./mobileTasks.js";
import { createWebPlatform } from "../webPlatform.js";
import { t } from "./mobileI18n.js";
import { logger } from "../../../ui/src/logger.js";

/**
 * 手机远控工作台（DeepCode Studio，2026-11-18）：与 ZCode 官方 `/remote/v4` 相同的做法，
 * 手机配对后直接挂载桌面同款 <Root>，服务经 relay bridge 走到桌面 Host。
 *
 * 为什么不是另写一套手机 UI：官方手机端就是桌面 UI（会话、侧栏、模型、预览全同），
 * 用户要的是「像打开电脑版一样」。连接是 replayable 由 Host 在 v4 hello 中裁定，
 * UI 侧无需（也不能）自行声明，桌面 continuous 链路不受影响。
 *
 * 状态所有者：配对/bridge 归 MobileRemoteControlClient；会话事实归 Host；
 * 本组件只在 bridge 代际变化时用新访问器重新挂载 <Root>（旧访问器的 RPC 已被拒绝）。
 */

type Mounted = {
  services: RemoteServiceAccess;
  generation: number;
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RemoteWorkbench() {
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [connection, setConnection] = useState<MobileConnectionSnapshot>({ state: "connecting" });
  const [bootstrap, setBootstrap] = useState<WebRemoteControlBootstrapResult | null>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);
  const [bridgeEpoch, setBridgeEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<MobileRemoteControlClient | null>(null);
  const platform = useMemo(() => createWebPlatform(), []);

  // 配对 + 连接：整页生命周期只有一个客户端。
  useEffect(() => {
    let params: ReturnType<typeof readPairingParamsFromLocation>;
    try {
      params = readPairingParamsFromLocation();
    } catch (reason) {
      setParamsError(describeError(reason));
      return;
    }
    const pairingName = params.deviceName?.trim() || null;
    setDeviceName(pairingName ?? findKnownDeviceDisplay(params.deviceMid)?.name ?? null);
    if (params.deviceMid && pairingName) {
      rememberKnownDeviceDisplay({
        deviceMid: params.deviceMid,
        name: pairingName,
        appVersion: params.appVersion,
      });
    }
    const client = new MobileRemoteControlClient(params, {
      onStateChange: (state, detail) => setConnection({ state, detail }),
      onPayload: (payload) => {
        if (payload.zcode_type === "workspace-list-updated") {
          setBootstrap((current) =>
            current
              ? { ...current, workspaces: payload.result.workspaces, tasks: payload.result.tasks }
              : current,
          );
        }
        // bridge 被降级/作废：旧访问器的在途 RPC 全部被拒绝，重开 bridge 并重挂 <Root>。
        if (payload.zcode_type === "bridge-degraded") setBridgeEpoch((value) => value + 1);
        if (payload.zcode_type === "app-error") setError(payload.error ?? payload.reason);
      },
    });
    clientRef.current = client;
    client.connect();
    const onOnline = () => client.retryNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") client.retryNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const paired = connection.state === "paired";

  // 断线重连后 socket 换代、bridge 也随之作废：重新拉 bootstrap 再开 bridge。
  useEffect(() => {
    if (!paired) return;
    const client = clientRef.current;
    if (!client) return;
    let cancelled = false;
    void client
      .request({
        zcode_type: "bootstrap-request",
        requestId: `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .then((response) => {
        if (!cancelled && response.zcode_type === "bootstrap-response") {
          setBootstrap(response.result);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(describeError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [paired]);

  const workspace = useMemo(() => pickBridgeWorkspace(bootstrap), [bootstrap]);
  const workspaceKey = workspace?.workspaceKey;

  useEffect(() => {
    const client = clientRef.current;
    if (!paired || !client || !workspace || !workspaceKey) return;
    let cancelled = false;
    setError(null);
    void client
      .openWorkbenchServices(workspaceKey)
      .then(({ services, generation }) => {
        if (cancelled) return;
        setMounted((current) =>
          current?.generation === generation
            ? current
            : {
                services,
                generation,
                workspacePath: workspace.workspacePath,
                ...(workspace.workspaceIdentity
                  ? { workspaceIdentity: workspace.workspaceIdentity }
                  : {}),
                ...(bootstrap?.initialViewState?.activeTaskId
                  ? { initialTaskId: bootstrap.initialViewState.activeTaskId }
                  : {}),
              },
        );
      })
      .catch((reason) => {
        if (cancelled) return;
        logger.warn("[mobile-workbench] bridge open failed", reason);
        setError(describeError(reason));
      });
    return () => {
      cancelled = true;
    };
    // workspace 对象随 bootstrap 刷新而换引用；只在目标 key / 连接 / 代际请求变化时重开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, workspaceKey, bridgeEpoch]);

  if (paramsError) {
    return <StatusScreen title={t("invalidLink")} detail={paramsError} tone="error" />;
  }

  const presentation = presentMobileConnection(connection.state, connection.detail);

  if (!mounted) {
    const detail = !paired
      ? presentation.description
      : bootstrap && !workspace
        ? t("openOnDesktop")
        : (error ?? t("loadingChat"));
    return (
      <StatusScreen
        title={paired ? (deviceName ? t("device", { name: deviceName }) : t("title")) : presentation.label}
        detail={detail}
        tone={presentation.terminal || (paired && error) ? "error" : "progress"}
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      {!paired ? (
        <div
          role="status"
          className={`fixed inset-x-0 top-0 z-[1000] px-3 py-1.5 text-center text-ui-sm ${presentation.terminal ? "bg-destructive text-destructive-foreground" : "bg-surface text-foreground-subtle"}`}
        >
          {presentation.label} · {presentation.description}
        </div>
      ) : null}
      <AppErrorBoundary>
        <ZCodeIntlProvider
          key={mounted.generation}
          settingService={mounted.services.settingService}
          broadcastService={mounted.services.broadcastService}
        >
          <Root
            services={mounted.services}
            platform={platform}
            initialWorkspaceAbsPath={mounted.workspacePath}
            initialWorkspaceIdentity={mounted.workspaceIdentity}
            initialTaskId={mounted.initialTaskId}
            allowOpenWorkspace={false}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </ZCodeIntlProvider>
      </AppErrorBoundary>
    </div>
  );
}

function StatusScreen(props: { title: string; detail: string; tone: "progress" | "error" }) {
  return (
    <div className="grid h-full min-h-dvh place-items-center bg-background p-6 text-center text-foreground">
      <div className="max-w-sm space-y-2">
        {props.tone === "progress" ? (
          <Loader2 className="mx-auto size-6 animate-spin text-primary" />
        ) : (
          <span className="mx-auto block size-2.5 rounded-full bg-destructive" />
        )}
        <p className="text-ui-lg font-semibold">{props.title}</p>
        <p className="text-ui-base text-foreground-subtle">{props.detail}</p>
      </div>
    </div>
  );
}
