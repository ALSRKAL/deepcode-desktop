import { describe, expect, it } from "vitest";
import { isVersionGreaterThan, normalizeVersionForCompare } from "./updateVersion.js";

describe("update version comparison keeps the build number", () => {
  it("a later DeepCode build is newer (it used to compare equal)", () => {
    expect(isVersionGreaterThan("3.16.2-20261117.901", "3.16.2-20261117.900")).toBe(true);
    expect(isVersionGreaterThan("3.16.2-20261117.900", "3.16.2-20261116.458")).toBe(true);
    expect(isVersionGreaterThan("3.16.2-20261116.458", "3.16.2-20261117.900")).toBe(false);
    expect(isVersionGreaterThan("3.16.2-20261116.458", "3.16.2-20261116.458")).toBe(false);
  });
  it("still understands plain and v-prefixed versions", () => {
    expect(normalizeVersionForCompare("v3.17.0")).toBe("3.17.0");
    expect(isVersionGreaterThan("3.17.0", "3.16.2-20261117.900")).toBe(true);
  });
});
