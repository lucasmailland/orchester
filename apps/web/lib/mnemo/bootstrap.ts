/**
 * Mnemosyne auto-bootstrap for self-hosted orchester.
 *
 * On first boot (mnemosyne has no API keys yet), this registers MNEMO_API_KEY
 * so the operator never needs to manually provision it inside mnemosyne.
 *
 * Called once from instrumentation.ts during the Node.js runtime init phase.
 * Idempotent: if mnemosyne already has keys, the call is a no-op.
 *
 * Required env vars:
 *   MNEMO_URL           – base URL of the mnemosyne server
 *   MNEMO_API_KEY       – the key to register (mns_live_... format)
 *   MNEMO_WORKSPACE_ID  – UUID that scopes all of orchester's memory data
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bootstrapMnemo(): Promise<void> {
  const url = process.env["MNEMO_URL"];
  const apiKey = process.env["MNEMO_API_KEY"];
  const workspaceId = process.env["MNEMO_WORKSPACE_ID"];

  if (!url || !apiKey || !workspaceId) return;

  if (!UUID_PATTERN.test(workspaceId)) {
    console.warn(
      `[mnemo/bootstrap] MNEMO_WORKSPACE_ID "${workspaceId}" is not a valid UUID — skipping`
    );
    return;
  }

  try {
    const statusRes = await fetch(`${url}/bootstrap/status`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusRes.ok) {
      console.warn(`[mnemo/bootstrap] /bootstrap/status returned ${statusRes.status} — skipping`);
      return;
    }

    const { bootstrapped } = (await statusRes.json()) as { bootstrapped: boolean };
    if (bootstrapped) return;

    const bootstrapRes = await fetch(`${url}/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, workspaceId, label: "orchester" }),
      signal: AbortSignal.timeout(30_000),
    });

    if (bootstrapRes.status === 201) {
      console.log(`[mnemo/bootstrap] Mnemosyne bootstrapped (workspace: ${workspaceId})`);
    } else if (bootstrapRes.status === 403) {
      // Race: another instance bootstrapped first — fine
    } else {
      const text = await bootstrapRes.text().catch(() => "");
      console.warn(`[mnemo/bootstrap] Bootstrap failed (${bootstrapRes.status}): ${text}`);
    }
  } catch (err) {
    // Mnemosyne may not be up yet on cold start — warn but don't crash
    console.warn("[mnemo/bootstrap] Bootstrap probe failed:", err);
  }
}
