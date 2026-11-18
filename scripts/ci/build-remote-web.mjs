#!/usr/bin/env node
// Builds the phone remote-control bundle served by the DeepCode server at /remote/:
//   remote-web/mobile/   the phone page (desktop workbench in the browser), base /remote/
//   remote-web/relay.mjs the pairing relay
// Output: <out>/remote-web.tar.gz and <out>/remote-web.tar.gz.sha256
//
// Why a release asset and not files committed to the server repo (2026-11-18): the bundle
// is ~60 MB of minified third-party code; committing it bloats the repo on every rebuild
// and trips the server's secret scanner with false positives. The server image downloads
// this asset at build time and checks its sha256 instead.
//
// Usage: node scripts/ci/build-remote-web.mjs [outDir]   (default: dist-remote-web)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(process.argv[2] ?? join(repoRoot, "dist-remote-web"));
const work = mkdtempSync(join(tmpdir(), "remote-web-"));
const viteOut = join(work, "vite");
const stage = join(work, "remote-web");

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ZCODE_ENV: "production" } });
}

try {
  // 1. Phone page: the web package's mobile entry with the /remote/ base.
  run(
    "pnpm",
    ["exec", "vite", "build", "--base", "/remote/", "--outDir", viteOut, "--emptyOutDir", "--manifest"],
    join(repoRoot, "packages/web"),
  );
  const manifest = JSON.parse(readFileSync(join(viteOut, ".vite/manifest.json"), "utf8"));
  const files = new Set(["mobile.html", "favicon.ico", "THIRD-PARTY-NOTICES.md"]);
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`manifest entry missing: ${key}`);
    files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    for (const asset of entry.assets ?? []) files.add(asset);
    for (const dep of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(dep);
  };
  visit("mobile.html");
  const mobileDir = join(stage, "mobile");
  for (const file of files) {
    const from = join(viteOut, file);
    if (!existsSync(from)) throw new Error(`built file missing: ${file}`);
    mkdirSync(dirname(join(mobileDir, file)), { recursive: true });
    cpSync(from, join(mobileDir, file));
  }
  // The workbench loads file icons and the PDF viewer's assets by path, not via the manifest.
  for (const dir of ["material-icons", "pdfjs"]) {
    if (existsSync(join(viteOut, dir))) cpSync(join(viteOut, dir), join(mobileDir, dir), { recursive: true });
  }

  // 2. Relay.
  run("node", ["build.mjs"], join(repoRoot, "packages/relay"));
  cpSync(join(repoRoot, "packages/relay/dist/cli.mjs"), join(stage, "relay.mjs"));

  // 3. Archive with a stable layout (remote-web/...) and its checksum.
  mkdirSync(outDir, { recursive: true });
  const archive = join(outDir, "remote-web.tar.gz");
  rmSync(archive, { force: true });
  run("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive, "remote-web"], work);
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(`${archive}.sha256`, `${sha}  remote-web.tar.gz\n`);
  console.log(`remote-web: ${files.size} page files, sha256 ${sha}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
