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

/**
 * DeepCode 网关可服务的全部模型（与 packages/db/src/catalog.ts 的
 * GO_TEAM_MODELS + OWNER_SYNTHETIC_MODELS 以及 packages/ui/src/lib/deepcodeModels.ts
 * 保持一致）。
 *
 * 修复原因：Agent 进程的 Registry 使用 EmptyAccountProviderConfigSource，不接收宿主按
 * 计划下发的动态模型清单，只认这里的静态 builtinModelIds。此前清单只有 Synthetic 的
 * 8 个品牌 id；2026-11-23 公开计划改为 OpenCode Go 后，用户在模型选择器里选
 * deepseek-v4.1-flash 等 Go 模型时，Agent 报
 * "Provider Registry 中不存在 Model"。这里放全集即可：模型选择器仍只展示宿主从网关
 * 取到的计划内模型，计划外模型由网关返回 403，权限边界始终在服务端。
 */
const DEEPCODE_MODELS = [
  // Synthetic.new 上游（owner 2026-11-16）：客户端只看到 deepcode-* 品牌 id，网关映射到
  // Synthetic 的 syn:/hf:/infinite: 模型；上游轮换模型时客户端无需发版。
  "deepcode-architect",
  "deepcode-coder-pro",
  "deepcode-default",
  "deepcode-fast-agent",
  "deepcode-mid",
  "deepcode-lite",
  "deepcode-general",
  "deepcode-background",
  // OpenCode Go（公开计划，owner 2026-11-23）。必须与网关的 GO_TEAM_MODELS 同步：
  // 少一个，该模型在 Agent Registry 里就不存在；多一个也无妨，网关仍会按计划拒绝。
  "hy4-flash-free",
  "deepseek-v4.1-flash",
  "hungerg-free",
  "glm-5.3-flash",
  "longcat-2.5",
  "mimo-v2.6-flash",
  "minimax-m3",
  "qwen3.7-plus",
  "hy4",
  "hy3",
  "kimi-k2.7-code",
  "qwen3.8-flash",
  "hy4-preview",
  "gemini-4-argon",
  "minimax-m3.1-flash",
  "glm-5.3",
  "kimi-k3.1-pro",
  "kimi-k3",
  "step-5-preview",
  "mimo-v2.6-pro",
  "deepseek-v4-pro",
  "gpt-6-luna",
  "gpt-5.6-luna",
  "claude-haiku-5-5",
  "grok-4.7",
  "qwen4-max",
  "qwen3.8-max",
];

/**
 * DeepCode 模型的精确能力：
 * - Synthetic：GET /openai/v1/models（2026-11-16 读取）。
 * - OpenCode Go：GET https://opencode.ai/inference/go/v1/models（2026-11-24 读取）。
 *   字段为 limit.context / limit.output / modalities.input / capabilities.reasoning.effort。
 *
 * 修复原因：此前只有 Synthetic 有精确事实，所有 Go 模型落到上游通配规则
 * （200K 窗口、32K 输出、无图片），于是网关声明 1M 的 HungerG Free 在应用里
 * 只显示 200K，Hy4/GLM/Kimi 等 1M 模型也被低估。这里覆盖全部在售 Go 模型；
 * 网关仍是权限与计费边界，客户端只按真实能力管理上下文。
 *
 * maxOutput 默认 65536：与套餐的输出上限（starter 32K / pro,team 64K）一致，
 * 避免为 1M 模型预留过大的输出预算而压缩掉可用上下文。hy4-preview 原生长度
 * 只有 64000，单独保留。
 */
const DEEPCODE_MODEL_FACTS = {
  // Synthetic (owner-only).
  "deepcode-architect": { contextWindow: 524288, image: true, efforts: ["low", "high", "max"] },
  "deepcode-coder-pro": { contextWindow: 524288, image: false, efforts: ["low", "high", "max"] },
  "deepcode-default": { contextWindow: 524288, image: true, efforts: ["none", "low", "high", "xhigh", "max"] },
  "deepcode-fast-agent": { contextWindow: 524288, image: true, efforts: ["low", "high", "max"] },
  "deepcode-mid": { contextWindow: 262144, image: true, efforts: ["low", "medium", "xhigh"] },
  "deepcode-lite": { contextWindow: 196608, image: false, efforts: ["none", "low", "medium", "high"] },
  "deepcode-general": { contextWindow: 131072, image: false, efforts: ["none", "low", "medium", "high"] },
  "deepcode-background": { contextWindow: 524288, image: true, efforts: ["none", "low", "high", "xhigh", "max"] },
  // OpenCode Go (public + trial). 27 active models on 2026-11-24.
  "hy4-flash-free": { contextWindow: 1048576, image: true, efforts: ["none", "high"] },
  "deepseek-v4.1-flash": { contextWindow: 1000000, image: true, efforts: ["low", "high", "max"], structuredOutput: true },
  "hungerg-free": { contextWindow: 1000000, image: true, video: true, efforts: ["disabled", "enabled"] },
  "glm-5.3-flash": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "high", "max"], structuredOutput: true },
  "longcat-2.5": { contextWindow: 1000000, image: true, efforts: ["disabled", "enabled"] },
  "mimo-v2.6-flash": { contextWindow: 1048576, image: true, video: true, audio: true, efforts: ["disabled", "enabled"] },
  "minimax-m3": { contextWindow: 1000000, image: true, video: true, efforts: ["disabled", "enabled"] },
  "qwen3.7-plus": { contextWindow: 1000000, image: true, video: true, efforts: ["disabled", "enabled"] },
  "hy4": { contextWindow: 1048576, image: true, efforts: ["none", "high"] },
  "hy3": { contextWindow: 256000, image: false, efforts: ["none", "low", "high"] },
  "kimi-k2.7-code": { contextWindow: 262144, image: true, video: true, efforts: ["enabled"], structuredOutput: true },
  "qwen3.8-flash": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "medium", "xhigh"], structuredOutput: true },
  "hy4-preview": { contextWindow: 1024000, maxOutput: 64000, image: false, efforts: ["none", "high"] },
  "gemini-4-argon": { contextWindow: 1048576, image: true, video: true, audio: true, pdf: true, efforts: ["low", "medium", "high"], structuredOutput: true },
  "minimax-m3.1-flash": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  "glm-5.3": { contextWindow: 1000000, image: false, efforts: ["low", "high", "max"], structuredOutput: true },
  "kimi-k3.1-pro": { contextWindow: 1048576, image: true, video: true, efforts: ["low", "high", "max"], structuredOutput: true },
  "kimi-k3": { contextWindow: 1048576, image: true, video: true, efforts: ["max"], structuredOutput: true },
  "step-5-preview": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "medium", "high"], structuredOutput: true },
  "mimo-v2.6-pro": { contextWindow: 1048576, image: true, video: true, audio: true, efforts: ["disabled", "enabled"] },
  "deepseek-v4-pro": { contextWindow: 1000000, image: false, efforts: ["high", "max"], structuredOutput: true },
  "gpt-6-luna": { contextWindow: 1050000, image: true, pdf: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], structuredOutput: true },
  "gpt-5.6-luna": { contextWindow: 1050000, image: true, pdf: true, efforts: ["none", "low", "medium", "high", "xhigh", "max"], structuredOutput: true },
  "claude-haiku-5-5": { contextWindow: 1000000, image: true, pdf: true, efforts: ["low", "medium", "high", "xhigh", "max"], structuredOutput: true },
  "grok-4.7": { contextWindow: 500000, image: true, pdf: true, efforts: ["low", "medium", "high", "xhigh"], structuredOutput: true },
  "qwen4-max": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "high", "xhigh"], structuredOutput: true },
  "qwen3.8-max": { contextWindow: 1000000, image: true, video: true, efforts: ["low", "medium", "xhigh"], structuredOutput: true },
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 追加在上游规则之后（后者覆盖前者）：DeepCode 模型的属性与思考强度。 */
function deepcodeModelRules() {
  return Object.entries(DEEPCODE_MODEL_FACTS).map(([id, f]) => ({
    modelMatch: `^${escapeRegExp(id)}$`,
    config: {
      enabled: true,
      properties: {
        contextWindow: f.contextWindow,
        inputFormat: {
          supportsText: true,
          supportsImage: f.image ?? false,
          supportsVideo: f.video ?? false,
          supportsAudio: f.audio ?? false,
          supportsPdf: f.pdf ?? false,
        },
        outputFormat: { supportsText: true },
        supportsToolCall: true,
        supportsJsonSchemaOutput: f.structuredOutput ?? true,
      },
      optionSpecs: {
        reasoningLevel: { values: f.efforts },
        maxOutputTokens: { max: f.maxOutput ?? 65536 },
      },
    },
  }));
}

/**
 * Synthetic 只认 OpenAI 的 reasoning_effort（none/low/medium/high/xhigh/max 按模型而定）；
 * 通配规则还会一并发送 thinking / enable_thinking / reasoning，其中不被支持的字段需要
 * 网关丢弃重试。DeepCode 模型只发 reasoning_effort。
 */
function deepcodeModelApiRules() {
  return [
    {
      modelMatch: "^deepcode\\-.*$",
      apiTypeMatch: "openai-chat-completions",
      config: {
        optionSpecs: {
          reasoningLevel: { map: '{"reasoning_effort": reasoningLevel}' },
          maxOutputTokens: { map: "{'max_completion_tokens': maxOutputTokens}" },
        },
      },
    },
  ];
}

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

const DEEPCODE_ENTRY_NAMES = {
  "": "DeepCode Studio",
  messages: "DeepCode Studio · Anthropic API",
  responses: "DeepCode Studio · OpenAI Responses",
  google: "DeepCode Studio · Gemini",
};

/** 网关四协议面：上游一 provider 一 API type 的约束下的内部拆分。 */
function deepcodeProviderRules() {
  const api = (type) => ({ type, baseUrl: `${DEEPCODE_GATEWAY_URL}/v1` });
  const entry = (suffix, type) => ({
    providerId: suffix ? `account:deepcode:${suffix}` : "account:deepcode",
    // 四个内部条目在模型选择器里各成一组；同名会出现四个相同的「DeepCode Studio」，
    // 用户无法区分（owner 反馈 2026-11-16），所以非默认条目带上协议族名。
    providerName: DEEPCODE_ENTRY_NAMES[suffix] ?? "DeepCode Studio",
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
      modelRules: [...upstream.config.modelConfigRules.modelRules, ...deepcodeModelRules()],
      modelApiRules: [...upstream.config.modelConfigRules.modelApiRules, ...deepcodeModelApiRules()],
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
