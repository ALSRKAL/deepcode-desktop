import type {
  WebRemoteControlBootstrapResult,
  WebRemoteControlWorkspaceRef,
  ZCodeTaskMeta,
} from "@zcode/shared";
import type { MobileProjectRoot } from "@zcode/client";
import { t } from "./mobileI18n.js";

/**
 * 手机端的「全部对话」投影（DeepCode Studio，2026-11-18）。
 *
 * 修复原因：原先首页只用 bootstrap 里的 tasks，而桌面只在远控弹层打开期间、只推当前
 * workspace 的任务，导致手机常常「没有对话」。现在手机经已就绪的 bridge 直接读 Host 的
 * `listTasks`（与桌面侧栏同一真相源），覆盖窗口内所有本地项目根；bootstrap 只用来找
 * bridge 目标，读不到时才回落到它推送的清单。
 *
 * 状态所有者：Host task service；本模块只做只读投影，不缓存会话事实。
 */
export type MobileTaskStatus = "running" | "completed" | "error" | "idle";

export interface MobileTask {
  taskId: string;
  title: string;
  status: MobileTaskStatus;
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  /** 打开 bridge 用的 workspaceKey（bootstrap 中已注册的目标）。 */
  bridgeKey: string;
  /** 任务真实所属项目：读快照、订阅流、停止都按它路由。 */
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  projectName: string;
}

/** 列表读取端口；生产实现是 `MobileRemoteControlClient.listTasks`。 */
export interface MobileTaskListPort {
  listTasks(params: {
    bridgeKey: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<ZCodeTaskMeta[]>;
}

export interface TaskSource {
  bridgeKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  projectName: string;
}

function identityKey(path: string, identity?: string): string {
  return identity?.trim() || path;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** 选 bridge 目标：优先已连接的本地 workspace（Host 与所有本地项目共享）。 */
export function pickBridgeWorkspace(
  bootstrap: WebRemoteControlBootstrapResult | null,
): WebRemoteControlWorkspaceRef | undefined {
  const connected = (bootstrap?.workspaces ?? []).filter(
    (workspace) => workspace.connectionState !== "disconnected",
  );
  return connected.find((workspace) => !workspace.remoteSessionId) ?? connected[0];
}

/**
 * 列出要读取任务的项目源：bootstrap 的 workspace + 项目目录里已在桌面打开的根，按身份去重。
 * 远端根只有在 bootstrap 里有同一 remoteSessionId 的目标时才读（它们走自己的 Host）。
 */
export function collectTaskSources(
  bootstrap: WebRemoteControlBootstrapResult | null,
  roots: MobileProjectRoot[] | null,
): TaskSource[] {
  const sources = new Map<string, TaskSource>();
  const workspaces = (bootstrap?.workspaces ?? []).filter(
    (workspace) => workspace.connectionState !== "disconnected",
  );
  const local = pickBridgeWorkspace(bootstrap);
  for (const workspace of workspaces) {
    sources.set(identityKey(workspace.workspacePath, workspace.workspaceIdentity), {
      bridgeKey: workspace.workspaceKey,
      workspacePath: workspace.workspacePath,
      ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
      ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
      projectName: workspace.label ?? baseName(workspace.workspacePath),
    });
  }
  for (const root of roots ?? []) {
    if (!root.enabled) continue;
    const path = root.rootIdentity.rootPath;
    const key = identityKey(path, root.workspaceIdentity);
    const existing = sources.get(key);
    if (existing) {
      existing.projectName = root.projectName || existing.projectName;
      continue;
    }
    const bridge = root.remoteSessionId
      ? workspaces.find((workspace) => workspace.remoteSessionId === root.remoteSessionId)
      : local && !local.remoteSessionId
        ? local
        : undefined;
    if (!bridge) continue;
    sources.set(key, {
      bridgeKey: bridge.workspaceKey,
      workspacePath: path,
      ...(root.workspaceIdentity ? { workspaceIdentity: root.workspaceIdentity } : {}),
      ...(root.remoteSessionId ? { remoteSessionId: root.remoteSessionId } : {}),
      projectName: root.projectName || baseName(path),
    });
  }
  return [...sources.values()];
}

function statusOf(meta: Pick<ZCodeTaskMeta, "status">): MobileTaskStatus {
  return meta.status ?? "idle";
}

/**
 * 读全部项目的任务。单个项目失败不影响其他项目；全部失败时抛出首个错误，
 * 由调用方回落到 bootstrap 推送的清单。同一 taskId 只保留一次。
 */
export async function loadAllTasks(
  port: MobileTaskListPort,
  sources: TaskSource[],
): Promise<MobileTask[]> {
  const results = await Promise.allSettled(
    // 串行读同一条 bridge 也可以，但并发请求共用一个 ChannelClient，顺序由 RPC 层保证。
    sources.map(async (source) => {
      const metas = await port.listTasks({
        bridgeKey: source.bridgeKey,
        workspacePath: source.workspacePath,
        ...(source.workspaceIdentity ? { workspaceIdentity: source.workspaceIdentity } : {}),
      });
      return metas.map(
        (meta): MobileTask => ({
          taskId: meta.taskId,
          title: meta.title,
          status: statusOf(meta),
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          unread: typeof meta.unreadAt === "number",
          bridgeKey: source.bridgeKey,
          workspacePath: meta.workspacePath || source.workspacePath,
          ...((meta.workspaceIdentity ?? source.workspaceIdentity)
            ? { workspaceIdentity: meta.workspaceIdentity ?? source.workspaceIdentity }
            : {}),
          ...(source.remoteSessionId ? { remoteSessionId: source.remoteSessionId } : {}),
          projectName: source.projectName,
        }),
      );
    }),
  );
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<MobileTask[]> => result.status === "fulfilled",
  );
  if (fulfilled.length === 0 && results.length > 0) {
    const rejected = results.find((result) => result.status === "rejected");
    throw rejected && rejected.status === "rejected" ? rejected.reason : new Error("no tasks");
  }
  const byId = new Map<string, MobileTask>();
  for (const result of fulfilled) {
    for (const task of result.value) {
      const existing = byId.get(task.taskId);
      if (!existing || task.updatedAt > existing.updatedAt) byId.set(task.taskId, task);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 回落：桌面推送的 bootstrap 清单（旧桌面或读取失败时）。 */
export function tasksFromBootstrap(bootstrap: WebRemoteControlBootstrapResult | null): MobileTask[] {
  const workspaces = bootstrap?.workspaces ?? [];
  return (bootstrap?.tasks ?? [])
    .map((task): MobileTask | null => {
      const workspace = workspaces.find((item) => item.workspaceKey === task.workspaceKey);
      if (!workspace) return null;
      return {
        taskId: task.taskId,
        title: task.title,
        status: (task.displayStatus as MobileTaskStatus | undefined) ?? "idle",
        createdAt: task.createdAt ?? 0,
        updatedAt: task.updatedAt ?? 0,
        unread: typeof task.unreadAt === "number",
        bridgeKey: workspace.workspaceKey,
        workspacePath: workspace.workspacePath,
        ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
        ...(workspace.remoteSessionId ? { remoteSessionId: workspace.remoteSessionId } : {}),
        projectName: workspace.label ?? baseName(workspace.workspacePath),
      };
    })
    .filter((task): task is MobileTask => task !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 紧凑相对时间：now / 5m / 3h / 2d，超过一周显示日期。 */
export function relativeTime(timestamp: number, now: number = Date.now(), locale = "en"): string {
  if (!timestamp) return "";
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("daysAgo", { n: days });
  return new Date(timestamp).toLocaleDateString(locale, { month: "short", day: "numeric" });
}
