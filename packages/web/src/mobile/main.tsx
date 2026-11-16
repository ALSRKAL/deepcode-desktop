import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp.js";
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
    <MobileApp />
  </StrictMode>,
);
