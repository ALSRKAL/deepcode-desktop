/**
 * macOS 无 Developer ID 签名时的自更新（DeepCode Studio，owner 要求所有平台空中更新）。
 *
 * 修复原因：electron-updater 的 MacUpdater 把下载好的 zip 交给 Squirrel.Mac 安装，
 * Squirrel 要求新包的签名满足当前 App 的 designated requirement。我们的 macOS 包没有
 * Apple 证书（CI 关闭签名，安装脚本只做本地 ad-hoc 签名），Squirrel 必然拒绝，
 * 用户永远停在旧版本。这里在“未签名”时只替换下载与安装两步：
 *  - 检查更新仍走 ManifestUpdateProvider（与其他平台同一份 manifest）；
 *  - 下载 zip、按 manifest 的 sha2（十六进制 SHA-256）校验、ditto 解压、本地 ad-hoc 签名；
 *  - 安装：退出后由一个分离的 shell 脚本等待本进程结束，原子替换 .app 并重新打开。
 * 事件（download-progress / update-downloaded / error）照旧从同一个 updater 发出，
 * 所以 UI 的“下载中 → 重启以更新”流程不变。已用 Developer ID 签名的构建不走这里。
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { app, net } from "electron";

const execFileAsync = promisify(execFile);

interface ManifestFile {
  url: URL;
  info: { url: string; sha2?: string; sha512?: string; size?: number };
}
interface UpdaterLike {
  emit(event: string, ...args: unknown[]): boolean;
  autoInstallOnAppQuit: boolean;
  downloadUpdate: (token?: { cancelled?: boolean }) => Promise<string[]>;
  quitAndInstall: (...args: unknown[]) => void;
}
interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** /Applications/DeepCode Studio.app/Contents/MacOS/DeepCode Studio → /Applications/DeepCode Studio.app */
export function appBundlePathFromExecPath(execPath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const index = execPath.indexOf(marker);
  return index < 0 ? null : execPath.slice(0, index + ".app".length);
}

/** zip is the only macOS format an in-place update can unpack; dmg needs mounting. */
export function pickMacUpdateFile(files: readonly ManifestFile[]): ManifestFile | null {
  return files.find((file) => file.url.pathname.toLowerCase().endsWith(".zip")) ?? null;
}

/** Waits for the app to exit, swaps the bundle (restoring the old one on failure), reopens it. */
export function buildMacSwapScript(input: { pid: number; target: string; staged: string }): string {
  const q = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
PID=${input.pid}
TARGET=${q(input.target)}
STAGED=${q(input.staged)}
i=0
while kill -0 "$PID" 2>/dev/null && [ $i -lt 240 ]; do sleep 0.5; i=$((i+1)); done
rm -rf "$TARGET.previous"
if mv "$TARGET" "$TARGET.previous" && mv "$STAGED" "$TARGET"; then
  rm -rf "$TARGET.previous"
else
  [ -d "$TARGET" ] || mv "$TARGET.previous" "$TARGET"
fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
open "$TARGET"
`;
}

export async function isMacBuildWithoutDeveloperId(bundlePath: string): Promise<boolean> {
  try {
    const { stderr } = await execFileAsync("/usr/bin/codesign", ["-dv", "--verbose=2", bundlePath]);
    return /Signature=adhoc|TeamIdentifier=not set/.test(stderr);
  } catch {
    // codesign 失败 = 完全未签名。
    return true;
  }
}

async function sha256Hex(filePath: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

export function installMacUnsignedUpdater(updater: UpdaterLike, logger: Logger): void {
  const bundlePath = appBundlePathFromExecPath(process.execPath);
  if (!bundlePath) return;
  let staged: { appPath: string; version: string } | null = null;
  // Squirrel 不参与：退出时不自动安装，只在用户点击“重启以更新”时替换。
  updater.autoInstallOnAppQuit = false;

  updater.downloadUpdate = async (token) => {
    const state = (updater as unknown as {
      updateInfoAndProvider?: { info: { version: string }; provider: { resolveFiles(info: unknown): ManifestFile[] } };
    }).updateInfoAndProvider;
    if (!state) throw new Error("Please check update first");
    const file = pickMacUpdateFile(state.provider.resolveFiles(state.info));
    if (!file) throw new Error("The update has no macOS .zip file");
    const expected = file.info.sha2?.toLowerCase();
    if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error("The update has no SHA-256 checksum");
    await access(dirname(bundlePath), constants.W_OK).catch(() => {
      throw new Error(`No permission to replace ${bundlePath}. Reinstall with the install command.`);
    });

    const workDir = join(app.getPath("temp"), "deepcode-mac-update", state.info.version);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    const zipPath = join(workDir, "update.zip");

    const response = await net.fetch(file.url.href);
    if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || file.info.size || 0;
    const out = createWriteStream(zipPath);
    const started = Date.now();
    let transferred = 0;
    let lastEmit = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        if (token?.cancelled) throw new Error("cancelled");
        const { done, value } = await reader.read();
        if (done) break;
        transferred += value.byteLength;
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          const seconds = Math.max(0.001, (now - started) / 1000);
          updater.emit("download-progress", {
            percent: total ? (transferred / total) * 100 : 0,
            bytesPerSecond: transferred / seconds,
            transferred,
            total,
            delta: value.byteLength,
          });
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(r));
    }

    const actual = await sha256Hex(zipPath);
    if (actual !== expected) {
      await rm(workDir, { recursive: true, force: true });
      throw new Error("sha2 checksum mismatch: the downloaded update is corrupted or was altered");
    }
    const unpackDir = join(workDir, "app");
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", zipPath, unpackDir]);
    const appName = (await readdir(unpackDir)).find((name) => name.endsWith(".app"));
    if (!appName) throw new Error("The update archive has no app inside");
    const appPath = join(unpackDir, appName);
    await execFileAsync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]).catch((error: unknown) => {
      logger.warn("[auto-update] mac ad-hoc sign of the update failed", error);
    });
    await rm(zipPath, { force: true });
    staged = { appPath, version: state.info.version };
    logger.info("[auto-update] mac update staged without Squirrel");
    updater.emit("update-downloaded", { ...state.info, downloadedFile: appPath });
    return [appPath];
  };

  updater.quitAndInstall = () => {
    if (!staged) {
      logger.warn("[auto-update] mac quitAndInstall without a staged update");
      return;
    }
    const scriptPath = join(dirname(staged.appPath), "..", "swap.sh");
    void writeFile(scriptPath, buildMacSwapScript({ pid: process.pid, target: bundlePath, staged: staged.appPath }))
      .then(() => chmod(scriptPath, 0o755))
      .then(() => {
        const child = spawn("/bin/sh", [scriptPath], { detached: true, stdio: "ignore" });
        child.unref();
        logger.info("[auto-update] mac update swap scheduled; quitting");
        app.quit();
      })
      .catch((error: unknown) => {
        logger.error("[auto-update] mac update install failed", error);
        updater.emit("error", error instanceof Error ? error : new Error(String(error)));
      });
  };
}
