/**
 * Registers a webhook `secret_token` on every active Telegram channel that
 * lacks one (channels created before the check existed). Run once after the
 * deploy that makes the webhook require it; safe to re-run.
 *
 *   pnpm --filter web telegram:register-secrets
 *
 * Prints channel ids only, never tokens or secrets.
 */
/* eslint-disable no-console */
import { registerMissingTelegramSecrets } from "@/lib/channels/telegram";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

async function main() {
  const { updated, skipped, failed } = await registerMissingTelegramSecrets((fn) =>
    withCrossTenantAdmin("telegram.register_secrets", fn)
  );
  console.log(`updated (${updated.length}): ${updated.join(", ") || "-"}`);
  console.log(`skipped (${skipped.length}): ${skipped.join(", ") || "-"}`);
  console.log(
    `failed (${failed.length}): ${failed.map((f) => `${f.id}=${f.reason}`).join(", ") || "-"}`
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  // Message only: never dump an error object that may carry a request URL.
  console.error("telegram:register-secrets failed:", e instanceof Error ? e.name : "unknown");
  process.exit(1);
});
