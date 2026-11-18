/* eslint-disable max-lines -- Web 入口集中编排启动、路由与 workspace shell wiring，与 Root.tsx 同样先保持入口收口，避免跨层状态拆散。 */
import { createRoot } from "react-dom/client";
import { createWebPlatform } from "./webPlatform.js";
import {
  AppErrorBoundary,
  Root,
  ZCodeIntlProvider,
  type Theme,
} from "@zcode/ui";
import "@zcode/ui/styles.css";
import { connectViaWebSocket } from "@zcode/client";
import { ConversationShareLandingLoader } from "./share/ConversationShareLandingPage.js";
import {
  isConversationSharePath,
  parseConversationShareRoute,
  resolveConversationShareRouteLocale,
} from "./share/conversationSharePreviewClient.js";
import type { ServerRemoteInfo } from "@zcode/shared";
import { WEB_DEFAULT_THEME, resolveWebInitialTheme } from "./webThemeSeed.js";

function resolveWebThemePreference(defaultTheme: Theme = WEB_DEFAULT_THEME): Theme {
  const saved = localStorage.getItem("zcode-theme");
  return resolveWebInitialTheme({ storedTheme: saved, defaultTheme });
}

// 初始化主题：默认 Zai dark，后续由 useTheme hook 接管
// system 模式下需要查询系统偏好；非 system 模式直接用存储值
{
  const saved = resolveWebThemePreference();
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "zai-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : saved === "dark"
        ? "zai-dark"
        : saved === "light"
          ? "zai-light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
}


const root = createRoot(document.getElementById("root")!);

interface WebBootstrapResult {
  wsUrl: string;
  initialWorkspaceAbsPath?: string;
  initialWorkspaceIdentity?: string;
  initialTaskId?: string;
  restoreSession?: boolean;
  allowOpenWorkspace?: boolean;
}

function clearRetiredLoginCallback(): void {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (["/cn/share/callback", "/share/callback"].includes(path)) {
    // 旧授权链接可能携带 code/token/跳转目标；移除整段参数，不解析或转发给本机服务。
    window.history.replaceState(null, "", "/");
  }
}

function resolveDefaultWsOrigin(): string {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}

async function resolveWebBootstrap(): Promise<WebBootstrapResult> {
  const params = new URLSearchParams(window.location.search);
  const remoteId = params.get("remote");
  const wsUrl = remoteId
    ? `${resolveDefaultWsOrigin()}/ws/remote/${remoteId}`
    : `${resolveDefaultWsOrigin()}/ws`;

  if (remoteId) {
    return { wsUrl };
  }

  try {
    const response = await fetch("/api/server-info", {
      cache: "no-store",
    });
    if (!response.ok) {
      return { wsUrl };
    }
    const serverInfo = (await response.json()) as Partial<ServerRemoteInfo>;
    const workspace = Array.isArray(serverInfo.workspaces) ? serverInfo.workspaces[0] : undefined;
    return {
      wsUrl,
      ...(workspace?.path ? { initialWorkspaceAbsPath: workspace.path } : {}),
      ...(workspace?.workspaceIdentity
        ? { initialWorkspaceIdentity: workspace.workspaceIdentity }
        : {}),
    };
  } catch {
    return { wsUrl };
  }
}

function WebBootstrapErrorScreen({ message }: { message: string }) {
  return (
    <div className="h-dvh min-h-dvh w-screen bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-lg items-center px-4">
        <section className="w-full rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-destructive" />
            <h1 className="text-ui-xs font-medium">
              {/^zh\b/i.test(navigator.language) ? "Web 启动失败" : "Web bootstrap failed"}
            </h1>
          </div>
          <p className="mt-2 break-all text-ui-xs/relaxed text-foreground-subtle">{message}</p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground-subtle hover:bg-surface-hover"
            onClick={() => {
              window.location.reload();
            }}
          >
            {/^zh\b/i.test(navigator.language) ? "重试" : "Retry"}
          </button>
        </section>
      </div>
    </div>
  );
}

function renderWebBootstrapError(error: unknown): void {
  document.title = "ZCode - Web";
  root.render(
    <WebBootstrapErrorScreen message={error instanceof Error ? error.message : String(error)} />,
  );
}

/** 分享页是独立公开入口：不连接本机 server，也不要求 workspace/登录态。 */
function renderConversationShareLanding(): boolean {
  const pathname = window.location.pathname;
  if (!isConversationSharePath(pathname)) return false;
  // 只接受显式配置的分享 API base 或同源 /api/v1；不内置任何生产站点地址。
  const endpointOrigin =
    import.meta.env.VITE_ZCODE_BASE_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  root.render(
    <AppErrorBoundary>
      <ConversationShareLandingLoader
        shareCode={parseConversationShareRoute(pathname)}
        locale={resolveConversationShareRouteLocale(pathname)}
        baseUrl={`${endpointOrigin}/api/v1`}
      />
    </AppErrorBoundary>,
  );
  return true;
}

async function bootstrapWebApp() {
  clearRetiredLoginCallback();
  if (renderConversationShareLanding()) return;

  let bootstrap: WebBootstrapResult;
  try {
    bootstrap = await resolveWebBootstrap();
  } catch (error) {
    renderWebBootstrapError(error);
    return;
  }

  try {
    const services = await connectViaWebSocket(bootstrap.wsUrl, {
      onClose: () => {},
    });
    const platform = createWebPlatform();
    document.title = "ZCode - Web + Server";

    root.render(
      <AppErrorBoundary>
        <ZCodeIntlProvider
          settingService={services.settingService}
          broadcastService={services.broadcastService}
        >
          <Root
            services={services}
            platform={platform}
            initialWorkspaceAbsPath={bootstrap.initialWorkspaceAbsPath}
            initialWorkspaceIdentity={bootstrap.initialWorkspaceIdentity}
            initialTaskId={bootstrap.initialTaskId}
            restoreSession={bootstrap.restoreSession}
            allowOpenWorkspace={bootstrap.allowOpenWorkspace}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </ZCodeIntlProvider>
      </AppErrorBoundary>,
    );
  } catch (error) {
    renderWebBootstrapError(error);
  }
}

void bootstrapWebApp();
