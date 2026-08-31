import { randomUUID } from "node:crypto";
import { config } from "../config/env";
import { metaConnectionStatusSchema, META_GRAPH_API_VERSION, MetaConnectionStatus, MetaGraphClient, MetaProbeResult } from "../schemas/meta-connection";

const disabledGate = (enabled: boolean, reason: string) => ({
  enabled,
  canPublish: false,
  status: enabled ? "blocked" as const : "disabled" as const,
  reasons: [reason],
});

const defaultProbe: MetaGraphClient = {
  async probe(input): Promise<MetaProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const requestId = randomUUID();
    try {
      const graph = `https://graph.facebook.com/${input.version}`;
      const get = async (path: string, token: string, fields: string): Promise<Record<string, unknown>> => {
        const url = `${graph}/${path}?fields=${encodeURIComponent(fields)}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error("Meta provider request failed");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") throw new Error("Meta provider response invalid");
        return body as Record<string, unknown>;
      };
      const accounts = await get("me/accounts", input.userAccessToken, "id,name,tasks,instagram_business_account,access_token");
      const data = Array.isArray(accounts.data) ? accounts.data : [];
      const page = data.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).id === input.pageId) as Record<string, unknown> | undefined;
      const linked = page?.instagram_business_account;
      const linkedId = linked && typeof linked === "object" ? (linked as Record<string, unknown>).id : undefined;
      const pageToken = typeof page?.access_token === "string" ? page.access_token : "";
      const instagram = pageToken ? await get(input.instagramAccountId, pageToken, "id,username,account_type") : {};
      const debug = await get("debug_token", input.appSecret, "data");
      const debugData = debug.data && typeof debug.data === "object" ? debug.data as Record<string, unknown> : {};
      const expiresAt = typeof debugData.expires_at === "number" ? new Date(debugData.expires_at * 1000).toISOString() : null;
      const valid = debugData.is_valid === true;
      const expiring = expiresAt !== null && new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
      return {
        identity: Boolean(page), linkage: linkedId === input.instagramAccountId,
        permissions: Array.isArray(page?.tasks) && (page.tasks as unknown[]).length > 0,
        version: input.version === META_GRAPH_API_VERSION,
        tokenStatus: valid ? (expiring ? "expiring" : "valid") : "invalid",
        expiresAt, requestId, diagnostic: Boolean(page) && instagram.account_type === "BUSINESS" ? "validated" : "validation_failed",
      };
    } catch (_error) {
      return { identity: false, linkage: false, permissions: false, version: input.version === META_GRAPH_API_VERSION, tokenStatus: "unknown", expiresAt: null, requestId, diagnostic: "provider_unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  },
};

let graphClient: MetaGraphClient = defaultProbe;

export const setMetaGraphClientForVerification = (client: MetaGraphClient): void => {
  graphClient = client;
};

const buildGate = (enabled: boolean, probe: MetaProbeResult, network: "instagram" | "facebookReel") => {
  if (!enabled) return disabledGate(false, "Network publishing is disabled by configuration.");
  const reasons: string[] = [];
  if (!probe.identity) reasons.push("Selected Page identity was not validated.");
  if (network === "instagram" && !probe.linkage) reasons.push("Professional Instagram linkage was not validated.");
  if (!probe.permissions) reasons.push("Required provider permissions were not validated.");
  if (probe.tokenStatus !== "valid") reasons.push(`API token lifecycle is ${probe.tokenStatus}.`);
  if (!probe.version) reasons.push("Pinned Graph API version was not validated.");
  return { enabled, canPublish: reasons.length === 0, status: reasons.length === 0 ? "ready" as const : "blocked" as const, reasons };
};

export const getMetaConnectionStatus = async (): Promise<MetaConnectionStatus> => {
  const configured = Boolean(config.meta.userAccessToken && config.meta.pageId && config.meta.instagramAccountId);
  const base = {
    contractVersion: "meta-connection.v1" as const,
    graphApiVersion: META_GRAPH_API_VERSION as typeof META_GRAPH_API_VERSION,
    configured,
    page: { id: config.meta.pageId || null, linkedInstagramAccountId: config.meta.instagramAccountId || null },
    token: { status: "unknown" as const, expiresAt: null },
    checks: { identity: false, linkage: false, permissions: false, version: config.meta.graphApiVersion === META_GRAPH_API_VERSION },
    gates: {
      instagram: disabledGate(config.meta.instagramEnabled, configured ? "Connection validation has not completed." : "Meta connection is not configured."),
      facebookReel: disabledGate(config.meta.facebookReelEnabled, configured ? "Connection validation has not completed." : "Meta connection is not configured."),
    },
    accountTagging: "not_proven" as const,
    checkedAt: null,
    requestId: null,
    diagnostic: configured ? "validation_failed" as const : "not_configured" as const,
  };

  if (!configured || config.meta.graphApiVersion !== META_GRAPH_API_VERSION) return metaConnectionStatusSchema.parse(base);
  try {
    const probe = await graphClient.probe({ ...config.meta, version: META_GRAPH_API_VERSION });
    return metaConnectionStatusSchema.parse({
      ...base,
      token: { status: probe.tokenStatus, expiresAt: probe.expiresAt },
      checks: { identity: probe.identity, linkage: probe.linkage, permissions: probe.permissions, version: probe.version },
      gates: { instagram: buildGate(config.meta.instagramEnabled, probe, "instagram"), facebookReel: buildGate(config.meta.facebookReelEnabled, probe, "facebookReel") },
      checkedAt: new Date().toISOString(),
      requestId: probe.requestId,
      diagnostic: probe.diagnostic,
    });
  } catch (_error) {
    return metaConnectionStatusSchema.parse(base);
  }
};
