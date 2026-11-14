import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

export function UsageStatsSection() {
  // 使用统计由 Agent 本地记录提供；第三方套餐剩余额度面板已随去耦合移除。
  return <AppUsagePanel />;
}
