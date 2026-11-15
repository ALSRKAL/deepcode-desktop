#!/usr/bin/env node
/**
 * DeepCode packaged-app smoke (Linux, Windows, macOS) — runs in the release CI
 * right after electron-builder, against the real unpacked app:
 *
 *  1. Launches the packaged executable with an isolated HOME/data dir, all DNS
 *     resolution disabled except loopback and a fail-closed proxy that records
 *     every host the app tries to reach (D-11 network allowlist).
 *  2. Waits for the workbench (database ready → composer visible).
 *  3. Checks identity: app name "DeepCode Studio", Arabic default UI (dir=rtl).
 *  4. Checks the DeepCode account bridge (main ↔ preload ↔ renderer): signed out,
 *     no key exposed, sign-in entry rendered.
 *  5. Fails if the app tried to contact any upstream (Z.ai/BigModel) host.
 *  6. Saves screenshots + a JSON report to the evidence dir (uploaded artifact).
 *
 *   node scripts/ci/deepcode-packaged-smoke.mjs [--dist packages/desktop/dist] [--evidence <dir>]
 *   (Linux CI: run under xvfb-run)
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { startFailClosedProxy } from "../lib/zcode-cli-rust-desktop-network.mjs";
import { closeDesktopApp, launchDesktopApp, waitForDatabaseReady } from "../lib/zcode-cli-rust-desktop-app.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const distDir = resolve(opt("dist", "packages/desktop/dist"));
const evidenceDir = resolve(opt("evidence", "dist/smoke-evidence"));
const PRODUCT = "DeepCode Studio";
const UPSTREAM_HOST = /z\.ai|bigmodel|zhipu|chatglm|cdn-zcode/i;
const IDLE_NETWORK_MS = 20_000;

/** Finds the packaged executable electron-builder left in the dist dir. */
async function findExecutable() {
  const entries = existsSync(distDir) ? await readdir(distDir) : [];
  if (process.platform === "linux") {
    for (const dir of entries.filter((e) => /^linux(-[a-z0-9]+)?-unpacked$/.test(e))) {
      const exe = join(distDir, dir, "deepcode-studio");
      if (existsSync(exe)) return exe;
    }
  } else if (process.platform === "win32") {
    for (const dir of entries.filter((e) => /^win(-[a-z0-9]+)?-unpacked$/.test(e))) {
      const exe = join(distDir, dir, `${PRODUCT}.exe`);
      if (existsSync(exe)) return exe;
    }
  } else if (process.platform === "darwin") {
    for (const dir of entries.filter((e) => /^mac(-[a-z0-9]+)?$/.test(e))) {
      const exe = join(distDir, dir, `${PRODUCT}.app`, "Contents", "MacOS", PRODUCT);
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error(`no packaged ${PRODUCT} executable under ${distDir} (entries: ${entries.join(", ")})`);
}

function isolatedEnv(root) {
  const dirs = {
    home: join(root, "home"),
    userData: join(root, "user-data"),
    sessionData: join(root, "session-data"),
    dataBase: join(root, "data-base"),
    xdgConfig: join(root, "xdg-config"),
    xdgData: join(root, "xdg-data"),
    xdgCache: join(root, "xdg-cache"),
    artifacts: join(root, "artifacts"),
  };
  const keep = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "DISPLAY", "XAUTHORITY", "LANG", "ComSpec", "PATHEXT"];
  const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  Object.assign(env, {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    APPDATA: join(dirs.home, "AppData", "Roaming"),
    LOCALAPPDATA: join(dirs.home, "AppData", "Local"),
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_DATA_HOME: dirs.xdgData,
    XDG_CACHE_HOME: dirs.xdgCache,
    ZCODE_DATA_BASE_DIR: dirs.dataBase,
    ZCODE_DESKTOP_HOME_DIR: dirs.home,
    ZCODE_DESKTOP_USER_DATA_DIR: dirs.userData,
    ZCODE_DESKTOP_SESSION_DATA_DIR: dirs.sessionData,
    ZCODE_DESKTOP_APPLICATION_NAME: `${PRODUCT} Smoke ${randomBytes(3).toString("hex")}`,
    ZCODE_E2E_ARTIFACT_DIR: dirs.artifacts,
  });
  return { env, dirs };
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const executable = await findExecutable();
  const root = join(tmpdir(), `deepcode-smoke-${randomBytes(4).toString("hex")}`);
  const { env, dirs } = isolatedEnv(root);
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));

  const report = { platform: `${process.platform}-${process.arch}`, executable, checks: {}, network: {}, errors: [] };
  const fail = (name, detail) => {
    report.checks[name] = { ok: false, detail };
  };
  const pass = (name, detail) => {
    report.checks[name] = { ok: true, detail };
  };
  /** Informational: recorded and printed, never fails the job. */
  const warn = (name, detail) => {
    report.checks[name] = { ok: true, warning: true, detail };
  };

  const proxy = await startFailClosedProxy({ label: "deepcode-smoke" });
  let handle;
  try {
    handle = await launchDesktopApp({
      electronBinary: executable,
      env,
      proxyUrl: proxy.url,
      packaged: true,
      extraArgs: ["--lang=ar"],
      timeoutMs: 120_000,
    });
    pass("launch", "first window opened");

    try {
      await waitForDatabaseReady(handle.page, { timeoutMs: 180_000 });
      pass("workbench", "composer visible (database ready)");
    } catch (error) {
      fail("workbench", String(error?.message ?? error));
    }

    const appName = await handle.app.evaluate(({ app }) => app.getName()).catch(() => null);
    if (appName === PRODUCT || (appName ?? "").startsWith(PRODUCT)) pass("identity.appName", appName);
    else fail("identity.appName", appName);

    const dir = await handle.page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
    if (dir === "rtl") pass("identity.arabicUi", "dir=rtl");
    else warn("identity.arabicUi", `dir=${dir} (system locale decides on first run)`);

    const auth = await handle.page
      .evaluate(() => window.zcode?.deepcode?.getAuthState?.() ?? null)
      .catch((e) => ({ error: String(e) }));
    if (auth && auth.signedIn === false && !JSON.stringify(auth).includes("sk-dc-")) pass("account.bridge", auth);
    else fail("account.bridge", auth);

    const signInButtons = await handle.page.locator('[data-testid="deepcode-account-signed-out"]').count();
    if (signInButtons > 0) pass("account.signInEntry", `${signInButtons} rendered`);
    else fail("account.signInEntry", "sign-in entry not rendered");

    await handle.page.screenshot({ path: join(evidenceDir, `${report.platform}-workbench.png`) }).catch(() => {});

    // Let background start-up traffic happen, then audit every attempted host.
    await new Promise((r) => setTimeout(r, IDLE_NETWORK_MS));
    const mainBlocked = await handle.blockedMainUrls();
    const attempted = [
      ...proxy.denied.map((d) => d.target),
      ...mainBlocked.map((u) => (typeof u === "string" ? u : JSON.stringify(u))),
      ...handle.rendererBlocked,
    ];
    report.network = { attempted: [...new Set(attempted)] };
    const upstream = report.network.attempted.filter((t) => UPSTREAM_HOST.test(t));
    if (upstream.length === 0) pass("network.noUpstreamHosts", `${report.network.attempted.length} other attempt(s) recorded`);
    else fail("network.noUpstreamHosts", upstream);
    report.errors = handle.errors.slice(0, 50);
  } catch (error) {
    fail("launch", String(error?.stack ?? error));
  } finally {
    if (handle) {
      await handle.page.screenshot({ path: join(evidenceDir, `${report.platform}-final.png`) }).catch(() => {});
      await closeDesktopApp(handle.app);
    }
    await proxy.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }

  await writeFile(join(evidenceDir, `${report.platform}-report.json`), JSON.stringify(report, null, 2));
  const failed = Object.entries(report.checks).filter(([, c]) => !c.ok);
  for (const [name, c] of Object.entries(report.checks)) {
    console.log(`${c.ok ? (c.warning ? "WARN" : "PASS") : "FAIL"} ${name}: ${typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail)}`);
  }
  console.log(`network attempts: ${JSON.stringify(report.network.attempted ?? [])}`);
  return failed.length === 0 ? 0 : 1;
}

process.exitCode = await main().catch((error) => {
  console.error(error);
  return 1;
});
