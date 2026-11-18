import { useSyncExternalStore } from "react";

/**
 * 窄屏（手机）判定（DeepCode Studio，2026-11-18）。
 * 手机远控现在挂载与桌面相同的工作台；窄屏下侧栏改为抽屉，避免侧栏与会话并排挤压。
 * 阈值与 Tailwind `md` 断点一致。
 */
const NARROW_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches;
}

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
