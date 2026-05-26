# Performance audit — 2026-05-26 (v1.0 GA prep)

Static audit, no production-build measurements. Scope: `apps/web/` only. Goal: identify high-leverage cheap fixes that improve Core Web Vitals and bundle weight without architectural surgery, and apply them inline.

## Executive summary

- No new dependencies added. Existing optimization scaffolding is solid: `output: "standalone"`, AVIF/WebP image formats, `optimizePackageImports` on the 12 heaviest barrel exports, `serverExternalPackages` for native modules. The Flow builder and Dashboard charts are already correctly behind `next/dynamic({ ssr: false })`. Heavy server-only parsers (`pdf-parse`, `mammoth`) are lazy-imported inside `lib/chunking.ts` and only referenced from one API route — zero client leakage.
- Top 5 wins applied in this commit:
  1. **OrgCanvas lazy-loaded.** `@xyflow/react` no longer ships in the org page's initial bundle.
  2. **SuspendedBanner converted to Server Component.** Removes the next-intl client runtime cost for the common (non-suspended) case where the component returns `null`.
  3. **Shell-group `loading.tsx` added.** Sidebar/topbar chrome stays mounted while any `(shell)` child route streams in — instant navigation feedback for 14 routes.
  4. **`optimizePackageImports` extended.** Added `swr`, `@dagrejs/dagre`, `tailwind-merge`, `clsx` — all imported from many client components.
  5. **Audit documented.** This file captures the deferred wins so they're not lost.
- Top 5 deferred wins (with effort estimate):
  1. **Per-route skeletons.** Replace the generic spinner in `(shell)/loading.tsx` with route-shaped skeletons (table rows for `conversations`, KPI cards for the dashboard). Per-route, low-risk. **~1 h per route.**
  2. **Remove dead `UsagePageClient` + `ConversationChart`.** No imports anywhere; both pull in `recharts` for no reason. Out of scope here — needs a confirmation pass before deletion. **~15 min.**
  3. **Skip-to-content telemetry trim from `instrumentation-node.ts`.** Not measured today; revisit when we have RUM. **~2 h.**
  4. **`framer-motion` → CSS transitions** in static-decoration sites (e.g. `EmptyState`, several `onboarding/steps/*`). Most usages are micro-animations that don't need a JS animation library; CSS keyframes give the same UX for zero bundle. **~3-4 h, judgment-heavy.**
  5. **`canvas-confetti`** in `OnboardingSteps/EmployeesStep`. Lazy-import on first success event instead of static import. **~20 min, but needs UX sign-off on timing.**

## Findings by category

### Bundle weight

Reading `package.json` and grepping for static imports:

| Dep               | Approx unpacked | Where it lands today                                  | Status                                                                                             |
| ----------------- | --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@xyflow/react`   | ~600 KB         | Flow builder, OrgCanvas                               | Flow already lazy. **OrgCanvas now lazy (this commit).**                                           |
| `recharts`        | ~450 KB         | DashboardClient, HealthDashboard                      | Dashboard already lazy. HealthDashboard ships inside `BrainInspectorClient` (deferred, see below). |
| `framer-motion`   | ~200 KB         | 36 components                                         | Optimized via `optimizePackageImports`. Tree-shaken in production.                                 |
| `mammoth`         | ~150 KB         | `lib/chunking.ts` (server-only)                       | Lazy-imported — no client leakage.                                                                 |
| `pdf-parse`       | ~80 KB          | `lib/chunking.ts` (server-only)                       | Lazy-imported — no client leakage.                                                                 |
| `canvas-confetti` | ~30 KB          | `onboarding/steps/EmployeesStep.tsx`                  | Statically imported. Deferred — see top-5.                                                         |
| `@dagrejs/dagre`  | ~50 KB          | `lib/flows/layout.ts` (only used by lazy FlowBuilder) | Added to `optimizePackageImports`.                                                                 |

The notable finding: `HealthDashboard` (recharts) is imported statically by `BrainInspectorClient`, which is itself client-side. The recharts cost lands on the `/brain` route on first paint. Not applied here because `BrainInspectorClient` is already client-side and refactoring the recharts island to be lazy inside that client component is a ~30-min change but needs to thread props through a wrapper — fits the deferred list.

### Server vs Client

Counted 104 `"use client"` directives under `apps/web/components/`. Iterated through each, keeping only files with no `useState`/`useEffect`/`useRef`/`onClick`/`onPress`/`framer-motion`/`next-themes`/`useTransition` signatures. Of the 8 candidates:

- **`SuspendedBanner.tsx`** — converted to async Server Component (this commit). Switched from `useTranslations` (client) → `getTranslations` (server). Pure JSX + conditional, no client behaviour.
- `LanguageSelector.tsx` — uses `useRouter` + `onAction`. Stays client.
- `BrainStats.tsx` — uses `useSWR` + `useParams`. Stays client.
- `DashboardClientLazy.tsx`, `FlowBuilderLazy.tsx` — wrapper boundaries for `dynamic({ ssr: false })`. Required to be client.
- `flows/nodes/BranchNode.tsx`, `flows/nodes/SimpleNode.tsx`, `flows/nodes/RegistryNode.tsx` — render `<Handle>` from `@xyflow/react`. Required to be client. Already inside the lazy `FlowBuilder` chunk.

### Images

`<img>` tags found in two files; both are documented justifications:

- `components/settings/TwoFactorSection.tsx:168` — QR served from a third-party generator, would require allowlisting the domain in `next.config.ts`. The existing inline comment captures the rationale.
- `components/agents/studio/AgentStudio.tsx:147` — user-provided avatar URL from arbitrary host. Same story.

No changes.

### Code splitting / dynamic imports

Three heavy client trees identified, all already correctly wrapped except one:

- **`FlowBuilder` (`@xyflow/react` + `@dagrejs/dagre`)** — already lazy via `components/flows/FlowBuilderLazy.tsx`.
- **`DashboardClient` (recharts)** — already lazy via `components/dashboard/DashboardClientLazy.tsx`.
- **`OrgCanvas` (`@xyflow/react`)** — **lazy-wrapped this commit** via new `components/org/OrgCanvasLazy.tsx`, mirroring the FlowBuilderLazy pattern. `app/[locale]/[workspaceSlug]/(shell)/org/page.tsx` updated to import the wrapper.

Deferred: `HealthDashboard` (recharts) inside `BrainInspectorClient` — needs the chart island extracted behind a wrapper because its host is already a client component.

### `next.config.ts`

Read `apps/web/next.config.ts`. Existing state was already strong:

- `output: "standalone"` — present.
- `images.formats: ["image/avif", "image/webp"]` — present.
- `experimental.optimizePackageImports` — covered the 12 biggest barrels.

This commit appended `swr`, `@dagrejs/dagre`, `tailwind-merge`, `clsx`. These are imported from many client components — small per-module wins, but they compound across the bundle.

### Loading boundaries

Before this commit only one `loading.tsx` existed (under `[locale]/`). The shell route group hosting 14 leaf routes (`agents`, `brain`, `channels`, `conversations`, `employees`, `flows`, `integrations`, `knowledge`, `org`, `settings`, `teams`, `usage`, plus subroutes) had no loading fallback — so navigating between routes blocked on the server roundtrip with no feedback.

Added `app/[locale]/[workspaceSlug]/(shell)/loading.tsx` — a generic centered spinner matching the existing `[locale]/loading.tsx` style. Because it lives below `ShellLayout`, the sidebar/topbar chrome stays mounted; only the inner content area shows the spinner. This restores perceived performance during route transitions without requiring 14 per-route skeletons.

## Fixes applied

- **`apps/web/components/org/OrgCanvasLazy.tsx`** — new file. Dynamic wrapper for OrgCanvas, mirrors `FlowBuilderLazy` / `DashboardClientLazy` shape.
- **`apps/web/app/[locale]/[workspaceSlug]/(shell)/org/page.tsx`** — switched the import from `OrgCanvas` to `OrgCanvasLazy`.
- **`apps/web/components/workspace/SuspendedBanner.tsx`** — converted from `"use client"` + `useTranslations` to async Server Component + `getTranslations`. Behavioural-equivalent (still returns `null` for non-suspended). Layout already imports it inside an async server component, so the change is transparent at the call site.
- **`apps/web/app/[locale]/[workspaceSlug]/(shell)/loading.tsx`** — new file. Generic loading fallback for the entire shell route group.
- **`apps/web/next.config.ts`** — appended `swr`, `@dagrejs/dagre`, `tailwind-merge`, `clsx` to `experimental.optimizePackageImports`.

## Deferred — recommend separate PRs

- **`HealthDashboard` recharts lazy island.** Today `BrainInspectorClient` statically imports `HealthDashboard`, which statically imports recharts (~450 KB). Wrapping `HealthDashboard` in a `dynamic({ ssr: false })` import (or a small `HealthDashboardLazy.tsx`) would defer recharts off the `/brain` initial render. Estimated effort: 30 min. File: `apps/web/components/brain/HealthDashboard.tsx` + `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/BrainInspectorClient.tsx`.
- **Per-route skeleton loading states.** The generic spinner in the shell `loading.tsx` is functional but unsophisticated. Each high-traffic route (dashboard, conversations, knowledge, agents) would benefit from a skeleton that mirrors the real layout — KPI tiles for dashboard, table rows for the lists. Estimated effort: 1 h per route, low risk.
- **Dead-code removal — `UsagePageClient`, `ConversationChart`.** Neither is referenced anywhere outside its own file. `usage/page.tsx` redirects to the dashboard. Deleting both removes a recharts entry point. Out of scope here because removing them requires confirming no dynamic-string references in messages/audit logs. Estimated effort: 15 min.
- **Static `framer-motion` → CSS keyframes.** 36 components import `framer-motion`, but most are decorative micro-animations (fade-in, hover scale). CSS keyframes would give equivalent UX with zero JS animation library cost. Highest-leverage candidates: `components/ui/EmptyState.tsx`, `components/onboarding/steps/*.tsx`. Estimated effort: 3-4 h, judgment-heavy.
- **`canvas-confetti` lazy import.** Currently statically imported in `EmployeesStep.tsx`. Should be `await import("canvas-confetti")` on first success event so it doesn't ship in the onboarding chunk. Estimated effort: 20 min.

## Verification

- `npx tsc --noEmit` — clean (no errors).
- `bash scripts/audit-invariants.sh` — passes (all transversal invariants hold).
- `npx vitest run` — 339 pass, 1 pre-existing failure (`tests/integration/gdpr/export-job.spec.ts` — zip-header buffer mismatch, unrelated to anything in this audit's scope).
