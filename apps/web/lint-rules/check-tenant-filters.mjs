// apps/web/lint-rules/check-tenant-filters.mjs
//
// Plan reference: Task A.24.
//
// Static text-based check that catches Drizzle queries against
// tenant-scoped tables that don't include a `workspaceId` filter inside
// their `.where(...)` clause within 800 chars after the `.from(...)`.
//
// It's deliberately simple: a regex sweep, not a real AST walker. The
// rationale is that the script complements (rather than replaces) the
// `tenantQuery(ctx)` helper — its job is to flag forgotten filters in
// hand-rolled queries during code review and CI.
//
// Tables list mirrors the spec's TENANT-scoped table inventory. Two
// substitutions vs. the spec's draft list:
//   - "integrations" → "workspaceIntegrations" (actual drizzle export)
//   - "webhooksOut"  → "outboundWebhooks"      (actual drizzle export)
//
// False positives are expected during Phase A; the goal is to install
// the check + baseline the noise. Phase B will iterate on the existing
// violations.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const TENANT_TABLES = [
  "agents",
  "teams",
  "channels",
  "employees",
  "conversations",
  "flows",
  "workspaceIntegrations",
  "apiKeys",
  "knowledgeBases",
  "knowledgeDocs",
  "knowledgeChunks",
  "agentMemories",
  "auditLog",
  "featureFlags",
  "gdprExportJobs",
  "aiProviders",
  "outboundWebhooks",
  "flowRuns",
  "conversationLabels",
  "notificationPrefs",
  "securityEvents",
];

let violations = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const f of entries) {
    const p = join(dir, f);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (f === "node_modules" || f === ".next" || f === "tests") continue;
      walk(p);
    } else if ([".ts", ".tsx"].includes(extname(p))) {
      const src = readFileSync(p, "utf-8");
      for (const tbl of TENANT_TABLES) {
        const re = new RegExp(`\\.from\\(\\s*schema\\.${tbl}\\b`, "g");
        const matches = [...src.matchAll(re)];
        for (const m of matches) {
          // Look ahead 800 chars for a .where(...) with workspaceId
          const tail = src.slice(m.index, m.index + 800);
          if (!/\.where\([^)]*workspaceId/.test(tail)) {
            console.error(`${p}: ${tbl} query without workspaceId filter`);
            violations++;
          }
        }
      }
    }
  }
}

walk("app");
walk("lib");
walk("components");

if (violations > 0) {
  console.error(`\n${violations} tenant-filter violations`);
  process.exit(1);
}
console.log("No tenant-filter violations found.");
