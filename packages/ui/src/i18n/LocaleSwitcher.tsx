import { useCallback } from "react";
import type { Locale } from "@zcode/shared";
import { TID_LOCALE_TOGGLE } from "@zcode/shared";
import { useZCodeIntl } from "./IntlProvider.js";

// zh-CN 已从发行包移除（docs/plan/01 §5.2）；切换器在 ar 与 en-US 间循环。
const LOCALE_CYCLE: Locale[] = ["ar", "en-US"];

const LOCALE_LABELS: Record<Locale, string> = {
  ar: "ع",
  "zh-CN": "中",
  "en-US": "En",
  "ja-JP": "日",
  "ru-RU": "Ру",
  "ko-KR": "한",
};

/**
 * 语言切换按钮 —— 点击循环切换语言
 */
export function LocaleSwitcher() {
  const { intl, locale, setLocale } = useZCodeIntl();

  const cycleLocale = useCallback(() => {
    const idx = LOCALE_CYCLE.indexOf(locale);
    const next = LOCALE_CYCLE[(idx + 1) % LOCALE_CYCLE.length] ?? LOCALE_CYCLE[0]!;
    setLocale(next);
  }, [locale, setLocale]);

  return (
    <button
      onClick={cycleLocale}
      data-testid={TID_LOCALE_TOGGLE}
      className="cursor-pointer rounded-lg bg-btn-alt-bg px-3 py-1 text-ui-base text-btn-alt-text transition hover:bg-surface-raised"
      title={intl.formatMessage({ id: "locale.switchLanguage" })}
    >
      {LOCALE_LABELS[locale]}
    </button>
  );
}
