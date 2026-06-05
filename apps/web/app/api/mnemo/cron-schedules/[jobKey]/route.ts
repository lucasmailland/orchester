// apps/web/app/api/mnemo/cron-schedules/[jobKey]/route.ts
//
// PATCH /api/mnemo/cron-schedules/[jobKey]
//
// Upsert the per-workspace override for ONE job. Body:
//   { mode: 'default' | 'disabled' | 'hourly' | 'daily' | 'weekly' |
//           'monthly' | 'custom',
//     customCronExpression?: string  // required when mode === 'custom'
//   }
//
// On 'default' we DELETE the row (rather than persisting mode='default')
// so the table only carries the operator's explicit decisions — cleaner
// audit trail and a cheaper hot path for the worker gate.
//
// RBAC: admin+.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isAuthContext, requireAuth } from "@/lib/auth-guards";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { parseBody } from "@/lib/validation";
import { CRON_JOBS, type CronJobKey } from "@/lib/mnemo/cron-policy";

const VALID_KEYS = Object.keys(CRON_JOBS) as readonly CronJobKey[];

// Allowed modes mirror CronMode in cron-policy.ts. zod also enforces
// "custom mode requires customCronExpression" with a refine.
const PatchBody = z
  .object({
    mode: z.enum(["default", "disabled", "hourly", "daily", "weekly", "monthly", "custom"]),
    customCronExpression: z.string().min(1).max(120).optional(),
  })
  .refine((b) => (b.mode === "custom" ? typeof b.customCronExpression === "string" : true), {
    message: "customCronExpression is required when mode = 'custom'",
    path: ["customCronExpression"],
  })
  .refine((b) => (b.mode !== "custom" ? b.customCronExpression === undefined : true), {
    message: "customCronExpression is only allowed when mode = 'custom'",
    path: ["customCronExpression"],
  });

/**
 * Light validation for a 5-field crontab expression. We don't pull in
 * a full cron parser dependency — the operator typing this knows
 * what they want and the worker gate treats custom as "≥ daily" anyway
 * (see cron-policy.ts). Goal here is to reject obvious garbage so we
 * don't store `"foo bar"` and surprise the operator later.
 */
function isPlausibleCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  // Each field can be: *, a number, a list (1,2), a range (1-5), a step
  // (*/15 or 0-30/5), or any combination joined by `,`. We accept a
  // permissive regex that catches the common shapes.
  const fieldRe = /^([*0-9,\-/]+)$/;
  return fields.every((f) => fieldRe.test(f));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ jobKey: string }> }
): Promise<NextResponse> {
  const ctx = await requireAuth({ minRole: "admin" });
  if (!isAuthContext(ctx)) return ctx as unknown as NextResponse;

  const { jobKey: rawKey } = await params;
  if (!(VALID_KEYS as readonly string[]).includes(rawKey)) {
    return NextResponse.json({ error: `Unknown jobKey: ${rawKey}` }, { status: 400 });
  }
  const jobKey = rawKey as CronJobKey;
  const jobName = CRON_JOBS[jobKey];

  const parsed = await parseBody(req, PatchBody);
  if (!parsed.ok) return parsed.response as unknown as NextResponse;
  const body = parsed.data;

  if (body.mode === "custom" && !isPlausibleCronExpression(body.customCronExpression!)) {
    return NextResponse.json(
      { error: "customCronExpression is not a valid 5-field cron expression" },
      { status: 400 }
    );
  }

  await withCrossTenantAdmin("mnemo.cron-schedules.upsert", async (tx) => {
    if (body.mode === "default") {
      // Storing `default` would be a no-op; deleting the row is
      // semantically equivalent and keeps the table thin.
      await tx.execute(sql`
        DELETE FROM mnemo_cron_schedule
        WHERE workspace_id = ${ctx.workspace.id} AND job_name = ${jobName}
      `);
      return;
    }
    const id = `${ctx.workspace.id}:${jobName}`;
    const custom = body.mode === "custom" ? body.customCronExpression! : null;
    await tx.execute(sql`
      INSERT INTO mnemo_cron_schedule
        (id, workspace_id, job_name, mode, custom_cron_expression, updated_at)
      VALUES
        (${id}, ${ctx.workspace.id}, ${jobName}, ${body.mode}, ${custom}, now())
      ON CONFLICT (workspace_id, job_name) DO UPDATE
        SET mode = EXCLUDED.mode,
            custom_cron_expression = EXCLUDED.custom_cron_expression,
            updated_at = now()
    `);
  });

  return NextResponse.json({ ok: true });
}
