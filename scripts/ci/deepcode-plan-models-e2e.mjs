// Plan-gated model picker e2e (trial → Starter) against a local DeepCode server; see deepcode-account-ui-e2e.mjs for setup.
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire("/home/mohammed/Desktop/DeepCode Studio/apps/desktop/package.json");
const { _electron } = require("playwright-core");
const [exe, helper, evidence] = process.argv.slice(2);
const home = await mkdtemp(join(tmpdir(), "dc-locked-"));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), LANG: "en_US.UTF-8", DEEPCODE_WEB_ORIGIN: "http://localhost:10090" };
const run = (a) => execSync(`${helper} ${a}`, { encoding: "utf8" }).trim().split("\n").pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "✓" : "✗"} ${n}${d ? "  — " + d : ""}`); };
const app = await _electron.launch({ executablePath: exe, args: ["--no-sandbox"], env, timeout: 180000 });
const page = await app.firstWindow({ timeout: 180000 });
await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
const shot = (n) => page.screenshot({ path: `${evidence}/${n}.png` }).catch(() => {});
await app.evaluate(({ shell }) => { globalThis.__o = []; shell.openExternal = async (u) => { globalThis.__o.push(String(u)); }; });
const menuText = async () => {
  await page.getByRole("button", { name: /Choose model|DeepCode/i }).last().click();
  await sleep(800);
  const g = page.getByRole("menuitem", { name: /^DeepCode Studio$/ }).first();
  await g.hover(); await g.click().catch(() => {}); await sleep(800);
  const t = await page.locator('[role="menu"]').last().innerText().catch(() => "");
  return t.split("\n").join(" | ");
};
try {
  const so = page.locator('[data-testid="deepcode-account-signed-out"]'); await so.waitFor({ timeout: 120000 });
  await so.getByRole("button").first().click();
  let url = null; for (let i = 0; i < 60 && !url; i++) { url = (await app.evaluate(() => globalThis.__o)).find((u) => u.includes("/auth/desktop")); if (!url) await sleep(250); }
  const q = new URL(url).searchParams;
  const email = `locked-${Date.now()}@deepcode.local`;
  run(`signup ${email} Locked-${Date.now()}-pw "Trial User"`);
  const code = run(`approve ${email} ${q.get("state")} ${q.get("code_challenge")} locked-e2e`);
  execFileSync(exe, ["--no-sandbox", `deepcodestudio://auth?token=${code}&state=${q.get("state")}`], { env, stdio: "ignore", timeout: 60000 });
  await page.locator('[data-testid="deepcode-account-identity"]').waitFor({ timeout: 60000 });
  await sleep(6000);
  const hud = await page.locator('[data-testid="subscription-hud-chip"]').innerText().catch(() => "");
  check("new account starts the free trial automatically", /trial/i.test(hud), hud.replace(/\n/g, " | "));
  let m = await menuText(); await shot("20-trial-menu");
  check("trial: DeepSeek available, shows real model", /DeepCode Default.*DeepSeek V4\.1 Flash/.test(m), m.slice(0, 160));
  check("trial: Starter/Pro/Team models listed as locked with plan", /DeepCode Lite.*Starter/.test(m) && /DeepCode Coder Pro.*Pro/.test(m) && /DeepCode Architect.*Team/.test(m), m);
  // click a locked model → opens plans page
  await page.getByText(/^DeepCode Architect/).first().click().catch(() => {});
  await sleep(1500);
  const opened = (await app.evaluate(() => globalThis.__o)).find((u) => /dashboard\/billing/.test(u));
  check("clicking a locked model opens the plans page", !!opened, opened ?? "nothing opened");
  await page.keyboard.press("Escape").catch(() => {});
  // upgrade to Starter
  run(`plan ${email} starter-monthly`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sleep(8000);
  m = await menuText(); await shot("21-starter-menu");
  const parts = m.split(" | ");
  const badgeAfter = (name) => { const i = parts.findIndex((p) => p.startsWith(name)); return i < 0 ? "missing" : (parts[i + 1] ?? ""); };
  const isLocked = (name) => /^(Starter|Pro|Team|Trial)$/.test(badgeAfter(name));
  check("starter: Lite/General/Fast Agent unlocked", !isLocked("DeepCode Lite") && !isLocked("DeepCode General") && !isLocked("DeepCode Fast Agent"), ["DeepCode Lite", "DeepCode General", "DeepCode Fast Agent"].map((n) => `${n}→${badgeAfter(n)}`).join(", "));
  check("starter: Mid/Coder Pro (Pro) and Architect (Team) still locked", badgeAfter("DeepCode Mid") === "Pro" && badgeAfter("DeepCode Coder Pro") === "Pro" && badgeAfter("DeepCode Architect") === "Team", ["DeepCode Mid", "DeepCode Coder Pro", "DeepCode Architect"].map((n) => `${n}→${badgeAfter(n)}`).join(", "));
  // chat with Lite via the local gateway (real Synthetic)
  await page.getByText(/^DeepCode Lite/).first().click(); await sleep(800);
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator('[data-testid="v4-composer-input"]').click();
  await page.keyboard.type("Reply with exactly the word: PONG"); await page.keyboard.press("Enter");
  let reply = "";
  for (let i = 0; i < 45 && !reply; i++) {
    await sleep(4000);
    const body = await page.locator("main").last().innerText().catch(() => "");
    const lines = body.split("\n").map((l) => l.trim()).filter((l) => l && !/Reply with exactly the word: PONG/.test(l));
    if (lines.some((l) => /^PONG\.?$/.test(l))) reply = "PONG";
    else if (/rejected|error|unavailable|Invalid/i.test(body) && i > 2) reply = "ERR " + lines.join(" | ").slice(0, 300);
  }
  await shot("22-lite-chat");
  check("chat with DeepCode Lite (GLM 4.7 Flash) through the gateway", reply === "PONG", reply || "no reply");
} catch (e) { fails++; console.log("✗ unexpected:", e.message); await shot("99-error"); }
finally { await page.getByRole("button", { name: /sign out/i }).click().catch(() => {}); await sleep(3000); await app.close().catch(() => {}); }
console.log(fails === 0 ? "ALL LOCKED-VIEW CHECKS PASSED" : `${fails} FAILED`);
process.exit(fails ? 1 : 0);
