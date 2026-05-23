/**
 * Conventional Commits enforcement via commitlint.
 *
 * Run automatically by the husky `commit-msg` hook on every commit.
 * Spec: https://www.conventionalcommits.org/en/v1.0.0/
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Subject case is intentionally relaxed: legitimate acronyms and product
    // names (CodeQL, MCP, JSON, OAuth, gitleaks, Stripe, GitHub) frequently
    // appear mid-subject. Forbidding them creates more friction than it saves.
    // We do still forbid all-UPPERCASE shouting subjects.
    "subject-case": [2, "never", ["upper-case"]],
    // Hard cap on header length — readable in `git log --oneline`.
    "header-max-length": [2, "always", 100],
    // Body lines wrap at 100 too (not 72 — modern terminals are wider).
    "body-max-line-length": [1, "always", 100],
    // Allowed conventional types.
    "type-enum": [
      2,
      "always",
      [
        "feat", // new feature
        "fix", // bug fix
        "docs", // docs only
        "style", // formatting (no code logic)
        "refactor", // refactor (no feature/fix)
        "perf", // performance improvement
        "test", // tests only
        "build", // build system / deps
        "ci", // CI config
        "chore", // misc
        "revert", // revert a previous commit
      ],
    ],
  },
};
