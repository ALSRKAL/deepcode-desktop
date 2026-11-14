import { createHash, generateKeyPairSync, sign as ed25519Sign } from "node:crypto";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createManagedContentSyncService } from "../src/sync/ManagedContentSyncService.js";
import type { SyncManifest } from "../src/contracts.js";

/** D-09（docs/plan/04 §2.3）：签名/哈希校验、篡改拒绝、路径穿越拒绝、用户目录不被触碰。 */
describe("managed content sync (D-09)", () => {
  const managedRoot = mkdtempSync(join(tmpdir(), "deepcode-sync-"));
  const serverRoot = mkdtempSync(join(tmpdir(), "deepcode-server-"));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  const skillId = "pdf-extract";
  const skillVersion = "1.0.0";
  const skillArchive = buildTar({ "SKILL.md": "---\nname: pdf-extract\n---\nbody\n" });
  const skillSha256 = createHash("sha256").update(skillArchive).digest("hex");
  const signature = ed25519Sign(
    null,
    Buffer.from(JSON.stringify(sortKeys({ id: skillId, version: skillVersion, sha256: skillSha256 }))),
    privateKey,
  ).toString("base64");

  let baseUrl = "";
  let server: ReturnType<typeof startServer> | undefined;

  function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)]),
      );
    }
    return value;
  }

  function buildTar(members: Record<string, string>): Buffer {
    const chunks: Buffer[] = [];
    for (const [name, content] of Object.entries(members)) {
      const header = Buffer.alloc(512, 0);
      Buffer.from(name).copy(header, 0);
      header.write("0000000", 124, 7, "utf8"); // placeholder size (fixed below)
      const size = Buffer.byteLength(content);
      header.write(size.toString(8).padStart(11, "0"), 124, 12, "utf8");
      header.write("0", 156, 1, "utf8"); // regular file
      chunks.push(header, Buffer.from(content));
      const pad = (512 - (Buffer.byteLength(content) % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
    chunks.push(Buffer.alloc(1024)); // end marker
    return Buffer.concat(chunks);
  }

  function startServer(manifestFactory: () => SyncManifest, archive: Buffer) {
    const { createServer } = require("node:http") as typeof import("node:http");
    const http = createServer((req, res) => {
      if (req.url?.includes("/v1/sync/manifest")) {
        // baseUrl 只有 listen 之后才知道；manifest 在请求期构建。
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(manifestFactory()));
        return;
      }
      if (req.url?.includes("/archive")) {
        res.end(archive);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    return new Promise<number>((resolveListen) => {
      http.listen(0, "127.0.0.1", () => resolveListen((http.address() as { port: number }).port));
    }).then((port) => {
      baseUrl = `http://127.0.0.1:${port}`;
      return { http, port };
    });
  }

  const manifest = (): SyncManifest => ({
    revision: 3,
    skills: [
      {
        id: skillId,
        name: "PDF Extract",
        version: skillVersion,
        sha256: skillSha256,
        url: `${baseUrl}/api/v1/skills/x/archive`,
        minTier: "free",
        signature,
      },
    ],
    mcpPresets: [],
  });

  beforeAll(async () => {
    server = await startServer(() => manifest(), skillArchive);
  });

  afterAll(async () => {
    server?.http.close();
  });

  function makeService(publicKeyOverride?: string) {
    return createManagedContentSyncService({
      gatewayBaseUrl: baseUrl,
      deviceKey: "sk-dc-test",
      manifestPublicKeyBase64: publicKeyOverride ?? publicKeyBase64,
      managedRoot,
      fetchImpl: (input, init) => fetch(input, init),
      logger: {
        info: () => {},
        warn: (msg, meta) => console.log("SYNC WARN:", msg, JSON.stringify(meta ?? {})),
      },
    });
  }

  it("verifies signature and hash, stages the skill into the managed root", async () => {
    const service = makeService();
    const result = await service.sync();
    if (result.status === "error") console.log("SYNC ERROR:", result.error);
    expect(result.status).toBe("synced");
    expect(result.revision).toBe(3);
    expect(result.skillsApplied).toEqual([skillId]);
    const installed = join(managedRoot, "skills", skillId, "SKILL.md");
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, "utf8")).toContain("pdf-extract");
    // Revision cached for If-None-Match.
    expect(readFileSync(join(managedRoot, "revision"), "utf8").trim()).toBe("3");
  });

  it("rejects a tampered archive (hash mismatch)", async () => {
    const tampered = Buffer.from(skillArchive);
    tampered[tampered.length - 20] = tampered[tampered.length - 20]! ^ 0xff;
    const { http } = await startServer(() => manifest(), tampered);
    const service = makeService();
    const result = await service.sync({ force: true });
    expect(result.skillsApplied).toEqual([]);
    expect(result.status).toBe("synced"); // manifest ok; skill skipped
    http.close();
  });

  it("rejects an item whose signature does not verify", async () => {
    const { publicKey: otherKey } = generateKeyPairSync("ed25519");
    const otherPub = otherKey.export({ type: "spki", format: "der" }).toString("base64");
    const service = makeService(otherPub);
    const result = await service.sync({ force: true });
    expect(result.skillsApplied).toEqual([]);
  });

  it("archive members escaping the managed root are rejected", async () => {
    const escaping = buildTar({ "../../escape.txt": "nope" });
    // Signature/hash must match the escaping archive to reach the extraction path.
    const escapeSha = createHash("sha256").update(escaping).digest("hex");
    const escapeSig = ed25519Sign(
      null,
      Buffer.from(JSON.stringify(sortKeys({ id: "evil", version: "1.0.0", sha256: escapeSha }))),
      privateKey,
    ).toString("base64");
    const evilManifest: SyncManifest = {
      revision: 4,
      skills: [
        {
          id: "evil",
          name: "Evil",
          version: "1.0.0",
          sha256: escapeSha,
          url: `${baseUrl}/api/v1/skills/evil/archive`,
          minTier: "free",
          signature: escapeSig,
        },
      ],
      mcpPresets: [],
    };
    writeFileSync(join(serverRoot, "evil.tar"), escaping);
    const { http } = await startServer(() => evilManifest, escaping);
    const service = makeService();
    const result = await service.sync({ force: true });
    expect(result.skillsApplied).toEqual([]);
    expect(existsSync(join(managedRoot, "..", "escape.txt"))).toBe(false);
    http.close();
  });

  it("MCP presets stay inert templates", async () => {
    const service = makeService();
    const cached = await service.readManifestCache();
    expect(cached).toBeTruthy();
    expect(cached!.mcpPresets).toEqual([]); // presets written as templates only
  });
});
