import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { t } from "./mobileI18n.js";

/** 手机会话的轻量 Markdown 与复制按钮（不引入桌面 Streamdown，避免依赖桌面 store）。 */

/** 复制到剪贴板；非安全上下文（局域网 http）回落到 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回落到下方的 textarea 方案。
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? t("copied") : t("copy")}
      className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-ui-sm text-foreground-subtle active:bg-surface-hover ${className ?? ""}`}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span>{copied ? t("copied") : t("copy")}</span>
    </button>
  );
}

/* ---------- 轻量 Markdown：代码块、标题、列表、行内 code / 粗体 ---------- */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <bdi
          key={`${keyPrefix}-c${index}`}
          dir="ltr"
          className="rounded bg-surface px-1 py-0.5 font-mono text-ui-sm"
        >
          {token.slice(1, -1)}
        </bdi>,
      );
    } else {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = start + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div dir="ltr" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-2">
        <span className="font-mono text-ui-xs text-foreground-subtle">{lang || "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-ui-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function TextBlocks({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `${keyPrefix}-p${blocks.length}`;
    blocks.push(
      <p key={key} dir="auto" className="whitespace-pre-wrap break-words">
        {renderInline(paragraph.join("\n"), key)}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `${keyPrefix}-l${blocks.length}`;
    const items = list.items.map((item, i) => (
      <li key={`${key}-${i}`} dir="auto" className="break-words">
        {renderInline(item, `${key}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={key} className="list-decimal space-y-1 ps-5">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 ps-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = /^\s*```(\S*)/u.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/u.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push(
        <CodeBlock key={`${keyPrefix}-code${blocks.length}`} code={code.join("\n")} lang={fence[1] ?? ""} />,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const key = `${keyPrefix}-h${blocks.length}`;
      blocks.push(
        <p key={key} dir="auto" className="text-ui-lg font-semibold">
          {renderInline(heading[2] ?? "", key)}
        </p>,
      );
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/u.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/u.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet?.[1] ?? numbered?.[1] ?? "").trim());
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}

