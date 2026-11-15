#!/usr/bin/env node
/**
 * 生成 config/provider/deepcode-builtin.json（docs/plan/01 §4）。
 *
 * 来源：上游 zcode-builtin.json（规则驱动的 187 KB 配置）。生成规则：
 * - providerRules：移除全部 8 条 zai / bigmodel 账号规则；新增唯一一条
 *   account:deepcode（access.type = deepcode-account，baseUrl 指向我们的网关）。
 *   网关的四个协议面按上游「一 provider 一 API type」的约束拆成四条内部条目，
 *   UI 上仍显示为单个 DeepCode Studio provider（group 相同）。
 * - templateRules（BYOK，owner decision 3：保留但隐藏于 Advanced）：移除
 *   zai / bigmodel / qwen-alibaba（阿里云百炼控制台链接是上游服务耦合）模板。
 * - modelConfigRules：保留通用能力规则；templateModelRules 只保留 BYOK 模板的，
 *   builtinProviderModelRules 重写为 account:deepcode 的目录模型。
 * - schemaVersion / revision 沿用上游值；revision 由发布流程递增。
 *
 * 运行：node scripts/codemod/generate-deepcode-builtin.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const check = process.argv.includes("--check");

const upstream = JSON.parse(readFileSync(resolve(root, "config/provider/zcode-builtin.json"), "utf8"));

/** DeepCode 网关目录模型（packages/db/src/catalog.ts 的私有模型子集）。 */
const DEEPCODE_MODELS = [
  "glm-5.3-flash",
  "glm-5.3",
  "kimi-k3",
  "kimi-k3.1-pro",
  "deepseek-v4-pro",
  "deepseek-v4.1-flash",
  "minimax-m3",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-plus",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "gpt-6-luna",
  "grok-4.7",
  "claude-haiku-5-5",
  "gemini-4-argon",
];

const REMOVED_TEMPLATE_IDS = new Set(["zai-api", "zai-standard-api", "bigmodel-api", "bigmodel-standard-api", "qwen-alibaba-model-studio-cn", "qwen-alibaba-model-studio-intl"]);

// 构建期注入的网关地址（docs/plan/00 §6：DEEPCODE_GATEWAY_URL 为 B/P 类）。
// schema 在构建期就会校验 URL，占位符必须替换为具体地址。
// Review M5：生产构建必须显式提供 HTTPS 网关地址；loopback/HTTP 只允许本地
// 打包时用 DEEPCODE_ALLOW_INSECURE_GATEWAY=1 显式放行。默认落在 placeholder 域名
// （docs/plan/04 §3 决策 7），保证干净检出的产物不会指向本机明文地址。
const configuredGateway = process.env.DEEPCODE_GATEWAY_URL?.trim();
const isProductionBuild = process.env.ZCODE_ENV?.trim().toLowerCase() === "production";
const allowInsecure = process.env.DEEPCODE_ALLOW_INSECURE_GATEWAY === "1";
const DEEPCODE_GATEWAY_URL = (configuredGateway || "https://deepcode.example").replace(/\/$/, "");
if (isProductionBuild && !allowInsecure && !DEEPCODE_GATEWAY_URL.startsWith("https://")) {
  throw new Error(
    "production builds require an https DEEPCODE_GATEWAY_URL (or DEEPCODE_ALLOW_INSECURE_GATEWAY=1 for local packaging)",
  );
}

/** 网关四协议面：上游一 provider 一 API type 的约束下的内部拆分。 */
function deepcodeProviderRules() {
  const api = (type) => ({ type, baseUrl: `${DEEPCODE_GATEWAY_URL}/v1` });
  const entry = (suffix, type) => ({
    providerId: suffix ? `account:deepcode:${suffix}` : "account:deepcode",
    providerName: "DeepCode Studio",
    config: {
      group: "deepcode",
      builtinModelIds: DEEPCODE_MODELS,
      access: { type: "deepcode-account" },
      api: api(type),
      logo: { type: "builtin", key: "deepcode" },
    },
  });
  return [
    entry("", "openai-chat-completions"),
    entry("messages", "anthropic-messages"),
    entry("responses", "openai-responses"),
    entry("google", "google-generative-ai"),
  ];
}

const cfg = {
  schemaVersion: upstream.schemaVersion,
  revision: upstream.revision + 1,
  config: {
    providerConfigRules: {
      templateRules: upstream.config.providerConfigRules.templateRules
        .filter((t) => !REMOVED_TEMPLATE_IDS.has(t.templateId))
        // 语言的唯一事实是 Locale = ar | en-US（docs/plan/01 §5.2）：模板展示名
        // 把上游 zh-CN 键换成 ar（沿用英文展示名；品牌/产品名保持拉丁）。
        .map((t) => {
          const nameMap = t.templateNameMap ?? {};
          return {
            ...t,
            templateNameMap: {
              ...(nameMap["en-US"] ? { ar: nameMap["en-US"], "en-US": nameMap["en-US"] } : nameMap),
            },
          };
        }),
      providerRules: deepcodeProviderRules(),
    },
    modelConfigRules: {
      modelRules: upstream.config.modelConfigRules.modelRules,
      modelApiRules: upstream.config.modelConfigRules.modelApiRules,
      providerSiteRules: upstream.config.modelConfigRules.providerSiteRules?.filter(
        (r) => !/z\.ai|bigmodel/i.test(r.baseUrlMatch ?? ""),
      ),
      templateModelRules: upstream.config.modelConfigRules.templateModelRules.filter(
        (r) => !REMOVED_TEMPLATE_IDS.has(r.templateId),
      ),
      builtinProviderModelRules: upstream.config.modelConfigRules.builtinProviderModelRules?.filter(
        (r) => !/account:zai|account:bigmodel/i.test(r.providerId ?? ""),
      ),
    },
  },
};

const out = `${JSON.stringify(cfg, null, 2)}\n`;
const target = resolve(root, "config/provider/deepcode-builtin.json");
if (check) {
  const existing = readFileSync(target, "utf8");
  if (existing !== out) {
    console.error("deepcode-builtin.json is stale; re-run generate-deepcode-builtin.mjs");
    process.exit(1);
  }
  console.log("deepcode-builtin.json up to date");
} else {
  writeFileSync(target, out);
  console.log(`wrote config/provider/deepcode-builtin.json (${out.length} bytes)`);
}
