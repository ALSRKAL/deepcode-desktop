import type { Locale, SkillScope } from "@zcode/shared";

interface SkillDisplayCandidate {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  pluginName?: string;
}

const OFFICIAL_BUILTIN_PLUGIN_NAMES = new Set([
  "android-emulator",
  "browser",
  "browser-use",
  "document-skills",
  "documents",
  "pdf",
  "presentations",
  "spreadsheets",
  "ios-simulator",
  "skill-creator",
  "plugin-creator",
  "superpowers",
  "zcode-guide",
]);

const OFFICIAL_PLUGIN_PATH_MARKERS = [
  "/zcode-plugins-official/",
  "\\zcode-plugins-official\\",
  "/android-emulator-plugin/",
  "/browser-use-plugin/",
  "/document-skills-plugin/",
  "/documents-plugin/",
  "/pdf-plugin/",
  "/presentations-plugin/",
  "/spreadsheets-plugin/",
  "/ios-simulator-plugin/",
  "/skill-creator-plugin/",
  "/plugin-creator-plugin/",
  "/superpowers-plugin/",
  "/zcode-guide-plugin/",
];

const BUILTIN_SKILL_DESCRIPTIONS: Record<string, Record<Locale, string>> = {
  "android-dev": {
    "ar": "بناء وتشغيل وفحص تطبيقات Android وأتمتتها خفيفة عبر أدوات android-emulator MCP.",
    "en-US":
      "Build, run, inspect, and lightly automate Android apps through the android-emulator MCP tools.",
  },
  brainstorming: {
    "ar": "استخدمه قبل أي عمل إبداعي: إنشاء ميزات أو بناء مكوّنات أو إضافة قدرات أو تعديل سلوك؛ يستكشف نية المستخدم والمتطلبات والتصميم أولاً.",
    "en-US":
      "Use before any creative work, including creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design before implementation.",
  },
  "control-browser": {
    "ar": "التحكم في المتصفح المدمج لفتح صفحات الويب وصفحات التطوير المحلية وفحصها والنقر عليها والإدخال والتقاط الشاشة أو التحقق منها.",
    "en-US":
      "Control ZCode's built-in browser to open, inspect, click, type, screenshot, or verify webpages and local development targets.",
  },
  "dispatching-parallel-agents": {
    "ar": "استخدمه عند وجود أكثر من مهمتين مستقلتين بلا حالة مشتركة أو تبعية ترتيب.",
    "en-US":
      "Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies.",
  },
  docx: {
    "ar": "إنشاء مستندات DOCX وتحريرها وتحليلها مع دعم المراجعات والتعليقات وحفظ التنسيق واستخراج النص. مناسب لإنشاء مستندات جديدة وتعديل المحتوى ومعالجة المراجعات وإضافة التعليقات ومهام Word الاحترافية الأخرى.",
    "en-US":
      "Create, edit, and analyze DOCX documents with revisions, comments, formatting preservation, and text extraction. Use for new documents, edits, revision handling, comments, and professional Word document work.",
  },
  "executing-plans": {
    "ar": "استخدمه عندما تتوفر خطة تنفيذ مكتوبة وتحتاج للتنفيذ في جلسة منفصلة بنقاط مراجعة.",
    "en-US":
      "Use when you have a written implementation plan to execute in a separate session with review checkpoints.",
  },
  "finishing-a-development-branch": {
    "ar": "استخدمه عندما يكتمل التنفيذ وتنجح الاختبارات وتحتاج لقرارة الدمج أو فتح PR أو تنظيف الفرع.",
    "en-US":
      "Use when implementation is complete, tests pass, and you need to decide how to integrate the work through merge, PR, or cleanup.",
  },
  "ios-dev": {
    "ar": "بناء وتشغيل وفحص تطبيقات محاكي iOS وأتمتتها خفيفة عبر أدوات ios-simulator MCP.",
    "en-US":
      "Build, run, inspect, and lightly automate iOS Simulator apps through the ios-simulator MCP tools.",
  },
  pdf: {
    "ar": "حزمة أدوات PDF احترافية تغطي التقارير والمرئيات الإبداعية وأكاديمية LaTeX ومعالجة ملفات PDF القائمة. يوجّه تلقائياً حسب نوع المستند ويدعم التقارير والملصقات والأوراق والسير الذاتية والاستخراج والدمج والتقسيم وتعبئة النماذج وتحويل الصيغ.",
    "en-US":
      "Professional PDF toolkit for reports, creative visuals, academic LaTeX, and existing-PDF workflows. Supports reports, posters, papers, resumes, extraction, merge, split, forms, and conversion.",
  },
  pptx: {
    "ar": "فحص وتحديث ضيّق للعناصر المحددة من منطقة معاينة PPTX. يتحقق من بصمة الملف الكاملة ومحدد OOXML لنص الأشكال أو خلايا الجداول، ويتوقف عند التعارض بدل التخمين.",
    "en-US":
      "Inspect and narrowly update elements selected in PPTX Preview Pane. Verifies the whole-file fingerprint and OOXML locator for shape or table-cell text, and stops on conflicts instead of guessing.",
  },
  "receiving-code-review": {
    "ar": "استخدمه لاستقبال ملاحظات مراجعة الكود والتصرف بناءً عليها قبل دفع التغييرات.",
    "en-US":
      "Use when receiving code review feedback before implementing suggestions, especially when feedback is unclear or technically questionable.",
  },
  "requesting-code-review": {
    "ar": "استخدمه لطلب مراجعة كود مستقلة قبل دمج التغييرات.",
    "en-US":
      "Use when completing tasks, implementing major features, or before merging to verify work meets requirements.",
  },
  "plugin-creator": {
    "ar": "إنشاء إضافات DeepCode للقدرات القابلة لإعادة الاستخدام.",
    "en-US": "Create and validate ZCode plugins, and guide local installation and updates.",
  },
  "skill-creator": {
    "ar": "إنشاء مهارات SKILL.md جديدة بهيكل صحيح ووصف فعّال.",
    "en-US":
      "Create new skills, edit existing skills, and iterate wording. Use for writing SKILL.md from scratch, improving skills, capturing repeated workflows, or tuning descriptions for reliable triggering.",
  },
  "subagent-driven-development": {
    "ar": "تنفيذ المهام عبر وكلاء فرعيين مع تسليم سياق مضبوط بين الخطوات.",
    "en-US":
      "Use when executing implementation plans with independent tasks in the current session.",
  },
  "systematic-debugging": {
    "ar": "تصحيح منهجي: أعد إنتاج الخطأ، افترض السبب، واختبر الفرضيات خطوة بخطوة.",
    "en-US":
      "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.",
  },
  "test-driven-development": {
    "ar": "طوّر بالاختبار أولاً: اكتب اختباراً فاشلاً ثم أصغر تنفيذ ينجح.",
    "en-US": "Use when implementing any feature or bugfix, before writing implementation code.",
  },
  "using-git-worktrees": {
    "ar": "استخدم git worktrees لعزل العمل على فروع متعددة بالتوازي.",
    "en-US":
      "Use when starting feature work that needs isolation or before executing implementation plans. Ensures an isolated workspace exists via native tools or git worktree fallback.",
  },
  "using-superpowers": {
    "ar": "استخدمه عند بدء أي محادثة؛ يشرح كيفية العثور على المهارات واستخدامها ويطلب استدعاء أداة Skill قبل أي رد بما فيه أسئلة التوضيح.",
    "en-US":
      "Use when starting any conversation. Establishes how to find and use skills, requiring Skill tool invocation before any response including clarifying questions.",
  },
  "verification-before-completion": {
    "ar": "استخدمه قبل الإعلان عن إنجاز العمل أو الإصلاح أو نجاح الاختبارات؛ يطلب تشغيل أوامر التحقق وتأكيد المخرجات، الدليل قبل الاستنتاج.",
    "en-US":
      "Use before claiming work is complete, fixed, or passing. Requires running verification commands and confirming output before success claims.",
  },
  "web-gui-tester": {
    "ar": "اختبارات صندوق أسود لواجهات الويب والمواقع المحلية عبر ZCode Browser Use، بالجمع بين تفاعل مستخدم حقيقي وأدلة DOM دلالية ولقطات شاشة مفحوصة.",
    "en-US":
      "Run pure GUI black-box tests against websites and local web frontends with ZCode Browser Use, combining real user interactions, semantic DOM evidence, and inspected screenshots.",
  },
  "writing-plans": {
    "ar": "استخدمه عند وجود مواصفات أو متطلبات متعددة الخطوات لكتابة خطة تنفيذ قبل تحرير الكود.",
    "en-US":
      "Use when you have a spec or requirements for a multi-step task, before touching code.",
  },
  "writing-skills": {
    "ar": "استخدمه عند إنشاء مهارة جديدة أو تعديل موجودة أو التحقق من صحتها قبل النشر.",
    "en-US":
      "Use when creating new skills, editing existing skills, or verifying skills work before deployment.",
  },
};

export function resolveSkillSourceLabel(scope: SkillScope, locale?: Locale): string {
  if (locale === "ar") {
    if (scope === "workspace") return "工作区";
    if (scope === "plugin") return "插件";
    return "用户";
  }
  if (scope === "workspace") return "Workspace";
  if (scope === "plugin") return "Plugin";
  return "User";
}

export function resolveSkillDisplayDescription(
  skill: SkillDisplayCandidate,
  locale?: Locale,
): string {
  const localized = isOfficialBuiltinSkill(skill)
    ? BUILTIN_SKILL_DESCRIPTIONS[skill.name]?.[locale ?? "en-US"]
    : undefined;
  return localized ?? skill.description;
}

function isOfficialBuiltinSkill(skill: SkillDisplayCandidate): boolean {
  if (skill.scope !== "plugin") {
    return false;
  }
  const pluginName = skill.pluginName?.trim();
  if (pluginName && OFFICIAL_BUILTIN_PLUGIN_NAMES.has(pluginName)) {
    return true;
  }
  const normalizedPath = skill.path.replaceAll("\\", "/");
  return OFFICIAL_PLUGIN_PATH_MARKERS.some((marker) => normalizedPath.includes(marker));
}
