import { describe, expect, it } from "vitest";
import { seedWorkspaceRef } from "./workspaceSeed.js";

describe("seedWorkspaceRef", () => {
  it("本地启动目标成为本地工作区种子，key 与 workspaceKeyOf 一致", () => {
    expect(seedWorkspaceRef({ workspacePath: "/p/a" })).toEqual({
      workspaceKey: "/p/a",
      workspacePath: "/p/a",
      kind: "local",
    });
  });

  it("远端目标带 identity、remoteSessionId 与桌面裁定的连接态", () => {
    expect(
      seedWorkspaceRef(
        { workspacePath: "/srv/x", workspaceIdentity: " ssh://h/srv/x ", remoteSessionId: "rs-1" },
        () => "connected",
      ),
    ).toEqual({
      workspaceKey: "ssh://h/srv/x",
      workspacePath: "/srv/x",
      workspaceIdentity: " ssh://h/srv/x ",
      remoteSessionId: "rs-1",
      connectionState: "connected",
      kind: "remote",
    });
  });
});
