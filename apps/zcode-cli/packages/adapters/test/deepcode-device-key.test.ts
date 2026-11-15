import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  createDeepCodeDeviceKeyReader,
  resolveDeepCodeCredentialsPath,
} from "../src/auth/deepcode-device-key.js";
import { createDeepCodeAuthFetch } from "../src/model/model-execution.js";

/** Same format as the desktop host's credentialCipherProvider (enc:v1:iv.tag.ct). */
function hostEncrypt(secret: string, value: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function withStore(run: (env: Record<string, string>, write: (record: Record<string, string>) => void) => void) {
  const base = mkdtempSync(join(tmpdir(), "deepcode-key-"));
  const env = { ZCODE_DATA_BASE_DIR: base, ZCODE_CREDENTIAL_SECRET: "test-secret" };
  const file = resolveDeepCodeCredentialsPath(env);
  try {
    run(env, (record) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(record));
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("credentials path follows the desktop data dir (.deepcode/v2)", () => {
  assert.equal(
    resolveDeepCodeCredentialsPath({ ZCODE_DATA_BASE_DIR: "/data" }),
    join("/data", ".deepcode", "v2", "credentials.json"),
  );
});

test("reads the host-encrypted device key and sees sign-in/sign-out without restart", () => {
  withStore((env, write) => {
    const read = createDeepCodeDeviceKeyReader({ env });
    assert.equal(read(), undefined, "no file → signed out");

    const key = `sk-dc-${"a".repeat(43)}`;
    write({ "deepcode.deviceKey": hostEncrypt("test-secret", key), other: "x" });
    assert.equal(read(), key, "sign-in is picked up on the next read");

    write({ other: "x" });
    assert.equal(read(), undefined, "sign-out is picked up on the next read");
  });
});

test("wrong cipher secret, corrupt file or non-DeepCode value read as signed out", () => {
  withStore((env, write) => {
    const read = createDeepCodeDeviceKeyReader({ env });
    write({ "deepcode.deviceKey": hostEncrypt("other-secret", `sk-dc-${"b".repeat(43)}`) });
    assert.equal(read(), undefined);
    write({ "deepcode.deviceKey": "not-a-deepcode-key" });
    assert.equal(read(), undefined);
  });
});

test("auth fetch sends the current key as Bearer and strips SDK key headers", async () => {
  let current: string | undefined = "sk-dc-first";
  const seen: Headers[] = [];
  const inner = (async (_input: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response("{}");
  }) as typeof fetch;
  const wrapped = createDeepCodeAuthFetch(inner, () => current);

  await wrapped("https://gw.test/v1/messages", {
    headers: { "x-api-key": "placeholder", "x-goog-api-key": "p", "content-type": "application/json" },
  });
  current = "sk-dc-rotated";
  await wrapped("https://gw.test/v1/messages", { headers: { authorization: "Bearer stale" } });

  assert.equal(seen[0]!.get("authorization"), "Bearer sk-dc-first");
  assert.equal(seen[0]!.get("x-api-key"), null);
  assert.equal(seen[0]!.get("x-goog-api-key"), null);
  assert.equal(seen[0]!.get("content-type"), "application/json");
  assert.equal(seen[1]!.get("authorization"), "Bearer sk-dc-rotated");

  current = undefined;
  await assert.rejects(() => wrapped("https://gw.test/v1/messages"), /Sign in to DeepCode Studio/);
});
