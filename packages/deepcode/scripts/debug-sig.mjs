import { createHash, createPublicKey, generateKeyPairSync, sign as ed25519Sign, verify as verifySignature } from "node:crypto";

function canonicalJson(value) {
  return JSON.stringify(value, (_k, v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const entries = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1));
      return Object.fromEntries(entries);
    }
    return v;
  });
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const item = { id: "pdf-extract", version: "1.0.0", sha256: "abc" };
const payload = Buffer.from(JSON.stringify(sortKeys(item)));
const signature = ed25519Sign(null, payload, privateKey).toString("base64");
console.log("sign payload:", payload.toString());
console.log("verify direct:", verifySignature(null, payload, privateKey.publicKey ?? createPublicKey(privateKey), Buffer.from(signature, "base64")));
const pubKey = createPublicKey(Buffer.from(pubB64, "base64"));
console.log("verify spki:", verifySignature(null, payload, pubKey, Buffer.from(signature, "base64")));
console.log("canonical service payload:", canonicalJson(item));
console.log("match:", canonicalJson(item) === payload.toString());
