/**
 * Which workspace integration a flow step means.
 *
 * The editor stores "<row id>::<action>", but a template cannot know the row
 * ids of the workspace it will be used in, so it names the connector type
 * instead ("odoo::create_ticket"). Before this, every such step failed with
 * "Integración no encontrada".
 *
 * An exact row id always wins. A type resolves only when it is unambiguous:
 * guessing between two Slack workspaces would post to the wrong one.
 */

export interface IntegrationRowRef {
  id: string;
  type: string;
  enabled: boolean;
}

export type IntegrationRefResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "ambiguous" | "disabled"; count: number };

export function resolveIntegrationRef(
  rows: IntegrationRowRef[],
  ref: string
): IntegrationRefResult {
  if (rows.some((row) => row.id === ref)) return { ok: true, id: ref };

  const ofType = rows.filter((row) => row.type === ref);
  const enabled = ofType.filter((row) => row.enabled);
  if (enabled.length === 1) return { ok: true, id: enabled[0]!.id };
  if (enabled.length > 1) return { ok: false, reason: "ambiguous", count: enabled.length };
  if (ofType.length > 0) return { ok: false, reason: "disabled", count: ofType.length };
  return { ok: false, reason: "not_found", count: 0 };
}
