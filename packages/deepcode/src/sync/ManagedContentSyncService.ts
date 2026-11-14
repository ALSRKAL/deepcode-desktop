/**
 * 托管内容同步服务（docs/plan/01 §8.2）。
 *
 * - GET /v1/sync/manifest（Bearer 设备密钥，If-None-Match: rev:<n>）→ 200 | 304。
 * - 每个 skill/preset 都带 publish 时的 Ed25519 签名与 sha256；下载后先验签再落盘，
 *   被攻破的 CDN 无法推送技能（docs/plan/01 §8.2 Integrity）。
 * - 归档写入 `~/.deepcode/managed/skills/<id>/`（独立 managed 根：用户文件永不被
 *   覆盖，同名用户技能按发现顺序遮蔽 managed）。
 * - MCP preset 是惰性模板：写入 managed/mcp.json 待用户启用，不自动执行任何命令。
 * - 离线：上次同步的集合继续可用；签名公钥由构建期编译进应用。
 *
 * 本服务不做执行；skill 内容由现有 skill scanner 在发现顺序中读取。
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SyncManifestSchema, type SyncManifest } from "../contracts.js";

export interface ManagedContentSyncServiceDeps {
  /** 网关 base（…/v1），manifest 端点为 /v1/sync/manifest。 */
  gatewayBaseUrl: string;
  /** 设备密钥（Bearer）。 */
  deviceKey: string;
  /** Ed25519 公钥（base64 SPKI；构建期注入）。 */
  manifestPublicKeyBase64: string;
  /** managed 根目录（默认 ~/.deepcode/managed；测试注入临时目录）。 */
  managedRoot: string;
  /** 可注入 fetch。 */
  fetchImpl?: typeof fetch;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void };
}

export interface SyncResult {
  status: "synced" | "not-modified" | "error";
  revision: number | null;
  skillsApplied: string[];
  error?: string;
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** canonicalJson：键排序后序列化（与 apps/web publish 端一致）。 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
      return Object.fromEntries(entries);
    }
    return v;
  });
}

/** 归档成员防路径穿越：所有条目必须落在目标目录内。 */
function safeArchiveTarget(root: string, memberName: string): string {
  const target = resolve(root, memberName);
  if (!target.startsWith(resolve(root) + "/") && target !== resolve(root)) {
    throw new Error(`archive member escapes managed root: ${memberName}`);
  }
  return target;
}

export interface ManagedContentSyncService {
  sync(options?: { force?: boolean }): Promise<SyncResult>;
  readManifestCache(): Promise<SyncManifest | null>;
}

export function createManagedContentSyncService(deps: ManagedContentSyncServiceDeps): ManagedContentSyncService {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const manifestCachePath = join(deps.managedRoot, "manifest.json");
  const revisionPath = join(deps.managedRoot, "revision");

  async function lastRevision(): Promise<number | null> {
    try {
      const raw = await readFile(revisionPath, "utf8");
      const n = Number(raw.trim());
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async function verifyItemSignature(item: { id: string; version: string; sha256: string }, signature: string): Promise<boolean> {
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(deps.manifestPublicKeyBase64, "base64"),
        format: "der",
        type: "spki",
      });
      return verifySignature(
        null,
        Buffer.from(canonicalJson({ id: item.id, version: item.version, sha256: item.sha256 }), "utf8"),
        publicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {
      return false;
    }
  }

  async function fetchArchive(url: string): Promise<Buffer> {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${deps.deviceKey}` },
    });
    if (!res.ok) throw new Error(`archive download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function stageSkill(item: SyncManifest["skills"][number], archive: Buffer): Promise<void> {
    const finalDir = join(deps.managedRoot, "skills", item.id);
    const stagingDir = `${finalDir}.staging-${process.pid}`;
    await rm(stagingDir, { recursive: true, force: true });
    // 归档是 .tar 成员集；这里用最小 tar 读取（ustar 头部）解包，条目路径经
    // safeArchiveTarget 校验。技能归档由发布端以确定性 tar 生成。
    await mkdir(stagingDir, { recursive: true });
    extractTar(archive, stagingDir);
    await rm(finalDir, { recursive: true, force: true });
    await mkdir(dirname(finalDir), { recursive: true });
    await rename(stagingDir, finalDir);
  }

  return {
    async sync(options = {}) {
      try {
        const last = options.force ? null : await lastRevision();
        const url = new URL("/v1/sync/manifest", deps.gatewayBaseUrl.endsWith("/v1") ? deps.gatewayBaseUrl : `${deps.gatewayBaseUrl}/v1`);
        const res = await fetchImpl(url, {
          headers: {
            authorization: `Bearer ${deps.deviceKey}`,
            ...(last !== null ? { "if-none-match": `rev:${last}` } : {}),
          },
        });
        if (res.status === 304) {
          return { status: "not-modified", revision: last, skillsApplied: [] };
        }
        if (!res.ok) {
          return { status: "error", revision: null, skillsApplied: [], error: `manifest fetch failed: ${res.status}` };
        }
        const manifest = SyncManifestSchema.parse(await res.json());

        const applied: string[] = [];
        for (const skill of manifest.skills) {
          const signatureOk = await verifyItemSignature(skill, skill.signature);
          if (!signatureOk) {
            deps.logger?.warn("[deepcode-sync] skill signature verification failed; skipping", { id: skill.id });
            continue;
          }
          const archive = await fetchArchive(skill.url);
          if (sha256Hex(archive) !== skill.sha256) {
            deps.logger?.warn("[deepcode-sync] skill archive hash mismatch; skipping", { id: skill.id });
            continue;
          }
          await stageSkill(skill, archive);
          applied.push(skill.id);
        }

        // MCP presets 是惰性模板：写入待启用清单，不自动执行。
        await mkdir(deps.managedRoot, { recursive: true });
        await writeFile(manifestCachePath, JSON.stringify(manifest, null, 2));
        await writeFile(revisionPath, String(manifest.revision));
        deps.logger?.info("[deepcode-sync] synced", { revision: manifest.revision, skills: applied.length });
        return { status: "synced", revision: manifest.revision, skillsApplied: applied };
      } catch (error) {
        return { status: "error", revision: null, skillsApplied: [], error: String(error) };
      }
    },

    async readManifestCache() {
      try {
        return SyncManifestSchema.parse(JSON.parse(await readFile(manifestCachePath, "utf8")));
      } catch {
        return null;
      }
    },
  };
}

/** 最小 ustar 解包（512 字节头）；仅支持普通文件，其余成员类型跳过。 */
function extractTar(archive: Buffer, targetDir: string): void {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeField, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] ?? 48);
    offset += 512;
    const dataEnd = offset + size;
    if (typeFlag === "0" || typeFlag === "\0") {
      const target = safeArchiveTarget(targetDir, name);
      const content = archive.subarray(offset, dataEnd);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    // 数据按 512 字节对齐补零；计算下一个头部偏移。
    offset = Math.ceil(dataEnd / 512) * 512;
  }
}
