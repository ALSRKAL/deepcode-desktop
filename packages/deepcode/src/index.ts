/**
 * DeepCode Studio 桌面端专属代码（docs/plan/01 §6、§8.2）。上游合并面保持最小：
 * 所有第一方集成（登录、设备密钥、托管内容同步、订阅 HUD 数据源）都收敛在本包。
 */
export type {
  DeepCodeSession,
  DeepCodeAuthStart,
  DeepCodeAuthService,
} from "./auth/DeepCodeAuthService.js";
export { createDeepCodeAuthService, DEEPCODE_DEVICE_CREDENTIAL_KEY } from "./auth/DeepCodeAuthService.js";
export type { ManagedContentSyncService } from "./sync/ManagedContentSyncService.js";
export { createManagedContentSyncService } from "./sync/ManagedContentSyncService.js";
export * from "./contracts.js";
