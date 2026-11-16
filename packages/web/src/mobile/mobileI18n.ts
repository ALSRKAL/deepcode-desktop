/**
 * 手机远控页的文案（DeepCode Studio，2026-11-16）。
 * 修复原因：此前页面文案写死为中文、品牌为 ZCode；阿拉伯语/英语用户扫码后看到中文页面。
 * 语言优先取配对链接的 lang 参数（桌面界面语言），否则按手机浏览器语言：ar → 阿拉伯语，其余英语。
 */
export type MobileLocale = "ar" | "en";

const en = {
  title: "DeepCode Studio Remote",
  device: "Desktop: {name}",
  intro: "This connection shows the projects, tasks and chats open on this computer. When the QR code expires, reconnect from the desktop.",
  invalidLink: "This remote-control link is invalid. Generate a new QR code on the desktop.",
  taskTitle: "Task",
  noMessages: "No messages yet",
  messagePlaceholder: "Send a message",
  send: "Send",
  stats: "{workspaces} workspaces · {tasks} tasks",
  projects: "Projects",
  newTask: "New task",
  openOnDesktop: "Open on desktop",
  organize: "Group: {mode}",
  organizeTimeline: "Timeline",
  organizeWorkspace: "Workspace",
  sort: "Sort: {mode}",
  sortUpdated: "Updated",
  sortCreated: "Created",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  noTasks: "No tasks in this workspace",
  updatedAt: "Updated {time}",
  statusRunning: "Running",
  statusDone: "Done",
  statusError: "Error",
  statusIdle: "Idle",
  back: "Back to tasks",
  refresh: "Refresh",
  connEndedLabel: "Connection ended",
  connEndedExpired: "The pairing has expired. Scan the QR code again.",
  connEndedDuplicate: "This pairing supports one phone page. Close the other page and scan again.",
  connEndedInvalid: "The link is invalid. Get a new QR code from the desktop.",
  connEndedRejected: "The connection was refused. Scan the QR code again for a valid link.",
  connReconnectingLabel: "Reconnecting",
  connReconnecting: "The connection dropped. Reconnecting…",
  connConnectingLabel: "Connecting to the desktop",
  connConnecting: "Connecting to the desktop…",
  connVerifyingLabel: "Verifying",
  connVerifying: "Verifying the pairing…",
  connWaitingLabel: "Waiting for the desktop",
  connWaiting: "The phone is connected; waiting for the desktop to confirm.",
  connPairedLabel: "Connected to this desktop window",
  connPaired: "The phone is connected to this desktop window.",
  connClosedLabel: "Connection closed",
  connClosed: "The connection is closed. Scan the QR code on the desktop again.",
  connErrorLabel: "Connection problem",
  connError: "The connection has a temporary problem. Check the network and try again.",
} as const;

export type MobileStringKey = keyof typeof en;

const ar: Record<MobileStringKey, string> = {
  title: "التحكم عن بُعد — DeepCode Studio",
  device: "الجهاز: {name}",
  intro: "يعرض هذا الاتصال المشاريع والمهام والمحادثات المفتوحة على هذا الكمبيوتر. عند انتهاء صلاحية رمز QR أعد الاتصال من الكمبيوتر.",
  invalidLink: "رابط التحكم عن بُعد غير صالح. أنشئ رمز QR جديداً من الكمبيوتر.",
  taskTitle: "المهمة",
  noMessages: "لا توجد رسائل بعد",
  messagePlaceholder: "اكتب رسالة",
  send: "إرسال",
  stats: "{workspaces} مشروع · {tasks} مهمة",
  projects: "المشاريع",
  newTask: "مهمة جديدة",
  openOnDesktop: "افتحه على الكمبيوتر",
  organize: "التجميع: {mode}",
  organizeTimeline: "حسب الوقت",
  organizeWorkspace: "حسب المشروع",
  sort: "الترتيب: {mode}",
  sortUpdated: "آخر تحديث",
  sortCreated: "تاريخ الإنشاء",
  expandAll: "توسيع الكل",
  collapseAll: "طي الكل",
  noTasks: "لا توجد مهام في هذا المشروع",
  updatedAt: "حُدّث {time}",
  statusRunning: "قيد التنفيذ",
  statusDone: "مكتمل",
  statusError: "خطأ",
  statusIdle: "خامل",
  back: "رجوع إلى المهام",
  refresh: "تحديث",
  connEndedLabel: "انتهى الاتصال",
  connEndedExpired: "انتهت صلاحية الاقتران. امسح رمز QR مرة أخرى.",
  connEndedDuplicate: "هذا الاقتران يدعم صفحة هاتف واحدة. أغلق الصفحة الأخرى وامسح الرمز مجدداً.",
  connEndedInvalid: "الرابط غير صالح. احصل على رمز QR جديد من الكمبيوتر.",
  connEndedRejected: "رُفض الاتصال. امسح رمز QR مرة أخرى للحصول على رابط صالح.",
  connReconnectingLabel: "جارٍ إعادة الاتصال",
  connReconnecting: "انقطع الاتصال. جارٍ إعادة الاتصال…",
  connConnectingLabel: "جارٍ الاتصال بالكمبيوتر",
  connConnecting: "جارٍ الاتصال بالكمبيوتر…",
  connVerifyingLabel: "جارٍ التحقق",
  connVerifying: "جارٍ التحقق من الاقتران…",
  connWaitingLabel: "بانتظار الكمبيوتر",
  connWaiting: "الهاتف متصل، بانتظار تأكيد الكمبيوتر.",
  connPairedLabel: "متصل بنافذة الكمبيوتر هذه",
  connPaired: "الهاتف متصل بنافذة الكمبيوتر هذه.",
  connClosedLabel: "أُغلق الاتصال",
  connClosed: "أُغلق الاتصال. امسح رمز QR من الكمبيوتر مرة أخرى.",
  connErrorLabel: "مشكلة في الاتصال",
  connError: "توجد مشكلة مؤقتة في الاتصال. تحقق من الشبكة وحاول مرة أخرى.",
};

export function resolveMobileLocale(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language],
): MobileLocale {
  const param = new URLSearchParams(search).get("lang")?.toLowerCase();
  if (param === "ar" || param?.startsWith("ar-")) return "ar";
  if (param === "en" || param?.startsWith("en-")) return "en";
  return languages.some((l) => l?.toLowerCase().startsWith("ar")) ? "ar" : "en";
}

let current: MobileLocale = resolveMobileLocale();

export function setMobileLocale(locale: MobileLocale): void {
  current = locale;
}

export function mobileLocale(): MobileLocale {
  return current;
}

export function t(key: MobileStringKey, vars: Record<string, string | number> = {}): string {
  const template = (current === "ar" ? ar : en)[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
