/**
 * Account-family identity types kept for settings compatibility.
 *
 * Upstream maps these to z.ai / BigModel built-in providers. DeepCode does not
 * ship those services, so only the persisted-value vocabulary remains.
 */
export type ModelProviderFamilyId = "zai" | "bigmodel";
export type ProviderFamilyDomain = ModelProviderFamilyId;
