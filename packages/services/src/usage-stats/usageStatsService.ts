import type {
  ApiClient,
  AppUsageRequest,
  AppUsageSnapshot,
  CodingPlanQuotaRequest,
  CodingPlanQuotaSnapshot,
} from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

interface UsageStatsServiceDependencies {
  /** 统计属于当前 Environment 的 Agent 数据库，不依赖账号或远端计费服务。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
  /** 额度查询复用宿主 ApiClient，代理/超时/端点判定与其它请求同源。 */
  apiClient?: ApiClient;
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
    async getCodingPlanQuota(_request: CodingPlanQuotaRequest): Promise<CodingPlanQuotaSnapshot> {
      // DeepCode accounts are served by our own gateway; z.ai/BigModel coding-plan
      // quotas do not apply. Fail explicitly instead of showing a fake 0% quota.
      throw new Error("Coding plan quota is not available for DeepCode accounts");
    },
  };
}
