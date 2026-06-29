// apps/web/lib/mnemo/entities.ts
//
// HTTP-only implementation of the workspace's entity browser surface.
//
// Five helpers cover the Mnemosyne entity endpoints (server path /entities):
//   - listWorkspaceEntities    → GET /api/mnemo/entities
//   - getWorkspaceEntity       → GET /api/mnemo/entities/[id]
//   - listWorkspaceEntityFacts → GET /api/mnemo/entities/[id]/facts
//   - createWorkspaceEntity    → POST /api/mnemo/entities
//   - updateWorkspaceEntity    → PATCH /api/mnemo/entities/[id]
//   - workspaceEntityExists    → guard used by the PATCH route's canonicalId check
//
// All return a discriminated `{ mode, ... }` envelope so the caller
// can stamp the `X-Mnemo-Mode` response header for operator visibility.

import "server-only";
import type {
  CreateEntityInput,
  EntityFactsResponse,
  EntityKind,
  EntityWithCount,
  ListEntitiesResponse,
  MnemoEntity,
  UpdateEntityInput,
} from "@mnemosyne/client-ts";
import { getMnemoMode, getMnemoClient, type MnemoMode } from "@/lib/mnemo/client";

export { getMnemoMode };
export type { MnemoMode };

export async function listWorkspaceEntities(
  _workspaceId: string,
  opts: { kind?: EntityKind; q?: string; limit: number }
): Promise<{ mode: MnemoMode; data: ListEntitiesResponse }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const data = await client.listEntities({
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.q ? { q: opts.q } : {}),
    limit: opts.limit,
  });
  return { mode, data };
}

export async function getWorkspaceEntity(
  _workspaceId: string,
  id: string
): Promise<{ mode: MnemoMode; data: EntityWithCount | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  try {
    const data = await client.getEntity(id);
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

export async function listWorkspaceEntityFacts(
  _workspaceId: string,
  id: string,
  opts: { limit: number }
): Promise<{ mode: MnemoMode; data: EntityFactsResponse | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  try {
    const data = await client.listEntityFacts(id, { limit: opts.limit });
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

export async function createWorkspaceEntity(
  _workspaceId: string,
  input: CreateEntityInput
): Promise<{ mode: MnemoMode; data: MnemoEntity }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  const data = await client.createEntity(input);
  return { mode, data };
}

export async function updateWorkspaceEntity(
  _workspaceId: string,
  id: string,
  input: UpdateEntityInput
): Promise<{ mode: MnemoMode; data: MnemoEntity | null }> {
  const mode = getMnemoMode();
  const client = getMnemoClient();
  try {
    const data = await client.updateEntity(id, input);
    return { mode, data };
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) {
      return { mode, data: null };
    }
    throw e;
  }
}

export async function workspaceEntityExists(_workspaceId: string, id: string): Promise<boolean> {
  const client = getMnemoClient();
  try {
    await client.getEntity(id);
    return true;
  } catch (e) {
    const { MnemosyneAPIError } = await import("@mnemosyne/client-ts");
    if (e instanceof MnemosyneAPIError && e.status === 404) return false;
    throw e;
  }
}
