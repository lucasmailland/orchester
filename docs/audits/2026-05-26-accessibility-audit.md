# Accessibility audit — 2026-05-26 (v1.0 GA prep)

Static audit, no real screen-reader testing. WCAG 2.1 AA-leaning. Scope: `apps/web/` only.

## Executive summary

- 24 findings total: 8 P0, 11 P1, 5 P2.
- Top three areas to address before v1.0:
  1. **Shell-level fundamentals** — `<html lang>` is hard-coded to `"en"` regardless of the `[locale]` route segment, and there is no skip-to-content link. These violations affect every page and every screen-reader user.
  2. **Bespoke modals lack the `dialog` ARIA pattern.** `AgentFormModal`, `ConfirmDialog`, the `IntegrationsClient` config modal, and the `ConversationDrawer` all omit `role="dialog"` / `aria-modal="true"`, an accessible name, and an Escape-key close. Native HeroUI `Modal` callers (e.g. `EditFactDialog`, `MemoryOpsClient`) get this for free, but the hand-rolled ones do not.
  3. **Icon-only buttons in shared row/list components are missing accessible names.** Notably `AgentRow` (edit/delete), `BrainPanel` (pin/forget), `AgentStudio` (back arrow + avatar), the close button in `AgentFormModal`, and the close in `IntegrationsClient.ConfigModal`. Because these patterns are re-used per list row, a single primitive fix removes dozens of real violations.
- Areas already in good shape: the HeroUI-based primitives (`Topbar`, `UserMenu`, `ThemeToggle`, `PresentationModeToggle`, `LanguageSelector`, `FactRow`) all carry `aria-label`s and use `isIconOnly` semantics correctly. `Sidebar`'s collapse button has an `aria-label`. `MembersSection`, `DevelopersSection`, `AuditLogSection`, and `SoftDeleteWorkspaceModal` properly use `htmlFor`/`id` pairs and `sr-only` labels for visually-hidden form labels. The `Topbar` brand renders with reasonable contrast (`text-strong` / `text-muted` semantic tokens). `Sidebar` group headings use `text-faint` which passes 4.5:1 in light mode.

## P0 findings (block screen reader users)

### [a11y-001] Root `<html lang>` is fixed to "en"

- File: `apps/web/app/layout.tsx:30`
- Issue: `<html lang="en">` is hard-coded in the root layout. The localized variant under `[locale]/layout.tsx` does not (cannot) override the root `<html>` element. So a user reading `/pt-BR/...` content still has `lang="en"` advertised to assistive tech, and screen readers will pronounce Portuguese with English phonetics. WCAG 3.1.1.
- Fix: Move `<html>` rendering into `[locale]/layout.tsx`, or pass the resolved `locale` up via `params` and set `<html lang={locale}>` at the root.

### [a11y-002] No skip-to-content link in the shell

- File: `apps/web/app/[locale]/[workspaceSlug]/(shell)/layout.tsx:51-79`
- Issue: Keyboard users land at the top of the page and must Tab through every Sidebar nav item, every Topbar control, and every command-palette trigger before reaching the page `<main>`. No `<a href="#main">Skip to content</a>` is rendered. WCAG 2.4.1.
- Fix: Add `<a href="#main" className="sr-only focus:not-sr-only ...">Skip to content</a>` as the first child of the shell layout, and give the `<main>` an `id="main"` and `tabIndex={-1}`.

### [a11y-003] `AgentFormModal` is not exposed as a dialog

- File: `apps/web/components/agents/AgentFormModal.tsx:99-244`
- Issue: The modal is built from a `motion.div` backdrop + content wrapper without `role="dialog"`, `aria-modal="true"`, or an accessible name (`aria-labelledby`). There is no Escape-key close handler. The form's labels (lines 138, 148, 160, 173, 192, 206) are bare `<label>` elements with no `htmlFor` and no `id` on the matching `<input>`/`<textarea>`/`<select>`, so screen readers do not announce the label when focus lands on the field. The close X (line 126) also has no `aria-label`.
- Fix: Wrap the dialog content in `<div role="dialog" aria-modal="true" aria-labelledby="agent-form-title">`, give the `<h2>` an `id="agent-form-title"`, add `htmlFor`/`id` pairs to every label/input, attach `onKeyDown` for `Escape`, and add `aria-label={labels.cancel}` to the close button.

### [a11y-004] `ConfirmDialog` host is not a dialog

- File: `apps/web/components/ui/ConfirmDialog.tsx:50-105`
- Issue: The global confirm dialog (used by `confirm()` in `AgentsPageClient.handleDelete`, `AgentRow.handleDelete`, and likely others) renders a `motion.div` overlay without `role="dialog"` / `aria-modal` / `aria-labelledby`. The title `<h3>` (line 75) is rendered but never associated with the dialog. No Escape-key handler.
- Fix: Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby="confirm-title"` and give the `<h3>` `id="confirm-title"`. Add an Escape handler that calls `close(false)`.

### [a11y-005] `ConversationDrawer` close + drawer not a dialog

- File: `apps/web/components/conversations/ConversationsClient.tsx:562-585`
- Issue: The drawer is a `<div className="fixed inset-0 z-40 flex">` with no `role="dialog"` / `aria-modal` / accessible name. Backdrop is `<div className="flex-1 bg-black/50" onClick={onClose} />` — a click-only backdrop, no keyboard escape and no role. The close button (line 583) is an icon-only `<button>` with no `aria-label`. There is also no initial focus management.
- Fix: Wrap the right-hand panel in `role="dialog" aria-modal="true" aria-labelledby="conv-drawer-title"`, label the `<User>` row's name span as the title via an id, add Escape handling, give the close button `aria-label={t("close")}`.

### [a11y-006] `IntegrationsClient` config modal not a dialog

- File: `apps/web/components/integrations/IntegrationsClient.tsx:281-292`
- Issue: Same pattern as the above — `<div className="fixed inset-0 z-50 ...">` with `<div className="absolute inset-0 bg-black/60" onClick={onClose} />` backdrop, no `role="dialog"`, no `aria-modal`, no Escape, no `aria-label` on the close X (line 289). The fields below (lines 300, 309) use bare `<label>` elements not associated to the inputs.
- Fix: Add the `role="dialog"` wrapper with `aria-labelledby` pointing to the existing `<h3>`, add Escape, give the close button an `aria-label`, and pair `htmlFor`/`id` on each label/input.

### [a11y-007] `AgentRow` icon-only Edit/Delete buttons have no accessible name

- File: `apps/web/components/agents/AgentRow.tsx:147,153`
- Issue: Both buttons render only a Lucide icon. No `aria-label`, no visible text, no `type="button"`. Screen readers announce them as just "button". This is one of the most-used surfaces in the product (every agent in every team renders an AgentRow).
- Fix: Add `type="button"` and `aria-label={t("editAria", { name })}` / `aria-label={t("deleteAria", { name })}` (the i18n keys already exist — they are used correctly in `AgentsPageClient.tsx:313,321`).

### [a11y-008] `BrainPanel` icon-only Pin / Forget buttons rely on `title` only

- File: `apps/web/components/brain/BrainPanel.tsx:188-206`
- Issue: The Pin and Trash icon buttons use `title="Pin"` / `title="Forget"`. `title` is unreliable on touch devices and not consistently announced by all screen readers; it should not be the only accessible name. The two icon buttons in `IntegrationsClient` at lines 145-151 (test/refresh) have the same shape — visible icon + label text, but the trash button at line 161-168 IS labeled. The BrainPanel ones are not.
- Fix: Replace `title="…"` with `aria-label="…"` (or add both — `title` for the tooltip, `aria-label` for AT). FactRow does this correctly using HeroUI's Tooltip + `aria-label`.

## P1 findings

### [a11y-009] `UserMenu` mounted-false branch removes focus ring

- File: `apps/web/components/shell/UserMenu.tsx:102-120`
- Issue: The pre-hydration button uses `focus:outline-none` with no replacement `focus:ring-*` or `focus-visible:*`. The same component's post-hydration branch (line 129) correctly adds `focus:ring-2 focus:ring-violet-500/60`. For the first paint (and for users who hit the page before client hydration completes), the avatar trigger has no visible focus indicator. WCAG 2.4.7.
- Fix: Add `focus-visible:ring-2 focus-visible:ring-violet-500/60` to the pre-hydration className.

### [a11y-010] `LanguageSelector` flags carry meaning but no text alternative for AT

- File: `apps/web/components/shell/LanguageSelector.tsx:41-46,55`
- Issue: On `sm:hidden` the only visible content is the flag emoji (e.g. 🇺🇸). Emoji flag pronunciation varies wildly between screen readers — some say "flag of the United States", some say nothing, some say the codepoint. The button still has the `<Globe>` icon + the `aria-label` from the parent isn't set; only the DropdownMenu has `aria-label={t("selectLanguage")}`. The trigger button does not have an `aria-label`.
- Fix: Add `aria-label={t("currentLanguage", { name: LOCALE_LABELS[locale] })}` to the trigger `<Button>`, and `aria-hidden="true"` on the flag emoji span so screen readers don't pronounce the codepoint.

### [a11y-011] `Sidebar` brand block has no accessible name

- File: `apps/web/components/shell/Sidebar.tsx:93-96`
- Issue: When collapsed the sidebar shows a single gradient circle with the letter "O". There is no text alternative, no `aria-label` on the surrounding `<div>`. The user expects "Orchester" or the workspace switcher.
- Fix: Either render a visually-hidden `<span className="sr-only">Orchester</span>` next to the "O", or wrap the brand block in `<Link href="..." aria-label="Orchester home">`.

### [a11y-012] `AgentsPageClient` card uses `motion.div onClick` for navigation

- File: `apps/web/components/agents/AgentsPageClient.tsx:257-269`
- Issue: The agent card is a `motion.div` with `onClick` that navigates to the agent detail page. No `role="button"`, no `tabIndex={0}`, no `onKeyDown` handler — keyboard users cannot open agents. The nested Edit/Delete buttons inside (lines 311-326) ARE accessible, but the card itself isn't. (`FactRow` shows the correct pattern.)
- Fix: Replace with `<Link>` wrapping (so anchors handle keyboard nav natively), or apply the `role="button"` + `tabIndex={0}` + `onKeyDown` triad as in FactRow.

### [a11y-013] `AgentStudio` back-arrow and avatar lack labels

- File: `apps/web/components/agents/studio/AgentStudio.tsx:134-160`
- Issue: The back arrow (line 134) is an icon-only `<button>` with no `aria-label`. The avatar `<img>` is rendered with `alt=""` (line 149), which is correct ONLY if the image is purely decorative — here it's the agent's avatar, so it conveys identity and should have an alt. The two inline name/role `<input>` editors (lines 156, 162) have no `<label>` / `aria-label` and no visible label — users only see the current text.
- Fix: `aria-label={t("back")}` on the back button; either remove the avatar image (let the gradient block stand on its own) or set `alt={t("agentAvatarAlt", { name })}`; add `aria-label={t("nameLabel")}` and `aria-label={t("roleLabel")}` to the two inputs.

### [a11y-014] `KnowledgeListClient` create form: inputs lack labels

- File: `apps/web/components/knowledge/KnowledgeListClient.tsx:72-94`
- Issue: Both the name and description `<input>` (lines 72, 79) use `placeholder` only — no `<label>`, no `aria-label`. The provider `<select>` (line 87) has a sibling `<label>` (line 86) but they're not connected via `htmlFor`/`id`. Placeholder text is not a substitute for a label (WCAG 3.3.2, 1.3.1).
- Fix: Add `aria-label` / `id`/`htmlFor` pairs.

### [a11y-015] `FlowsListClient` create form: input lacks label

- File: `apps/web/components/flows/FlowsListClient.tsx:60-67`
- Issue: The name `<input>` (line 60) has only a `placeholder` — no label or `aria-label`.
- Fix: Add `aria-label={t("namePlaceholder")}` or render a hidden `<label>` with `htmlFor`/`id`.

### [a11y-016] Dashboard agent-performance table lacks `<th scope>` and caption

- File: `apps/web/components/dashboard/DashboardClient.tsx:504-516`
- Issue: The `<table>` uses `<th>` elements without `scope="col"` and there's no `<caption>` describing the table's purpose. WCAG 1.3.1.
- Fix: Add `scope="col"` to every `<th>` and `<caption className="sr-only">{t("agentPerformanceCaption")}</caption>` after the opening `<table>`.

### [a11y-017] `AuditLogViewer` table lacks `<th scope>` and caption

- File: `apps/web/components/workspace/AuditLogViewer.tsx:170-179`
- Issue: Same pattern as the dashboard table — `<th>` elements without `scope="col"`, no `<caption>`.
- Fix: Same fix.

### [a11y-018] `UsagePageClient` table lacks `<th scope>` and caption

- File: `apps/web/components/usage/UsagePageClient.tsx:226-232`
- Issue: Same pattern.
- Fix: Same fix.

### [a11y-019] Loading spinners in lazy wrappers and integrations are not announced

- Files:
  - `apps/web/components/dashboard/DashboardClientLazy.tsx:27-31`
  - `apps/web/components/flows/FlowBuilderLazy.tsx:22-26`
  - `apps/web/components/integrations/IntegrationsClient.tsx:103`
- Issue: HeroUI's `<Spinner>` does not ship `role="status"` / `aria-live` by default; the wrapper `<div>` should provide them so the loading state is announced. `apps/web/app/[locale]/loading.tsx` does this correctly already and is the model.
- Fix: Wrap each spinner in `<div role="status" aria-live="polite" aria-label={t("loading")}>…</div>` (or set those attrs on the existing wrapper).

## P2 findings

### [a11y-020] Heading hierarchy: every page jumps `<h1>` → `<h3>`

- Files (sampled):
  - `apps/web/components/conversations/ConversationsClient.tsx:209,362`
  - `apps/web/components/flows/FlowsListClient.tsx:46,90`
  - `apps/web/components/knowledge/KnowledgeListClient.tsx:58,118`
  - `apps/web/components/agents/AgentsPageClient.tsx:167,237` (uses `<h2>` correctly for team groups)
  - `apps/web/components/ui/EmptyState.tsx:48`
  - `apps/web/components/brain/BrainPanel.tsx:110`
- Issue: The pattern is `<h1>{page title}</h1>` then `<h3>{empty state title}</h3>` with no `<h2>` between them. EmptyState is a shared primitive used by many pages and hard-codes `<h3>`. Tools like NVDA's heading-jump navigation will skip a level. WCAG 1.3.1.
- Fix: Lower the EmptyState heading to `<h2>` (and let callers nest), or accept an `as` prop. Same for the inline empty states in conversations/flows/knowledge — `<h2>` is the right level for a top-level empty state on those pages.

### [a11y-021] `text-faint` semantic token has marginal contrast in dark mode

- Files (sampled): `apps/web/app/globals.css:44`, used widely
- Issue: In dark mode, `--text-faint: 82 82 91` (zinc-600) on `--app: 0 0 0` yields approximately 3.5:1 contrast — fails WCAG 1.4.3 (4.5:1 for normal text). It's used for secondary metadata: sidebar group labels, dashboard sub-text, fact-row "updated" timestamps, EmptyState description, etc. The light-mode token (`113 113 122` on `250 250 250`) is closer to passing but still borderline.
- Fix: Bump dark-mode `--text-faint` to `140 140 150` (or use the existing `--text-muted` of `113 113 122` which is already used elsewhere). Verify each call site against AA.

### [a11y-022] `text-zinc-500` / `text-zinc-400` on dark backgrounds in marketing pages

- Files (sampled):
  - `apps/web/app/[locale]/welcome/page.tsx:71,93,129,161,178,194,242`
  - `apps/web/app/[locale]/pricing/page.tsx:46,71,96,111`
  - `apps/web/components/auth/LoginForm.tsx:140,159,227`
  - `apps/web/components/docs/DocsLayout.tsx:12,17,55,59,91,106`
- Issue: Hard-coded `text-zinc-400` (`#a1a1aa`) and `text-zinc-500` (`#71717a`) on the auth/marketing dark backgrounds. On `bg-zinc-900` (`#18181b`), `text-zinc-500` is ~3.3:1 — fails AA. These pages are outside the workspace shell but are the first thing every signed-out user sees.
- Fix: Standardise on the semantic tokens (`text-muted`, `text-faint`) which can be tuned centrally, or bump to `text-zinc-300` / `text-zinc-400` for paragraph copy.

### [a11y-023] HeroUI `<Modal>` with `backdrop="blur"` is fine but config modal closes are still inconsistent

- Files (sampled):
  - `apps/web/components/brain/EditFactDialog.tsx:67` — uses HeroUI Modal (good)
  - `apps/web/app/[locale]/[workspaceSlug]/(shell)/settings/memory/MemoryOpsClient.tsx:452` — uses HeroUI Modal (good)
  - vs. the hand-rolled ones flagged above (P0-003/004/005/006)
- Issue: We have two modal patterns in the codebase. HeroUI's Modal handles focus trap, Escape, and `aria-modal` for free; the hand-rolled `motion.div` modals do not. This is observation, not a single fix — the suggested follow-up is to migrate all hand-rolled modals onto HeroUI's `Modal`.
- Fix: Track this as a refactor — replace `AgentFormModal`, `ConfirmDialog`, `IntegrationsClient.ConfigModal`, and `ConversationDrawer` with HeroUI `Modal` / `Drawer`.

### [a11y-024] Marketing nav lacks an accessible name

- File: `apps/web/app/[locale]/welcome/page.tsx:71`, `apps/web/app/[locale]/pricing/page.tsx:46`, `apps/web/components/docs/DocsLayout.tsx:59`
- Issue: `<nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">` — no `aria-label`. When there are multiple `<nav>` elements in a page (header nav + footer nav), screen readers announce them as just "navigation" with no way to distinguish.
- Fix: Add `aria-label={t("mainNav")}` (or "Primary", "Footer", etc.).

## Patterns observed

- **Two modal patterns in the codebase**: HeroUI `Modal` (handles a11y correctly) vs. hand-rolled `motion.div` overlays (misses `role="dialog"`, `aria-modal`, Escape, focus trap, accessible names). All four hand-rolled instances we found have the same set of gaps.
- **Icon-only buttons via Lucide**: across the codebase, the pattern split is roughly: HeroUI `<Button isIconOnly aria-label="…">` (good) vs. raw `<button><Icon /></button>` (often missing `aria-label` and `type="button"`). The shell components are clean; per-feature rows (AgentRow, BrainPanel, AgentStudio) are where most gaps live.
- **Labels separated from inputs**: in hand-rolled forms (KnowledgeListClient, FlowsListClient, AgentFormModal, ConfigModal) the visible `<label>` is rendered as a sibling without `htmlFor`/`id` — the SettingsSections (Members, Developers, Audit) and `SoftDeleteWorkspaceModal` show the right pattern with `sr-only` labels paired by id.
- **Card-as-button via `motion.div onClick`** appears in AgentsPageClient. FactRow shows the right pattern (`role="button"` + `tabIndex` + `onKeyDown`).
- **Heading levels jump from h1 to h3** because the shared `EmptyState` primitive hard-codes `<h3>`. Fixing the primitive removes the issue across all pages that use it.
- **`<th>` without `scope` and no `<caption>`** in every `<table>` in the codebase (Audit log, Usage, Dashboard, SpreadsheetField in flows). One pattern fix per table.

## Suggested follow-up sweep (~1 day of focused work)

- **Step 1 — shell fundamentals (≈1h)**: dynamic `<html lang>`, skip-to-content link, `aria-label` on the collapsed sidebar brand, `aria-label` on the LanguageSelector trigger, focus-ring on the pre-hydration UserMenu button.
- **Step 2 — modal pattern unification (≈3h)**: migrate `AgentFormModal`, `ConfirmDialog`, `ConfigModal`, and `ConversationDrawer` from hand-rolled overlays onto HeroUI `<Modal>` / `<Drawer>`. This single change closes findings 003, 004, 005, 006, and 023.
- **Step 3 — icon-only buttons in row components (≈1h)**: add `aria-label` to AgentRow edit/delete (i18n keys already exist), BrainPanel pin/forget, AgentStudio back. Audit all `<button>…<Lucide /></button>` patterns one more time after these.
- **Step 4 — tables (≈30min)**: add `scope="col"` to every `<th>` and `<caption className="sr-only">` to AuditLogViewer, UsagePageClient, DashboardClient.AgentTable.
- **Step 5 — EmptyState heading + contrast tokens (≈1h)**: lower EmptyState to `<h2>`, bump `--text-faint` dark-mode value, audit all `text-zinc-{400,500}` usages on dark backgrounds and replace with semantic tokens.
- **Step 6 — loading states (≈30min)**: wrap the three known spinners (DashboardLazy, FlowBuilderLazy, IntegrationsClient) in `role="status" aria-live="polite"`.
- **Step 7 — manual smoke pass with VoiceOver / NVDA (≈1h)**: tab through the shell, open one modal, drive the conversations drawer, navigate the agents list with the keyboard, confirm announcements.
