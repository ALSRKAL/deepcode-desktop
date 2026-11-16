import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: true }, net: { fetch: vi.fn() } }));

const { deepcodeRelayWsUrl, deriveRelayHttpBase } = await import("./manager.js");

describe("DeepCode relay addresses (phone works from any network)", () => {
  it("builds the relay socket on the DeepCode server under /remote/", () => {
    expect(deepcodeRelayWsUrl("https://deepcode-2sfl.onrender.com")).toBe("wss://deepcode-2sfl.onrender.com/remote/ws");
  });
  it("has no relay for a build without a real web origin", () => {
    expect(deepcodeRelayWsUrl("https://deepcode.example")).toBeNull();
  });
  it("the phone link keeps the /remote/ prefix; a self-hosted relay at /ws stays at /", () => {
    expect(deriveRelayHttpBase("wss://deepcode-2sfl.onrender.com/remote/ws")).toBe("https://deepcode-2sfl.onrender.com/remote/");
    expect(deriveRelayHttpBase("wss://my-relay.example/ws")).toBe("https://my-relay.example/");
  });
});
