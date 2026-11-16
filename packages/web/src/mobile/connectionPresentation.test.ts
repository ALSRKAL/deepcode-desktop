import { describe, expect, it } from "vitest";
import { presentMobileConnection } from "./connectionPresentation.js";
import { setMobileLocale } from "./mobileI18n.js";

setMobileLocale("en");

describe("presentMobileConnection", () => {
  it("distinguishes initial connection, authentication, waiting, and paired states", () => {
    expect(presentMobileConnection("connecting")).toMatchObject({
      label: "Connecting to the desktop",
      description: "Connecting to the desktop…",
      terminal: false,
    });
    expect(presentMobileConnection("authenticating").label).toBe("Verifying");
    expect(presentMobileConnection("waiting").label).toBe("Waiting for the desktop");
    expect(presentMobileConnection("paired").label).toBe("Connected to this desktop window");
  });

  it("identifies reconnecting from the close code without creating retry state", () => {
    expect(presentMobileConnection("connecting", { closeCode: 1006 })).toMatchObject({
      label: "Reconnecting",
      description: "The connection dropped. Reconnecting…",
      terminal: false,
    });
  });

  it.each([
    ["AUTH_FAILED", "The pairing has expired. Scan the QR code again."],
    ["WRONG_PARAM", "The link is invalid. Get a new QR code from the desktop."],
  ])("shows safe terminal guidance for %s", (reason, description) => {
    expect(presentMobileConnection("error", { reason })).toMatchObject({
      label: "Connection ended",
      description,
      terminal: true,
    });
  });

  it("asks a kicked page to close, and recognizes rejection only with close code 4001", () => {
    expect(presentMobileConnection("error", { reason: "KICKED" }).description).toContain(
      "Close the other page",
    );
    expect(presentMobileConnection("connecting", { reason: "CONNECTION_REJECTED" }).terminal).toBe(
      false,
    );
    expect(
      presentMobileConnection("connecting", {
        reason: "CONNECTION_REJECTED",
        closeCode: 4001,
      }),
    ).toMatchObject({
      label: "Connection ended",
      description: "The connection was refused. Scan the QR code again for a valid link.",
      terminal: true,
    });
  });

  it("maps close-only kicked/expired failures to terminal guidance", () => {
    expect(presentMobileConnection("error", { closeCode: 4002, reason: "kicked" })).toEqual(
      presentMobileConnection("error", { reason: "KICKED" }),
    );
    expect(presentMobileConnection("error", { closeCode: 4003, reason: "pair-expired" })).toEqual(
      presentMobileConnection("error", { reason: "AUTH_FAILED" }),
    );
  });

  it("does not expose unknown server reasons or message-like data", () => {
    expect(
      presentMobileConnection("error", {
        reason: "sensitive server text AUTH_FAILED proof=secret",
      }),
    ).toEqual({
      label: "Connection problem",
      description: "The connection has a temporary problem. Check the network and try again.",
      terminal: false,
    });
  });

  it("does not present closed as automatic retry", () => {
    expect(presentMobileConnection("closed")).toMatchObject({
      label: "Connection closed",
      terminal: false,
    });
  });
});
