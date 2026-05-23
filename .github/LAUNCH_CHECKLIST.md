# Launch-day checklist

Everything that genuinely requires `lucasmailland` to be at the keyboard. All technical work in the repo is done; this is the public-flip + hardening sequence.

Total expected time: **~5 minutes** of clicking + waiting.

## Order matters

Run in this order. Steps 2–5 only become available after step 1.

### 1. Flip the repo to public

`Settings → General → Danger Zone → Change repository visibility → Make public`

Confirms with the repo name. Takes effect immediately.

### 2. Upload the social preview image

`Settings → General → Social preview → Edit → Upload image`

Drag `.github/assets/social-preview.png` (already committed to the repo) into the upload box. GitHub crops to 1280×640 — the image is already that size, no cropping needed.

### 3. Enable branch protection on `main`

Either via the web UI (`Settings → Branches → Add branch protection rule → main`) or via `gh`:

```bash
gh api -X PUT repos/lucasmailland/orchester/branches/main/protection \
  -F required_status_checks.strict=true \
  -F required_status_checks.contexts[]='CI / build-test' \
  -F required_status_checks.contexts[]='CodeQL / Analyze (javascript-typescript)' \
  -F required_status_checks.contexts[]='gitleaks / scan' \
  -F required_status_checks.contexts[]='DCO / DCO Check' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_code_owner_reviews=true \
  -F required_linear_history=true \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true \
  -F lock_branch=false \
  -F block_creations=false
```

The status-check context names must match what your workflows actually report. Run the workflows once after flipping to public, then copy the names from `gh api repos/lucasmailland/orchester/commits/main/check-runs --jq '.check_runs[].name'`.

### 4. Enable private vulnerability reporting

`Settings → Security → Code security and analysis → Private vulnerability reporting → Enable`

This is what `SECURITY.md` directs people to. Free on public repos.

### 5. Enable Dependabot security updates

`Settings → Security → Code security and analysis`:

- **Dependency graph** → Enable
- **Dependabot alerts** → Enable
- **Dependabot security updates** → Enable
- **Secret scanning** → Enable (free on public repos)
- **Push protection** → Enable

The Dependabot config file (`.github/dependabot.yml`) was already shipped for routine version bumps; these toggles add the _security-specific_ alerts and auto-PRs.

### 6. (Optional) Pin the Discussions categories you want surfaced

`Discussions → New post` shows all categories. To pin the curated three (Q&A, Show and tell, Ideas) at the top of the sidebar:

- Hover each category → ⚙ → "Pin to sidebar"

### 7. (Optional) Verify CITATION.cff renders

After flip, the repo's "About" card should show a "Cite this repository" button. If it doesn't appear within ~10 minutes, GitHub may need a fresh push to re-index; an empty commit does the trick.

---

## Post-launch announcement

Once steps 1–5 are complete:

- Tweet / post / blog with the public URL and the social preview will render automatically (`https://github.com/lucasmailland/orchester`).
- The v0.1.0 release page (`https://github.com/lucasmailland/orchester/releases/tag/v0.1.0`) is the canonical "what's in this" link.
- Pin the launch announcement to the Discussions Announcements category.

Everything in the codebase is ready for traffic. The structural CI guards, security tooling, and contribution workflow are wired and tested.
