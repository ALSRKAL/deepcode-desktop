import type { ZCodeMessageWithParts, ZCodeStreamEvent } from "@zcode/shared";

/**
 * 手机远控会话投影的纯函数 reducer。
 *
 * 职责：把 Host replayable 事件流（`agent_message_chunk` / `task_snapshot_updated` /
 * 终态事件）与快照读取结果，规约为稳定的消息气泡列表。订阅本身由 Host 拥有，
 * 本 reducer 不产生任何 IO，也不保存 session 事实，只维护移动端视图态：
 *
 * - **快照屏障**：`beginScope` 与 `task_snapshot_updated` 置 `awaitingSnapshot`，
 *   屏障期间丢弃增量 chunk，等 `applySnapshot` 落地权威历史。这样迟到的流式碎片
 *   不会覆盖已恢复的快照。
 * - **按 messageId 定位气泡**：同一 `messageId` 的纯 delta 按序追加；重复物理帧
 *   已由传输 seq 去重，正文内容不能充当事件身份。
 * - **resync 标志**：`bridge-degraded` / 断档 / 快照信号都置 `needsResync`，
 *   由宿主重开 bridge、重订阅并重读快照。
 * - **作用域代际**：每条 action 携带 `scope`（workspace + task），与当前 scope 不一致
 *   的事件直接丢弃，避免切 workspace/task 后的迟到事件污染新会话。
 */

/**
 * 气泡内的一段内容（DeepCode Studio，2026-11-18）。
 * 修复原因：v1 只渲染纯文本，手机上看不到「思考」、工具步骤（终端/读写文件）和进度，
 * 用户无法判断任务「做到哪了」。现在按 part 投影，与桌面时间线同源（readSessionMessages）。
 */
export type ConversationToolStatus = "running" | "completed" | "error";
export type ConversationPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      id: string;
      tool: string;
      title: string;
      status: ConversationToolStatus;
      /** 一行输入摘要（命令 / 路径 / 查询），只用于展示。 */
      detail?: string;
      /** 失败原因或输出尾部，只用于展示。 */
      output?: string;
    }
  | { kind: "file"; name: string };

/** 手机会话视图的一条气泡；`id` 稳定，供 React key 与幂等 upsert 复用。 */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  /** 正文纯文本（复制按钮与兼容旧渲染用）。 */
  text: string;
  /** 结构化内容；缺省时按 `text` 渲染。 */
  parts?: ConversationPart[];
  /** 实时流创建的气泡记录所属 traceId，思考/工具增量据此并入同一轮。 */
  traceId?: string;
}

/** 订阅作用域：workspace + task 任一变化都视为新会话。 */
export interface ConversationScope {
  workspaceKey: string;
  taskId: string;
}

export interface ConversationState {
  scope: ConversationScope | null;
  messages: ConversationMessage[];
  /** 快照屏障：为 true 时丢弃增量 chunk，等 `applySnapshot` 解除。 */
  awaitingSnapshot: boolean;
  /** 需要重读快照：degraded / 断档 / `task_snapshot_updated` / 终态事件。 */
  needsResync: boolean;
  /** 实时运行态：`task_run_started` 置 true，终态置 false；null 表示未知（用列表状态）。 */
  running: boolean | null;
  /** 最近一次 `task_error` 的可展示原因；新一轮开始时清空。 */
  lastError: string | null;
}

export const initialConversationState: ConversationState = {
  scope: null,
  messages: [],
  awaitingSnapshot: true,
  needsResync: false,
  running: null,
  lastError: null,
};

export type ConversationAction =
  | { type: "beginScope"; scope: ConversationScope }
  | { type: "applySnapshot"; scope: ConversationScope; messages: ConversationMessage[] }
  | { type: "streamEvent"; scope: ConversationScope; event: ZCodeStreamEvent }
  | { type: "resync"; scope: ConversationScope }
  | { type: "appendOptimisticUserMessage"; scope: ConversationScope; id: string; text: string };

/** 工具输入的一行摘要：命令、路径、模式或查询；其余工具不显示细节。 */
export function summarizeToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of [
    "command",
    "cmd",
    "file_path",
    "filePath",
    "path",
    "pattern",
    "query",
    "url",
    "description",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return undefined;
}

function tailOf(value: string, max = 600): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

/** `readSessionMessages` 的 `ZCodeMessageWithParts[]` → 气泡（文本、思考、工具、文件）。 */
export function conversationMessagesFromSnapshot(
  messages: ZCodeMessageWithParts[],
): ConversationMessage[] {
  return messages.map((message) => {
    const parts: ConversationPart[] = [];
    for (const part of message.parts) {
      if (part.type === "text") {
        if (part.ignored || part.text.length === 0) continue;
        // synthetic 文本是 agent 内部注入（系统提醒等），桌面同样不作为正文展示。
        if (part.synthetic) continue;
        parts.push({ kind: "text", text: part.text });
      } else if (part.type === "reasoning") {
        if (part.text.trim()) parts.push({ kind: "reasoning", text: part.text });
      } else if (part.type === "tool") {
        const state = part.state;
        const title =
          ("title" in state && typeof state.title === "string" && state.title.trim()) ||
          part.tool;
        parts.push({
          kind: "tool",
          id: part.callId,
          tool: part.tool,
          title,
          status:
            state.status === "completed"
              ? "completed"
              : state.status === "error"
                ? "error"
                : "running",
          detail: summarizeToolInput(state.input),
          ...(state.status === "error" ? { output: tailOf(state.error) } : {}),
          ...(state.status === "completed" && state.output ? { output: tailOf(state.output) } : {}),
        });
      } else if (part.type === "file") {
        parts.push({ kind: "file", name: part.filename ?? part.mime });
      }
    }
    return {
      id: message.info.messageId,
      role: message.info.role === "user" ? "user" : "assistant",
      text: parts
        .map((part) => (part.kind === "text" ? part.text : ""))
        .filter((value) => value.length > 0)
        .join("\n"),
      parts,
    };
  });
}

/** scope 身份比较：workspace + task 全等才算同一会话。 */
export function isSameConversationScope(
  left: ConversationScope | null,
  right: ConversationScope | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.workspaceKey === right.workspaceKey &&
    left.taskId === right.taskId
  );
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "beginScope": {
      // 同 scope 重新进入（断线重连 / 重订阅）：保留已渲染气泡，只立屏障要求重读快照。
      if (isSameConversationScope(state.scope, action.scope)) {
        return { ...state, awaitingSnapshot: true, needsResync: true };
      }
      return {
        scope: action.scope,
        messages: [],
        awaitingSnapshot: true,
        needsResync: false,
        running: null,
        lastError: null,
      };
    }
    case "appendOptimisticUserMessage": {
      if (!isSameConversationScope(state.scope, action.scope)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: action.id, role: "user", text: action.text, parts: [{ kind: "text", text: action.text }] },
        ],
        lastError: null,
      };
    }
    case "resync": {
      if (!isSameConversationScope(state.scope, action.scope)) return state;
      return { ...state, needsResync: true, awaitingSnapshot: true };
    }
    case "applySnapshot": {
      if (!isSameConversationScope(state.scope, action.scope)) return state;
      return {
        ...state,
        messages: action.messages,
        awaitingSnapshot: false,
        needsResync: false,
      };
    }
    case "streamEvent": {
      if (!isSameConversationScope(state.scope, action.scope)) return state;
      return reduceStreamEvent(state, action.event);
    }
  }
}

function reduceStreamEvent(state: ConversationState, event: ZCodeStreamEvent): ConversationState {
  // 快照信号：残余数据已 flush，先立屏障、等权威快照，再放行后续增量。
  if (event.type === "task_snapshot_updated") {
    return { ...state, awaitingSnapshot: true, needsResync: true };
  }
  if (event.type === "task_run_started") {
    return { ...state, running: true, lastError: null };
  }
  // 终态：再读一次快照对齐最终正文（流式碎片可能不完整）。
  if (event.type === "task_complete") {
    return { ...state, awaitingSnapshot: true, needsResync: true, running: false };
  }
  if (event.type === "task_error") {
    return {
      ...state,
      awaitingSnapshot: true,
      needsResync: true,
      running: false,
      lastError: event.error || event.detail || null,
    };
  }
  // 屏障期间丢弃增量：快照落地后由权威历史补齐，避免碎片覆盖。
  if (state.awaitingSnapshot) return state;
  // 子代理（parentToolUseId 非空）的增量不混进主对话；终态快照会给出完整结构。
  if ("parentToolUseId" in event && event.parentToolUseId) return state;
  switch (event.type) {
    case "agent_message_chunk":
      return reduceTextChunk(state, event);
    case "agent_thought_chunk":
      if (event.content.length === 0) return state;
      return appendToLiveTurn(state, event.traceId, (parts) => {
        const last = parts[parts.length - 1];
        if (last?.kind === "reasoning") {
          return [...parts.slice(0, -1), { ...last, text: last.text + event.content }];
        }
        return [...parts, { kind: "reasoning", text: event.content }];
      });
    case "tool_call":
      return appendToLiveTurn(state, event.traceId, (parts) => {
        if (parts.some((part) => part.kind === "tool" && part.id === event.toolId)) return parts;
        const tool = event.toolName ?? event.kind;
        return [
          ...parts,
          {
            kind: "tool",
            id: event.toolId,
            tool,
            title: event.title?.trim() || tool,
            status: "running",
            detail: summarizeToolInput(event.input),
          },
        ];
      });
    case "tool_call_update":
      return updateToolPart(state, event.toolId, {
        status:
          event.status === "completed"
            ? "completed"
            : event.status === "failed" || event.status === "denied" || event.status === "stopped"
              ? "error"
              : "running",
        ...(event.title?.trim() ? { title: event.title.trim() } : {}),
        ...(event.error ? { output: tailOf(event.error) } : {}),
      });
    default:
      return state;
  }
}

function reduceTextChunk(
  state: ConversationState,
  event: Extract<ZCodeStreamEvent, { type: "agent_message_chunk" }>,
): ConversationState {
  const content = event.content;
  if (content.length === 0) return state;
  // messageId 缺失时退回 traceId，保证同一轮次的碎片仍归并到同一条气泡。
  const key = event.messageId ?? event.traceId;
  // 生产者 content 是纯 delta 且没有唯一 eventId；内容去重会误删 ha/ha，前缀猜测会误合并 a/ab。
  // seq 层已保证交付幂等，messageId 只用于定位气泡。
  const index = findAssistantMessageIndex(state.messages, key);
  if (index === -1) {
    // 同一轮先到的思考/工具已建了 live 气泡：正文并入它，保持时间顺序。
    const live = findLiveTurnIndex(state.messages, event.traceId);
    if (live !== -1 && !event.messageId) {
      return appendTextAt(state, live, content);
    }
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          id: key,
          role: "assistant",
          text: content,
          parts: [{ kind: "text", text: content }],
          traceId: event.traceId,
        },
      ],
    };
  }
  return appendTextAt(state, index, content);
}

function appendTextAt(state: ConversationState, index: number, content: string): ConversationState {
  const existing = state.messages[index];
  if (!existing) return state;
  const parts = existing.parts ?? (existing.text ? [{ kind: "text" as const, text: existing.text }] : []);
  const last = parts[parts.length - 1];
  const nextParts: ConversationPart[] =
    last?.kind === "text"
      ? [...parts.slice(0, -1), { ...last, text: last.text + content }]
      : [...parts, { kind: "text", text: content }];
  const messages = [...state.messages];
  messages[index] = { ...existing, text: existing.text + content, parts: nextParts };
  return { ...state, messages };
}

/** 最后一条属于该 traceId 的 assistant 气泡；只看末尾，避免把增量插回历史中间。 */
function findLiveTurnIndex(messages: ConversationMessage[], traceId: string): number {
  const index = messages.length - 1;
  const last = messages[index];
  return last && last.role === "assistant" && last.traceId === traceId ? index : -1;
}

function appendToLiveTurn(
  state: ConversationState,
  traceId: string,
  update: (parts: ConversationPart[]) => ConversationPart[],
): ConversationState {
  const index = findLiveTurnIndex(state.messages, traceId);
  if (index === -1) {
    const parts = update([]);
    if (parts.length === 0) return state;
    return {
      ...state,
      running: state.running ?? true,
      messages: [
        ...state.messages,
        { id: `live-${traceId}-${state.messages.length}`, role: "assistant", text: "", parts, traceId },
      ],
    };
  }
  const existing = state.messages[index]!;
  const parts = update(existing.parts ?? []);
  if (parts === existing.parts) return state;
  const messages = [...state.messages];
  messages[index] = { ...existing, parts };
  return { ...state, messages };
}

function updateToolPart(
  state: ConversationState,
  toolId: string,
  patch: Partial<Extract<ConversationPart, { kind: "tool" }>>,
): ConversationState {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]!;
    const partIndex = message.parts?.findIndex((part) => part.kind === "tool" && part.id === toolId);
    if (partIndex === undefined || partIndex === -1) continue;
    const parts = [...message.parts!];
    parts[partIndex] = { ...(parts[partIndex] as Extract<ConversationPart, { kind: "tool" }>), ...patch };
    const messages = [...state.messages];
    messages[index] = { ...message, parts };
    return { ...state, messages };
  }
  return state;
}

function findAssistantMessageIndex(messages: ConversationMessage[], id: string): number {
  return messages.findIndex((message) => message.id === id && message.role === "assistant");
}
