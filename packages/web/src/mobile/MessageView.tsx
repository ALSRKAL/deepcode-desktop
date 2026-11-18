import { memo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  FilePen,
  FileText,
  Globe,
  Loader2,
  Paperclip,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import type { ConversationMessage, ConversationPart } from "./conversationReducer.js";
import { t } from "./mobileI18n.js";
import { CopyButton, TextBlocks } from "./mobileMarkdown.js";

/**
 * 手机会话气泡（DeepCode Studio，2026-11-18）：正文（轻量 Markdown）、思考、工具步骤、
 * 附件与复制。只渲染 reducer 投影，不持有会话事实。
 */

type ToolPart = Extract<ConversationPart, { kind: "tool" }>;

/* ---------- 思考与工具 ---------- */

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = text.trim().split("\n").find((line) => line.trim()) ?? "";
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-10 w-full items-center gap-2 px-3 text-start text-ui-sm text-foreground-subtle"
        onClick={() => setOpen((value) => !value)}
      >
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : null}
        <span className="shrink-0 font-medium">{live ? t("thinking") : t("thought")}</span>
        {!open ? (
          <span dir="auto" className="min-w-0 flex-1 truncate opacity-80">
            {preview}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-2 text-ui-sm text-foreground-subtle">
          <TextBlocks text={text} keyPrefix="r" />
        </div>
      ) : null}
    </div>
  );
}

function toolIcon(tool: string) {
  const name = tool.toLowerCase();
  if (/bash|shell|terminal|exec|command/u.test(name)) return SquareTerminal;
  if (/edit|write|patch|create|replace/u.test(name)) return FilePen;
  if (/read|view|cat/u.test(name)) return FileText;
  if (/grep|glob|search|find|ls|list/u.test(name)) return Search;
  if (/web|fetch|browser|url/u.test(name)) return Globe;
  if (/task|agent|subagent/u.test(name)) return Bot;
  return Wrench;
}

function ToolStep({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(part.tool);
  const expandable = Boolean(part.detail || part.output);
  return (
    <div className="rounded-lg bg-surface">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex min-h-10 w-full items-center gap-2 px-3 text-start"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="size-4 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-ui-sm text-foreground">
            {part.title}
          </span>
          {part.detail && !open ? (
            <span dir="ltr" className="block truncate font-mono text-ui-xs text-foreground-subtle">
              {part.detail}
            </span>
          ) : null}
        </span>
        <span className="sr-only">
          {part.status === "running"
            ? t("toolRunning")
            : part.status === "completed"
              ? t("toolDone")
              : t("toolFailed")}
        </span>
        {part.status === "running" ? (
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-primary" />
        ) : part.status === "completed" ? (
          <Check aria-hidden className="size-4 shrink-0 text-success" />
        ) : (
          <X aria-hidden className="size-4 shrink-0 text-destructive" />
        )}
      </button>
      {open ? (
        <div dir="ltr" className="space-y-1 border-t border-border px-3 py-2">
          {part.detail ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-ui-xs text-foreground">
              {part.detail}
            </pre>
          ) : null}
          {part.output ? (
            <pre
              className={`max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-ui-xs ${part.status === "error" ? "text-destructive" : "text-foreground-subtle"}`}
            >
              {part.output}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 连续的工具步骤折成一组：超过 4 步时默认只显示最后 3 步。 */
function ToolGroup({ parts }: { parts: ToolPart[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = !expanded && parts.length > 4 ? parts.length - 3 : 0;
  const shown = hidden > 0 ? parts.slice(-3) : parts;
  return (
    <div className="space-y-1.5">
      {hidden > 0 ? (
        <button
          type="button"
          className="min-h-8 text-ui-sm text-primary"
          onClick={() => setExpanded(true)}
        >
          {t("showMore")} (+{hidden})
        </button>
      ) : null}
      {shown.map((part) => (
        <ToolStep key={part.id} part={part} />
      ))}
      {expanded && parts.length > 4 ? (
        <button
          type="button"
          className="min-h-8 text-ui-sm text-primary"
          onClick={() => setExpanded(false)}
        >
          {t("showLess")}
        </button>
      ) : null}
    </div>
  );
}

function partsOf(message: ConversationMessage): ConversationPart[] {
  if (message.parts) return message.parts;
  return message.text ? [{ kind: "text", text: message.text }] : [];
}

export const MessageView = memo(function MessageView({
  message,
  live,
}: {
  message: ConversationMessage;
  /** 该气泡是否是正在进行的最后一轮（思考显示「正在思考」）。 */
  live: boolean;
}) {
  const parts = partsOf(message);
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[88%] rounded-2xl rounded-ee-md bg-primary px-3.5 py-2.5 text-ui-base text-primary-foreground">
          {parts.map((part, index) =>
            part.kind === "text" ? (
              <p key={index} dir="auto" className="whitespace-pre-wrap break-words">
                {part.text}
              </p>
            ) : part.kind === "file" ? (
              <p key={index} className="flex items-center gap-1 text-ui-sm opacity-90">
                <Paperclip className="size-3.5" />
                {t("attachment", { name: part.name })}
              </p>
            ) : null,
          )}
        </div>
        {message.text ? <CopyButton text={message.text} /> : null}
      </div>
    );
  }

  // 相邻工具步骤合并为一组，其余按原顺序渲染。
  const groups: Array<{ key: string; node: ReactNode }> = [];
  let toolRun: ToolPart[] = [];
  const flushTools = () => {
    if (toolRun.length === 0) return;
    const run = toolRun;
    groups.push({ key: `tools-${run[0]!.id}`, node: <ToolGroup parts={run} /> });
    toolRun = [];
  };
  parts.forEach((part, index) => {
    if (part.kind === "tool") {
      toolRun.push(part);
      return;
    }
    flushTools();
    if (part.kind === "text") {
      groups.push({
        key: `t${index}`,
        node: (
          <div className="text-ui-base leading-relaxed text-foreground">
            <TextBlocks text={part.text} keyPrefix={`${message.id}-${index}`} />
          </div>
        ),
      });
    } else if (part.kind === "reasoning") {
      groups.push({
        key: `r${index}`,
        node: <Reasoning text={part.text} live={live && index === parts.length - 1} />,
      });
    } else if (part.kind === "file") {
      groups.push({
        key: `f${index}`,
        node: (
          <p className="flex items-center gap-1 text-ui-sm text-foreground-subtle">
            <Paperclip className="size-3.5" />
            {t("attachment", { name: part.name })}
          </p>
        ),
      });
    }
  });
  flushTools();
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.key}>{group.node}</div>
      ))}
      {message.text && !live ? <CopyButton text={message.text} className="self-start -ms-2" /> : null}
    </div>
  );
});
