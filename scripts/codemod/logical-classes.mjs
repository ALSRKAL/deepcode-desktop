#!/usr/bin/env node
/**
 * 物理 → 逻辑方向类 codemod（docs/plan/01 §5.3，可重跑）。
 *
 * ml-→ms-, mr-→me-, pl-→ps-, pr-→pe-, text-left→text-start, text-right→text-end,
 * border-l/border-r → border-s/e, rounded-l/r → rounded-s/e, inset 的 left/right
 * → start/end，以及 space-x 系列 → gap 系列。
 *
 * 谨慎项（默认跳过，见 SKIP_FILES）：
 * - 拖拽手柄、窗口控件位置等刻意物理的用法；
 * - LtrIsland 内部的绝对定位覆盖层。
 * 应用后用 git diff 复核；可随时 checkout 单个文件后重跑。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const APPLY = process.argv.includes("--apply");

// 刻意物理方向的文件（review 后决定不改）。
const SKIP_FILES = new Set([]);

const REPLACEMENTS = [
  // margin / padding（含任意数值后缀与任意修饰前缀）
  [/(^|[\s"'`])ml-([a-z0-9[\]./-]+)/g, "$1ms-$2"],
  [/(^|[\s"'`])mr-([a-z0-9[\]./-]+)/g, "$1me-$2"],
  [/(^|[\s"'`])pl-([a-z0-9[\]./-]+)/g, "$1ps-$2"],
  [/(^|[\s"'`])pr-([a-z0-9[\]./-]+)/g, "$1pe-$2"],
  // text 对齐
  [/(^|[\s"'`])text-left\b/g, "$1text-start"],
  [/(^|[\s"'`])text-right\b/g, "$1text-end"],
  // border / rounded / inset 方言
  [/(^|[\s"'`])border-l\b/g, "$1border-s"],
  [/(^|[\s"'`])border-r\b/g, "$1border-e"],
  [/(^|[\s"'`])border-l-([a-z0-9[\]./-]+)/g, "$1border-s-$2"],
  [/(^|[\s"'`])border-r-([a-z0-9[\]./-]+)/g, "$1border-e-$2"],
  [/(^|[\s"'`])rounded-l\b/g, "$1rounded-s"],
  [/(^|[\s"'`])rounded-r\b/g, "$1rounded-e"],
  [/(^|[\s"'`])rounded-l-([a-z0-9[\]./-]+)/g, "$1rounded-s-$2"],
  [/(^|[\s"'`])rounded-r-([a-z0-9[\]./-]+)/g, "$1rounded-e-$2"],
  [/(^|[\s"'`])left-([a-z0-9[\]./-]+)/g, "$1start-$2"],
  [/(^|[\s"'`])right-([a-z0-9[\]./-]+)/g, "$1end-$2"],
  // space-x/y 是物理方向偶联，逻辑等价是 gap
  [/(^|[\s"'`])space-x-([a-z0-9[\]./-]+)/g, "$1gap-$2"],
];

const files = execSync(
  `grep -rlE '(ml-|mr-|pl-|pr-|text-left|text-right|border-l|border-r|rounded-l|rounded-r|left-|right-|space-x-)' "${join(root, "packages/ui/src")}" --include="*.tsx" --include="*.ts"`,
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((f) => f && !SKIP_FILES.has(f));

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [pattern, replacement] of REPLACEMENTS) {
    after = after.replace(pattern, replacement);
  }
  if (after !== before) {
    changed += 1;
    if (APPLY) writeFileSync(file, after);
  }
}

console.log(`files scanned: ${files.length}, files to change: ${changed}, apply=${APPLY}`);
