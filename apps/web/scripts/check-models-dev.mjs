#!/usr/bin/env node
/**
 * Compare the model catalogue against models.dev and report every disagreement.
 *
 *   node apps/web/scripts/check-models-dev.mjs [--json] [--strict]
 *
 * Why a checker and not a generator: this catalogue is what the meter and the
 * spend cap read, so its numbers decide what a workspace is charged. Handing
 * that to a feed nobody on this project controls trades one failure mode for a
 * worse one — a silent change in an external file becoming a silent change in
 * everyone's bill. A checker keeps the numbers in git, where a change is a diff
 * somebody approves, and still catches the drift that a hand-maintained table
 * accumulates on its own.
 *
 * It found the reason it exists: every Claude-on-Bedrock entry carried the
 * price of the `global.*` inference profile while the ids were `us.*`, which
 * bill 10% more. Five models, undercharged, since the day they were added.
 *
 * models.dev is MIT and quotes cost per 1M tokens; this catalogue stores per
 * 1K. That factor of a thousand is the easiest thing here to get wrong.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SOURCE = process.env["MODELS_DEV_URL"] ?? "https://models.dev/api.json";
/** models.dev quotes USD per 1M tokens; we store per 1K. */
const PER_1K = 1000;
/** Floating point: 0.1 + 0.2 must not be reported as drift. */
const EPSILON = 1e-9;

/** Our provider id → the key models.dev files it under. */
const PROVIDER_KEYS = {
  bedrock: "amazon-bedrock",
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  xai: "xai",
  groq: "groq",
  mistral: "mistral",
  deepseek: "deepseek",
};

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read the catalogue as text rather than importing it: the module pulls in
 * `server-only` and the rest of the app, and this script should run anywhere,
 * including a CI step that has not built the app.
 */
export function readCatalogue(
  source = readFileSync(join(here, "..", "lib", "ai", "catalog", "models.ts"), "utf8")
) {
  const entries = [];
  // Cut the file at each `m(` first. A single regex cannot do this: entries are
  // written both on one line and across several, and a body-matching pattern
  // that allows newlines will happily run past a one-line entry's closing brace
  // and pick up the NEXT entry's numbers. That silently pairs every model with
  // its neighbour's price, which reads as catastrophic drift in the report.
  const starts = [];
  const opener = /\bm\(\s*"/g;
  for (const found of source.matchAll(opener)) starts.push(found.index);
  const chunks = starts.map((start, i) => source.slice(start, starts[i + 1] ?? source.length));

  const head = /m\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*\{([\s\S]*)/;
  for (const chunk of chunks) {
    const match = chunk.match(head);
    if (!match) continue;
    const [, provider, model, name, capability, body] = match;
    if (capability !== "chat") continue;
    // Drop line comments first: prices get discussed right above the real ones
    // ("// el perfil global sale 0.0003"), and a note must never be read as a
    // value.
    const clean = body.replaceAll(/\/\/[^\n]*/g, "");
    const num = (key) => {
      // The key sits after `{` or `,`, or opens the body — anchoring it to the
      // start of a LINE would silently skip every entry written on one line,
      // and a skipped entry is never reported as anything at all.
      const found = clean.match(new RegExp(`(?:^|[{,])\\s*${key}:\\s*([\\d._]+)`));
      return found ? Number(found[1].replaceAll("_", "")) : undefined;
    };
    entries.push({
      provider,
      model,
      name,
      id: `${provider}:${model}`,
      cin: num("cin"),
      cout: num("cout"),
      ctx: num("ctx"),
    });
  }
  return entries;
}

export function differs(ours, theirs) {
  if (ours === undefined || theirs === undefined) return false;
  return Math.abs(ours - theirs) > EPSILON;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");

  const response = await fetch(SOURCE);
  if (!response.ok) {
    console.error(`models.dev returned ${response.status}`);
    process.exit(2);
  }
  const catalogue = await response.json();
  const ours = readCatalogue();
  if (ours.length === 0) {
    console.error("Parsed no models out of the catalogue — the file's shape changed.");
    process.exit(2);
  }

  const findings = [];
  let compared = 0;
  let missing = 0;
  for (const entry of ours) {
    const key = PROVIDER_KEYS[entry.provider];
    if (!key) continue;
    const theirs = catalogue[key]?.models?.[entry.model];
    if (!theirs) {
      missing++;
      findings.push({ id: entry.id, kind: "unknown-to-models-dev" });
      continue;
    }
    compared++;
    const cin = theirs.cost?.input === undefined ? undefined : theirs.cost.input / PER_1K;
    const cout = theirs.cost?.output === undefined ? undefined : theirs.cost.output / PER_1K;
    const ctx = theirs.limit?.context;
    if (differs(entry.cin, cin) || differs(entry.cout, cout)) {
      findings.push({
        id: entry.id,
        kind: "price",
        ours: { in: entry.cin, out: entry.cout },
        modelsDev: { in: cin, out: cout },
      });
    }
    if (differs(entry.ctx, ctx)) {
      findings.push({ id: entry.id, kind: "context", ours: entry.ctx, modelsDev: ctx });
    }
    if (theirs.tool_call === false) {
      // A chat model that cannot call tools is not usable as an agent here.
      findings.push({ id: entry.id, kind: "no-tool-call" });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ compared, missing, findings }, null, 2));
  } else {
    const prices = findings.filter((f) => f.kind === "price");
    const contexts = findings.filter((f) => f.kind === "context");
    const noTools = findings.filter((f) => f.kind === "no-tool-call");
    const unknown = findings.filter((f) => f.kind === "unknown-to-models-dev");
    console.log(`Compared ${compared} chat models against models.dev.\n`);
    for (const f of prices) {
      console.log(
        `PRICE   ${f.id}\n        ours       in ${f.ours.in}  out ${f.ours.out}\n` +
          `        models.dev in ${f.modelsDev.in}  out ${f.modelsDev.out}`
      );
    }
    for (const f of contexts) {
      console.log(`CONTEXT ${f.id}: ours ${f.ours}, models.dev ${f.modelsDev}`);
    }
    for (const f of noTools) {
      console.log(`TOOLS   ${f.id}: models.dev says this model cannot call tools`);
    }
    if (unknown.length) {
      console.log(
        `\n${unknown.length} model(s) models.dev does not list, so nothing to compare:\n  ` +
          unknown.map((f) => f.id).join("\n  ")
      );
    }
    const disagreements = prices.length + contexts.length + noTools.length;
    console.log(
      disagreements === 0
        ? "\nNo disagreements."
        : `\n${disagreements} disagreement(s). models.dev is a cross-check, not an authority: ` +
            `confirm against the vendor's own price list before changing a number here.`
    );
  }

  // Off by default. A disagreement can be models.dev being wrong or stale, and
  // an external file must not be able to turn every build in the repo red.
  if (strict && findings.some((f) => f.kind !== "unknown-to-models-dev")) process.exit(1);
}

// Only when run as a command; the parser is imported by its tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
