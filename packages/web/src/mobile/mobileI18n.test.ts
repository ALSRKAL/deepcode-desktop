import { describe, expect, it } from "vitest";
import { resolveMobileLocale, setMobileLocale, t } from "./mobileI18n.js";

describe("phone remote page language", () => {
  it("follows the link's lang, else the phone language (Arabic → ar, otherwise English)", () => {
    expect(resolveMobileLocale("?lang=ar", ["en-US"])).toBe("ar");
    expect(resolveMobileLocale("", ["ar-SA", "en"])).toBe("ar");
    expect(resolveMobileLocale("", ["zh-CN"])).toBe("en");
    expect(resolveMobileLocale("?lang=en", ["ar"])).toBe("en");
  });

  it("is branded DeepCode Studio and has no Chinese text", () => {
    for (const locale of ["en", "ar"] as const) {
      setMobileLocale(locale);
      expect(t("title")).toContain("DeepCode Studio");
      expect(t("stats", { workspaces: 2, tasks: 5 })).toMatch(/2.*5/);
      expect(t("connPairedLabel")).not.toMatch(/[一-龥]/);
    }
  });
});
