/**
 * Upstream sync safety (docs/upstream-sync.md). The sync re-derives our files by
 * re-running the codemods, so they must be idempotent on the current tree and
 * must never touch identifiers or the Apache-2.0 attribution.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addMissingArabicKeys, localeEntries, mechanical, ownedByCodemods } from "./sync.mjs";

test("codemods are idempotent on every file they own (re-running changes nothing)", () => {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && ownedByCodemods(f));
  assert.ok(files.length > 100, `expected the UI tree, got ${files.length} files`);
  const changed = files.filter((f) => {
    const text = readFileSync(f, "utf8");
    return mechanical(f, text) !== text;
  });
  assert.deepEqual(changed, []);
});

test("brand codemod keeps identifiers and the upstream attribution", () => {
  const menu = "packages/shared/src/desktopMenu.ts";
  const src = `const a = { helpToggleZCodeStdioTap: "titleBar.menu.help.toggleZCodeStdioTap", open: "tray.menu.openZCode" };\nconst t = "Open ZCode";\n`;
  const out = mechanical(menu, src);
  assert.match(out, /toggleZCodeStdioTap/);
  assert.match(out, /openZCode"/);
  assert.match(out, /"Open DeepCode Studio"/);
  const about = "packages/desktop/src/main/about.ts";
  assert.equal(mechanical(about, `basedOn: "Based on ZCodium (Apache-2.0)",\n`), `basedOn: "Based on ZCodium (Apache-2.0)",\n`);
});

test("logical-class codemod re-derives a file from a newer upstream version", () => {
  const ui = "packages/ui/src/Example.tsx";
  const upstreamOld = `<div className="ml-2 text-left" />`;
  const ours = mechanical(ui, upstreamOld);
  assert.equal(ours, `<div className="ms-2 text-start" />`);
  const upstreamNew = `<div className="ml-2 pr-1 text-left" />`;
  assert.equal(mechanical(ui, upstreamNew), `<div className="ms-2 pe-1 text-start" />`);
});

test("missing Arabic keys are appended in English and marked for translation", () => {
  const en = `const enUS: Record<string, string> = {\n  "a": "A",\n  "b.new": "New {count}",\n};\n\nexport default enUS;\n`;
  const ar = `const ar: Record<string, string> = {\n  "a": "أ",\n};\n\nexport default ar;\n`;
  const { text, added } = addMissingArabicKeys(en, ar);
  assert.deepEqual(added, ["b.new"]);
  assert.match(text, /TODO\(ar\)/);
  assert.equal(localeEntries(text).get("b.new"), `"New {count}"`);
  assert.equal(localeEntries(text).get("a"), `"أ"`);
  assert.equal(addMissingArabicKeys(en, text).added.length, 0);
});
