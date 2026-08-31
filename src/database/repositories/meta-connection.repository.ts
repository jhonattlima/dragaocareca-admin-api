import { getDb, nowIso } from "../sqlite";
import { metaConnectionStatusSchema, type MetaConnectionStatus } from "../../schemas/meta-connection";

type SqliteMetaConnectionRow = {
  connection_key: string;
  contract_version: string;
  graph_api_version: string;
  configured: number;
  page_id: string | null;
  linked_instagram_account_id: string | null;
  token_status: MetaConnectionStatus["token"]["status"];
  token_expires_at: string | null;
  identity_check: number;
  linkage_check: number;
  permissions_check: number;
  version_check: number;
  permissions_json: string;
  tasks_json: string;
  instagram_gate_json: string;
  facebook_reel_gate_json: string;
  account_tagging: MetaConnectionStatus["accountTagging"];
  checked_at: string | null;
  request_id: string | null;
  diagnostic: MetaConnectionStatus["diagnostic"];
};

const mapRow = (row: SqliteMetaConnectionRow | undefined): MetaConnectionStatus | null => {
  if (!row) return null;
  try {
    return metaConnectionStatusSchema.parse({
      contractVersion: row.contract_version,
      graphApiVersion: row.graph_api_version,
      configured: Boolean(row.configured),
      page: { id: row.page_id, linkedInstagramAccountId: row.linked_instagram_account_id },
      token: { status: row.token_status, expiresAt: row.token_expires_at },
      checks: { identity: Boolean(row.identity_check), linkage: Boolean(row.linkage_check), permissions: Boolean(row.permissions_check), version: Boolean(row.version_check) },
      permissions: JSON.parse(row.permissions_json),
      tasks: JSON.parse(row.tasks_json),
      gates: { instagram: JSON.parse(row.instagram_gate_json), facebookReel: JSON.parse(row.facebook_reel_gate_json) },
      accountTagging: row.account_tagging,
      checkedAt: row.checked_at,
      requestId: row.request_id,
      diagnostic: row.diagnostic,
    });
  } catch (_error) {
    return null;
  }
};

export const findMetaConnectionStatus = (): MetaConnectionStatus | null =>
  mapRow(getDb().prepare("SELECT * FROM meta_connections WHERE connection_key = 'default'").get() as SqliteMetaConnectionRow | undefined);

export const upsertMetaConnectionStatus = (status: MetaConnectionStatus): void => {
  const parsed = metaConnectionStatusSchema.parse(status);
  const database = getDb();
  const existing = database.prepare("SELECT page_id, linked_instagram_account_id FROM meta_connections WHERE connection_key = 'default'").get() as { page_id: string | null; linked_instagram_account_id: string | null } | undefined;
  if (existing && (existing.page_id !== null || existing.linked_instagram_account_id !== null) && (existing.page_id !== parsed.page.id || existing.linked_instagram_account_id !== parsed.page.linkedInstagramAccountId)) {
    throw new Error("Meta connection asset identity cannot change without replacement and revalidation.");
  }
  database.prepare(`
    INSERT INTO meta_connections (
      connection_key, contract_version, graph_api_version, configured, page_id, linked_instagram_account_id,
      token_status, token_expires_at, identity_check, linkage_check, permissions_check, version_check,
      permissions_json, tasks_json, instagram_gate_json, facebook_reel_gate_json, account_tagging, checked_at, request_id, diagnostic, updated_at
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_key) DO UPDATE SET
      contract_version = excluded.contract_version, graph_api_version = excluded.graph_api_version,
      configured = excluded.configured, page_id = excluded.page_id, linked_instagram_account_id = excluded.linked_instagram_account_id,
      token_status = excluded.token_status, token_expires_at = excluded.token_expires_at,
      identity_check = excluded.identity_check, linkage_check = excluded.linkage_check, permissions_check = excluded.permissions_check, version_check = excluded.version_check,
      permissions_json = excluded.permissions_json, tasks_json = excluded.tasks_json,
      instagram_gate_json = excluded.instagram_gate_json, facebook_reel_gate_json = excluded.facebook_reel_gate_json,
      account_tagging = excluded.account_tagging, checked_at = excluded.checked_at, request_id = excluded.request_id,
      diagnostic = excluded.diagnostic, updated_at = excluded.updated_at
  `).run(
    parsed.contractVersion, parsed.graphApiVersion, parsed.configured ? 1 : 0, parsed.page.id, parsed.page.linkedInstagramAccountId,
    parsed.token.status, parsed.token.expiresAt, parsed.checks.identity ? 1 : 0, parsed.checks.linkage ? 1 : 0,
    parsed.checks.permissions ? 1 : 0, parsed.checks.version ? 1 : 0, JSON.stringify(parsed.permissions), JSON.stringify(parsed.tasks), JSON.stringify(parsed.gates.instagram), JSON.stringify(parsed.gates.facebookReel),
    parsed.accountTagging, parsed.checkedAt, parsed.requestId, parsed.diagnostic, nowIso(),
  );
};
