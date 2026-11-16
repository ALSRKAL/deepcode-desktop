/** Windows/Linux 登录回调经第二实例 argv 转发（回归：此前被丢弃，网页“允许”后桌面端不登录）。 */
import { describe, expect, it } from "vitest";
import { createDeepLinkSingleInstanceData, extractDeepLinkUrlFromArgs, extractDeepLinkUrlFromSingleInstanceData } from "./desktopDeepLinkUrl.js";
import { handleSecondInstanceWorkspaceRequest } from "./desktopSecondInstanceDeepLink.js";

const AUTH = "deepcodestudio://auth?token=one-time-code&state=state-1234567890";
const ELECTRON_ARGV = ["/opt/DeepCode Studio/deepcode-studio", "--no-sandbox", "--ozone-platform=x11", AUTH];

describe("auth callback through the second instance", () => {
  it("extracts the sign-in callback from argv", () => {
    expect(extractDeepLinkUrlFromArgs(ELECTRON_ARGV)).toBe(AUTH);
  });

  it("passes it in the single-instance data", () => {
    expect(extractDeepLinkUrlFromSingleInstanceData(createDeepLinkSingleInstanceData(ELECTRON_ARGV))).toBe(AUTH);
  });

  it("delivers it to the running instance's deep link handler", () => {
    const seen: string[] = [];
    const handled = handleSecondInstanceWorkspaceRequest({
      additionalData: {},
      argv: ELECTRON_ARGV,
      forceUpdateBlocked: false,
      focusForceUpdateGateWindow: () => {},
      handleDeepLink: (url) => {
        seen.push(url);
        return true;
      },
      handleOpenWorkspacePath: () => false,
      logger: { warn: () => {} },
    });
    expect(handled).toBe(true);
    expect(seen).toEqual([AUTH]);
  });

  it("ignores auth-looking links without token and state", () => {
    expect(extractDeepLinkUrlFromArgs(["app", "deepcodestudio://auth?state=x"])).toBeNull();
    expect(extractDeepLinkUrlFromArgs(["app", "deepcodestudio://other?token=a&state=b"])).toBeNull();
  });

  it("still forwards workspace links", () => {
    const url = "deepcodestudio://workspace/open?path=%2Ftmp%2Fproj";
    expect(extractDeepLinkUrlFromArgs(["app", url])).toBe(url);
  });
});
