import { ModelSelectionFacade, type ProviderRegistryFacadeSource } from "@zcode/provider";
import { OFF_PEAK_PROVIDER_IDS } from "@zcode/shared";
import { resolveLegacyReasoningLevel } from "./legacy-reasoning-level.js";

/** Host 与受管理 Worker 共用身份分类；解析仍由纯 Provider Facade 负责。 */
export function createNodeModelSelectionFacade(
  source: ProviderRegistryFacadeSource,
): ModelSelectionFacade {
  return new ModelSelectionFacade(
    source,
    (providerId) => {
      // 第三方账号套餐 provider 已移除；仅闲时 provider 保留账号侧身份，
      // 其余（含用户自定义连接）都按真实 ID 参与唯一性判断。
      if (Object.values(OFF_PEAK_PROVIDER_IDS).some((id) => id === providerId))
        return "account-offpeak";
      return "ordinary";
    },
    resolveLegacyReasoningLevel,
  );
}
