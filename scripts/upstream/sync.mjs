#!/usr/bin/env node
/**
 * Upstream sync: merge new ZCodium commits into DeepCode Studio while keeping the
 * DeepCode identity (docs/upstream-sync.md).
 *
 *   node scripts/upstream/sync.mjs [--remote upstream] [--url <git url>] [--branch main]
 *                                  [--ci] [--report <file>] [--no-branch]
 *
 * What it does
 *  1. Fetches upstream; exits 0 with status "up_to_date" when nothing is new.
 *  2. Creates branch `upstream-sync/<sha>` and merges upstream (no commit yet).
 *  3. Resolves conflicts that are ours only mechanically: when applying the
 *     codemods (logical RTL classes, brand strings) to the old upstream file gives
 *     exactly our file, the resolution is "codemods(new upstream file)".
 *     Files we deleted on purpose (removed upstream services) stay deleted.
 *     Anything else is a real conflict for a human.
 *  4. Re-applies the codemods over the tree, regenerates the built-in provider
 *     config, and adds missing Arabic keys (English text, marked for translation).
 *  5. Commits, or — with real conflicts — stops: locally the merge is left open
 *     for you to finish; with --ci it is aborted and the report lists the files.
 *
 * The report (markdown) also flags upstream changes that need eyes even when
 * they merge cleanly: new Z.ai/BigModel references, changes to files we patched
 * by hand, and new UI strings.
 *
 * Exit codes: 0 merged or up to date · 2 real conflicts · 1 error.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appliesToLogicalClasses, toLogicalClasses } from "../codemod/logical-classes.mjs";
import { appliesToBrandStrings, rebrandText } from "../codemod/brand-strings.mjs";

const DEFAULT_URL = "https://github.com/axiom-desu/ZCodium.git";
const EN_LOCALE = "packages/ui/src/i18n/locales/en-US.ts";
const AR_LOCALE = "packages/ui/src/i18n/locales/ar.ts";
/** Signals that upstream added a dependency on its own services. */
const UPSTREAM_SERVICE = /z\.ai|bigmodel|zhipu|智谱|chatglm|cdn-zcode/i;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const remote = opt("remote", "upstream");
const url = opt("url", process.env.UPSTREAM_REPO_URL || DEFAULT_URL);
const upstreamBranch = opt("branch", process.env.UPSTREAM_BRANCH || "main");
const ci = flag("ci");
const reportPath = resolve(opt("report", "upstream-sync-report.md"));
const createBranch = !flag("no-branch");

function git(...a) {
  return execFileSync("git", a, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trim();
}
function gitOk(...a) {
  return spawnSync("git", a, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).status === 0;
}
/** File content at a revision or index stage (":1:path"); null when absent or binary. */
function show(spec) {
  const r = spawnSync("git", ["show", spec], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  if (r.stdout.includes(0)) return null; // binary
  return r.stdout.toString("utf8");
}
function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** Apply every codemod that owns this path. */
export function mechanical(relPath, text) {
  let out = text;
  if (appliesToLogicalClasses(relPath)) out = toLogicalClasses(out);
  if (appliesToBrandStrings(relPath)) out = rebrandText(relPath, out);
  return out;
}
export function ownedByCodemods(relPath) {
  return appliesToLogicalClasses(relPath) || appliesToBrandStrings(relPath);
}

/** Keys of a `const x: Record<string,string> = { "k": "v", ... }` locale file. */
export function localeEntries(text) {
  const body = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));
  const re = /"((?:[^"\\]|\\.)+)"\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(body)) !== null) out.set(m[1], m[2]);
  return out;
}

/** Appends en-US keys missing from ar (English text, marked for translation). */
export function addMissingArabicKeys(enText, arText) {
  const en = localeEntries(enText);
  const ar = localeEntries(arText);
  const missing = [...en.keys()].filter((k) => !ar.has(k));
  if (missing.length === 0) return { text: arText, added: [] };
  const close = arText.lastIndexOf("};");
  const block =
    `  // TODO(ar): translate — added by upstream sync (English text shown until then).\n` +
    missing.map((k) => `  ${JSON.stringify(k)}: ${en.get(k)},\n`).join("");
  return { text: arText.slice(0, close) + block + arText.slice(close), added: missing };
}

function report(lines) {
  writeFileSync(reportPath, lines.join("\n") + "\n");
}

function main() {
  // ---- 1. fetch ----------------------------------------------------------------
  if (!gitOk("remote", "get-url", remote)) git("remote", "add", remote, url);
  git("fetch", "--no-tags", remote, upstreamBranch);
  const upstreamRef = `${remote}/${upstreamBranch}`;
  const upstreamSha = git("rev-parse", upstreamRef);
  const short = upstreamSha.slice(0, 7);
  const newCommits = Number(git("rev-list", "--count", `HEAD..${upstreamRef}`));
  setOutput("upstream_sha", upstreamSha);
  if (newCommits === 0) {
    setOutput("status", "up_to_date");
    report([`# Upstream sync`, ``, `Up to date with ${upstreamRef} (${short}).`]);
    console.log(`up to date with ${upstreamRef} (${short})`);
    return 0;
  }
  if (git("status", "--porcelain") !== "") {
    console.error("working tree is not clean; commit or stash first");
    return 1;
  }

  const base = git("merge-base", "HEAD", upstreamRef);
  const branch = `upstream-sync/${short}`;
  if (createBranch) {
    if (gitOk("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)) {
      console.error(`branch ${branch} already exists (a previous sync for this upstream commit)`);
      setOutput("status", "exists");
      setOutput("branch", branch);
      return 0;
    }
    git("switch", "-c", branch);
  }
  setOutput("branch", branch);

  // ---- 2. what upstream changed that needs eyes ---------------------------------
  const upstreamChanged = git("diff", "--name-only", base, upstreamRef).split("\n").filter(Boolean);
  const oursChanged = new Set(git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean));
  const handPatched = upstreamChanged.filter((f) => {
    if (!oursChanged.has(f)) return false;
    const baseText = show(`${base}:${f}`);
    const ourText = show(`HEAD:${f}`);
    if (baseText === null || ourText === null) return true; // deleted/binary: needs eyes
    return !(ownedByCodemods(f) && mechanical(f, baseText) === ourText);
  });
  const serviceRefs = [];
  for (const f of upstreamChanged) {
    const d = spawnSync("git", ["diff", "-U0", base, upstreamRef, "--", f], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    for (const line of (d.stdout || "").split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++") && UPSTREAM_SERVICE.test(line)) {
        serviceRefs.push(`${f}: ${line.slice(1).trim().slice(0, 140)}`);
      }
    }
  }

  // ---- 3. merge and resolve mechanical conflicts --------------------------------
  const merged = gitOk("merge", "--no-ff", "--no-commit", upstreamRef);
  const autoResolved = [];
  const keptDeleted = [];
  const realConflicts = [];
  // DeepCode owns its CI; upstream workflow edits are listed for review instead
  // (the default GitHub token may not push workflow changes anyway).
  const workflowChanges = upstreamChanged.filter((f) => f.startsWith(".github/workflows/"));
  for (const f of workflowChanges) {
    if (gitOk("cat-file", "-e", `HEAD:${f}`)) git("checkout", "HEAD", "--", f);
    else gitOk("rm", "-f", "--quiet", "--", f);
  }
  if (!merged) {
    const status = git("status", "--porcelain=v1").split("\n").filter(Boolean);
    for (const entry of status) {
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (path.startsWith(".github/workflows/")) continue;
      if (!["UU", "AA", "DU", "UD", "AU", "UA", "DD"].includes(code)) continue;
      if (code === "DU") {
        // Deleted by us (removed upstream service), modified upstream: keep it removed.
        git("rm", "--quiet", "--", path);
        keptDeleted.push(path);
        continue;
      }
      if (code === "UU" && ownedByCodemods(path)) {
        const baseText = show(`:1:${path}`);
        const ours = show(`:2:${path}`);
        const theirs = show(`:3:${path}`);
        if (baseText !== null && ours !== null && theirs !== null && mechanical(path, baseText) === ours) {
          writeFileSync(path, mechanical(path, theirs));
          git("add", "--", path);
          autoResolved.push(path);
          continue;
        }
      }
      realConflicts.push(`${code} ${path}`);
    }
  }

  const lines = [
    `# Upstream sync: ZCodium ${short}`,
    ``,
    `- Upstream: \`${upstreamRef}\` @ \`${upstreamSha}\` — **${newCommits} new commit(s)**, ${upstreamChanged.length} file(s) changed.`,
    `- Branch: \`${branch}\``,
    ``,
  ];

  if (realConflicts.length > 0) {
    lines.push(
      `## ❌ Needs a manual merge (${realConflicts.length})`,
      ``,
      `These files were changed both upstream and by hand in DeepCode:`,
      ``,
      ...realConflicts.map((c) => `- \`${c}\``),
      ``,
      `Run locally: \`node scripts/upstream/sync.mjs\`, fix the listed files (keep DeepCode identity, take upstream logic), then \`git commit\`. See docs/upstream-sync.md.`,
      ``,
    );
  }

  // ---- 4. normalise the merged tree ---------------------------------------------
  let arAdded = [];
  if (realConflicts.length === 0) {
    for (const script of ["logical-classes.mjs", "brand-strings.mjs"]) {
      execFileSync(process.execPath, [`scripts/codemod/${script}`, ".", "--apply"], { stdio: "ignore" });
    }
    execFileSync(process.execPath, ["scripts/codemod/generate-deepcode-builtin.mjs", "."], { stdio: "ignore" });
    if (existsSync(EN_LOCALE) && existsSync(AR_LOCALE)) {
      const r = addMissingArabicKeys(readFileSync(EN_LOCALE, "utf8"), readFileSync(AR_LOCALE, "utf8"));
      if (r.added.length > 0) writeFileSync(AR_LOCALE, r.text);
      arAdded = r.added;
    }
    git("add", "-A");
  }

  lines.push(
    `## Resolved automatically`,
    ``,
    `- Mechanical conflicts (codemod-only files, re-derived from the new upstream file): ${autoResolved.length}`,
    ...autoResolved.slice(0, 50).map((f) => `  - \`${f}\``),
    `- Upstream CI workflow changes not applied (DeepCode keeps its own): ${workflowChanges.length}`,
    ...workflowChanges.map((f) => `  - \`${f}\``),
    `- Upstream changes to files DeepCode removed (kept removed): ${keptDeleted.length}`,
    ...keptDeleted.map((f) => `  - \`${f}\` — check whether the upstream change matters`),
    ``,
    `## Review checklist`,
    ``,
    `- [ ] **Upstream service references added (${serviceRefs.length})** — must not ship; route to DeepCode or remove:`,
    ...serviceRefs.slice(0, 40).map((s) => `  - ${s}`),
    `- [ ] **Hand-patched DeepCode files that upstream also changed (${handPatched.length})** — confirm identity/behaviour kept:`,
    ...handPatched.slice(0, 60).map((f) => `  - \`${f}\``),
    `- [ ] **New UI strings (${arAdded.length})** added to ar.ts in English, marked \`TODO(ar)\` — translate.`,
    `- [ ] CI checks green (typecheck, lint, architecture, brand leak, DeepCode tests).`,
    `- [ ] After merge: tag a release → installers → register in /admin/releases → users update.`,
  );

  if (realConflicts.length > 0) {
    setOutput("status", "conflicts");
    if (ci) {
      git("merge", "--abort");
      if (createBranch) {
        git("switch", "-");
        git("branch", "-D", branch);
      }
    }
    report(lines);
    console.error(`${realConflicts.length} real conflict(s); see ${reportPath}`);
    return 2;
  }

  const message = `chore(upstream): merge ZCodium ${short} (${newCommits} commit(s))\n\nAuto-resolved: ${autoResolved.length}; kept removed: ${keptDeleted.length}; new ar keys: ${arAdded.length}.\nReport: upstream-sync-report.md (not committed).`;
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", message);
  setOutput("status", "merged");
  report(lines);
  console.log(`merged ${newCommits} upstream commit(s) on ${branch}; report: ${reportPath}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (ci && existsSync(".git/MERGE_HEAD")) spawnSync("git", ["merge", "--abort"]);
    process.exitCode = 1;
  }
}
