import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", isPackaged: true }, net: { fetch: vi.fn() } }));

const { fetchLatestManifestVersion } = await import("./manifestUpdateProvider.js");

const yaml = (version: string) => `version: ${version}\nreleaseDate: 2026-11-16T00:00:00Z\nfiles: []\n`;

describe("fetchLatestManifestVersion (install the newest release, not an older download)", () => {
  it("reads the newest version from the platform/channel manifest", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/api/v1/releases/electron/manifest");
      expect(u.searchParams.get("platform")).toBe("linux-x86_64");
      expect(u.searchParams.get("channel")).toBe("1");
      return new Response(yaml("3.16.2-20261117.900"));
    });
    const v = await fetchLatestManifestVersion({
      endpointOrigin: "https://updates.example",
      channel: "stable",
      platform: "linux-x86_64",
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(v).toBe("3.16.2-20261117.900");
  });

  it("returns null (install what is ready) when the server fails or is unreachable", async () => {
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    const bad = vi.fn(async () => new Response("nope", { status: 503 }));
    for (const fetchImpl of [down, bad]) {
      expect(
        await fetchLatestManifestVersion({
          endpointOrigin: "https://updates.example",
          channel: "stable",
          platform: "linux-x86_64",
          timeoutMs: 1000,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).toBeNull();
    }
  });
});
