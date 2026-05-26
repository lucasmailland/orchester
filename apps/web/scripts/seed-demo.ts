/// <reference types="node" />
/**
 * seed-demo.ts — One-shot CLI that creates a fresh "Acme Inc." demo
 * workspace so a first-time self-host operator can explore a working
 * product instead of empty states.
 *
 * The companion script `packages/db/src/seed-demo.ts` seeds INTO an
 * existing workspace (the first row) and is the rich-volume seed used
 * for internal demos. This script is intentionally narrower:
 *
 *   - Always creates a NEW workspace (slug = "demo"). Aborts cleanly
 *     if one already exists — never modifies existing data.
 *   - Hand-curated, realistic content in English (3 conversations
 *     read like real interactions, not faker.lorem).
 *   - Self-contained: also creates the owner user + membership in the
 *     same transaction, so it works on a virgin DB before any signup.
 *
 * Idempotency contract: detected via `workspace.slug = "demo"`. If the
 * slug exists, we abort with a clear message. To re-seed, the operator
 * must delete the workspace manually first (we never auto-destroy).
 *
 * RLS contract: every tenant table touched here has FORCE ROW LEVEL
 * SECURITY enabled (migrations 0009/0010), so even table-owner roles
 * are subject to RLS. We set the `app.cross_tenant_admin` GUC (=true)
 * inside the seeding transaction — same bypass the `withCrossTenantAdmin`
 * wrapper uses for cron jobs. `lib/tenant/cron.ts` is `server-only`
 * and can't be imported from a standalone Node script, so the GUC is
 * applied inline.
 *
 * Usage:
 *   DATABASE_URL=postgres://… pnpm --filter @orchester/web seed:demo
 *
 * Refs:
 *   - tests/fixtures/workspaces.ts — canonical workspace+owner pattern
 *   - packages/db/src/seed-demo.ts — wider-volume "into existing ws" seed
 *   - docs/DEPLOY.md "First-run setup" — operator-facing doc
 */
/* eslint-disable no-console */

// scripts/ is excluded from apps/web/tsconfig.json — tsx resolves at runtime.
// We rely on the `@orchester/db` workspace path the rest of apps/web uses.
import { createId } from "@paralleldrive/cuid2";
import { sql, eq } from "drizzle-orm";
import { createDbClient, schema } from "@orchester/db";

const DEMO_SLUG = "demo";
const DEMO_OWNER_EMAIL = "demo@orchester.local";
const DEMO_TZ = "America/Argentina/Buenos_Aires";

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("✗ DATABASE_URL is required");
    process.exit(2);
  }

  const db = createDbClient(url);

  // ── Idempotency guard ──────────────────────────────────────────────────
  // Detect by slug — deterministic, doesn't depend on `createId` reuse.
  // Read happens BEFORE the seeding transaction so we never start work
  // we'll have to roll back.
  const existing = await db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, DEMO_SLUG))
    .limit(1);

  if (existing.length > 0) {
    console.error(
      `✗ Demo workspace already exists (id=${existing[0]!.id}, name="${existing[0]!.name}"). ` +
        `Remove it manually if you want to re-seed.`
    );
    process.exit(1);
  }

  // ── Seed transaction ───────────────────────────────────────────────────
  // Single transaction for two reasons:
  //   1. The `workspace_owner_must_be_member` constraint trigger (migration
  //      0001) fires at COMMIT and needs the owner-membership row to exist.
  //   2. We set `app.cross_tenant_admin=true` as a transaction-local GUC so
  //      FORCE RLS doesn't block any of the inserts. The GUC dies with the
  //      tx, leaving the connection back in the regular tenant-scoped mode.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.cross_tenant_admin', 'true', true)`);

    // ── 1. Owner user + workspace + membership ────────────────────────────
    const ownerId = createId();
    const wsId = createId();

    await tx.insert(schema.users).values({
      id: ownerId,
      email: DEMO_OWNER_EMAIL,
      name: "Demo Owner",
      emailVerified: true,
      onboardingCompleted: true,
      preferredLocale: "en",
    });

    await tx.insert(schema.workspaces).values({
      id: wsId,
      slug: DEMO_SLUG,
      name: "Acme Inc.",
      timezone: DEMO_TZ,
      status: "active",
      ownerUserId: ownerId,
    });

    await tx.insert(schema.workspaceMembers).values({
      id: createId(),
      workspaceId: wsId,
      userId: ownerId,
      role: "owner",
    });

    console.log(`✓ Created workspace "Acme Inc." (slug=${DEMO_SLUG}, id=${wsId})`);
    console.log(`  owner: ${DEMO_OWNER_EMAIL} (no password set — use SSO or set one via the app)`);

    // ── 2. Agents (3) ─────────────────────────────────────────────────────
    const sofiaId = createId();
    const mateoId = createId();
    const luciaId = createId();

    await tx.insert(schema.agents).values([
      {
        id: sofiaId,
        workspaceId: wsId,
        name: "Sofia — Customer Support",
        role: "support",
        status: "active",
        kind: "conversational",
        model: "claude-haiku-4-5",
        temperature: "0.40",
        systemPrompt:
          "You are Sofia, the customer support agent for Acme Inc.\n" +
          "Help customers with refunds, account issues, and product questions.\n" +
          "Be warm, concise, and never invent policy — if you don't know, say you'll loop in a human.\n" +
          "Always confirm the issue is resolved before closing the conversation.\n" +
          "Reply in the customer's language; default to English.",
        greeting: "Hi! I'm Sofia from Acme support. How can I help you today?",
        starters: ["I want a refund", "How do I reset my password?", "What's your pricing?"],
        color: "#34d399",
      },
      {
        id: mateoId,
        workspaceId: wsId,
        name: "Mateo — Sales Qualifier",
        role: "sales",
        status: "active",
        kind: "conversational",
        model: "claude-haiku-4-5",
        temperature: "0.30",
        systemPrompt:
          "You are Mateo, a B2B sales qualifier for Acme Inc.\n" +
          "Greet the prospect, capture company size, use case, and timeline.\n" +
          "Use BANT lightly — no aggressive interrogation. Aim for a 4–6 turn conversation.\n" +
          "If the lead is qualified (>50 employees, has a concrete use case, decision in <90 days), offer to book a demo.\n" +
          "Otherwise, send relevant resources and exit gracefully.",
        greeting: "Hey! Mateo from Acme. Looking into us for your team?",
        starters: ["Tell me about pricing", "Can I book a demo?", "Do you integrate with HubSpot?"],
        color: "#22d3ee",
      },
      {
        id: luciaId,
        workspaceId: wsId,
        name: "Lucia — Onboarding Specialist",
        role: "onboarding",
        status: "active",
        kind: "conversational",
        model: "claude-haiku-4-5",
        temperature: "0.40",
        systemPrompt:
          "You are Lucia, the onboarding specialist for new Acme customers.\n" +
          "Walk users through account setup, first integration, and inviting their team.\n" +
          "Be encouraging — onboarding is the most fragile point in the funnel.\n" +
          "Anticipate the common stuck point: webhook signature mismatch. Mention it preemptively if relevant.\n" +
          "Always end with a clear next step.",
        greeting: "Welcome to Acme! I'm Lucia. Let's get you set up in under 10 minutes.",
        starters: [
          "I'm stuck on step 3",
          "How do I invite my team?",
          "Where's the webhook secret?",
        ],
        color: "#a78bfa",
      },
    ]);
    console.log("✓ Seeded 3 agents (Sofia · Mateo · Lucia)");

    // ── 3. Channels (2) ───────────────────────────────────────────────────
    const webChannelId = createId();
    const emailChannelId = createId();

    await tx.insert(schema.channels).values([
      {
        id: webChannelId,
        workspaceId: wsId,
        agentId: sofiaId,
        name: "Web widget — main site",
        type: "web",
        status: "active",
        // Stub config — no real credentials. The widget renders but won't
        // actually send/receive until the operator points it at their site.
        config: { color: "#34d399", position: "bottom-right", greeting: "Hi! How can we help?" },
      },
      {
        id: emailChannelId,
        workspaceId: wsId,
        agentId: sofiaId,
        name: "Email inbox — support",
        type: "email",
        status: "active",
        // Stub — operator wires real IMAP/SMTP via Settings → Channels.
        config: { address: "support@acme.example", reply_format: "html" },
      },
    ]);
    console.log("✓ Seeded 2 channels (web widget + email inbox — stub config, no real creds)");

    // ── 4. Knowledge base + 3 docs + chunks ───────────────────────────────
    const kbId = createId();
    await tx.insert(schema.knowledgeBases).values({
      id: kbId,
      workspaceId: wsId,
      name: "Acme Product Docs",
      description: "Public-facing product documentation: pricing, refunds, account setup.",
    });

    // Each doc is split into 3–5 hand-written chunks. Embeddings are left
    // NULL — the operator runs `pnpm kb:backfill` (or the route POST
    // /api/knowledge-bases/[id]/docs reupload) to embed them through the
    // configured provider. Per the existing convention in seed.ts, docs
    // whose chunks have null embeddings stay in `pending` status so the
    // UI doesn't claim RAG retrieval works when it doesn't.
    const docs: Array<{
      title: string;
      chunks: string[];
    }> = [
      {
        title: "Pricing",
        chunks: [
          "Acme Inc. offers three plans: Starter ($29/mo per seat), Growth ($79/mo per seat), and Enterprise (custom pricing, contact sales). All plans include unlimited agents and conversations; the difference is in advanced features and SLA.\n\nThe Starter plan is designed for small teams (≤10 seats) who need a single channel and basic analytics. It includes the web widget, one knowledge base, and 7-day audit log retention.",
          "The Growth plan unlocks multi-channel deployments (WhatsApp, Slack, Telegram, Email), unlimited knowledge bases, 90-day audit log retention, and SSO via SAML or OIDC. Most customers between 10 and 200 seats land here.\n\nGrowth also includes the Flow Studio for visual multi-step automations, scheduled flow runs, and HTTP node integrations with private endpoints (via VPC peering on annual contracts).",
          "Enterprise pricing applies for >200 seats or any deployment that requires self-hosting, on-premise data residency, custom data processing agreements, or dedicated support. Contact sales@acme.example for a quote.\n\nEnterprise includes everything in Growth plus: 7-year audit log retention, custom RBAC roles, SCIM provisioning, dedicated customer success engineer, and a 99.9% uptime SLA backed by service credits.",
          "All plans are billed monthly or annually. Annual billing is 20% cheaper. We do not charge for inactive seats automatically — you must remove them via Settings → Team.\n\nUsage-based add-ons: AI model inference is metered per provider's pricing and passed through with a 10% margin. Operators can connect their own provider keys and bypass the margin entirely.",
        ],
      },
      {
        title: "Refunds policy",
        chunks: [
          "Acme offers a 14-day money-back guarantee on all Starter and Growth subscriptions. If you cancel within 14 days of your first charge, we issue a full refund to the original payment method — no questions asked, no support call required.\n\nTo request a refund within the 14-day window, email billing@acme.example with your workspace slug and the email of the workspace owner. Refunds typically land in your account within 5–7 business days.",
          "After the 14-day window, refunds are evaluated case-by-case. We DO refund if: (a) a service outage exceeded our SLA, (b) we shipped a regression that broke a feature you were paying for and didn't fix it within 30 days, or (c) we made a billing error.\n\nWe DO NOT refund: (a) unused seats from a partial month, (b) renewals you forgot to cancel — but we'll downgrade you to the free plan and credit any unused time. Renewals are emailed 7 days in advance.",
          "Enterprise contracts have custom refund terms in the MSA. Contact your account manager.\n\nFor disputed charges, please reach out before opening a chargeback with your bank — chargebacks lock the workspace and slow resolution. We aim to respond to refund requests within 2 business days.",
        ],
      },
      {
        title: "Account setup",
        chunks: [
          'After signing up at acme.example/signup, the first user becomes the workspace owner. There is no separate "create workspace" step — the workspace is provisioned automatically with a slug derived from your email domain.\n\nNext, invite your team via Settings → Team → Invite. Each invitee gets a magic-link email; they can join with their own credentials or SSO. The four roles are Owner, Admin, Editor, and Viewer.',
          'To start receiving messages, you need at least one Channel connected to at least one Agent. Channels are configured under Settings → Channels.\n\nThe most common first step is the Web Widget: click "Connect Web Widget," choose an agent to handle inbound, and paste the one-line script tag into your site\'s HTML. The widget appears at the bottom-right corner by default; position and color are customizable.',
          'For email-based support, connect your support inbox under Settings → Channels → Email. We support IMAP fetch (for inbound) and SMTP send (for outbound replies). The most common gotcha is the webhook signature mismatch — see the Onboarding Specialist agent for the exact fix, or check Troubleshooting → "webhook signature mismatch."\n\nWebhooks (for outbound notifications to your systems) use HMAC-SHA256 over the request body, keyed by the per-webhook secret in Settings → Webhooks. The signature is in the X-Acme-Signature header, prefixed with `sha256=`. Validate with constant-time comparison.',
          "Once your first channel and agent are live, send a test message to confirm the round-trip works. If the agent doesn't reply within ~10 seconds, check: (1) the agent status is Active (not Draft), (2) your AI provider key is set under Settings → Providers, (3) the worker queue is running (Settings → System → Queue status).",
          "For production deployments, we strongly recommend: (a) enabling 2FA on owner accounts, (b) setting up a backup integration (Settings → Backups), and (c) configuring alerting for agent failures via Slack/Discord under Settings → Notifications.",
        ],
      },
    ];

    for (const doc of docs) {
      const docId = createId();
      await tx.insert(schema.knowledgeDocs).values({
        id: docId,
        kbId,
        workspaceId: wsId,
        title: doc.title,
        source: "text",
        contentType: "text/markdown",
        byteSize: doc.chunks.reduce((acc, c) => acc + c.length, 0),
        // Status stays "pending" because embeddings are NULL — the kb:backfill
        // script (or the upload route) flips this to "ready" after embedding.
        status: "pending",
        chunkCount: doc.chunks.length,
      });

      for (let i = 0; i < doc.chunks.length; i++) {
        await tx.insert(schema.knowledgeChunks).values({
          id: createId(),
          docId,
          kbId,
          workspaceId: wsId,
          ordinal: i,
          text: doc.chunks[i]!,
          // embedding stays NULL — backfill script populates it.
          metadata: { docTitle: doc.title },
        });
      }
    }
    const totalChunks = docs.reduce((acc, d) => acc + d.chunks.length, 0);
    console.log(
      `✓ Seeded knowledge base "Acme Product Docs" (3 docs · ${totalChunks} chunks · embeddings deferred)`
    );

    // ── 5. Conversations (3) — hand-written realistic exchanges ───────────
    // Each conversation is 4 messages (user → agent → user → agent) and
    // closed. They demonstrate the three most common interaction shapes
    // a first-time operator sees in our hub:
    //   1. Refund question  → Sofia closes positively.
    //   2. Pricing question → Mateo qualifies and offers a demo.
    //   3. Onboarding stuck → Lucia unblocks the webhook signature pain.
    interface SeedConv {
      agentId: string;
      customerName: string;
      customerEmail: string;
      summary: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }

    const conversations: SeedConv[] = [
      {
        agentId: sofiaId,
        customerName: "Priya Shah",
        customerEmail: "priya@buyer.example",
        summary: "Refund requested within 14-day window — issued.",
        messages: [
          {
            role: "user",
            content:
              "Hi — I signed up last week but our team decided to go a different direction. Can I get a refund?",
          },
          {
            role: "assistant",
            content:
              "Hi Priya! Sorry to see you go — yes, you're well within our 14-day money-back window, so a full refund is no problem. I just need to confirm two things: the workspace slug (it'll be in the URL when you're logged in, like acme.example/w/your-slug) and whether you want the refund on the original card. Once I have those I'll process it on the spot.",
          },
          {
            role: "user",
            content:
              "Workspace is priya-shah-team and yes, original card please. Thanks for not making this painful.",
          },
          {
            role: "assistant",
            content:
              "Done — refund queued for priya-shah-team, original payment method. You'll see it back on the card in 5–7 business days, usually faster. I'm closing the workspace from billing so you won't get any further charges, but your data stays intact for 30 days in case you change your mind. Take care, and thanks for trying us.",
          },
        ],
      },
      {
        agentId: mateoId,
        customerName: "Daniel Okeke",
        customerEmail: "daniel@growthco.example",
        summary: "Qualified Growth-plan lead, demo booked.",
        messages: [
          {
            role: "user",
            content:
              "Hey — we're a 120-person SaaS company looking at AI agents for our support inbox. What's the cost?",
          },
          {
            role: "assistant",
            content:
              "Hey Daniel! 120 seats puts you in our Growth plan territory — $79/mo per seat, billed annually it's $63/mo (20% off). That includes the web widget, email, WhatsApp, Slack, Telegram, unlimited knowledge bases, 90-day audit retention, and SSO. Quick question to make sure I'm pointing you at the right thing: are you looking to deflect tickets (agents reply directly to customers) or assist your team (suggested replies a human approves)?",
          },
          {
            role: "user",
            content:
              "Mostly deflect — we want the agent to handle tier-1 stuff end-to-end and only escalate when it's stuck. Timeline is Q3, so ~6 weeks out.",
          },
          {
            role: "assistant",
            content:
              "Perfect — deflection-first is exactly where Growth shines, and Q3 timing gives you plenty of runway. Two next steps that usually move fastest: (1) a 30-min demo with one of our solutions engineers where they'll show your exact use case running on sample data, and (2) we can spin up a free sandbox you wire to a copy of your support inbox so you see numbers on your own traffic. Want me to send a calendar link for the demo? I'd suggest next Tuesday or Wednesday afternoon US-Eastern.",
          },
        ],
      },
      {
        agentId: luciaId,
        customerName: "Marcus Lindberg",
        customerEmail: "marcus@startup.example",
        summary: "Onboarding stuck on webhook signature mismatch — resolved.",
        messages: [
          {
            role: "user",
            content:
              "I'm trying to wire up outbound webhooks and every call is failing with 'signature mismatch'. I've copied the secret three times. What am I doing wrong?",
          },
          {
            role: "assistant",
            content:
              "This is the #1 stuck point and it's almost always the same thing — you're hashing the parsed JSON instead of the raw request body. The signature is HMAC-SHA256 over the raw bytes of the POST body, BEFORE any JSON parsing or whitespace normalization. If your framework auto-parses the body, you need to capture it in a raw-body middleware first (in Express that's `express.raw({ type: 'application/json' })` on the webhook route). Want me to share a 10-line Node example?",
          },
          {
            role: "user",
            content: "Yes please. I'm on Node + Fastify if it matters.",
          },
          {
            role: "assistant",
            content:
              "Fastify makes it easy — register a content-type parser that hands you the raw buffer:\n\n```js\nfastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {\n  req.rawBody = body;\n  done(null, JSON.parse(body.toString()));\n});\n\nfastify.post('/webhooks/acme', async (req, reply) => {\n  const sig = req.headers['x-acme-signature']; // 'sha256=…'\n  const expected = 'sha256=' + crypto\n    .createHmac('sha256', process.env.ACME_WEBHOOK_SECRET)\n    .update(req.rawBody)\n    .digest('hex');\n  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {\n    return reply.code(401).send({ error: 'bad signature' });\n  }\n  // body is already parsed for you here\n  return { ok: true };\n});\n```\n\nThe `crypto.timingSafeEqual` is important (don't use ===) to avoid timing attacks. Try this and let me know — if it still fails I'll dig in further.",
          },
        ],
      },
    ];

    let convTotal = 0;
    let msgTotal = 0;
    const now = Date.now();
    for (let i = 0; i < conversations.length; i++) {
      const c = conversations[i]!;
      const convId = createId();
      const startedAt = new Date(now - (conversations.length - i) * 6 * 3600 * 1000);
      const endedAt = new Date(startedAt.getTime() + 8 * 60 * 1000); // ~8 min handle time
      await tx.insert(schema.conversations).values({
        id: convId,
        workspaceId: wsId,
        channelId: webChannelId,
        agentId: c.agentId,
        status: "closed",
        summary: c.summary,
        messageCount: c.messages.length,
        durationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
        customerName: c.customerName,
        customerEmail: c.customerEmail,
        startedAt,
        endedAt,
      });

      for (let j = 0; j < c.messages.length; j++) {
        const m = c.messages[j]!;
        await tx.insert(schema.messages).values({
          id: createId(),
          conversationId: convId,
          role: m.role,
          content: m.content,
          // No real LLM was billed for these — leave tokens/cost null.
          model: m.role === "assistant" ? "claude-haiku-4-5" : null,
          createdAt: new Date(startedAt.getTime() + j * 90 * 1000),
        });
        msgTotal++;
      }
      convTotal++;
    }
    console.log(`✓ Seeded ${convTotal} sample conversations (${msgTotal} messages, all closed)`);

    // ── 6. Flow (1) — "New ticket triage" ─────────────────────────────────
    // 3 nodes: trigger → switch → agent_handoff. Status `draft` so the
    // operator publishes it explicitly after reviewing the wiring.
    const fTrigger = createId();
    const fSwitch = createId();
    const fHandoff = createId();

    await tx.insert(schema.flows).values({
      id: createId(),
      workspaceId: wsId,
      name: "New ticket triage",
      description:
        "Inbound conversation → route by topic → hand off to Sofia (support) or Mateo (sales). Draft — publish after reviewing the switch cases.",
      status: "draft",
      trigger: "conversation",
      enabled: false,
      nodes: [
        {
          id: fTrigger,
          type: "trigger",
          label: "New conversation",
          config: { source: "conversation" },
          position: { x: 100, y: 200 },
        },
        {
          id: fSwitch,
          type: "switch",
          label: "Route by topic",
          config: {
            value: "{{conversation.first_message}}",
            cases: [
              { when: "contains 'refund' or 'cancel'", label: "support" },
              { when: "contains 'pricing' or 'demo' or 'plan'", label: "sales" },
              { when: "default", label: "support" },
            ],
          },
          position: { x: 400, y: 200 },
        },
        {
          id: fHandoff,
          type: "agent",
          label: "Hand off to Sofia",
          config: { agentId: sofiaId, message: "{{conversation.first_message}}" },
          position: { x: 700, y: 200 },
        },
      ],
      edges: [
        { id: createId(), source: fTrigger, target: fSwitch },
        { id: createId(), source: fSwitch, target: fHandoff, sourceHandle: "support" },
      ],
    });
    console.log('✓ Seeded 1 flow ("New ticket triage" — status: draft)');

    // ── 7. Employees (2) ──────────────────────────────────────────────────
    await tx.insert(schema.employees).values([
      {
        id: createId(),
        workspaceId: wsId,
        name: "Alex Rivera",
        email: "alex.rivera@acme.example",
        area: "Customer Support",
        phone: "+1 415 555 0142",
        active: true,
      },
      {
        id: createId(),
        workspaceId: wsId,
        name: "Jordan Kim",
        email: "jordan.kim@acme.example",
        area: "Sales",
        phone: "+1 415 555 0167",
        active: true,
      },
    ]);
    console.log("✓ Seeded 2 employees (Alex Rivera · Jordan Kim)");
  });

  console.log("");
  console.log("✓ Demo workspace ready.");
  console.log(`  Workspace: Acme Inc. (slug=${DEMO_SLUG})`);
  console.log(`  Owner:     ${DEMO_OWNER_EMAIL}`);
  console.log("");
  console.log("Next: sign in, set a password for the demo owner (or use SSO),");
  console.log("then run `pnpm kb:backfill` if you want the KB embedded for RAG.");

  process.exit(0);
}

main().catch((e) => {
  console.error("✗ seed-demo failed:", e);
  process.exit(1);
});
