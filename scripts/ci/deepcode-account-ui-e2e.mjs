#!/usr/bin/env node
/**
 * DeepCode account flow through the REAL packaged app UI, against a running
 * DeepCode server (the production image on a throwaway database).
 *
 *   xvfb-run -a node scripts/ci/deepcode-account-ui-e2e.mjs \
 *     --exe <squashfs-root/deepcode-studio> --web http://localhost:10090 \
 *     --helper "<cmd that runs apps/web/scripts/e2e-admin-helper.mts>" --evidence <dir>
 *
 * Steps: signed-out sidebar → "Sign in" opens the website consent page → the user
 * allows → deep link back → sidebar shows the website identity → no plan: lock
 * dialog → "Renew" opens the website billing page → admin assigns a plan → lock
 * gone, credits shown → credits exhausted → "Out of credits" lock → top-up → lock
 * gone → sign out from the app → device freed on the server.
 */
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const exe = resolve(opt("exe"));
const web = opt("web", "http://localhost:10090").replace(/\/$/, "");
const helper = opt("helper");
const evidence = resolve(opt("evidence", "dist/account-ui-e2e"));
await mkdir(evidence, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const run = (cmd) => execSync(`${helper} ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = await mkdtemp(join(tmpdir(), "deepcode-ui-e2e-"));
const app = await electron.launch({
  executablePath: exe,
  args: ["--no-sandbox"],
  env: {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    DEEPCODE_WEB_ORIGIN: web,
  },
  timeout: 120_000,
});
const page = await app.firstWindow({ timeout: 120_000 });
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
const shot = (name) => page.screenshot({ path: join(evidence, `${name}.png`) }).catch(() => {});

// The browser is the user's: record what the app asks the OS to open.
await app.evaluate(({ shell }) => {
  globalThis.__opened = [];
  shell.openExternal = async (url) => {
    globalThis.__opened.push(String(url));
  };
});
const opened = () => app.evaluate(() => globalThis.__opened.slice());
const waitOpened = async (pred, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = (await opened()).find(pred);
    if (hit) return hit;
    await sleep(250);
  }
  return null;
};
const refreshStatus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));

try {
  // 1. signed out
  const signedOut = page.locator('[data-testid="deepcode-account-signed-out"]');
  await signedOut.waitFor({ timeout: 120_000 });
  await shot("01-signed-out");
  check("sidebar offers DeepCode sign-in", await signedOut.isVisible());

  // 2. sign in opens the website consent page
  await signedOut.getByRole("button").first().click();
  const consentUrl = await waitOpened((u) => u.includes("/auth/desktop"));
  check("Sign in opens the website consent page", !!consentUrl?.startsWith(web), consentUrl ?? "nothing opened");
  const q = new URL(consentUrl).searchParams;

  // 3. the user has a website account and allows the device (browser side)
  const email = `ui-e2e-${Date.now()}@deepcode.local`;
  run(`signup ${email} Ui-e2e-${Date.now()}-pw "Mohammed Alsrkal"`);
  const code = run(`approve ${email} ${q.get("state")} ${q.get("code_challenge")} "${q.get("device_name") ?? "e2e"}"`);
  // Real Windows/Linux path: the browser starts a second app process with the link,
  // which hands it to the running one (second-instance). macOS would use open-url.
  const callback = `deepcodestudio://auth?token=${code}&state=${q.get("state")}`;
  if (process.platform === "darwin") {
    await app.evaluate(({ app: electronApp }, url) => electronApp.emit("open-url", { preventDefault() {} }, url), callback);
  } else {
    execFileSync(exe, ["--no-sandbox", callback], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), DEEPCODE_WEB_ORIGIN: web },
      stdio: "ignore",
      timeout: 60_000,
    });
  }

  // 4. identity from the website appears in the app
  const identity = page.locator('[data-testid="deepcode-account-identity"]');
  await identity.waitFor({ timeout: 30_000 });
  const idText = await identity.innerText();
  await sleep(1500);
  await shot("02-signed-in-identity");
  check("sidebar shows the website account name and email", idText.includes("Mohammed Alsrkal") && idText.includes(email), idText.replace(/\n/g, " | "));

  // 5. no plan → lock dialog that sends the user to the website to subscribe
  const lock = page.getByRole("alertdialog");
  await refreshStatus();
  await lock.waitFor({ timeout: 30_000 }).catch(() => {});
  const lockText = (await lock.innerText().catch(() => "")).replace(/\n/g, " | ");
  await shot("03-no-plan-lock");
  check("no plan: the app blocks use and explains it", (await lock.isVisible().catch(() => false)) && lockText.length > 0, lockText);
  check("a new account is invited to choose a plan (not told it expired)", /choose a plan/i.test(lockText), lockText);
  // The primary action (not "Close"): "View plans" for a new account, "Renew" otherwise.
  await lock.getByRole("button", { name: /view plans|renew|عرض الخطط|تجديد/i }).first().click().catch(() => {});
  const billingUrl = await waitOpened((u) => /\/(dashboard\/billing|pricing)/.test(u));
  check("its button opens the website billing page", !!billingUrl?.startsWith(web), billingUrl ?? "nothing opened");

  // 6. the admin (or a paid UPI payment) activates a plan → the app unlocks
  run(`plan ${email} starter-monthly`);
  await refreshStatus();
  await lock.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
  const hud = page.locator('[data-testid="subscription-hud-chip"]');
  await hud.waitFor({ timeout: 30_000 }).catch(() => {});
  const hudText = (await hud.innerText().catch(() => "")).replace(/\n/g, " | ");
  await sleep(800);
  await shot("04-plan-active");
  check("plan active: lock gone, plan and credits shown", !(await lock.isVisible().catch(() => false)) && /Starter/.test(hudText) && /\d/.test(hudText), hudText);
  check("usage shows used of total", /\d.* of .*\d.* used/.test(hudText), hudText);

  // 7. credits run out → "Out of credits" lock
  run(`exhaust ${email}`);
  await refreshStatus();
  await lock.waitFor({ timeout: 30_000 }).catch(() => {});
  const quotaText = (await lock.innerText().catch(() => "")).replace(/\n/g, " | ");
  await shot("05-out-of-credits");
  check("credits exhausted: the app shows the out-of-credits lock", /out of credits/i.test(quotaText), quotaText);

  // 8. top-up → unlocked again
  run(`topup ${email}`);
  await refreshStatus();
  await lock.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
  await shot("06-topped-up");
  check("after top-up the app unlocks", !(await lock.isVisible().catch(() => false)));

  // 9. sign out from the app frees the device on the server
  check("server registered this device", run(`devices ${email}`) === "1");
  await page.getByRole("button", { name: /sign out/i }).click();
  await signedOut.waitFor({ timeout: 30_000 });
  await sleep(1500);
  await shot("07-signed-out-again");
  check("sign out returns to the signed-out sidebar", await signedOut.isVisible());
  check("sign out removed the device on the server", run(`devices ${email}`) === "0");
} catch (error) {
  failures++;
  console.log(`✗ unexpected: ${error instanceof Error ? error.message : String(error)}`);
  await shot("99-error");
} finally {
  await app.close().catch(() => {});
}
console.log(failures === 0 ? "\nALL UI CHECKS PASSED" : `\n${failures} UI CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
