import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", quit: () => {} }, net: { fetch: vi.fn() } }));

const { appBundlePathFromExecPath, buildMacSwapScript, pickMacUpdateFile } = await import("./macUnsignedUpdate.js");

const file = (name: string) => ({ url: new URL(`https://example.test/v0.1.4/${name}`), info: { url: name, sha2: "a".repeat(64) } });

describe("macOS in-place updater (no Developer ID)", () => {
  it("finds the .app bundle from the executable path", () => {
    expect(appBundlePathFromExecPath("/Applications/DeepCode Studio.app/Contents/MacOS/DeepCode Studio")).toBe(
      "/Applications/DeepCode Studio.app",
    );
    expect(appBundlePathFromExecPath("/usr/bin/node")).toBeNull();
  });

  it("installs from the .zip, never the .dmg", () => {
    expect(pickMacUpdateFile([file("x-mac-arm64.dmg"), file("x-mac-arm64.zip")])?.info.url).toBe("x-mac-arm64.zip");
    expect(pickMacUpdateFile([file("x-mac-arm64.dmg")])).toBeNull();
  });

  it("swap script waits for the app, swaps with rollback, reopens, and quotes paths", () => {
    const script = buildMacSwapScript({
      pid: 4242,
      target: "/Applications/DeepCode Studio.app",
      staged: "/tmp/it's/DeepCode Studio.app",
    });
    expect(script).toContain("PID=4242");
    expect(script).toContain(`TARGET='/Applications/DeepCode Studio.app'`);
    expect(script).toContain(`STAGED='/tmp/it'\\''s/DeepCode Studio.app'`);
    expect(script).toMatch(/kill -0 "\$PID"/);
    expect(script).toContain('mv "$TARGET.previous" "$TARGET"');
    expect(script).toContain('open "$TARGET"');
  });
});
