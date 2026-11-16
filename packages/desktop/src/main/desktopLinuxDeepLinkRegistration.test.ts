import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./desktopLinuxAppImageIcon.js", () => ({ installLinuxAppImageDesktopIconBestEffort: vi.fn() }));

const { registerLinuxDeepLinkProtocol } = await import("./desktopLinuxDeepLinkRegistration.js");

describe("DeepCode Studio leaves other apps' launchers alone (ZCode side by side)", () => {
  it("does not delete the real ZCode app's zcode.desktop", () => {
    const home = mkdtempSync(join(tmpdir(), "dc-desktop-entry-"));
    const apps = join(home, ".local/share/applications");
    mkdirSync(apps, { recursive: true });
    const zcode = "[Desktop Entry]\nName=ZCode\nComment=ZCode Desktop App\nExec=/opt/ZCode.AppImage %U\nType=Application\n";
    writeFileSync(join(apps, "zcode.desktop"), zcode);

    registerLinuxDeepLinkProtocol({
      executablePath: "/opt/DeepCode-Studio.AppImage",
      homeDir: home,
      productName: "DeepCode Studio",
      env: { XDG_DATA_HOME: join(home, ".local/share"), XDG_DATA_DIRS: join(home, "none") },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      runCommand: () => ({ ok: true, status: 0, stdout: "", stderr: "" }) as never,
      systemApplicationDirs: [],
    });

    expect(readFileSync(join(apps, "zcode.desktop"), "utf8")).toBe(zcode);
    expect(existsSync(join(apps, "deepcode-studio.desktop"))).toBe(true);
  });
});
