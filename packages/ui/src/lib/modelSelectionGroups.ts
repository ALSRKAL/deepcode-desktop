import {
  isZCodeAgentProvider,
  zcodeProviderAccountAccessSchema,
  type ZCodeProviderAccountAccess,
  type ZCodeProvider,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";
import {
  DEEPCODE_LOCKED_VALUE_PREFIX,
  DEEPCODE_MODELS,
  DEEPCODE_PREMIUM_PLACEHOLDERS,
  deepCodeModelInfo,
  isDeepCodeProviderId,
  type DeepCodePlanTier,
} from "@/lib/deepcodeModels.js";

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  codingPlanLabel?: string;
  codingPlanBadgeLabel?: string;
  startPlanLabel?: string;
  startPlanBadgeLabel?: string;
  teamPlanBadgeLabel?: string;
  teamPlanFallbackLabel?: string;
  /**
   * DeepCode: also list the models the current plan does not include (locked, with
   * the plan that has them) and the "on request" premium group. Composer only.
   */
  deepcode?: {
    planBadge: (tier: DeepCodePlanTier) => string;
    lockedMessage: (tier: DeepCodePlanTier) => string;
    premiumGroupLabel: string;
    onRequestBadge: string;
    onRequestMessage: string;
  };
}

function supportsRegistryApiFormat(
  selectedProvider: ZCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（ZCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isZCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  return withDeepCodePresentation(buildRawRegistryModelSelectGroups(selectedProvider, view, labels), view, labels);
}

function buildRawRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions,
): ModelSelectGroup[] {
  return view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    const accountAccess = zcodeProviderAccountAccessSchema.safeParse(provider.config.access);
    const accountPresentation = accountAccess.success
      ? getRegistryAccountProviderGroupPresentation(provider.providerId, accountAccess.data, labels)
      : null;

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: accountPresentation?.label || provider.providerName?.trim() || provider.providerId,
        ...(accountPresentation?.labelBadge ? { labelBadge: accountPresentation.labelBadge } : {}),
        ...(accountPresentation ? { directItems: true } : {}),
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          // DeepCode 品牌名 + 实际上游模型，用户看得到自己在用哪个模型。
          name: (isDeepCodeProviderId(provider.providerId) && deepCodeModelInfo(modelId)?.name) || modelId,
          ...(isDeepCodeProviderId(provider.providerId) && deepCodeModelInfo(modelId)
            ? { detail: deepCodeModelInfo(modelId)!.detail }
            : {}),
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });
}

function getRegistryAccountProviderGroupPresentation(
  providerId: string,
  access: ZCodeProviderAccountAccess,
  labels: ModelProviderGroupLabelOptions,
): Pick<ModelSelectGroup, "label" | "labelBadge"> {
  const label = providerId;
  if (access.mode === "start-plan") {
    return { label: "Start Plan", labelBadge: labels.startPlanBadgeLabel ?? "Free" };
  }
  if (access.mode === "team-coding-plan") {
    return { label, labelBadge: labels.teamPlanBadgeLabel ?? "Team" };
  }
  return { label, labelBadge: labels.codingPlanBadgeLabel ?? "Individual" };
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}

const DEEPCODE_PLAN_ORDER: Record<DeepCodePlanTier, number> = { free: 0, trial: 1, starter: 2, pro: 3, team: 4 };

/**
 * DeepCode groups: available models ordered cheapest → strongest, then the models of
 * higher plans (locked, badge = plan), then a separate "on request" premium group.
 * Only when the caller asks (labels.deepcode) and a DeepCode provider has models.
 */
function withDeepCodePresentation(
  groups: ModelSelectGroup[],
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions,
): ModelSelectGroup[] {
  const deepcode = labels.deepcode;
  if (!deepcode) return groups;
  const available = new Set(
    view.providers.filter((p) => isDeepCodeProviderId(p.providerId)).flatMap((p) => p.models.map((m) => m.modelId)),
  );
  if (available.size === 0) return groups;
  const primary = groups.find((g) => g.key.startsWith("registry-provider:account:deepcode"));
  if (!primary) return groups;
  const rank = (name: string) => {
    const i = DEEPCODE_MODELS.findIndex((m) => m.name === name);
    return i < 0 ? DEEPCODE_MODELS.length : i;
  };
  primary.items = [...primary.items].sort((a, b) => rank(a.name) - rank(b.name));
  // Owner-only Synthetic models are not advertised to non-owner accounts at all.
  const locked = DEEPCODE_MODELS.filter((m) => !m.ownerOnly && !available.has(m.id))
    .sort((a, b) => DEEPCODE_PLAN_ORDER[a.plan] - DEEPCODE_PLAN_ORDER[b.plan])
    .map((m) => ({
      key: `deepcode-locked:${m.id}`,
      value: `${DEEPCODE_LOCKED_VALUE_PREFIX}${m.id}`,
      name: m.name,
      detail: m.detail,
      lockedBadge: deepcode.planBadge(m.plan),
      lockedMessage: deepcode.lockedMessage(m.plan),
    }));
  primary.items = [...primary.items, ...locked];
  const premium: ModelSelectGroup = {
    key: "deepcode-premium-on-request",
    label: deepcode.premiumGroupLabel,
    labelBadge: deepcode.onRequestBadge,
    items: DEEPCODE_PREMIUM_PLACEHOLDERS.map((m) => ({
      key: `deepcode-premium:${m.id}`,
      value: `${DEEPCODE_LOCKED_VALUE_PREFIX}premium:${m.id}`,
      name: m.name,
      detail: m.detail,
      lockedBadge: deepcode.onRequestBadge,
      lockedMessage: deepcode.onRequestMessage,
    })),
  };
  return [...groups, premium];
}
