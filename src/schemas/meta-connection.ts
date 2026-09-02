import { z } from "zod";

export const META_GRAPH_API_VERSION = "v25.0";
export const metaAccountTaggingSchema = z.enum(["not_checked", "proven", "not_proven", "unsupported"]);
export type MetaAccountTagging = z.infer<typeof metaAccountTaggingSchema>;

export const metaGateSchema = z.object({
  enabled: z.boolean(),
  canPublish: z.boolean(),
  status: z.enum(["disabled", "blocked", "ready"]),
  reasons: z.array(z.string().min(1).max(200)).max(12),
}).strict();

export const metaConnectionStatusSchema = z.object({
  contractVersion: z.literal("meta-connection.v1"),
  graphApiVersion: z.literal(META_GRAPH_API_VERSION),
  configured: z.boolean(),
  page: z.object({ id: z.string().nullable(), linkedInstagramAccountId: z.string().nullable() }).strict(),
  token: z.object({ status: z.enum(["valid", "expiring", "invalid", "unknown"]), expiresAt: z.string().datetime({ offset: true }).nullable() }).strict(),
  checks: z.object({ identity: z.boolean(), linkage: z.boolean(), permissions: z.boolean(), version: z.boolean() }).strict(),
  permissions: z.array(z.string().min(1).max(100)).max(30),
  tasks: z.array(z.string().min(1).max(100)).max(30),
  gates: z.object({ instagram: metaGateSchema, facebookReel: metaGateSchema }).strict(),
  accountTagging: metaAccountTaggingSchema,
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  requestId: z.string().nullable(),
  diagnostic: z.enum(["not_configured", "disabled", "validated", "validation_failed", "provider_unavailable"]),
}).strict();
export type MetaConnectionStatus = z.infer<typeof metaConnectionStatusSchema>;

export type MetaGraphClient = {
  probe: (input: { pageId: string; instagramAccountId: string; userAccessToken: string; pageAccessToken: string; appId: string; appSecret: string; version: string }) => Promise<MetaProbeResult>;
};

export type MetaProbeResult = {
  identity: boolean;
  linkage: boolean;
  permissions: boolean;
  permissionNames: string[];
  taskNames: string[];
  version: boolean;
  tokenStatus: "valid" | "expiring" | "invalid" | "unknown";
  expiresAt: string | null;
  requestId: string;
  diagnostic: "validated" | "validation_failed" | "provider_unavailable";
};
