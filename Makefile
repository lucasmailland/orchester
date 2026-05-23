# Orchester — developer shortcuts.
#
# Every target wraps the canonical pnpm script so editors, CI, and humans
# all use one front door. Run `make help` for the menu.

SHELL := /usr/bin/env bash

.DEFAULT_GOAL := help

# ---- meta -------------------------------------------------------------------

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN { FS = ":.*## "; printf "\nUsage: make <target>\n\nTargets:\n" } \
	  /^[a-zA-Z0-9_.-]+:.*## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ---- setup ------------------------------------------------------------------

.PHONY: install
install: ## Install all workspace dependencies via pnpm.
	pnpm install

.PHONY: db.up
db.up: ## Start the local Postgres (Docker compose) in the background.
	docker compose up -d postgres

.PHONY: db.down
db.down: ## Stop the local Postgres.
	docker compose stop postgres

.PHONY: db.migrate
db.migrate: ## Apply pending Drizzle migrations.
	pnpm db:migrate

.PHONY: db.seed
db.seed: ## Seed the local DB with sample data.
	pnpm db:seed

.PHONY: db.reset
db.reset: ## Drop and recreate the local DB volume. DESTRUCTIVE.
	docker compose down -v postgres
	docker compose up -d postgres
	@echo "Waiting for postgres to be ready..."; sleep 3
	$(MAKE) db.migrate

# ---- run --------------------------------------------------------------------

.PHONY: dev
dev: ## Run the dev server (web). Use in one terminal.
	pnpm dev

.PHONY: worker
worker: ## Run the flow worker. Use in a second terminal.
	pnpm worker

# ---- quality ----------------------------------------------------------------

.PHONY: lint
lint: ## Run ESLint across the workspace.
	pnpm lint

.PHONY: format
format: ## Format every supported file in place.
	pnpm format

.PHONY: format.check
format.check: ## Verify formatting without writing.
	pnpm format:check

.PHONY: typecheck
typecheck: ## Run TypeScript --noEmit across the workspace.
	pnpm --filter @orchester/web exec tsc --noEmit

.PHONY: test
test: ## Run the unit + integration test suite (Vitest).
	pnpm test

.PHONY: invariants
invariants: ## Run the structural invariants guard locally.
	bash scripts/audit-invariants.sh

.PHONY: ci
ci: format.check lint typecheck test invariants ## Run everything CI runs.

# ---- release ----------------------------------------------------------------

.PHONY: clean
clean: ## Remove build artifacts and caches.
	rm -rf .turbo apps/*/.next apps/*/.turbo apps/*/dist packages/*/.turbo packages/*/dist
