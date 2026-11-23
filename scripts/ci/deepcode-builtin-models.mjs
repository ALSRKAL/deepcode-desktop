#!/usr/bin/env node
/**
 * Regression guard for the Agent Provider Registry (2026-11-23).
 *
 * The Agent process cannot read the gateway's per-plan model list: it registers
 * only the static `builtinModelIds` in config/provider/deepcode-builtin.json.
 * When the public plans moved to OpenCode Go, the model picker offered
 * `deepseek-v4.1-flash` but the registry still listed only the eight Synthetic
 * ids, so every message failed with:
 *
 *   Provider Registry 中不存在 Model: account:deepcode/deepseek-v4.1-flash
 *
 * The generated config is the source of truth for the registry; the UI list is
 * the source of truth for what users can pick. Every pickable model must exist
 * in the registry. (The gateway still enforces plan access server-side.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(process.argv[2] ?? ".");
const configPath = resolve(root, "config/provider/deepcode-builtin.json");
const modelsPath = resolve(root, "packages/ui/src/lib/deepcodeModels.ts");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const providerRules = config?.config?.providerConfigRules?.providerRules ?? [];
const builtinIds = new Set(
  providerRules.flatMap((rule) => rule?.config?.builtinModelIds ?? []),
);
if (builtinIds.size === 0) {
  console.error("[deepcode-builtin-models] no builtinModelIds found in", configPath);
  process.exit(1);
}

const modelsSource = readFileSync(modelsPath, "utf8");
const listBody = modelsSource.match(
  /export const DEEPCODE_MODELS[\s\S]*?=\s*\[([\s\S]*?)\n\];/,
)?.[1];
if (!listBody) {
  console.error("[deepcode-builtin-models] could not find DEEPCODE_MODELS in", modelsPath);
  process.exit(1);
}
const pickableIds = [...listBody.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((match) => match[1]);
if (pickableIds.length === 0) {
  console.error("[deepcode-builtin-models] DEEPCODE_MODELS is empty");
  process.exit(1);
}

const missing = pickableIds.filter((id) => !builtinIds.has(id));
if (missing.length > 0) {
  console.error(
    `[deepcode-builtin-models] ${missing.length} pickable model(s) missing from ${configPath}:\n` +
      missing.map((id) => `  - ${id}`).join("\n") +
      "\nAdd them to DEEPCODE_MODELS in scripts/codemod/generate-deepcode-builtin.mjs and re-run it.",
  );
  process.exit(1);
}

console.log(
  `[deepcode-builtin-models] ok: ${pickableIds.length} pickable models, ${builtinIds.size} registered ids`,
);
