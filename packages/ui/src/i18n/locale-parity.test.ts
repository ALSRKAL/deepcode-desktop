/** D-13 相邻：ar 与 en-US 的 key 与占位符 parity（docs/plan/01 §5.2）。 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Messages = Record<string, string>;

function loadLocale(name: string): Messages {
  const text = readFileSync(new URL(`./locales/${name}.ts`, import.meta.url), "utf8");
  // 结构恒为 `const x: Record<string, string> = { "key": "value", ... }; export default x;`
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const body = text.slice(start + 1, end);
  const out: Messages = {};
  // en-US 的值有三种形态：双引号、单引号、无占位的反引号模板字面量。
  const entryRe =
    /"((?:[^"\\]|\\.)+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    out[m[1]!] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

const PLACEHOLDER = /\{[^{}]+\}/g;

describe("ar / en-US locale parity", () => {
  const en = loadLocale("en-US");
  const ar = loadLocale("ar");

  it("ar covers every en-US key", () => {
    const missing = Object.keys(en).filter((k) => !(k in ar));
    expect(missing, `missing in ar (${missing.length}): ${missing.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("ar has no stray keys", () => {
    const extra = Object.keys(ar).filter((k) => !(k in en));
    expect(extra, `extra in ar (${extra.length}): ${extra.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("placeholders match exactly", () => {
    const mismatches: string[] = [];
    for (const [key, enValue] of Object.entries(en)) {
      const arValue = ar[key];
      if (arValue === undefined) continue;
      const norm = (s: string) => (s.match(PLACEHOLDER) ?? []).sort().join(",");
      if (norm(enValue) !== norm(arValue)) mismatches.push(key);
    }
    expect(mismatches, `placeholder mismatch: ${mismatches.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("catalogs are non-trivial", () => {
    expect(Object.keys(en).length).toBeGreaterThan(5_000);
  });
});
