import { describe, expect, it } from "vitest";
import type { ZCodeStreamEvent } from "@zcode/shared";
import {
  conversationReducer,
  conversationMessagesFromSnapshot,
  initialConversationState,
  isSameConversationScope,
  type ConversationAction,
  type ConversationMessage,
  type ConversationScope,
  type ConversationState,
} from "./conversationReducer.js";

/** 只比较气泡身份与正文；结构化 parts 由专门用例覆盖。 */
function bubbles(messages: ConversationMessage[]) {
  return messages.map(({ id, role, text }) => ({ id, role, text }));
}

const scopeA: ConversationScope = { workspaceKey: "ws-a", taskId: "task-1" };
const scopeB: ConversationScope = { workspaceKey: "ws-a", taskId: "task-2" };

function begin(scope: ConversationScope = scopeA): ConversationState {
  return conversationReducer(initialConversationState, { type: "beginScope", scope });
}

function applySnapshot(
  state: ConversationState,
  messages: ConversationMessage[],
  scope: ConversationScope = scopeA,
): ConversationState {
  return conversationReducer(state, { type: "applySnapshot", scope, messages });
}

function stream(
  state: ConversationState,
  event: ZCodeStreamEvent,
  scope: ConversationScope = scopeA,
): ConversationState {
  return conversationReducer(state, { type: "streamEvent", scope, event });
}

function chunk(params: {
  content: string;
  messageId?: string;
  traceId?: string;
  inputId?: string;
}): Extract<ZCodeStreamEvent, { type: "agent_message_chunk" }> {
  return {
    type: "agent_message_chunk",
    taskId: scopeA.taskId,
    traceId: params.traceId ?? "trace-1",
    ...(params.messageId ? { messageId: params.messageId } : {}),
    ...(params.inputId ? { inputId: params.inputId } : {}),
    content: params.content,
  };
}

function snapshotUpdated(): Extract<ZCodeStreamEvent, { type: "task_snapshot_updated" }> {
  return {
    type: "task_snapshot_updated",
    workspacePath: "/workspace/a",
    workspaceKey: scopeA.workspaceKey,
    taskId: scopeA.taskId,
    traceId: "trace-1",
  };
}

describe("conversationReducer scope", () => {
  it("scope 身份按 workspace + task 判定", () => {
    expect(isSameConversationScope(scopeA, { ...scopeA })).toBe(true);
    expect(isSameConversationScope(scopeA, scopeB)).toBe(false);
    expect(isSameConversationScope(scopeA, null)).toBe(false);
    expect(isSameConversationScope(null, scopeA)).toBe(false);
  });

  it("切换 task 后丢弃迟到事件", () => {
    let state = begin(scopeA);
    state = applySnapshot(state, [{ id: "u1", role: "user", text: "旧任务历史" }]);
    state = conversationReducer(state, { type: "beginScope", scope: scopeB });
    expect(state.scope).toEqual(scopeB);
    expect(bubbles(state.messages)).toEqual([]);

    // 旧 scope 的迟到 chunk 不能污染新任务。
    state = stream(state, chunk({ messageId: "late", content: "旧任务迟到碎片" }), scopeA);
    expect(bubbles(state.messages)).toEqual([]);

    // 旧 scope 的迟到快照同样被丢弃。
    state = applySnapshot(state, [{ id: "u2", role: "user", text: "旧快照" }], scopeA);
    expect(bubbles(state.messages)).toEqual([]);
  });
});

describe("conversationReducer stream chunks", () => {
  it("屏障落地前丢弃增量 chunk，落地后按序渲染", () => {
    let state = begin();
    expect(state.awaitingSnapshot).toBe(true);

    state = stream(state, chunk({ messageId: "m1", content: "早到增量" }));
    expect(bubbles(state.messages)).toEqual([]);

    state = applySnapshot(state, [{ id: "u1", role: "user", text: "你好" }]);
    expect(state.awaitingSnapshot).toBe(false);

    state = stream(state, chunk({ messageId: "m1", content: "屏障后增量" }));
    expect(bubbles(state.messages)).toEqual([
      { id: "u1", role: "user", text: "你好" },
      { id: "m1", role: "assistant", text: "屏障后增量" },
    ]);
  });

  it("乱序 chunk 按 messageId 归并到各自气泡", () => {
    let state = applySnapshot(begin(), []);
    state = stream(state, chunk({ messageId: "m1", content: "A1" }));
    state = stream(state, chunk({ messageId: "m2", content: "B1" }));
    state = stream(state, chunk({ messageId: "m1", content: "A2" }));
    state = stream(state, chunk({ messageId: "m2", content: "B2" }));

    expect(bubbles(state.messages)).toEqual([
      { id: "m1", role: "assistant", text: "A1A2" },
      { id: "m2", role: "assistant", text: "B1B2" },
    ]);
  });

  it.each([
    ["ha", "ha", "haha"],
    ["a", "ab", "aab"],
  ])("同 inputId/messageId 纯 delta %s + %s = %s", (first, second, text) => {
    let state = applySnapshot(begin(), []);
    state = stream(state, chunk({ messageId: "m1", inputId: "input-1", content: first }));
    state = stream(state, chunk({ messageId: "m1", inputId: "input-1", content: second }));
    expect(bubbles(state.messages)).toEqual([{ id: "m1", role: "assistant", text }]);
  });

  it("缺 messageId 时按 traceId 归并", () => {
    let state = applySnapshot(begin(), []);
    state = stream(state, chunk({ traceId: "trace-9", content: "foo" }));
    state = stream(state, chunk({ traceId: "trace-9", content: "bar" }));
    expect(bubbles(state.messages)).toEqual([{ id: "trace-9", role: "assistant", text: "foobar" }]);
  });
});

describe("conversationReducer resync", () => {
  it("task_snapshot_updated 置回等快照屏障并禁止增量", () => {
    let state = applySnapshot(begin(), [{ id: "m1", role: "assistant", text: "已渲染" }]);
    state = stream(state, snapshotUpdated());
    expect(state.awaitingSnapshot).toBe(true);
    expect(state.needsResync).toBe(true);

    state = stream(state, chunk({ messageId: "m1", content: "屏障期碎片" }));
    expect(bubbles(state.messages)).toEqual([{ id: "m1", role: "assistant", text: "已渲染" }]);
  });

  it("bridge-degraded/断档置 resync 标志并要求重读快照", () => {
    let state = applySnapshot(begin(), [{ id: "m1", role: "assistant", text: "已渲染" }]);
    state = conversationReducer(state, { type: "resync", scope: scopeA });
    expect(state.needsResync).toBe(true);
    expect(state.awaitingSnapshot).toBe(true);
  });

  it("重读快照清空 resync 与屏障，并覆盖本地增量", () => {
    let state = applySnapshot(begin(), []);
    state = stream(state, chunk({ messageId: "m1", content: "本地增量" }));
    expect(bubbles(state.messages)).toEqual([{ id: "m1", role: "assistant", text: "本地增量" }]);
    state = conversationReducer(state, { type: "resync", scope: scopeA });
    state = applySnapshot(state, [{ id: "m1", role: "assistant", text: "权威快照" }]);
    expect(state.needsResync).toBe(false);
    expect(state.awaitingSnapshot).toBe(false);
    expect(bubbles(state.messages)).toEqual([{ id: "m1", role: "assistant", text: "权威快照" }]);
  });

  it("终态事件触发一次最终对账", () => {
    let state = applySnapshot(begin(), []);
    const complete: ZCodeStreamEvent = {
      type: "task_complete",
      taskId: scopeA.taskId,
      traceId: "trace-1",
      stopReason: "complete",
    };
    state = stream(state, complete);
    expect(state.needsResync).toBe(true);
    expect(state.awaitingSnapshot).toBe(true);
  });
});

describe("conversationReducer optimistic user message", () => {
  it("乐观用户消息只进入匹配 scope", () => {
    let state = begin(scopeA);
    state = conversationReducer(state, {
      type: "appendOptimisticUserMessage",
      scope: scopeA,
      id: "local-1",
      text: "先显示这条",
    });
    expect(bubbles(state.messages)).toEqual([{ id: "local-1", role: "user", text: "先显示这条" }]);

    const action: ConversationAction = {
      type: "appendOptimisticUserMessage",
      scope: scopeB,
      id: "local-2",
      text: "不应进入",
    };
    state = conversationReducer(state, action);
    expect(bubbles(state.messages)).toEqual([{ id: "local-1", role: "user", text: "先显示这条" }]);
  });
});

describe("conversationReducer structured parts", () => {
  function ready(): ConversationState {
    return applySnapshot(begin(), []);
  }

  it("思考、工具与正文按到达顺序并入同一轮 live 气泡", () => {
    let state = ready();
    state = stream(state, { type: "task_run_started", taskId: "task-1", traceId: "t1", startedAt: 1 });
    expect(state.running).toBe(true);
    state = stream(state, { type: "agent_thought_chunk", taskId: "task-1", traceId: "t1", content: "想" });
    state = stream(state, { type: "agent_thought_chunk", taskId: "task-1", traceId: "t1", content: "一下" });
    state = stream(state, {
      type: "tool_call",
      taskId: "task-1",
      traceId: "t1",
      toolId: "call-1",
      toolName: "Bash",
      kind: "Bash",
      title: "Run tests",
      input: { command: "pnpm test" },
      raw: {},
    });
    state = stream(state, {
      type: "tool_call_update",
      taskId: "task-1",
      traceId: "t1",
      toolId: "call-1",
      status: "completed",
      raw: {},
    });
    state = stream(state, chunk({ content: "完成", traceId: "t1" }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.parts).toEqual([
      { kind: "reasoning", text: "想一下" },
      { kind: "tool", id: "call-1", tool: "Bash", title: "Run tests", status: "completed", detail: "pnpm test" },
      { kind: "text", text: "完成" },
    ]);
    expect(state.messages[0]?.text).toBe("完成");
  });

  it("子代理增量不混进主对话", () => {
    let state = ready();
    state = stream(state, {
      type: "agent_message_chunk",
      taskId: "task-1",
      traceId: "t1",
      parentToolUseId: "call-9",
      content: "子代理正文",
    });
    expect(state.messages).toEqual([]);
  });

  it("task_error 记录原因、结束运行态并要求对账", () => {
    let state = ready();
    state = stream(state, { type: "task_run_started", taskId: "task-1", traceId: "t1", startedAt: 1 });
    state = stream(state, { type: "task_error", taskId: "task-1", traceId: "t1", error: "boom" });
    expect(state.running).toBe(false);
    expect(state.lastError).toBe("boom");
    expect(state.needsResync).toBe(true);
  });

  it("快照映射文本、思考、工具状态，跳过 synthetic 文本", () => {
    const messages = conversationMessagesFromSnapshot([
      {
        info: { messageId: "m1", sessionId: "s", role: "assistant" },
        parts: [
          { id: "p0", sessionId: "s", messageId: "m1", type: "text", text: "<system>", synthetic: true },
          { id: "p1", sessionId: "s", messageId: "m1", type: "reasoning", text: "plan" },
          {
            id: "p2",
            sessionId: "s",
            messageId: "m1",
            type: "tool",
            callId: "c1",
            tool: "Read",
            state: { status: "error", input: { file_path: "/a.ts" }, error: "ENOENT", startedAt: 1, completedAt: 2 },
          },
          { id: "p3", sessionId: "s", messageId: "m1", type: "text", text: "答案" },
        ],
      },
    ] as never);
    expect(messages).toEqual([
      {
        id: "m1",
        role: "assistant",
        text: "答案",
        parts: [
          { kind: "reasoning", text: "plan" },
          { kind: "tool", id: "c1", tool: "Read", title: "Read", status: "error", detail: "/a.ts", output: "ENOENT" },
          { kind: "text", text: "答案" },
        ],
      },
    ]);
  });
});
