import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createZCodeCredentialCipher,
  isEncryptedZCodeCredentialValue,
  type ZCodeCredentialCipher,
} from "./credential-cipher.js";

/**
 * DeepCode 订阅设备密钥（docs/plan/01 §6）。
 *
 * 桌面 main 进程登录后把密钥写入加密凭据文件 `~/.deepcode/v2/credentials.json`
 * （键 `deepcode.deviceKey`，与 desktop 的 ICredentialService 同一文件、同一 cipher）。
 * agent 在每次绑定模型时同步读取：登录/登出无需重启 agent，密钥也不进入 agent 的
 * 子进程 env（Bash 工具等不会继承）。读失败一律视为未登录，由调用方给出明确错误。
 */
export const DEEPCODE_DEVICE_CREDENTIAL_KEY = "deepcode.deviceKey";
const DEEPCODE_DATA_DIR_NAME = ".deepcode";

export interface DeepCodeDeviceKeyReaderOptions {
  env?: Record<string, string | undefined>;
  filePath?: string;
  cipher?: ZCodeCredentialCipher;
}

export function resolveDeepCodeCredentialsPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const baseDir = env.ZCODE_DATA_BASE_DIR?.trim() || homedir();
  return join(baseDir, DEEPCODE_DATA_DIR_NAME, "v2", "credentials.json");
}

export function createDeepCodeDeviceKeyReader(
  options: DeepCodeDeviceKeyReaderOptions = {},
): () => string | undefined {
  const env = options.env ?? process.env;
  const filePath = options.filePath ?? resolveDeepCodeCredentialsPath(env);
  const cipher = options.cipher ?? createZCodeCredentialCipher({ env });
  return () => {
    try {
      const record = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const raw = record[DEEPCODE_DEVICE_CREDENTIAL_KEY];
      if (typeof raw !== "string" || raw.length === 0) return undefined;
      const value = isEncryptedZCodeCredentialValue(raw) ? cipher.decrypt(raw) : raw;
      return value.startsWith("sk-dc-") ? value : undefined;
    } catch {
      return undefined;
    }
  };
}
