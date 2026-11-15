import type { AccountProviderConnectionResolver } from "@zcode/provider";

/**
 * DeepCode Studio account models (owner request 2026-11-15).
 *
 * The built-in DeepCode provider is one product split into four internal entries,
 * one per wire format (chat completions, messages, responses, google). Which
 * models a user sees is decided by the admin per plan on the server, so instead
 * of a list fixed at build time we ask the gateway (`GET <gateway>/v1/models`,
 * device key) and publish each model under the entry of its native format:
 *
 *  - signed out (no device key)  → every DeepCode entry unavailable, no models;
 *  - key revoked / invalid (401) → unavailable (credential-failed);
 *  - gateway unreachable         → unknown (the previous list is kept);
 *  - otherwise                   → available with exactly the plan's models.
 */
export const DEEPCODE_DEVICE_CREDENTIAL_KEY = "deepcode.deviceKey";

export interface DeepcodeAccountConnectionDeps {
  loadDeviceKey: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type GatewayModel = { id?: unknown; api_type?: unknown };

export function createDeepcodeAccountConnectionResolver(
  deps: DeepcodeAccountConnectionDeps,
): AccountProviderConnectionResolver {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (input) => {
    const entries = [...input.configuredProviders.entries()].filter(
      ([, config]) => config.access?.type === "deepcode-account",
    );
    if (entries.length === 0) return [];
    const ids = entries.map(([providerId]) => providerId);

    let key: string | null = null;
    try {
      key = await deps.loadDeviceKey();
    } catch {
      key = null;
    }
    if (!key || !key.startsWith("sk-dc-")) {
      return ids.map((providerId) => ({
        providerId,
        status: "unavailable" as const,
        unavailableReason: "not-authenticated" as const,
        resetPrevious: true,
      }));
    }

    const baseUrl = entries
      .map(([, config]) => config.api?.baseUrl)
      .find((url): url is string => typeof url === "string" && url.length > 0);
    if (!baseUrl) return ids.map((providerId) => ({ providerId, status: "unknown" as const }));

    let models: GatewayModel[];
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
      });
      if (res.status === 401 || res.status === 403) {
        return ids.map((providerId) => ({
          providerId,
          status: "unavailable" as const,
          unavailableReason: "credential-failed" as const,
        }));
      }
      if (!res.ok) return ids.map((providerId) => ({ providerId, status: "unknown" as const }));
      const body = (await res.json()) as { data?: unknown };
      models = Array.isArray(body.data) ? (body.data as GatewayModel[]) : [];
    } catch {
      return ids.map((providerId) => ({ providerId, status: "unknown" as const }));
    }

    // Entry per native wire format; models without a known format go to chat completions.
    const entryByType = new Map<string, string>();
    for (const [providerId, config] of entries) {
      const type = config.api?.type;
      if (typeof type === "string" && !entryByType.has(type)) entryByType.set(type, providerId);
    }
    const fallbackEntry = entryByType.get("openai-chat-completions") ?? ids[0]!;
    const byEntry = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const model of models) {
      if (typeof model.id !== "string" || model.id.length === 0 || model.id.length > 128) continue;
      const entry =
        (typeof model.api_type === "string" ? entryByType.get(model.api_type) : undefined) ??
        fallbackEntry;
      byEntry.get(entry)!.push(model.id);
    }
    return ids.map((providerId) => ({
      providerId,
      status: "available" as const,
      models: byEntry.get(providerId) ?? [],
    }));
  };
}
