/** D-04（docs/plan/04 §2.3）：deep link 处理器的 state/重放/无待处理语义。 */
import { describe, expect, it } from "vitest";
import { handleDeepLink } from "./desktopOAuthDeepLink.js";

const noopLogger = { info: () => {}, warn: () => {} };

function authUrl(state: string, token = "tok"): string {
  return `deepcodestudio://auth?token=${token}&state=${state}`;
}

function workspaceUrl(path: string): string {
  return `deepcodestudio://workspace/open?path=${encodeURIComponent(path)}`;
}

function makeHarness() {
  const acceptedStates: string[] = [];
  const handled: Array<{ state: string; token: string }> = [];
  const auth = (url: URL): boolean => {
    const state = url.searchParams.get("state") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const index = acceptedStates.indexOf(state);
    if (index < 0) return false;
    // 与真实账号服务一致：一次待处理登录只消费一次（pending 在兑换时清空）。
    acceptedStates.splice(index, 1);
    handled.push({ state, token });
    return true;
  };
  return {
    accept: (state: string) => acceptedStates.push(state),
    handled,
    options: { onAuthCallback: auth },
  };
}

describe("deep link handler (D-04)", () => {
  it("routes a matching-state auth link to the auth callback exactly once", () => {
    const h = makeHarness();
    h.accept("state-abc");
    const handled = handleDeepLink(authUrl("state-abc", "tok-1"), noopLogger, h.options);
    expect(handled).toBe(true);
    expect(h.handled).toEqual([{ state: "state-abc", token: "tok-1" }]);
    // 重放：service 侧已消费码，handler 不再投递第二次。
    handleDeepLink(authUrl("state-abc", "tok-1"), noopLogger, h.options);
    expect(h.handled).toHaveLength(1);
  });

  it("drops links with an unknown state without invoking the callback", () => {
    const h = makeHarness();
    h.accept("state-expected");
    const handled = handleDeepLink(authUrl("state-wrong"), noopLogger, h.options);
    expect(handled).toBe(true); // 消化了（不再走 workspace 分支）
    expect(h.handled).toHaveLength(0);
  });

  it("drops auth links when no sign-in is pending", () => {
    const h = makeHarness();
    const handled = handleDeepLink(authUrl("whatever"), noopLogger, h.options);
    expect(handled).toBe(true);
    expect(h.handled).toHaveLength(0);
  });

  it("ignores other schemes and unparseable URLs", () => {
    const h = makeHarness();
    expect(handleDeepLink("https://deepcode.example/dashboard", noopLogger, h.options)).toBe(false);
    expect(handleDeepLink("not-a-url", noopLogger, h.options)).toBe(false);
  });

  it("still routes workspace/open links", () => {
    const h = makeHarness();
    const tmp = process.env.DEEPCODE_TEST_WORKSPACE_DIR ?? process.cwd();
    const handled = handleDeepLink(workspaceUrl(tmp), noopLogger, {
      ...h.options,
      canOpenWorkspace: () => false, // gate 拦截，但视为已处理
      onWorkspaceOpenBlocked: () => {},
    });
    expect(handled).toBe(true);
  });
});
