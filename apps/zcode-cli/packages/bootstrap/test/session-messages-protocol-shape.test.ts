import { describe, expect, it } from "vitest";
import { zcodeSessionMessagesResultSchema } from "@zcode/shared";
import type { MessageWithParts } from "@zcode/contracts";
import { mapMessageWithParts } from "../src/zcode-protocol/message-mapper.js";

/**
 * Phone remote control showed no conversation (2026-11-18): session/messages returned
 * the stored shape (id, sessionID, messageID, parentID, callID, state.time) and the desktop
 * rejected it against zcodeSessionMessagesResultSchema. The reply must be mapped.
 */
const now = 1_794_990_000_000;
const stored = [
  {
    info: { id: "msg_u1", sessionID: "ses_1", role: "user", time: { created: now }, agent: "build", modelSelection: undefined },
    parts: [{ id: "prt_1", sessionID: "ses_1", messageID: "msg_u1", type: "text", text: "أضف التحقق من البريد" }],
  },
  {
    info: {
      id: "msg_a1",
      sessionID: "ses_1",
      parentID: "msg_u1",
      role: "assistant",
      time: { created: now + 1, completed: now + 5 },
      agent: "build",
      providerId: "account:deepcode",
      modelId: "deepcode-default",
      path: { cwd: "/tmp/p", root: "/tmp/p" },
      cost: 0,
      tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      { id: "prt_2", sessionID: "ses_1", messageID: "msg_a1", type: "reasoning", text: "thinking", time: { start: now + 1, end: now + 2 } },
      { id: "prt_3", sessionID: "ses_1", messageID: "msg_a1", type: "text", text: "Done." },
      {
        id: "prt_4",
        sessionID: "ses_1",
        messageID: "msg_a1",
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: { status: "completed", input: { path: "a.ts" }, output: "ok", title: "a.ts", metadata: {}, time: { start: now + 2, end: now + 3 } },
      },
    ],
  },
] as unknown as MessageWithParts[];

describe("session/messages answers in the protocol shape", () => {
  it("raw stored messages do NOT pass the protocol schema (the bug)", () => {
    expect(zcodeSessionMessagesResultSchema.safeParse({ messages: stored }).success).toBe(false);
  });

  it("mapped messages pass the schema the desktop validates against", () => {
    const parsed = zcodeSessionMessagesResultSchema.safeParse({ messages: stored.map(mapMessageWithParts) });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5)));
    const [user, assistant] = parsed.data.messages;
    expect(user!.info.messageId).toBe("msg_u1");
    expect(assistant!.info.role).toBe("assistant");
    expect(assistant!.parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
  });
});
