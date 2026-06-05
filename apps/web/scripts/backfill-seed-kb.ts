/// <reference types="node" />
/**
 * Backfill seed knowledge bases with real content.
 *
 * The demo seed (packages/db/src/seed-demo.ts) creates the 4 KBs
 * (Product Docs, HR Policies, IT Runbook, Brand Voice Guide) but
 * intentionally leaves them empty — see the comment block in that
 * file for why. This script uploads the canonical 9 docs through
 * the production endpoint so they run the real chunking + embedding
 * pipeline and end up with non-null `embedding` vectors in
 * `knowledge_chunk`. After running, RAG search returns real hits.
 *
 * Run it manually after `pnpm db:seed:demo`:
 *
 *   pnpm tsx apps/web/scripts/backfill-seed-kb.ts \
 *     --workspace-slug acme-inc \
 *     --base http://localhost:3333 \
 *     --cookie "better-auth.session_token=..."
 *
 * The cookie is required for auth. Grab it from your browser dev
 * tools after logging in as demo@fichap.com, or use an API key via
 * `--api-key ok_live_…` instead (issued from Settings → Developers).
 *
 * Skips uploads if a doc with the same title already exists.
 *
 * Cost note: the OpenAI provider (or whichever is configured per-KB)
 * is billed for ~80 chunks × text-embedding-3-small ≈ <$0.001 total.
 */

// scripts/ is excluded from apps/web/tsconfig.json — types resolve at
// runtime via tsx. We only depend on `process.argv` / `process.exit` /
// `fetch`, all available in Node 22+.

interface Args {
  base: string;
  workspaceSlug: string;
  cookie?: string;
  apiKey?: string;
}

function parseArgs(): Args {
  const args: Partial<Args> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    if (arg === "--base" && next) {
      args.base = next.replace(/\/+$/, "");
      i++;
    } else if (arg === "--workspace-slug" && next) {
      args.workspaceSlug = next;
      i++;
    } else if (arg === "--cookie" && next) {
      args.cookie = next;
      i++;
    } else if (arg === "--api-key" && next) {
      args.apiKey = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: tsx apps/web/scripts/backfill-seed-kb.ts \\",
          "  --workspace-slug acme-inc \\",
          "  --base http://localhost:3333 \\",
          "  --cookie <better-auth session cookie>     # or",
          "  --api-key ok_live_…                       # from Settings → Developers",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  if (!args.base || !args.workspaceSlug || (!args.cookie && !args.apiKey)) {
    console.error("Missing required arguments. Run with --help.");
    process.exit(2);
  }
  return args as Args;
}

interface SeedDoc {
  kbName: string;
  title: string;
  content: string;
}

const SEED_DOCS: SeedDoc[] = [
  {
    kbName: "Product Docs",
    title: "Getting Started.md",
    content: `# Getting Started with Orchester

Orchester is an open-source AI agent platform that lets you build, connect, and ship multi-channel AI agents in minutes.

## 1. Create your first agent

Navigate to Agents → "+ New Agent". Provide a name, role, and system prompt. Save → choose a model → toggle status to Active.

## 2. Connect a channel

Channels → "+ Connect Web Widget". Embed one script tag and the agent starts answering. WhatsApp / Telegram / Slack go through their respective Connect flows.

## 3. Configure a knowledge base

Knowledge → "+ New base" creates a vector index backed by Postgres + pgvector. Upload PDFs, paste text, or import URLs. Documents get chunked and embedded via your connected provider.

## 4. Build flows (optional)

For multi-step workflows, drag-and-drop triggers, conditions, AI agents, and actions on the canvas. Test runs surface every node's input and output.

## 5. Invite your team

Settings → Team. Owners, Admins, Editors, and Viewers each have scoped permissions. The audit log captures every action for SOC 2 / GDPR.`,
  },
  {
    kbName: "Product Docs",
    title: "API Reference v1.md",
    content: `# Orchester API Reference v1

Base URL: https://api.orchester.io/v1 (cloud) or https://your-instance/api (self-host).

## Authentication

Bearer tokens from Settings → Developers, scoped per workspace. Rotate from the same page.

## POST /agents

Creates an agent. Body: { name, role, systemPrompt, model, status, teamId }. Returns 201.

## GET /agents/:id/runs (SSE)

Streams run events: { runId, status, tokens, costUsd }.

## POST /conversations/:id/messages

Append a message: { role: "user"|"agent"|"operator", text }. Use for inbound from custom channels.

## POST /flows/:id/runs

Triggers a flow run. Body matches the flow's input schema. Returns { runId, status }.

## GET/POST /webhooks

List and create signed webhooks: { url, events, secret }. HMAC-SHA256 signature in X-Orchester-Signature header.

## Rate limits

120 req/min per API key by default; 429 responses include Retry-After.

## MCP server

POST /api/mcp speaks JSON-RPC 2.0 over Streamable HTTP. Same Authorization header. Use from Claude Desktop, Cursor, Gemini, or any MCP client.`,
  },
  {
    kbName: "Product Docs",
    title: "Pricing & Plans.md",
    content: `# Pricing & Plans

## Free
Unlimited agents, flows, knowledge bases. 1,000 conversations / month. Self-hosted forever. Community support.

## Team — $49 / month
Up to 25,000 conversations / month. BYO LLM keys. Slack + email support (24h response). 5 seats included, +$10 per additional seat.

## Business — $499 / month
Up to 250,000 conversations / month. SSO (SAML, Okta, Google Workspace). Audit log export, SOC 2 Type II report. Dedicated success manager. 99.9% SLA. Unlimited seats.

## Enterprise — custom
Volume pricing above 1M conversations. On-prem / private cloud. Custom data residency. 99.95% SLA. Contact enterprise@orchester.io.

All plans include: BYO LLM keys (you pay token costs directly), 90-day audit retention, RBAC, GDPR/CCPA compliance, all channels.

## Token costs

Token costs are NOT included — you pay your LLM provider directly. Orchester meters everything and breaks down by agent, conversation, and message. Set per-employee monthly budgets in Settings → Plan and usage.

## Cancellation

No annual commitments. Cancel from Settings → Billing; access continues through the paid period.`,
  },
  {
    kbName: "HR Policies",
    title: "PTO Policy 2026.md",
    content: `# PTO Policy 2026 — Acme Inc.

## Annual allotment

20 business days per year, accruing monthly (1.67 days/month). Requestable after 90 days of employment.

## Carryover

Up to 5 unused days carry over; must be used by March 31 or expire. No payout on termination except where required by local law.

## Public holidays

New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving + day after, Christmas Eve, Christmas Day. Paid in addition to PTO.

## Sick leave

10 paid sick days/year, no rollover. No doctor's note required for ≤3 consecutive days.

## Requesting time off

Submit via Settings → My account → Time off, at least 2 weeks in advance for 3+ days. Same-day sick: notify manager via Slack #out-today before 9 AM local time.

## Parental leave

16 weeks paid for birthing parents, 8 weeks for non-birthing parents. Take within 12 months of birth/adoption.

## Policy owner

Florencia Castro (Head of People), people@acme.com.`,
  },
  {
    kbName: "HR Policies",
    title: "Code of Conduct.md",
    content: `# Code of Conduct — Acme Inc.

## 1. Be kind, be direct

Default to positive intent. Disagree without making it personal.

## 2. No harassment, no discrimination

Zero tolerance. Report to people@acme.com or your skip-level. We investigate every report and protect reporters.

## 3. Confidentiality

Customer data, financials, and unreleased plans are confidential. Don't share dashboard screenshots in public Slack or social.

## 4. Working hours

Async-first. Core overlap 10:00–14:00 ART. We measure outcomes, not hours.

## 5. AI usage

You may use Claude / Cursor / Copilot freely on internal work. Customer data stays inside Orchester. Never paste customer prompts into a personal ChatGPT account.

## 6. Open-source

Engineers may contribute to OSS on company time with team-lead approval when relevant to our stack.

## 7. Conflict resolution

Try 1:1 first → manager → People Ops (Florencia) as final mediator.

## Reporting violations

Anonymous: ethics-hotline.acme.com. Named: people@acme.com or any C-level. No retaliation.`,
  },
  {
    kbName: "HR Policies",
    title: "Benefits & Compensation.md",
    content: `# Benefits & Compensation 2026

## Salary

Band-based, reviewed annually in January. Bands visible to all employees in Settings → People → Compensation.

## Equity

All FTEs get options. Sign-on grants vest over 4 years with a 1-year cliff. Refresh grants annually based on performance, 4-year vesting.

## Health insurance

- US: Anthem PPO — Acme covers 100% employee, 80% dependents.
- Argentina: OSDE 410 — Acme covers 100% for employee + spouse + children under 21.
- Other countries: stipend up to $400/month against verified private insurance.

## Retirement

US: Vanguard 401(k) with 4% company match, fully vested immediately.
Argentina: SAC (aguinaldo) per local law.

## Equipment

$2,500 laptop budget (renewable every 3 years). $750 one-time home-office stipend. $50/month internet/phone reimbursement.

## Learning & development

$1,500/year per employee for books, courses, conferences. Pre-approval not required under $500.

## Wellness

$75/month wellness stipend. Quarterly mental-health days (closed Fridays).

## Referral bonus

$3,000 net per accepted hire who passes 90-day probation.`,
  },
  {
    kbName: "IT Runbook",
    title: "VPN Troubleshooting.md",
    content: `# VPN Troubleshooting

Acme's VPN is a self-hosted WireGuard mesh.

## 1. Refresh your config

WireGuard configs rotate every 90 days. Download from https://it.acme.com/vpn/config (SSO required). Import the file into the WireGuard app.

## 2. Check the tunnel

\`sudo wg show\` — handshake within last 2 minutes. If dead, \`sudo wg-quick down acme-vpn && sudo wg-quick up acme-vpn\`.

## 3. DNS issues

If you can ping the gateway (10.10.0.1) but can't resolve internal hostnames:
- macOS: \`sudo killall -HUP mDNSResponder\`
- Linux: \`sudo systemd-resolve --flush-caches\`

Verify with \`dig internal.acme.com @10.10.0.1\`.

## 4. Route conflicts

If your home network is 10.10.0.0/16, you have a conflict. Either switch your home router to 192.168.x.x, or contact IT (Eduardo Patiño) for a NAT'd config.

## 5. Restrictive firewalls (hotels / airports)

UDP/51820 may be blocked. Switch to TCP fallback (port 443):
\`Endpoint = vpn-tcp.acme.com:443\` — ~50% throughput but bypasses most filters.

## 6. macOS network extension stuck

If WireGuard says "starting…" forever, reboot. Really.

## 7. Still broken

Open a P3 ticket via Slack /helpdesk vpn with OS+version, \`wg show\` output, and a traceroute to internal.acme.com. SLA 4 business hours.`,
  },
  {
    kbName: "IT Runbook",
    title: "Postgres Restore Procedure.md",
    content: `# Postgres Restore Procedure

P1 incident, ~15-30 minutes. Two-person work — page the on-call SRE.

## Prerequisites

- AWS console access (postgres-admin role)
- WireGuard VPN connected
- psql 16+ installed locally
- On-call SRE paged and online

## 1. Identify the target backup

Backups: s3://acme-postgres-backups/prod/. Full dumps every 4h (00, 04, 08, 12, 16, 20 UTC) + after every schema migration.

\`aws s3 ls s3://acme-postgres-backups/prod/ --recursive | grep base.tar.gz | tail -5\`

## 2. Spin up a recovery instance

DO NOT restore in-place. Spin up a new RDS instance from snapshot at the same class:

\`aws rds restore-db-instance-from-db-snapshot --db-instance-identifier acme-prod-recovery-$(date +%s) --db-snapshot-identifier acme-prod-snapshot-LATEST --db-instance-class db.r6g.4xlarge\`

Wait for status=available (~15 min).

## 3. Apply WAL up to PITR target

For point-in-time recovery to a specific timestamp, use AWS console → RDS → Restore to point in time, set recovery time in UTC.

## 4. Validate

Sanity queries before flipping DNS:

\`SELECT COUNT(*) FROM conversations;\`
\`SELECT MAX(created_at) FROM messages;\`

Row counts should match production within reason.

## 5. Flip DNS

Update CNAME prod-db.acme.com → new endpoint via Route 53. TTL 60s.

## 6. Verify app health

Watch Datadog for 5xx, p99 latency, connection-pool saturation for 30 minutes after the flip.

## 7. Decommission old instance

After 24h of stable operation, snapshot then terminate the old prod instance.

## 8. Postmortem

Required within 48 hours. Template: https://docs.acme.com/postmortems. CC cto@acme.com.`,
  },
  {
    kbName: "Brand Voice Guide",
    title: "Tone of Voice.md",
    content: `# Acme Tone of Voice

## Three adjectives

- **Direct.** Say what you mean. Don't bury the point.
- **Confident.** We've shipped this. Don't hedge unnecessarily.
- **Warm.** Direct ≠ cold. Greet people, acknowledge frustration, use "we" and "you" liberally.

## Do

- Start with the answer.
- Use contractions (you're, we'll, don't).
- Second person ("you can") in product copy; first-person plural ("we built") in marketing.
- Code voice in technical contexts: present tense, active voice.

## Don't

- "Effortlessly", "seamlessly", "robust", "enterprise-grade", "best-in-class" — buzzwords.
- "Synergy", "leverage" (verb), "ideate", "unlock value" — corporate jargon.
- Hyperbole: "game-changer", "revolutionize", "transform".
- Emoji in error messages. Emoji is OK in marketing and success messages.
- All-caps for emphasis. Use italics or bold.

## Error messages

1. State what failed (specific).
2. State why if you know.
3. State what the user can do.

❌ "Oops! Something went wrong."
✅ "Couldn't save the agent — name is required. Add a name and try again."

## Empty states

Teach. Don't just say "No data" — say what should be here and how to put it there.

## Customer support

Acknowledge feelings first, then solve. Don't pre-apologize for things that aren't your fault. Own up to mistakes when they are.

## Versioning callouts

"(new in v0.7)" / "(deprecated, will be removed in v1.0)" — helps power users orient.

## Authorial voice

Long-form (blog posts, docs, READMEs): more personal. Sign authored posts. We can have opinions. We don't need to be neutral.`,
  },
];

interface KbSummary {
  id: string;
  name: string;
}

interface DocSummary {
  id: string;
  title: string;
}

async function api<T>(
  args: Args,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; body?: string }> {
  const headers = new Headers(init.headers ?? {});
  if (args.apiKey) headers.set("authorization", `Bearer ${args.apiKey}`);
  if (args.cookie) headers.set("cookie", args.cookie);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const r = await fetch(`${args.base}${path}`, { ...init, headers });
  const text = await r.text();
  let data: T | undefined;
  try {
    data = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    // pass — return body string instead
  }
  return { ok: r.ok, status: r.status, data, body: text };
}

async function main() {
  const args = parseArgs();
  console.log(`Backfilling KBs for workspace=${args.workspaceSlug} via ${args.base}…`);

  const kbsRes = await api<KbSummary[]>(args, "/api/knowledge-bases");
  if (!kbsRes.ok || !Array.isArray(kbsRes.data)) {
    console.error(`Failed to list KBs: ${kbsRes.status} ${kbsRes.body ?? ""}`);
    process.exit(1);
  }
  const kbByName = new Map((kbsRes.data ?? []).map((kb) => [kb.name, kb.id]));

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const doc of SEED_DOCS) {
    const kbId = kbByName.get(doc.kbName);
    if (!kbId) {
      console.warn(`Skip "${doc.title}" — KB "${doc.kbName}" not found.`);
      skipped++;
      continue;
    }
    const existing = await api<DocSummary[]>(args, `/api/knowledge-bases/${kbId}/docs`);
    if (
      existing.ok &&
      Array.isArray(existing.data) &&
      existing.data.some((d) => d.title === doc.title)
    ) {
      console.log(`✓ ${doc.kbName} / ${doc.title} — already exists, skipping`);
      skipped++;
      continue;
    }
    const upload = await api(args, `/api/knowledge-bases/${kbId}/docs`, {
      method: "POST",
      body: JSON.stringify({ title: doc.title, content: doc.content, source: "text" }),
    });
    if (upload.ok) {
      console.log(`✓ ${doc.kbName} / ${doc.title} — uploaded`);
      created++;
    } else {
      console.error(
        `✗ ${doc.kbName} / ${doc.title} — ${upload.status}: ${upload.body?.slice(0, 200)}`
      );
      failed++;
    }
  }

  console.log(`\nDone. created=${created}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
