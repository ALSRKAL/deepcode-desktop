import { describe, expect, it } from "vitest";
import type { WebRemoteControlBootstrapResult, ZCodeTaskMeta } from "@zcode/shared";
import type { MobileProjectRoot } from "@zcode/client";
import { collectTaskSources, loadAllTasks, pickBridgeWorkspace, tasksFromBootstrap } from "./mobileTasks.js";

const bootstrap = {
  workspaces: [
    { workspaceKey: "/p/a", workspacePath: "/p/a", kind: "local" },
    { workspaceKey: "remote-1", workspacePath: "/srv/x", remoteSessionId: "rs-1", kind: "remote", connectionState: "connected" },
  ],
  tasks: [{ workspaceKey: "/p/a", taskId: "pushed", title: "Pushed", displayStatus: "idle", updatedAt: 5 }],
} as unknown as WebRemoteControlBootstrapResult;

function root(path: string, extra: Partial<MobileProjectRoot> = {}): MobileProjectRoot {
  return {
    rootIdentity: { hostId: "local", projectId: path, rootPath: path },
    projectName: path.split("/").pop() ?? path,
    enabled: true,
    ...extra,
  };
}

function meta(taskId: string, updatedAt: number, status?: ZCodeTaskMeta["status"]): ZCodeTaskMeta {
  return { taskId, title: taskId, updatedAt, createdAt: 1, status, workspacePath: "" } as ZCodeTaskMeta;
}

describe("mobileTasks", () => {
  it("bridge 目标优先本地已连接 workspace", () => {
    expect(pickBridgeWorkspace(bootstrap)?.workspaceKey).toBe("/p/a");
  });

  it("本地项目根经本地 bridge 读取，远端根只走同 remoteSessionId 的目标，按身份去重", () => {
    const sources = collectTaskSources(bootstrap, [
      root("/p/a", { projectName: "Alpha" }),
      root("/p/b"),
      root("/srv/y", { remoteSessionId: "rs-1" }),
      root("/srv/z", { remoteSessionId: "rs-unknown" }),
      root("/p/c", { enabled: false }),
    ]);
    expect(sources.map((source) => [source.workspacePath, source.bridgeKey, source.projectName])).toEqual([
      ["/p/a", "/p/a", "Alpha"],
      ["/srv/x", "remote-1", "x"],
      ["/p/b", "/p/a", "b"],
      ["/srv/y", "remote-1", "y"],
    ]);
  });

  it("合并所有项目的任务，单个项目失败不影响其他项目，按更新时间排序", async () => {
    const sources = collectTaskSources(bootstrap, [root("/p/b")]);
    const tasks = await loadAllTasks(
      {
        async listTasks({ workspacePath }) {
          if (workspacePath === "/srv/x") throw new Error("offline");
          if (workspacePath === "/p/a") return [meta("t1", 10, "completed"), meta("t2", 30, "running")];
          return [meta("t3", 20), meta("t1", 5)];
        },
      },
      sources,
    );
    expect(tasks.map((task) => [task.taskId, task.status, task.workspacePath])).toEqual([
      ["t2", "running", "/p/a"],
      ["t3", "idle", "/p/b"],
      ["t1", "completed", "/p/a"],
    ]);
  });

  it("全部失败时抛错，供调用方回落到桌面推送清单", async () => {
    await expect(
      loadAllTasks({ listTasks: () => Promise.reject(new Error("down")) }, collectTaskSources(bootstrap, null)),
    ).rejects.toThrow("down");
    expect(tasksFromBootstrap(bootstrap).map((task) => task.taskId)).toEqual(["pushed"]);
  });
});
