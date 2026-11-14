#!/usr/bin/env node
/**
 * 品牌泄漏检查（docs/plan/01 §2.3，D-14）：发行面出现上游品牌串即失败。
 *
 * 检查目标（源码模式）：
 * 1. i18n locale 文件（用户可见文案的主体）；
 * 2. 主进程对话框 / 托盘 / 菜单 / 通知文案文件；
 * 3. public/ 打包静态资源。
 * --dist 模式改为扫描构建产物（dist/out）。
 *
 * 模式设计：`ZCode` 后面不允许紧跟标识符字符，这样 ZCodeTaskMeta、ZCodeEnv 等
 * 内部类型名（docs/plan/01 §2.4 有意保留）不算泄漏，而 UI 文案里的裸 ZCode 算。
 * @zcode/*、zcode-protocol、window.zcode、ZCODE_* 等 allowlist 内部标识不判泄漏。
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const checkDist = process.argv.includes("--dist");

// 裸 ZCode / ZCodium（不匹配 ZCodeXxx 内部类型名）+ z.ai 域名 + bigmodel + 智谱。
const PATTERN = "zcodium|z\\.ai|bigmodel|智谱|ZCode[^A-Za-z0-9_-]|ZCode$";
const ALLOW_LINE =
  /@zcode\/|zcode-protocol|window\.zcode|window\.__zcode|ZCODE_[A-Z_]+|zcode\.cjs|TID_ZCODE|zcode:\/\/|deepcode|experimental\["zcode\/|ZCodeStartupLogoBadge|trayOpenZCode|toggleZCodeStdioTap|zcode-resource|defineProperty\(window, "zcode"|CustomEvent\("zcode:|"zcode\.error\.|"zcode\.unavailable|"zcode\.initFailed|"zcode-browser|"zcodePluginSandbox|"zcode:set_globals"|globalThis\.zcode|runtime\.zcode|\bzcode: ZcodeAliasApi\b|const zcode = lazy/i;
const ALLOW_PATHS = [
  /node_modules/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)out(\/|$)/,
  /LICENSE/,
  /NOTICE\.md/,
  /THIRD-PARTY-NOTICES/,
  /CHANGELOG/,
  /(^|\/)docs\//,
  /\.agents\//,
  /scripts\/ci\/brand-leak-check\.mjs/,
  /scripts\/codemod\//,
  /diagnosticLogCatalog/,
  /\.test\.(ts|tsx|mts)$/,
  /(^|\/)tests?\//,
  // zh-CN 是上游合并锚点，不进发行包（docs/plan/01 §5.2）。
  /locales\/zh-CN\.ts$/,
  // 上游 Built-in Config 是生成器的输入（deepcode-builtin.json 才是发行面），
  // 保留 z.ai/bigmodel 模板事实用于上游合并。
  /config\/provider\/zcode-builtin\.json$/,
  // NOTICE 中「Based on ZCodium (Apache-2.0)」与 About 窗口的同句归属是义务声明，
  // 不是品牌泄漏（docs/plan/01 §2.5）。
  /main\/about\.ts$/,
  // plugin-sandbox 别名桥：window.zcode 内部协议面（§2.4 有意保留）。
  /plugin-sandbox\/aliasRuntime\.ts$/,
  // 内部命名空间文件（有意保留的标识符集中地）。
  /openrouter-attribution\.ts$/,
];

const SOURCE_TARGETS = [
  "packages/ui/src/i18n/locales",
  "packages/shared/src/desktopMenu.ts",
  "packages/shared/src/helpAppConfig.ts",
  "packages/desktop/src/main/about.ts",
  "packages/desktop/src/main/aboutWindow.ts",
  "packages/desktop/src/main/desktopTray.ts",
  "packages/desktop/src/main/desktopApplicationMenu.ts",
  "packages/desktop/src/main/desktopArchitectureGuard.ts",
  "packages/desktop/src/main/forceUpdatePrompt.ts",
  "packages/desktop/src/main/embeddedBrowserJavaScriptDialog.ts",
  "packages/desktop/src/renderer",
  "config",
  "public",
];
const DIST_TARGETS = ["packages/desktop/dist", "packages/desktop/out", "packages/ui/dist", "public"];

const targets = checkDist ? DIST_TARGETS : SOURCE_TARGETS.filter((t) => t !== "packages/desktop/src/main/aboutWindow.ts" || true);
const result = spawnSync(
  "rg",
  ["-i", "-e", PATTERN, ...targets, "--no-ignore", "-g", "!node_modules", "-g", "!*.map"],
  { encoding: "utf8", cwd: root, maxBuffer: 128 * 1024 * 1024 },
);
if (result.error && result.error.code !== "ENOENT") {
  console.error(`brand-leak-check: rg failed: ${result.error.message}`);
  process.exit(2);
}
if (result.status === 2) {
  console.error(`brand-leak-check: rg usage error:\n${result.stderr}`);
  process.exit(2);
}

const findings = (result.stdout ?? "")
  .split("\n")
  .filter(Boolean)
  .filter((line) => !ALLOW_PATHS.some((p) => p.test(line.split(":")[0] ?? "")))
  .filter((line) => !ALLOW_LINE.test(line));

if (findings.length > 0) {
  console.error(`brand-leak-check: ${findings.length} finding(s)`);
  for (const line of findings.slice(0, 40)) console.error("  " + line.slice(0, 240));
  process.exit(1);
}
console.log("brand-leak-check: clean");
