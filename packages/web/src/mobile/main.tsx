import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp.js";
import { RemoteWorkbench } from "./RemoteWorkbench.js";
import "@zcode/ui/styles.css";
import { mobileLocale, t } from "./mobileI18n.js";

// 页面语言与方向跟随手机语言（阿拉伯语从右到左）。
document.documentElement.lang = mobileLocale();
document.documentElement.dir = mobileLocale() === "ar" ? "rtl" : "ltr";
document.title = t("title");

const container = document.getElementById("mobile-root");
if (!container) {
  throw new Error("mobile-root container is missing");
}

createRoot(container).render(
  <StrictMode>
    {/* 默认挂载桌面同款工作台（与 ZCode 官方一致）；`?lite=1` 保留轻量页作为兜底。 */}
    {new URLSearchParams(window.location.search).get("lite") === "1" ? <MobileApp /> : <RemoteWorkbench />}
  </StrictMode>,
);
