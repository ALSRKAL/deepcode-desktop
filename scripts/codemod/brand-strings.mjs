#!/usr/bin/env node
/**
 * 品牌字符串 codemod（docs/plan/01 §2.3，可重跑）。
 *
 * 只改「值」，不改「键 / 标识符 / import 路径」：
 * - locale 文件（packages/ui/src/i18n/locales/*.ts）：替换每个键值对的值。
 * - 其他目标文件：替换字符串字面量里的品牌串，跳过 @zcode/*、zcode-protocol、
 *   ZCODE_* 等内部标识（docs/plan/01 §2.4）。
 *
 * 映射：ZCodium Exp → DeepCode Studio；ZCodium → DeepCode Studio；
 * ZCode → DeepCode Studio；Z Code → DeepCode Studio；Z.ai / 智谱 → DeepCode Studio。
 * 长串优先（先替换 ZCodium Exp 再替换 ZCodium），避免二次替换。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const APPLY = process.argv.includes("--apply");

const LOCALE_FILES = ["packages/ui/src/i18n/locales/en-US.ts", "packages/ui/src/i18n/locales/ar.ts"];
const EXTRA_TARGETS = [
  "packages/shared/src/desktopMenu.ts",
  "packages/shared/src/helpAppConfig.ts",
  "packages/desktop/src/main/about.ts",
  "packages/desktop/src/main/desktopTray.ts",
  "packages/desktop/src/main/desktopApplicationMenu.ts",
  "packages/desktop/src/main/desktopArchitectureGuard.ts",
  "packages/desktop/src/main/forceUpdatePrompt.ts",
  "packages/desktop/src/main/embeddedBrowserJavaScriptDialog.ts",
  "packages/desktop/src/main/forceUpdateGuard.ts",
  "packages/desktop/src/main/autoUpdater.ts",
];

// 品牌映射，长串优先。
const MAPPINGS = [
  [/ZCodium Exp/g, "DeepCode Studio"],
  [/ZCodium/g, "DeepCode Studio"],
  [/Z Code/g, "DeepCode Studio"],
  [/ZCode/g, "DeepCode Studio"],
  [/Z\.ai/g, "DeepCode Studio"],
  [/智谱/g, "DeepCode Studio"],
];

/** 行内 allowlist：内部标识与路径不在品牌清洗范围。 */
const LINE_ALLOW =
  /@zcode\/|zcode-protocol|window\.zcode|window\.__zcode|ZCODE_[A-Z_]+|zcode\.cjs|TID_ZCODE|zcode:\/\/|deepcode|zcode-plugins|zcode-guide|document@|x-zcode-bot/i;

function rebrandValue(value) {
  let out = value;
  for (const [pattern, replacement] of MAPPINGS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** locale 文件：只重写引号内值部分（"key": "value" 或 "key": 'value'）。 */
function rebrandLocaleFile(text) {
  let count = 0;
  const text2 = text.replace(/(\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)(:)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    (whole, lead, key, colon, value) => {
      const newValue = rebrandValue(value);
      if (newValue !== value) count += 1;
      return `${lead}${key}${colon} ${newValue}`;
    });
  return { text: text2, count };
}

/** 普通源文件：逐行处理（allowlist 行跳过），再对全文做多行模板字面量替换。 */
function rebrandSourceFile(text) {
  let count = 0;
  const lines = text.split("\n");
  const out = lines.map((line) => {
    if (LINE_ALLOW.test(line)) return line;
    let newLine = line;
    for (const [pattern, replacement] of MAPPINGS) {
      // 只替换引号字符串内出现的品牌串（简单启发："'` 边界内）。
      newLine = newLine.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, (literal) => {
        const replaced = literal.replace(pattern, replacement);
        if (replaced !== literal) count += 1;
        return replaced;
      });
    }
    return newLine;
  });
  let text2 = out.join("\n");
  // 多行模板字面量（HTML 提示页等）：按行拆分会漏，这里对全文再过一遍模板串。
  for (const [pattern, replacement] of MAPPINGS) {
    text2 = text2.replace(/`(?:[^`\\]|\\.)*`/g, (literal) => {
      if (LINE_ALLOW.test(literal)) return literal;
      const replaced = literal.replace(pattern, replacement);
      if (replaced !== literal) count += 1;
      return replaced;
    });
  }
  return { text: text2, count };
}

const targets = [];
for (const f of LOCALE_FILES) {
  const full = join(root, f);
  if (existsSync(full)) targets.push(full);
}
for (const f of EXTRA_TARGETS) {
  const full = join(root, f);
  if (existsSync(full)) targets.push(full);
}

let files = 0;
let values = 0;
for (const file of targets) {
  const before = readFileSync(file, "utf8");
  const isLocale = LOCALE_FILES.some((f) => file.endsWith(f));
  const { text, count } = isLocale ? rebrandLocaleFile(before) : rebrandSourceFile(before);
  if (text !== before) {
    files += 1;
    values += count;
    if (APPLY) writeFileSync(file, text);
  }
}

console.log(`brand codemod: files changed ${files}, values ${values}, apply=${APPLY}`);
