import { describe, expect, it } from "vitest";
import { mobileWsUrl } from "./protocol.js";

describe("phone page WebSocket address", () => {
  it("same-network page at / uses /ws", () => {
    expect(mobileWsUrl("ws:", "192.168.0.2:34437", "/")).toBe("ws://192.168.0.2:34437/ws");
    expect(mobileWsUrl("ws:", "192.168.0.2:34437", "/mobile.html")).toBe("ws://192.168.0.2:34437/ws");
  });
  it("DeepCode relay page under /remote/ uses /remote/ws", () => {
    expect(mobileWsUrl("wss:", "deepcode-2sfl.onrender.com", "/remote/")).toBe("wss://deepcode-2sfl.onrender.com/remote/ws");
  });
});
