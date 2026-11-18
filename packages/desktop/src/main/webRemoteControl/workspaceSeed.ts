import type { WebRemoteControlWorkspaceRef } from "@zcode/shared";

/**
 * 远控启动目标 → 工作区清单种子（DeepCode Studio，2026-11-18）。
 * 清单此前只靠弹层打开期间的周期同步填充；运行时重启或同步未跑时手机拿到 0 个工作区，
 * 看不到对话也打不开 bridge。启动目标就是本窗口已打开的工作区，先作为种子，同步再覆盖。
 */
export function seedWorkspaceRef(
  target: { workspacePath: string; workspaceIdentity?: string; remoteSessionId?: string },
  resolveRemoteConnectionState?: (
    remoteSessionId: string,
  ) => WebRemoteControlWorkspaceRef["connectionState"],
): WebRemoteControlWorkspaceRef {
  return {
    workspaceKey: target.workspaceIdentity?.trim() || target.workspacePath,
    workspacePath: target.workspacePath,
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
    ...(target.remoteSessionId
      ? {
          remoteSessionId: target.remoteSessionId,
          ...(resolveRemoteConnectionState
            ? { connectionState: resolveRemoteConnectionState(target.remoteSessionId) }
            : {}),
        }
      : {}),
    kind: target.remoteSessionId ? "remote" : "local",
  };
}
