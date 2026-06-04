# Changelog

All notable changes to Orchester are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Until **v1.0.0**, breaking changes may land in minor versions; we note them explicitly.

Releases are produced by [release-please](https://github.com/googleapis/release-please) from Conventional Commit messages on `main`.

## [0.2.0](https://github.com/lucasmailland/orchester/compare/v0.1.0...v0.2.0) (2026-06-04)


### Added

* **agent-runtime v1.5:** wire all v1.4 latent recall features into runtime ([fabfb60](https://github.com/lucasmailland/orchester/commit/fabfb6036c3e4c3ed6f37531ee91ab2191c529fe))
* **agent-runtime:** compact fact rendering + hard cap top-3 (anti-bloat) ([568b2a6](https://github.com/lucasmailland/orchester/commit/568b2a6c28ed87f7cf4f7cecc5760006c3ed9179))
* **agent-runtime:** flip HyDE + rerank + graph expansion defaults to ON with kill-switches ([2464f0d](https://github.com/lucasmailland/orchester/commit/2464f0de40c58c7ae231bee54de9128e655d4a9f))
* **agent-runtime:** inject Memory Protocol v1 into agent system prompts ([5f7539d](https://github.com/lucasmailland/orchester/commit/5f7539d5297a6cef462a6ca5c71edc667b6cf178))
* **agent-runtime:** tiered memory injection — Layer 1 cached, Layer 2 conditional recall ([1a6fc16](https://github.com/lucasmailland/orchester/commit/1a6fc16efd8efb67f16652d170cc5818f2e0fdbb))
* **ai:** resolveEmbeddingTier — premium tier for pinned / high-conf / workspace-scope facts ([a35f590](https://github.com/lucasmailland/orchester/commit/a35f590ea0a46933cff73b2a28d0dfd0e9c3c44d))
* **api:** /api/mnemo/entities CRUD + linked-facts endpoint ([af5fa85](https://github.com/lucasmailland/orchester/commit/af5fa8503b210de858a7fdfc146a42bb4d7d5278))
* **api:** admin "run now" routes for memory crons (7 routes) ([08d7f29](https://github.com/lucasmailland/orchester/commit/08d7f29e2ecd837c232f01739c362a4a61f4f4ab))
* **api:** GET /api/mnemo/episodes + /api/mnemo/episodes/[id] ([4751d84](https://github.com/lucasmailland/orchester/commit/4751d844717637a13f5fa76832d17023494db50c))
* **api:** GET /api/mnemo/export — workspace memory dump ([7e03721](https://github.com/lucasmailland/orchester/commit/7e037213808db59bd5915ea880c4d420f5cb4a08))
* **api:** GET /api/mnemo/facts + PATCH/forget/restore/pin/unpin/citations ([7f78cec](https://github.com/lucasmailland/orchester/commit/7f78cec990e5b155fb32316f2c77e7ffc916bbdd))
* **api:** GET /api/mnemo/review + POST /api/mnemo/review/[id]/resolve ([f917e5b](https://github.com/lucasmailland/orchester/commit/f917e5b420c398171e6958a8a616eefe648ec80d))
* **api:** GET /api/mnemo/review/count ([1800bdc](https://github.com/lucasmailland/orchester/commit/1800bdc43a775ba65e384a3a9258078e061d4cec))
* **api:** PATCH /api/conversations/[id]/sensitivity ([a3800a2](https://github.com/lucasmailland/orchester/commit/a3800a210adb4931d5a9458bfc6c65a5bbb72ab4))
* **api:** POST /api/mnemo/recall-unified + agents/[id]/memory-policy ([c4c7c4e](https://github.com/lucasmailland/orchester/commit/c4c7c4e0c1f005e846f912ebee286915f87121ee))
* **audit:** barrel export for lib/audit ([7c9d89a](https://github.com/lucasmailland/orchester/commit/7c9d89a9b30d123fd7fa5c7ab9b6eb11538009fd))
* **audit:** chain hash algorithm tests (canonical + payload + chain hashes) ([17a1e67](https://github.com/lucasmailland/orchester/commit/17a1e67d05e3f3ddf031c7785335f0c42a8bd71d))
* **audit:** daily verify-all-chains cron worker + security_event on break ([6d11b80](https://github.com/lucasmailland/orchester/commit/6d11b8014b07a3aed1fef092de6977fada55c434))
* **audit:** GET /audit + GET /audit/verify endpoints (admin/owner only) ([6ce3d8b](https://github.com/lucasmailland/orchester/commit/6ce3d8b5f2cced7af6b3d3cd30e53208c2e87f3a))
* **audit:** minimal chain + types + log shims for call sites ([9a810fb](https://github.com/lucasmailland/orchester/commit/9a810fb778c68a0ad2e1e9f59fe1f4c2d5ceaeb5))
* **audit:** SECURITY_ALERT_WEBHOOK on chain break ([013c954](https://github.com/lucasmailland/orchester/commit/013c954170d97ec8180b5006d0e267b4ced3da53))
* **audit:** verifyChain detects retroactive tampering + tests ([55a869e](https://github.com/lucasmailland/orchester/commit/55a869edcdd9c05fdaa09fa0a50ca4a3b8723f44))
* **boot:** assertSafeDbRole boot check — fails closed in production ([18cf2d6](https://github.com/lucasmailland/orchester/commit/18cf2d6dcf1ad35b427f1226d20cc2cb8da58ca4))
* **brain ui:** Export Decision BOM button ([68baeec](https://github.com/lucasmailland/orchester/commit/68baeec395303fb2784b05dbda4af01299571b0e))
* **brain:** /api/mnemo/decisions/[traceId] BOM endpoint ([c8e26d6](https://github.com/lucasmailland/orchester/commit/c8e26d6c1b6a26430f3bb9172c40699ed5a44029))
* **brain:** 422 + audit on poisoning reject ([64e6f22](https://github.com/lucasmailland/orchester/commit/64e6f222f2d816193f6d798cfdedfe2b69760640))
* **brain:** API routes facts/search + brain.read/write RBAC actions ([52778fd](https://github.com/lucasmailland/orchester/commit/52778fdbe3d1ffdf4d86617ae2cf646a4d6c76f1))
* **brain:** BrainPanel UI + GDPR exporter integration ([a3e6a65](https://github.com/lucasmailland/orchester/commit/a3e6a654f4a0547a169a831a5a6effe6e93132aa))
* **brain:** deep-link fact citations to source conversation ([055af04](https://github.com/lucasmailland/orchester/commit/055af040fb5685368a4174e1c3d0b99312102f89))
* **brain:** diff page — week-over-week added/forgotten/updated columns ([23ae5e7](https://github.com/lucasmailland/orchester/commit/23ae5e7987598511114eae359fb8e29f55f2971f))
* **brain:** episode-extractor — synthesize mnemo_episode rows from slices ([cd097b3](https://github.com/lucasmailland/orchester/commit/cd097b3d330842592771355170eccbc5509e82e6))
* **brain:** export modal — JSON + CSV downloadable bundles ([9f02cbc](https://github.com/lucasmailland/orchester/commit/9f02cbcc8266fb37d4c543a8d870c80ff0b15519))
* **brain:** extract-job populates entity_id + protocol_version='v1.2' ([53b8ee0](https://github.com/lucasmailland/orchester/commit/53b8ee0ad785a68af4f509c45ebdaff72fde3079))
* **brain:** extract-job populates memory_type + attribution + actor_id ([7eb36ba](https://github.com/lucasmailland/orchester/commit/7eb36ba9356ed61a91b51a6a02cd61836ca74a1c))
* **brain:** extract-job uses saveFactWithCandidates for contradiction detection ([ac3dccd](https://github.com/lucasmailland/orchester/commit/ac3dccd184a4a3c74c52860adeaad1dd684571fd))
* **brain:** Fact detail page with inline editor + citations panel ([a1c44bc](https://github.com/lucasmailland/orchester/commit/a1c44bc7faac88e867b256b891c0eb0ecc8b551b))
* **brain:** HealthDashboard component — 30d fact-count + hit-rate charts ([8e7a3db](https://github.com/lucasmailland/orchester/commit/8e7a3db1a485bbbcb7bd2b674dde7d352883cba7))
* **brain:** Memory Inspector list page + filters + KPI stats ([a2a478c](https://github.com/lucasmailland/orchester/commit/a2a478c22c20251ea090479985a568b038c79830))
* **brain:** MNEMO_DECISION_BOM kill-switch + complete env docs ([995141d](https://github.com/lucasmailland/orchester/commit/995141d127b4ad9582645cf27de298e4383066c5))
* **brain:** passive recall injection + Stats page + sidebar nav + i18n ([935a253](https://github.com/lucasmailland/orchester/commit/935a253fd24b7b2c4c972f0305e0d9ffd2453801))
* **brain:** persistent memory section with inspector mockup and 4 differentiators ([14bd1ca](https://github.com/lucasmailland/orchester/commit/14bd1ca1fb73f616e1ae1043773f398b2c63d2ae))
* **brain:** phase BA foundation (migration + drizzle schema + lib skeleton) ([16666d5](https://github.com/lucasmailland/orchester/commit/16666d54573ea0bca17dd60011ba937cc8d2f859))
* **brain:** phase BB extraction worker (LLM facts + pg-boss handler + queue constant) ([d159bec](https://github.com/lucasmailland/orchester/commit/d159bec84b7c410d4e73727369d57e722260a1db))
* **brain:** phase BD compaction + decay daily crons ([e0185b9](https://github.com/lucasmailland/orchester/commit/e0185b952636d4197956a6d4da8dca502383a018))
* **brain:** respect conversation.memory_learning_paused (sensitivity gate) ([b21738d](https://github.com/lucasmailland/orchester/commit/b21738d74b36e0c29243164b50faeb9b68892916))
* **brain:** sensitivity toggle — per-conversation learning pause ([e11f8b2](https://github.com/lucasmailland/orchester/commit/e11f8b2d651fcd70d5ae3bbe89587613e2c7725c))
* **brain:** SWR hooks for facts + health endpoints ([0e912f2](https://github.com/lucasmailland/orchester/commit/0e912f2249dd199d91f3daddeba3081d8c755737))
* **brain:** TimeTravelPicker — bitemporal asOf UI in Memory Inspector ([185bade](https://github.com/lucasmailland/orchester/commit/185bade089f6e53078229349d64e04223438bc27))
* **brain:** traceId on recall-debug ([45a76aa](https://github.com/lucasmailland/orchester/commit/45a76aa250c087eb71be298af9cdaf2180f735d1))
* **brain:** undo log — last 20 memory changes with revert buttons ([f059ee6](https://github.com/lucasmailland/orchester/commit/f059ee669b00f46d26c0fc6a31d7227ff0296795))
* **brain:** wire real review queue count via /api/mnemo/review/count ([d86caf8](https://github.com/lucasmailland/orchester/commit/d86caf86ca6de0b5196c091759363519b06549bb))
* **brain:** wire worker handler + router enqueue + brain_recall agent tool ([5eb5ea5](https://github.com/lucasmailland/orchester/commit/5eb5ea585f525f3f2ab44e4b7aceaedfac1ff1ad))
* **channels:** animated message beams traveling from agent core to each channel ([8cf8b85](https://github.com/lucasmailland/orchester/commit/8cf8b85d0f0879ad31ed6ea0a4ffe902d16a0e17))
* **channels:** redesign as 3x3 grid with agent at center ([c7cf72c](https://github.com/lucasmailland/orchester/commit/c7cf72c9f209f7344f43ba177fd2aeb5d022776b))
* **comparison:** vs CrewAI/AutoGen/LangGraph table with 8 feature differentiators ([8b70972](https://github.com/lucasmailland/orchester/commit/8b7097253173e0967f0af171b6c40222c970940d))
* **compass:** foundation + showcase + 7 polished pages ([e40fd07](https://github.com/lucasmailland/orchester/commit/e40fd07cb9ce18771a92dbc3e28c21a4d528c4bf))
* **compass:** Sprint 3 — Tour engine, First-mile wizard, polish fixes ([be3fef2](https://github.com/lucasmailland/orchester/commit/be3fef23fa2dae86b9070ed29e16aa551249a8c3))
* **compass:** Sprint 4 — closes adversarial round-2 findings ([6e04535](https://github.com/lucasmailland/orchester/commit/6e04535c6a5c12056e67d0e910aa0f0317a2ac6f))
* **compass:** Sprint 5 — Tier 1 complete (Help drawer, Cmd-K, Templates, 7 tours, tests) ([57c2960](https://github.com/lucasmailland/orchester/commit/57c29600717684708e2da7c38d5e8b8ed05088a1))
* **compass:** Sprint 6 — final polish, 100/100 production-grade verdict ([01ca69e](https://github.com/lucasmailland/orchester/commit/01ca69e8e17064fd606e91387cd4d354bff29d3c))
* **conversations:** embed SensitivityToggle in detail page with server persistence ([e7b1d77](https://github.com/lucasmailland/orchester/commit/e7b1d770fb2a666ea16ffbfff267af9fcdf79032))
* **db:** agent.memory_policy + mnemo_fact.actor_id columns (0036, 0037) ([222ab2f](https://github.com/lucasmailland/orchester/commit/222ab2f071f0f380f304dafbae5809116899e8bf))
* **db:** attribution column on mnemo_fact (migration 0035) ([3ffc561](https://github.com/lucasmailland/orchester/commit/3ffc5618d2ba9bcb5d9ea9cefdadd75c5823b0cd))
* **db:** bitemporal GIST indexes on mnemo_* tables (spec §2.1) ([8a85733](https://github.com/lucasmailland/orchester/commit/8a85733315dfbd3c11a3cc95113e9de89ba54ea0))
* **db:** conversation.memory_learning_paused column (migration 0038) ([abe561d](https://github.com/lucasmailland/orchester/commit/abe561dd2f152475c1fc37ff99577f84efa9369c))
* **db:** demo seed — 6 teams, 14 agents, 7 flows, 22 conversations ([fc55b75](https://github.com/lucasmailland/orchester/commit/fc55b75a238f7f9c5c13c7bae98ed53d8ffe0b6c))
* **db:** drizzle schema for feature_flag ([f82611a](https://github.com/lucasmailland/orchester/commit/f82611a16645db97444ac0916f63fcc388d23765))
* **db:** drizzle schema for mnemo_decision (Task 2.2) ([70448aa](https://github.com/lucasmailland/orchester/commit/70448aa8b98fb6fe5f30f90fdc1597c6d94ec300))
* **db:** drizzle schema for mnemo_fact + mnemo_extraction_job ([5567d35](https://github.com/lucasmailland/orchester/commit/5567d35c20fb3a817298d42ca0bf197b405a95c9))
* **db:** drizzle schema for new audit_log (Task A.4) ([c85c342](https://github.com/lucasmailland/orchester/commit/c85c34271e1ee463c9d14643043fd1ece0b46d23))
* **db:** drizzle schema for workspace lifecycle ([f97cec1](https://github.com/lucasmailland/orchester/commit/f97cec1e2bb4e0a2e420d693655a51d6f7c9a911))
* **db:** drizzle schemas for gdpr/idempotency/security_event ([6b14c53](https://github.com/lucasmailland/orchester/commit/6b14c53b8fe977abd5e5d2ff9cb721567a2a9bce))
* **db:** feature_flag table for per-workspace toggles ([6a4867d](https://github.com/lucasmailland/orchester/commit/6a4867d4df5344bf6fbbac571e4d1d96017d12ec))
* **db:** FORCE RLS on critical tables (memory, KB chunks, conversations, audit, etc.) ([a98a86d](https://github.com/lucasmailland/orchester/commit/a98a86dc6404162e4d410527e8255e5d01290f1c))
* **db:** FORCE RLS on remaining tenant tables (full enforcement) ([fcfd2e8](https://github.com/lucasmailland/orchester/commit/fcfd2e8bb89e743f70c85433216050d678df61f3))
* **db:** gdpr_export_job state machine table ([d4b2861](https://github.com/lucasmailland/orchester/commit/d4b28614be09e45aa0e30f9987d3dfb708bfebd9))
* **db:** halfvec quantization on mnemo_fact.embedding — 2x storage reduction (migration 0042) ([5661b82](https://github.com/lucasmailland/orchester/commit/5661b8248b56a93271f817bea53d154097953d27))
* **db:** idempotency + security_event tables + RLS helper functions ([f03d4ad](https://github.com/lucasmailland/orchester/commit/f03d4ad10ac798f8222f366069771e078a30171c))
* **db:** memory_type column on mnemo_fact + mnemo_episode table (0033, 0034) ([1719d13](https://github.com/lucasmailland/orchester/commit/1719d132b11ea2a581a4cf62e7a61643bdcfcee0))
* **db:** migrate legacy audit_log rows into new schema with placeholder hash chain ([bf62eb6](https://github.com/lucasmailland/orchester/commit/bf62eb6319cd3bec0b2ee4f64803e6cfecae24c9))
* **db:** migration 0017 — mnemo_fact + mnemo_extraction_job ([3ee632c](https://github.com/lucasmailland/orchester/commit/3ee632cb1c34a33daa0ece63ee098d3edf59a6e2))
* **db:** migration 0018 — mnemo_decision schema (Task 2.1) ([48dda5d](https://github.com/lucasmailland/orchester/commit/48dda5df5b145334990e932f2383c7bc4c2a1ff3))
* **db:** migration 0020 — mnemo_relation with 9 locked verbs (Task 2.4) ([c4ae9af](https://github.com/lucasmailland/orchester/commit/c4ae9afe9380cfd9511d569d2d6ed827c27b2982))
* **db:** migration 0021 — mnemo_citation ([43ff9f8](https://github.com/lucasmailland/orchester/commit/43ff9f8ad0a1a75879a35d861e69eb1e63fca064))
* **db:** migration 0022 — mnemo_query_cache (L3 semantic cache) ([0a51375](https://github.com/lucasmailland/orchester/commit/0a51375a40524deb884dc19131cdd1a6c4748467))
* **db:** migration 0024 — backfill brain → mnemo data ([5701685](https://github.com/lucasmailland/orchester/commit/5701685b528b6dd2f93a03b9c43c1a442cd11107))
* **db:** mnemo_entity + actor isolation policy + protocol tag (0039-0041) ([ea0e503](https://github.com/lucasmailland/orchester/commit/ea0e503e21f0db72e8666effdf88e32f3fc9f2f1))
* **db:** mnemo_extraction_job defer_until column + deferred_provider_outage status (migration 0027) ([42a9d8a](https://github.com/lucasmailland/orchester/commit/42a9d8ac1ee0d3921ddbbe34bc16d70afe56dd36))
* **db:** mnemo_review_queue table (migration 0032) ([0c6d556](https://github.com/lucasmailland/orchester/commit/0c6d5566e086f47b976408eeb87fd3c63bb3bd39))
* **db:** mnemo_summary table — distilled user profile cache (migration 0028) ([376dd88](https://github.com/lucasmailland/orchester/commit/376dd8811734a67d7bce47190130694a1873334b))
* **db:** new audit_log table with hash chain (Task A.3) ([c0888ce](https://github.com/lucasmailland/orchester/commit/c0888ce533b31b86b7689fa592c3a3df5c3bd69f))
* **db:** postgres roles app_user/cron_admin/read_only_audit ([826b9e1](https://github.com/lucasmailland/orchester/commit/826b9e105a5396ecdaa653e54abdfff2289859fc))
* **db:** remove temp auditLogs alias — all call sites migrated ([b23e5bf](https://github.com/lucasmailland/orchester/commit/b23e5bf83f6bea4a3a471b3542f9b81f432144c1))
* **db:** rename legacy audit_log → audit_log_legacy ([a87329b](https://github.com/lucasmailland/orchester/commit/a87329b0afec5eba5854b992bc93ebb372563fdb))
* **db:** RLS policies on all tenant tables (NOT FORCED — Phase A) ([26e29e1](https://github.com/lucasmailland/orchester/commit/26e29e180dda0164bbc9957bd250a66d64db93d5))
* **db:** schema rename auditLogs → auditLogsLegacy with back-compat alias ([3019927](https://github.com/lucasmailland/orchester/commit/30199271151bb5830a97eecde4cd916e36b120ab))
* **db:** workspace lifecycle columns (status, deleted_at, owner_user_id) ([44b430d](https://github.com/lucasmailland/orchester/commit/44b430d97057da619eaa36e1127a2fbf468f89e2))
* **dev-seed:** mnemo-seed admin endpoint for Inspector smoke testing ([3ee6a4c](https://github.com/lucasmailland/orchester/commit/3ee6a4ca44582b0b428845a54be45f1be12ded28))
* **extract-job:** defer instead of skip when LLM provider unavailable ([9a3219c](https://github.com/lucasmailland/orchester/commit/9a3219cc91f81ac8b5afb0ffdbd5ac687a814bde))
* **faq:** accordion FAQ section with 6 community-focused questions ([c6c1f78](https://github.com/lucasmailland/orchester/commit/c6c1f78ba39b37ca793baa2664db4bfb68c88d72))
* **feature-flags:** per-workspace check/set/list with 60s in-process cache ([582ce7c](https://github.com/lucasmailland/orchester/commit/582ce7c177b1fb0c0c45ba935c8b11f72129b676))
* **flow:** visual flow builder section with canvas mockup + 4 features ([81c7362](https://github.com/lucasmailland/orchester/commit/81c73624982262860dbc4e0d4a66a68b44300d1a))
* **gdpr:** abort export at 1GB threshold (prevent OOM) ([0ef9df3](https://github.com/lucasmailland/orchester/commit/0ef9df31fcdc9f5b145b55a78eba6b10f51307b7))
* **gdpr:** export job skeleton (worker + storage + email + endpoint) ([70f54eb](https://github.com/lucasmailland/orchester/commit/70f54ebabdbce2db9ae957c20d2e2f9fd5f284f1))
* **gdpr:** persist email send failures without failing the job ([6646b0e](https://github.com/lucasmailland/orchester/commit/6646b0ef756ad5c9bbbc8fdfc4d8ba81bb13a95d))
* **gdpr:** regenerate signed URL on-demand + HMAC token download route ([2ed20c4](https://github.com/lucasmailland/orchester/commit/2ed20c49eb0b77d8e9fc736f78da0bfda4b1c48b))
* **gdpr:** Resend email integration with stub fallback ([89c85f2](https://github.com/lucasmailland/orchester/commit/89c85f29a5f7027829d4cdf67f2355d7e85cd055))
* **gdpr:** storage adapter pattern (S3 + filesystem fallback) ([6394f9d](https://github.com/lucasmailland/orchester/commit/6394f9d3713fe1b0a77cb2c85ca92b16b28ab4f6))
* **gdpr:** streaming zip export with per-table exporters ([9c93703](https://github.com/lucasmailland/orchester/commit/9c9370369f966a312327b622b8c21be63abea43d))
* **gdpr:** watchdog cron flips stalled jobs to failed after 30m ([e31b04b](https://github.com/lucasmailland/orchester/commit/e31b04b6adca95719b899588e8445659863fcfeb))
* **hero:** replace three.js Wave with CSS Aurora — 4 drifting blobs + rotating conic halo ([65da60d](https://github.com/lucasmailland/orchester/commit/65da60dbe542fe6be337e5f546e9480a66edde60))
* **hero:** reuse NeuralBackground + AgentOrgChart from login screen ([8d49a56](https://github.com/lucasmailland/orchester/commit/8d49a566168b01a9746a580b1b2af8bc56cb666f))
* **hero:** split into 2-column layout — text left, chart right ([8cb4df3](https://github.com/lucasmailland/orchester/commit/8cb4df310c17bef676edc636f4d1f907a9bb4134))
* **hero:** swap Aurora for canvas wave background + drop redundant agent preview ([df8aa09](https://github.com/lucasmailland/orchester/commit/df8aa093f3466587f2017a8031c908440b331e9f))
* **how-it-works:** typewriter effect on code blocks with blinking caret ([5693531](https://github.com/lucasmailland/orchester/commit/56935314ca4099d6e1b87912263dd33112a3b53e))
* **i18n:** add marketing namespace to EN/ES/PT-BR ([bfa9a8d](https://github.com/lucasmailland/orchester/commit/bfa9a8db725534fefa685541dc3bd2ad8c4cf4d7))
* **i18n:** brain.* keys for Inspector (en + es + pt-BR) ([51d3053](https://github.com/lucasmailland/orchester/commit/51d3053edc907585899596da435152da98cf2e3b))
* **i18n:** end-to-end UI audit — every page, button & toast translated ([92f0f76](https://github.com/lucasmailland/orchester/commit/92f0f76d80ec85eaa6ff9d001e2d550cb40121f7))
* **i18n:** wave 2 — settings tabs, agent studio, flow builder all translated ([592e985](https://github.com/lucasmailland/orchester/commit/592e985d8bccf274ade8ab905771f9da8408e26a))
* **i18n:** workspace namespace (switcher, create, delete, restore, suspended, export, audit) ([e67063a](https://github.com/lucasmailland/orchester/commit/e67063a7459847e9637715df098fd167af885c13))
* landing page completa + i18n fix + workspaces dedup ([9a6ea30](https://github.com/lucasmailland/orchester/commit/9a6ea304408dc81c0954ba63ee5f8e8ec333a862))
* **llm-call:** make request timeouts configurable via env ([81f6aa3](https://github.com/lucasmailland/orchester/commit/81f6aa30e2e51374dc5cfeec21da2baff0ec24bd))
* **llm-call:** support provider-agnostic cache_control markers (Anthropic ephemeral cache) ([7403a49](https://github.com/lucasmailland/orchester/commit/7403a499cee78b345145510d0b5ae2e5929add65))
* **marketing:** 6-card bento features grid with hover gradients ([e0da1e0](https://github.com/lucasmailland/orchester/commit/e0da1e0eca22a6052f891dc16509db13803bf214))
* **marketing:** add (marketing) route group, remove locale root redirect ([a8393bc](https://github.com/lucasmailland/orchester/commit/a8393bc0e632bbf1cffcd3d2fddd97176f3a71a5))
* **marketing:** animated three.js Wave shader background in Hero ([ba240bb](https://github.com/lucasmailland/orchester/commit/ba240bb9087f69a7492d393dff793f42a36f0f88))
* **marketing:** assemble full landing — hero, stats, features, how-it-works, integrations, CTA ([c1dff9b](https://github.com/lucasmailland/orchester/commit/c1dff9bc571f30f1976f391b9bd9e5b9ce5d36c7))
* **marketing:** assemble new sections + i18n ([a9c4026](https://github.com/lucasmailland/orchester/commit/a9c4026cec2ef4f4f8cf6682d0ad59a4f1671524))
* **marketing:** ChannelsSection — orbital multi-channel display with animated connections ([34cdb21](https://github.com/lucasmailland/orchester/commit/34cdb21a1b21c7a4562b0879bd6a173f120dcdd0))
* **marketing:** FeaturesGrid — radial spotlight cursor effect on hover ([ef3c114](https://github.com/lucasmailland/orchester/commit/ef3c114572236e9909a9f0c97278b0f9749f88d8))
* **marketing:** Footer with link columns and i18n ([0669f51](https://github.com/lucasmailland/orchester/commit/0669f51a6e9d371375633a50b0bd49128c9c46b1))
* **marketing:** hero — animated beams traveling from Orchestrator to specialist agents ([2d16506](https://github.com/lucasmailland/orchester/commit/2d16506d39dd3206fe99b778c00781cad9202216))
* **marketing:** hero 2-col, navbar premium, testimonials, faq, audit polish ([18e3a3e](https://github.com/lucasmailland/orchester/commit/18e3a3e9ab71852635b173d4faa5613f2ba78497))
* **marketing:** hero section — animated badge, gradient headline, agent org preview ([6617a35](https://github.com/lucasmailland/orchester/commit/6617a356495cf1d8c5590b573ad48a529a5fd65a))
* **marketing:** how it works — 3 alternating steps with code windows ([7e6d78c](https://github.com/lucasmailland/orchester/commit/7e6d78c24b20d105350dbe9240bb34ea0b0b394c))
* **marketing:** integrations grid — 10 provider chips with stagger animation ([7da469c](https://github.com/lucasmailland/orchester/commit/7da469c47ce8871760aa0b6fa8bdffcac825859a))
* **marketing:** ModelMarquee — two-row infinite marquee of 23 AI providers ([ee83eb7](https://github.com/lucasmailland/orchester/commit/ee83eb7d0a5d24e047c11911ae9cdf5bc74a9793))
* **marketing:** open source CTA — GitHub star + self-host command ([09757be](https://github.com/lucasmailland/orchester/commit/09757be7cd0313e7fd2e0591f4ba39ceee0a5a49))
* **marketing:** premium hero polish with animations ([db9f691](https://github.com/lucasmailland/orchester/commit/db9f691f193090d01254db9cf15f39cea5953900))
* **marketing:** ProductShowcase bento grid with 6 real UI mockups ([7bd2287](https://github.com/lucasmailland/orchester/commit/7bd2287b674e71f671e2272396d86fb034b4b984))
* **marketing:** re-assemble landing with ChannelsSection + TechStackSection ([6f296a2](https://github.com/lucasmailland/orchester/commit/6f296a266bdf24c7bc8fc9173d04ea5f588a2fc6))
* **marketing:** rebuild narrative around teams, two patterns, brain, flow builder ([2ed57df](https://github.com/lucasmailland/orchester/commit/2ed57df80e629e75b7e1e78bd28bcbc3e7b96913))
* **marketing:** replace features grid with real Orchester capabilities ([e0fd6b4](https://github.com/lucasmailland/orchester/commit/e0fd6b4d86fe2dec85f7855aa07acb64399bf9cb))
* **marketing:** stats bar with live GitHub stars (1h cache) ([a39f4ac](https://github.com/lucasmailland/orchester/commit/a39f4ac18dbaa907728fc8408565d6f12a8afbf4))
* **marketing:** sticky Navbar with locale switcher, blur on scroll ([ce37ef2](https://github.com/lucasmailland/orchester/commit/ce37ef2b9434439e4a309103ded4abe6de02edaf))
* **marketing:** TechStackSection — pgvector, workers, webhooks, otel, RLS + terminal demo ([3c2446c](https://github.com/lucasmailland/orchester/commit/3c2446c8cdc164a609bf6140fcb54479ff106225))
* **mnemo+db:** Phase K — eliminar los 3 bloqueos externos (org, 0050, NOT NULL) ([5152e20](https://github.com/lucasmailland/orchester/commit/5152e209259cf8b0a6adb1e7508526bdb867bfa1))
* **mnemo:** add poisoning pattern catalogue ([cec4501](https://github.com/lucasmailland/orchester/commit/cec450124906c426867229dce16f8e63db402fa0))
* **mnemo:** composeBOM pure builder ([9f8d358](https://github.com/lucasmailland/orchester/commit/9f8d3584fb6fe8cbbabb9bd6cbf08fc42af60be8))
* **mnemo:** cross-workspace consolidation pure algorithm (Phase C) ([deb455b](https://github.com/lucasmailland/orchester/commit/deb455babf875702f8209898d36267c4953f4b3e))
* **mnemo:** cross-workspace org-consolidation worker scaffold (Phase E) ([6a49ff3](https://github.com/lucasmailland/orchester/commit/6a49ff3f836f353604655794bcaee0a93ca056e3))
* **mnemo:** Decision BOM type contract ([6b0f2a2](https://github.com/lucasmailland/orchester/commit/6b0f2a239499da84e7262807ae0410f5cdf3385a))
* **mnemo:** effectiveTrust pure helper ([c89be2f](https://github.com/lucasmailland/orchester/commit/c89be2f1e8bb21d9e0df807f54b8b96e78139003))
* **mnemo:** export poisoning detector from package root ([16cde4e](https://github.com/lucasmailland/orchester/commit/16cde4e0918cb794488a63f871a22e23b6a21337))
* **mnemo:** Inspector UI v2 — recall pipeline visualizer (Phase A) ([74aae5c](https://github.com/lucasmailland/orchester/commit/74aae5ccd389916b8c5f42eeda887bd513b1c781))
* **mnemo:** Mnemosyne v1.1 — batch S-tier + M-tier completo ([1d0d6db](https://github.com/lucasmailland/orchester/commit/1d0d6db42037a723f8d1e5a66ebf0fbc2d80a867))
* **mnemo:** Mnemosyne v1.1 — L-tier completo ([#6](https://github.com/lucasmailland/orchester/issues/6) [#13](https://github.com/lucasmailland/orchester/issues/13) [#22](https://github.com/lucasmailland/orchester/issues/22) [#26](https://github.com/lucasmailland/orchester/issues/26) [#27](https://github.com/lucasmailland/orchester/issues/27) [#29](https://github.com/lucasmailland/orchester/issues/29)) ([3dfea6e](https://github.com/lucasmailland/orchester/commit/3dfea6e0d8578118923d9ab980bc883e5e784925))
* **mnemo:** opt-in trust decay in rerank ([afcf764](https://github.com/lucasmailland/orchester/commit/afcf7643f47140f58e848bb2855a0b63bcb1d7eb))
* **mnemo:** per-stage recall telemetry callback (Foco 1) ([b198ce7](https://github.com/lucasmailland/orchester/commit/b198ce7b736e072360dd8a8412b1298a0e71bff0))
* **mnemo:** Phase A polish — audit log + rate-limiter extract + hot-path regression ([7be47ab](https://github.com/lucasmailland/orchester/commit/7be47ab267048924fcb6d558edd41d8202a20154))
* **mnemo:** Phase F — per-stage caps wired + protocol v2 guidance + synthetic episode ids ([a73e9cf](https://github.com/lucasmailland/orchester/commit/a73e9cffcdd7622f1c477c09af3e4c28deed3f3a))
* **mnemo:** Phase G+H+I — episodes first-class migration + cross-WS doc + [#5](https://github.com/lucasmailland/orchester/issues/5) [#9](https://github.com/lucasmailland/orchester/issues/9) opt-in ([9bc81fa](https://github.com/lucasmailland/orchester/commit/9bc81fa141ff665ddafa377a85e227b238be04bc))
* **mnemo:** Phase J — cierre completo (backfill + [#16](https://github.com/lucasmailland/orchester/issues/16) [#17](https://github.com/lucasmailland/orchester/issues/17) + episode coherence + protocol bump) ([50e9b97](https://github.com/lucasmailland/orchester/commit/50e9b97acbb29c001777f88fa1f93f8b780fb86e))
* **mnemo:** Phase L — cron wiring + cross-WS real body + admin REST + CHANGELOG v2 ([8517895](https://github.com/lucasmailland/orchester/commit/851789552c66463972df07a0b7bcc951538b7858))
* **mnemo:** PoisoningRejectedError + audit actions ([06a1d53](https://github.com/lucasmailland/orchester/commit/06a1d538031ef365bb24202c9722d4534185d496))
* **mnemo:** scanForPoisoning detector ([1c9c441](https://github.com/lucasmailland/orchester/commit/1c9c441858322e842dca3571b37a69a414293e89))
* **mnemosyne v1.2:** bitemporal asOf + memory drift detection + archive table ([77d839f](https://github.com/lucasmailland/orchester/commit/77d839fbf9cecc3e333beca826301e7428e68362))
* **mnemosyne v1.2:** janitor — semantic dedup + inactive pruning + crons ([26e632c](https://github.com/lucasmailland/orchester/commit/26e632c29e87b1932fc0950fcba298a2020be806))
* **mnemosyne/consolidation:** REM-style nightly cluster summarization ([69c674e](https://github.com/lucasmailland/orchester/commit/69c674ef2e34974a39a87c2cb8fe71da8e723777))
* **mnemosyne/entity:** primitive — CRUD + findOrCreate + heuristic+LLM extraction ([04fd769](https://github.com/lucasmailland/orchester/commit/04fd7695915db3763139c8c90f286050e37cb278))
* **mnemosyne/policy:** per-agent memory policy + apply helpers ([a5e4ec0](https://github.com/lucasmailland/orchester/commit/a5e4ec093fb965d7dec583dc640fc61a1066e9fb))
* **mnemosyne/protocol:** bump to v1.2 — entity awareness + per-user privacy ([6256e5f](https://github.com/lucasmailland/orchester/commit/6256e5fe00b708d42919653dbf6c5a635dda19fd))
* **mnemosyne/protocol:** tighten Memory Protocol to v1.1 (~80 tokens, was ~300) ([36b3d3e](https://github.com/lucasmailland/orchester/commit/36b3d3e7e6a676f09965239a125be1f485684aca))
* **mnemosyne/recall:** compact structured fact rendering for prompt injection ([f0a2aca](https://github.com/lucasmailland/orchester/commit/f0a2aca4affd2e54009cd63f04524609cac18abd))
* **mnemosyne/recall:** cross-encoder reranking pass (Cohere optional, agnostic fallback) ([4a4cd16](https://github.com/lucasmailland/orchester/commit/4a4cd16c67c5fd0e3f875969318554d9443f4854))
* **mnemosyne/recall:** graph traversal — expandGraph option for 1-hop relation expansion ([7bd4ff6](https://github.com/lucasmailland/orchester/commit/7bd4ff62f737600b4e303fafd9af0afe2de5cacb))
* **mnemosyne/recall:** memoryTypes filter on searchMnemo ([af65f4c](https://github.com/lucasmailland/orchester/commit/af65f4c00efe665a1c82d9cfc8b937897b2f16e9))
* **mnemosyne/recall:** post-recall pruning + hard cap top-3 (anti-bloat) ([faa6bbd](https://github.com/lucasmailland/orchester/commit/faa6bbd7b3578d889726e3f03ff8ef068068aaff))
* **mnemosyne/recall:** query contextualization + HyDE (fixes query-fact embedding mismatch) ([65654ae](https://github.com/lucasmailland/orchester/commit/65654aef9e947badea22311f1edc1f31d697cc72))
* **mnemosyne/recall:** shouldTriggerRecall — heuristic classifier for smart triggering ([caa800a](https://github.com/lucasmailland/orchester/commit/caa800a35e4dc0bbb82ca0676eaf9b429aa8c60f))
* **mnemosyne/recall:** unified recall (KB + Memory) + actorId filter ([b878991](https://github.com/lucasmailland/orchester/commit/b8789913b7569727fa3ffcae13f71b640209ca23))
* **mnemosyne/review:** enqueueReview helper + wire into saveFactWithCandidates ([0a76bcb](https://github.com/lucasmailland/orchester/commit/0a76bcb12518b74b320cb9c695739179be3dbe63))
* **mnemosyne/summary:** getOrComputeSummary + heuristic fallback ([6801311](https://github.com/lucasmailland/orchester/commit/68013114ddfda74a5cd31c2812213e3c4b6c4e47))
* **mnemosyne/tx:** withMnemoTx accepts actorId + enforceActorIsolation ([4d4a4b9](https://github.com/lucasmailland/orchester/commit/4d4a4b9297796cd1fd8357cc65f45fbb5ea7ae53))
* **mnemosyne:** A1 — heuristic pre-filter saves 80% of LLM calls ([152a334](https://github.com/lucasmailland/orchester/commit/152a3349231e8191d94ea0366f94a034e48b6722))
* **mnemosyne:** A7 L1 recall cache + workspace invalidation ([04608f6](https://github.com/lucasmailland/orchester/commit/04608f65ed0dadb45e20269477496f9ee7a8ab91))
* **mnemosyne:** adapter interface — provider capability detection (A2) ([16f7d1e](https://github.com/lucasmailland/orchester/commit/16f7d1e6107250f3856cc2121dd3c91e16d85753))
* **mnemosyne:** candidate-on-write loop for decision save (Task 2.7) ([2aaa03d](https://github.com/lucasmailland/orchester/commit/2aaa03d8ebaeb65da13cfc73562eb3355d391d8c))
* **mnemosyne:** citation/store CRUD ([f013027](https://github.com/lucasmailland/orchester/commit/f0130277ce2bc11c9fd4b702cffbd4a960c5980a))
* **mnemosyne:** createFactAsync — defer embedding to batch worker ([27c912b](https://github.com/lucasmailland/orchester/commit/27c912b8ae675508c6b202196d6635a8efd5f8b6))
* **mnemosyne:** episode CRUD + timeline queries ([e508d00](https://github.com/lucasmailland/orchester/commit/e508d00bc4db31c29092df086e4d4607e10e88cc))
* **mnemosyne:** graph/relation CRUD + judge (Task 2.6) ([622d1e9](https://github.com/lucasmailland/orchester/commit/622d1e9b79f86ee371601c293e36da0920e79a7d))
* **mnemosyne:** graph/verbs — 9 locked relation verbs (Task 2.5) ([dadf748](https://github.com/lucasmailland/orchester/commit/dadf7483b63cb1fb66110066119538a432b908be))
* **mnemosyne:** hybrid recall search over mnemo_fact (spec §5) ([f5e01ba](https://github.com/lucasmailland/orchester/commit/f5e01ba69d174596f26dad7423c62646e6088ea4))
* **mnemosyne:** JOB_MNEMO_EXTRACT queue constant ([f51fd20](https://github.com/lucasmailland/orchester/commit/f51fd205b304af1115cfd2e508bc26d6008f3707))
* **mnemosyne:** L3 query cache write-through with 0.95 cosine lookup + 5min TTL ([1e35ea0](https://github.com/lucasmailland/orchester/commit/1e35ea06b6bcf9d37f2fa6712ef767c7a1b3f671))
* **mnemosyne:** Memory Protocol v1 artifact (frozen, version-locked) ([85d6842](https://github.com/lucasmailland/orchester/commit/85d684288e004568644dc118969bf7cab22e1977))
* **mnemosyne:** modes/detect — A/B/C mode resolution ([16bd3f3](https://github.com/lucasmailland/orchester/commit/16bd3f3d1bce724d76b94b00be3790e432103cea))
* **mnemosyne:** pii detection (regex layer) — email/phone/CC/SSN/API key/IP/URL token ([5cb392d](https://github.com/lucasmailland/orchester/commit/5cb392d0a6e40a1b386eaa9e30c7d7bdb8b02734))
* **mnemosyne:** pii redact policy ([96f6b83](https://github.com/lucasmailland/orchester/commit/96f6b83b60c37e580d2d003e0678483e99b7eed9))
* **mnemosyne:** port embed wrapper with workspace-keyed cache ([cc42675](https://github.com/lucasmailland/orchester/commit/cc426756308fc7ea4bd24a5dd402241d28482520))
* **mnemosyne:** port withMnemoTx wrapper from brain core ([eda227d](https://github.com/lucasmailland/orchester/commit/eda227da0204c0e4b39f8fd116eb616a46d117d5))
* **mnemosyne:** primitives/decision with topic-key upsert (Task 2.3) ([205aade](https://github.com/lucasmailland/orchester/commit/205aade454b940e76b8fe33a735281e4fd683d41))
* **mnemosyne:** primitives/fact CRUD ([a7c7115](https://github.com/lucasmailland/orchester/commit/a7c711517393e18a9245c57571889cd16b64a393))
* **mnemosyne:** provider health tracker + health-based mode detection ([3f40d38](https://github.com/lucasmailland/orchester/commit/3f40d38c2ca0249c6251ca4cf8996b732d27d602))
* **mnemosyne:** saveFactWithCandidates — contradiction detection on fact writes ([5be5380](https://github.com/lucasmailland/orchester/commit/5be53804627ecdd3a512bc58ff2812286d5d7e94))
* **mnemosyne:** scaffold @orchester/mnemosyne package ([4b966ad](https://github.com/lucasmailland/orchester/commit/4b966ad0c424debcdc0bb3371239f3384d5d13df))
* **mnemosyne:** SET LOCAL ROLE app_user in withMnemoTx — fixes P0 audit finding (RLS theatre) ([f7b0280](https://github.com/lucasmailland/orchester/commit/f7b02801e342364bec1b27902207598a3468f436))
* **mnemosyne:** theory-of-mind attribution field — user_stated/user_belief/objective_fact/inferred ([3f3801f](https://github.com/lucasmailland/orchester/commit/3f3801fcc2eb64079652fa30549d28dbb2f2d6e8))
* **mnemosyne:** wire PII detection + redaction into createFact ([577ddc2](https://github.com/lucasmailland/orchester/commit/577ddc24f7288be81939f4a6a2f0a2ac3339f9b8))
* **mnemo:** v2 partials — rerank-as-default + trust ladder + per-stage caps (Phase B) ([9d19d8a](https://github.com/lucasmailland/orchester/commit/9d19d8a6aef30051653220ca45747541ca94c6c2))
* **mnemo:** wire poisoning gate into createFact ([94afceb](https://github.com/lucasmailland/orchester/commit/94afceb10a21c41766428d893f1d9b562d8633e7))
* **nav:** remove Pricing link from Navbar and Footer ([ca5e4c8](https://github.com/lucasmailland/orchester/commit/ca5e4c8965712e01812c18931c950e84710cfd34))
* **patterns:** two-patterns section — Prompt+Tools vs Visual Flow ([58aaca5](https://github.com/lucasmailland/orchester/commit/58aaca59e792407cfdcab43a171370b04fb63286))
* **phase-F:** tenant correctness + GDPR streaming + secret scrubber ([898787f](https://github.com/lucasmailland/orchester/commit/898787fdb96cfeeeb3e6cd2abf009c549d3e373f))
* **problem:** why teams section — single agent vs team comparison + 3 pain points ([342fcab](https://github.com/lucasmailland/orchester/commit/342fcab4c7819bbd01c6ac26c66a9d94a8a9f057))
* **rbac:** add mnemo.read/write/admin actions ([1e3b048](https://github.com/lucasmailland/orchester/commit/1e3b0484d19a3a953376692552edf2e92229a320))
* **rbac:** introduce assertSystemAdmin via ADMIN_EMAILS env ([33ff673](https://github.com/lucasmailland/orchester/commit/33ff673716831dc88bfdec5e9042d7e2aa174623))
* **readme+hero:** quotable opening + real studio screenshot + try-in-30s ([99da142](https://github.com/lucasmailland/orchester/commit/99da1423407543d607f65acd1a09a3c193fca6b3))
* **readme+problem:** editorial polish + Teams/Two-Patterns/Brain narrative ([069066a](https://github.com/lucasmailland/orchester/commit/069066abaa2ded1d600c86a35c447623d0ba593b))
* **security:** HMAC-sign active-workspace cookie ([af23dc3](https://github.com/lucasmailland/orchester/commit/af23dc38e187eff07aba1f803dc0eadbd42edd79))
* **seed:** massively enrich demo data + add real-LLM backfill scripts ([26ec3fe](https://github.com/lucasmailland/orchester/commit/26ec3feb3c555d8c420c1c66f11d087223356341))
* **settings-ui:** Recall quality section + Premium embedding selector ([51b995f](https://github.com/lucasmailland/orchester/commit/51b995f351bcd75cb5c52afe97589289a398b1dd))
* **settings:** Memory operations panel — manual cron triggers ([4a25063](https://github.com/lucasmailland/orchester/commit/4a250639c87ccdf4a7e2e24915770deed53a85fc))
* **settings:** mnemo.disable_* kill-switches + premium embedding workspace settings ([e4e5c90](https://github.com/lucasmailland/orchester/commit/e4e5c90c06727b4021be159d56d1de39d6b4292d))
* **shell:** account dropdown + Conversations HeroUI Select polish ([a9f93f2](https://github.com/lucasmailland/orchester/commit/a9f93f2e478baa51659d64bc7b154c2892a52645))
* **showcase:** redesign OrgMockup tree + ConvsMockup bubbles — avatars, live pulses, gradient edges ([b83f9b1](https://github.com/lucasmailland/orchester/commit/b83f9b1de35898fbc88176884b9aca5b7b90d20c))
* **stats:** animated counters — numbers count up from 0 on scroll into view ([905d462](https://github.com/lucasmailland/orchester/commit/905d462228e91850d9fcbb1d8243cf1a466c5ee6))
* **tenant:** admin endpoint to read context telemetry counters ([47d7d20](https://github.com/lucasmailland/orchester/commit/47d7d20c7a220624171f50b06269f12676be7bf2))
* **tenant:** broadcast invalidation from resolve/membership/feature-flag caches ([29139e6](https://github.com/lucasmailland/orchester/commit/29139e64af6e6c664a4d603ada8a6798977055ad))
* **tenant:** cluster-wide cache invalidation via Postgres LISTEN/NOTIFY ([105f075](https://github.com/lucasmailland/orchester/commit/105f0751c1dcbb0d1135e995ee9383c50620fd80))
* **tenant:** daily hard-delete cron (workspaces past 30d window) ([e7f88c3](https://github.com/lucasmailland/orchester/commit/e7f88c3dc74584a0a69f2b289068908742c6aea6))
* **tenant:** lifecycle softDelete/restore/suspend/unsuspend + audit ([cde1ca2](https://github.com/lucasmailland/orchester/commit/cde1ca2643d8a0a2b3a4c7460af15e0851521deb))
* **tenant:** membership check with 60s in-process cache ([5cb4aab](https://github.com/lucasmailland/orchester/commit/5cb4aab31c63aaaa02356ded3410beab85f973d0))
* **tenant:** merge tenant-hardening-v1.3 (sub-spec 1) ([9378774](https://github.com/lucasmailland/orchester/commit/937877407f24eb8573e359b92c7171b7ffd8cec3))
* **tenant:** middleware sets app.workspace_id + telemetry counters (Phase B) ([d05b11b](https://github.com/lucasmailland/orchester/commit/d05b11b0108851c89bcfcca1637b25ed3b8cdd5c))
* **tenant:** SET LOCAL ROLE app_user in withBrainTx and withTenantContext ([d2f7549](https://github.com/lucasmailland/orchester/commit/d2f7549bb3a65fb0044a75c55a02eb8d37cc1783))
* **tenant:** slug/id resolver with LRU cache (5min TTL) ([63272d0](https://github.com/lucasmailland/orchester/commit/63272d0f817c6d233cf0cc2ce638f909d4cc82a8))
* **tenant:** tenantQuery typed helper for safe-by-default queries ([a31c139](https://github.com/lucasmailland/orchester/commit/a31c139e35bdf0fa248e652c41d42310b6886f3f))
* **tenant:** types module + barrel export (modules to follow) ([f49b115](https://github.com/lucasmailland/orchester/commit/f49b115874074012af30e66de3e912de50aefa81))
* **tenant:** withCrossTenantAdmin wrapper for cron workers with bypass logging ([08e0d93](https://github.com/lucasmailland/orchester/commit/08e0d932db9ba2ddb1a39b44c5c4ddd173c8b11c))
* **tenant:** withTenantContext wrapper + requireAction guard ([81e57a6](https://github.com/lucasmailland/orchester/commit/81e57a683f7c2f2bb0825150b6719dd2b7f7338e))
* **testimonials:** community quotes section (3-card grid) ([4f5cf97](https://github.com/lucasmailland/orchester/commit/4f5cf97a72bd0e776fe278354225873de01f8957))
* **v1.0:** J.1 Sentry + H perf wins + L.2 demo seed + Mnemo v2 plan + 2 deep audits ([e0cc2a7](https://github.com/lucasmailland/orchester/commit/e0cc2a70c4f30418495f498300342d6e3490512e))
* **v1.0:** L.1 onboarding + M.2 a11y P0 fixes + I.1 docker hardening ([a82628a](https://github.com/lucasmailland/orchester/commit/a82628a82724f7728f86504152791bde08535713))
* **worker/embed-batch:** group by tier — one batched API call per tier per workspace ([f6476ea](https://github.com/lucasmailland/orchester/commit/f6476ea07c09f4b18744869c12b2ae67ad20ae48))
* **worker:** consolidation-job — weekly cluster + summarize cron ([d4828ba](https://github.com/lucasmailland/orchester/commit/d4828ba832b9a4085b5fc5ffdf158c06637ee334))
* **worker:** embed-batch-job — batched embedding for cost efficiency ([3478edd](https://github.com/lucasmailland/orchester/commit/3478eddff58f8051a134bee2425b248093364dc5))
* **worker:** embed-batch-job — handler source + contract test ([37c78bc](https://github.com/lucasmailland/orchester/commit/37c78bc0dc9bc4f744d88755f7ed63119d3eda11))
* **worker:** review-sweep-job + auto-pin-job — daily crons ([a4a13a5](https://github.com/lucasmailland/orchester/commit/a4a13a53090c538f19d6b2cfbbd0cc39e74892be))
* **worker:** summary-job — daily distillation cron ([feb54d2](https://github.com/lucasmailland/orchester/commit/feb54d249dde41ead8f80493764f2b3d240f1b63))
* **workspace:** /workspaces list page for no-context landing ([2b64bfa](https://github.com/lucasmailland/orchester/commit/2b64bfa090d295acb115076ed6903d36325a77d5))
* **workspace:** audit member.role_change + member.remove + invalidate cache ([3dd74f4](https://github.com/lucasmailland/orchester/commit/3dd74f49b72ad87a2e7a330ee68c37867ebe07f2))
* **workspace:** create workspace modal + POST /api/workspaces ([3d15517](https://github.com/lucasmailland/orchester/commit/3d15517bf5e8f9bc299e68034400d8777796f219))
* **workspace:** deleted-workspace restore page + card ([a50a697](https://github.com/lucasmailland/orchester/commit/a50a697fe367cfdf12a2c863008eefc5f72ec1d5))
* **workspace:** feature-flags + transfer + active-workspace endpoints ([a7bf01d](https://github.com/lucasmailland/orchester/commit/a7bf01de028eb34ff7a7b314c8b592654b0436ea))
* **workspace:** GDPR export progress toast (global, polls job status) ([588c300](https://github.com/lucasmailland/orchester/commit/588c3000c553d4276ccd1bf1b0e3a8b2cc49ebe1))
* **workspace:** GET /api/me/workspaces + useMyWorkspaces hook ([9dacfe9](https://github.com/lucasmailland/orchester/commit/9dacfe9f8259f01f5fc0487ce1adc7ae768134d2))
* **workspace:** GET /export/[jobId] for status polling ([bc5bd87](https://github.com/lucasmailland/orchester/commit/bc5bd87926805a7ac6083d9c391e6c583fb2f5a1))
* **workspace:** GET/PATCH/DELETE /api/workspaces/[slug] with confirm_slug + audit ([fd44039](https://github.com/lucasmailland/orchester/commit/fd44039743b108313a8a9f1f026ed05f3f6509f8))
* **workspace:** middleware extracts slug + 301-redirects legacy URLs ([77beabe](https://github.com/lucasmailland/orchester/commit/77beabe570217c3746a32345e755ddccab9e8f1e))
* **workspace:** POST /api/workspaces/[slug]/restore (token or owner) ([02d3424](https://github.com/lucasmailland/orchester/commit/02d3424fda951a938c3586b9eff2d58ba97027b0))
* **workspace:** POST/DELETE /[slug]/suspend (system-admin only) ([968334c](https://github.com/lucasmailland/orchester/commit/968334ce211171975458486721bb4d5211eb99cf))
* **workspace:** revoke previous-owner sessions on transfer ([84eb90e](https://github.com/lucasmailland/orchester/commit/84eb90e467fd8bba45f58ec9a9aa7c4e0ddeb5cb))
* **workspace:** suspended banner + soft-delete + audit viewer + flag panel ([7c704a8](https://github.com/lucasmailland/orchester/commit/7c704a861e5aa713087e1f39d860e6e87fc4a21f))
* **workspace:** sweep internal links to include workspaceSlug ([5a736b8](https://github.com/lucasmailland/orchester/commit/5a736b8698b3677f775cf44cd4091cadde01ff52))
* **workspace:** switcher topbar + menu + ⌘K shortcut ([20dc7ce](https://github.com/lucasmailland/orchester/commit/20dc7ce43aaa54edf2059c40ac669dc9c513ad16))
* **workspace:** transfer ownership modal (wired into danger zone) ([2cd7837](https://github.com/lucasmailland/orchester/commit/2cd78379c845b260be33207d7228e55e99a46322))


### Fixed

* **api-auth:** authenticateApiKey opts into cross-tenant bypass for SELECT ([ccd8035](https://github.com/lucasmailland/orchester/commit/ccd8035aa1b61b93c3c6cb1faf635c8a358c962a))
* **api-auth:** log lastUsedAt update failures instead of swallowing ([c78533a](https://github.com/lucasmailland/orchester/commit/c78533a599974068386720620f5bf3391d812219))
* **api:** set workspace GUC in 11 routes touching FORCED/RLS tables (round 2) ([d1022e9](https://github.com/lucasmailland/orchester/commit/d1022e97d489d34c8a65fa0c5abdeb86a573301b))
* **api:** set workspace GUC in 24 routes broken by RLS FORCE ([1babe3f](https://github.com/lucasmailland/orchester/commit/1babe3f663159cdfa95112c31082ef547d1c5ff8))
* **api:** wrap unauthenticated webhooks in withCrossTenantAdmin ([aa5f3ad](https://github.com/lucasmailland/orchester/commit/aa5f3ad6597dc459ffcdf8fba29a00583d046f23))
* **audit:** explicit chain rotation past legacy bootstrap row instead of silent reset ([964ed37](https://github.com/lucasmailland/orchester/commit/964ed374f9e8e23fef654387c86f7334d490ecc1))
* **audit:** pass tx into verifyChain for cron callers (consistent role bypass) ([9eb4f31](https://github.com/lucasmailland/orchester/commit/9eb4f31cf72770ffb9bfb582b9469a1b8158a369))
* **audit:** use appendAuditSync for workspace.create genesis (never lose chain root) ([30f9f09](https://github.com/lucasmailland/orchester/commit/30f9f094084cf6f7a93ae8683ce29e02190ff3e6))
* **audit:** verifyChain skips legacy.* rows when computing hash chain ([19a27f5](https://github.com/lucasmailland/orchester/commit/19a27f538ccfdba4bc53d38680f3ff237321e996))
* **brain-api:** parameterize minRole + clarify audit fire-and-forget ([7723679](https://github.com/lucasmailland/orchester/commit/7723679d63a695f3a617c3e931bd305f54752f6c))
* **brain:** apply audit FIX-001 — drop hardcoded claude-haiku-4-5 default in extract.ts ([94c9a68](https://github.com/lucasmailland/orchester/commit/94c9a68a9f72b4649ef615ef5b2d6be7075c6e5c))
* **brain:** apply audit FIX-002/003/005 — drop embed defaults, Mode A short-circuit ([122a559](https://github.com/lucasmailland/orchester/commit/122a559e91c64313b406a6e8119bba68d6ff42a1))
* **brain:** apply audit FIX-004 — comment cleanup in extract.ts header ([fb74ac7](https://github.com/lucasmailland/orchester/commit/fb74ac7723c99b309bf5355ecf2b012f41c016fc))
* **brain:** apply audit FIX-006 — Mode A FTS fallback in searchBrain ([3a1a0de](https://github.com/lucasmailland/orchester/commit/3a1a0debc037f26206229fd8c1746ca329f68eae))
* **brain:** apply audit FIX-007 — Mode A createFact persists NULL embedding ([4fb6526](https://github.com/lucasmailland/orchester/commit/4fb6526e37fd00dd6c7b28628b9cad67a39ce7c2))
* **brain:** apply audit FIX-008 — Mode A updateFact skips re-embed ([7a793bd](https://github.com/lucasmailland/orchester/commit/7a793bda5a0440438190277238f14dfa06d05212))
* **brain:** apply audit FIX-009 — Mode A skips extraction job formally ([1991320](https://github.com/lucasmailland/orchester/commit/19913208d387a77c8ede0c80aad6a21d5226a297))
* **brain:** cierra wires huérfanos del Memory Inspector — undo endpoint + nav buttons ([8fea670](https://github.com/lucasmailland/orchester/commit/8fea670748766a13bc85f5d07900fe6035c4cd7b))
* **brain:** close all v1.6 UI audit findings — 8 bugs, 6 surfaces unblocked ([cdc75e3](https://github.com/lucasmailland/orchester/commit/cdc75e35bf6e1a1cc933048076c4abc7ee3398ec))
* **brain:** close audit-invariant gap in extract.ts + zod v4 migration ([903794d](https://github.com/lucasmailland/orchester/commit/903794df434d85eb70958f74a9797067db7b92a2))
* **brain:** correctness pass from review agent ([9b16660](https://github.com/lucasmailland/orchester/commit/9b16660c7c51d45f394a01bf4d4b5479c905ebd0))
* **brain:** normalise hook → API contracts so Inspector renders ([81d2f52](https://github.com/lucasmailland/orchester/commit/81d2f520a1eaa7857ec1adabd33178d27471447c))
* **channels:** re-check workspace accessibility between resolve and persist ([e5fa10e](https://github.com/lucasmailland/orchester/commit/e5fa10e52295e816c81526bdccda4613e2fb71d9))
* **cost-alerts:** fail-closed on permission errors, fail-open only on network errors ([f7ee11a](https://github.com/lucasmailland/orchester/commit/f7ee11a96093bd1ecddb6c93ce6514d61dc41403))
* **db:** add RLS policies to 10 unprotected tenant tables (audit gap) ([662e254](https://github.com/lucasmailland/orchester/commit/662e25459ddc00a9fb19f1e8ad8a218d8c8fc031))
* **db:** drop explicit BEGIN/COMMIT from brain_core migration ([a0a192f](https://github.com/lucasmailland/orchester/commit/a0a192f8baadfb6fa771ab3cdaeeec24d12103c9))
* **db:** enable RLS on audit_log_legacy + flow_template + fix workspace_member_select ([949a535](https://github.com/lucasmailland/orchester/commit/949a535e9f0910c9abbae0a62c436a8c89fe3175))
* **db:** replace owner CHECK constraint with deferred trigger validating membership ([809ea6f](https://github.com/lucasmailland/orchester/commit/809ea6f978eae4a94af26e76b6063d08795b8a3f))
* **db:** scope workspace_member_select policy to current workspace GUC ([3e74feb](https://github.com/lucasmailland/orchester/commit/3e74feb8d9215b77f890cb143205528092764b3a))
* **db:** use drizzle 0.45 array-based pgTable extraConfig (deprecation cleanup) ([f2d7684](https://github.com/lucasmailland/orchester/commit/f2d7684cf78ea6d058f1400b478c584e2ae650b1))
* **db:** use drizzle 0.45 array-based pgTable extraConfig (notificationPrefs) ([88d1a86](https://github.com/lucasmailland/orchester/commit/88d1a8621622e6caaca7193a3717aa0fe23898c5))
* **db:** workspace-scope idempotency_key primary key (cross-tenant collision) ([f9badf3](https://github.com/lucasmailland/orchester/commit/f9badf37d37962d760e5fe289ad4dee096a01066))
* **deploy:** point production DATABASE_URL at app_user (audit P1) ([cca601f](https://github.com/lucasmailland/orchester/commit/cca601fb23b9b1eab2f8f48c0ad4b29f3fa75d1c))
* **dev:** clean professional config — no webpack hacks, no stale workarounds ([53f612f](https://github.com/lucasmailland/orchester/commit/53f612ffd02276d8154e740f5021327514ea6c0b))
* **flows:** include workspaceSlug in flow card click handler ([d4d7eac](https://github.com/lucasmailland/orchester/commit/d4d7eacd1ab984cd1e856a23e5d4c7776bf2a1de))
* **gdpr:** log original error before state-update fallback ([7930e74](https://github.com/lucasmailland/orchester/commit/7930e746f9cefe38cc4bb02e8a66c3d6bcc52982))
* **hero:** headline size + word-spacing — words no longer collide, grid balanced ([2958a48](https://github.com/lucasmailland/orchester/commit/2958a48128ca58ed72770fa7ed6cc6c849929727))
* **i18n:** final closeout — landing, legal, billing, invite email ([5933083](https://github.com/lucasmailland/orchester/commit/5933083adc018d7b49d854af4ccc83e2082e356c))
* **i18n:** finish ConnectProviderModal English pass ([d944075](https://github.com/lucasmailland/orchester/commit/d9440757336cb95df4a1a976800f4d78e0f082e7))
* **i18n:** hard-coded Spanish in shared UI surfaces ([ed41d3b](https://github.com/lucasmailland/orchester/commit/ed41d3b6bfbcfe73f8cfc03853bbf6ce3c136dbd))
* **i18n:** translate hardcoded auth layout strings in EN/ES/PT-BR ([dbb88e8](https://github.com/lucasmailland/orchester/commit/dbb88e877da1bc41850e7af03fa8f9820cc128ea))
* **i18n:** translate more user-facing Spanish leaks ([9852b81](https://github.com/lucasmailland/orchester/commit/9852b81c04059917e689d559008bb07d12307504))
* **integrations:** translate connector catalog from Spanish to English ([f4bd55f](https://github.com/lucasmailland/orchester/commit/f4bd55fb4071a8ea88d2fd096e9e292c01788615))
* **marketing:** remove unused 'my' var in ProductShowcase flow edges ([ea7a246](https://github.com/lucasmailland/orchester/commit/ea7a24625bddf2c3b8a98a7bdc56053a45357d53))
* **marketing:** replace deprecated Github lucide icon with inline SVG ([45ec9d6](https://github.com/lucasmailland/orchester/commit/45ec9d6e01f8fe5a3ba93dea4783433398d53cd5))
* **mcp:** translate remaining Spanish error strings in JSON-RPC layer ([9176874](https://github.com/lucasmailland/orchester/commit/9176874da66080327be4bc136f7db0a118320471))
* **mnemosyne:** clean up package typecheck + drop next.js coupling ([3600d50](https://github.com/lucasmailland/orchester/commit/3600d50d2b4f4cf57346a256102114c13415154d))
* **mnemosyne:** correct package.json exports map — remove dead ./schema and ./tools entries ([149a1d5](https://github.com/lucasmailland/orchester/commit/149a1d5eded97aefef205f9d40a28f702d669952))
* **mnemosyne:** export withMnemoTx from package barrel ([a9033cb](https://github.com/lucasmailland/orchester/commit/a9033cbc08739cdb489b7a276670f930bfad5dfb))
* **mnemosyne:** set ignoreDeprecations="5.0" to clean tsc EXIT (was =2 from baseUrl notice) ([e3d252f](https://github.com/lucasmailland/orchester/commit/e3d252fcd111170a303f0848583849622fd6fd0c))
* **mnemosyne:** set rootDir=monorepo + ignoreDeprecations=6.0 — tsc clean EXIT=0 ([ec28aa6](https://github.com/lucasmailland/orchester/commit/ec28aa6631db598dee84dcb78f51208fe5f93a13))
* **org-chart:** wrap teams into multiple rows when total width exceeds canvas ([0deab39](https://github.com/lucasmailland/orchester/commit/0deab391765e96c0fcf9b14f750dbd414ec87e4a))
* **queue:** disable retry + expiry on scheduled crons (worker audit C1+C4) ([25642a5](https://github.com/lucasmailland/orchester/commit/25642a5c616bd2c3c67e2eaa8c82266f457b8290))
* **queue:** pg-boss createQueue deadlock — boot-time pre-create + retry-on-deadlock ([405dede](https://github.com/lucasmailland/orchester/commit/405dede31101fcde86c11432a3ca9208ed44cf5e))
* **seed:** stop seeding fake-ready KB docs + add backfill helper ([6eb02c4](https://github.com/lucasmailland/orchester/commit/6eb02c44ad514ab90e6306f89dd7b8c80a77c1ee))
* **settings:** GeneralSection Save uses workspace.slug, not id ([4e97942](https://github.com/lucasmailland/orchester/commit/4e97942a2984d977a1d9f87c5f6e69bc218f8bde))
* **settings:** Toggle knob escapes the track on Notifications ([f4b18ef](https://github.com/lucasmailland/orchester/commit/f4b18ef0a8b81ee9e8601c749b81280f2481180c))
* **shell:** defer HeroUI Select/Dropdown mount past hydration ([90136b1](https://github.com/lucasmailland/orchester/commit/90136b1ab50d5bc0ee07903aed65f391da7d8cd2))
* **tenant:** hard-delete cron re-checks status under advisory lock ([4887b87](https://github.com/lucasmailland/orchester/commit/4887b87dc275c48656f8620b8aa95b2638a77194))
* **tenant:** suspend/unsuspend assert current status (no silent strand) ([6a9df29](https://github.com/lucasmailland/orchester/commit/6a9df295f7e137561d5387690b0dc0154bdbf5ca))
* **tenant:** timing-safe restore-token comparison ([b5e20ce](https://github.com/lucasmailland/orchester/commit/b5e20ce4dd990f3de6a4090565d0b88d8ae14675))
* **test-fixtures:** cast at migrate() boundary to bridge drizzle peer variants ([6130b5b](https://github.com/lucasmailland/orchester/commit/6130b5bea2990303b2e84718feb858985d1c7487))
* **ui:** five hydration / ICU / surrogate bugs surfaced by full audit pass ([69e4c9b](https://github.com/lucasmailland/orchester/commit/69e4c9b2a8d693e32dfbfc7ae7b46890576e42d9))
* **ui:** UserMenu + RecallQualitySection hydration; nudge i18n loader ([5e32391](https://github.com/lucasmailland/orchester/commit/5e32391e843a546054e3bc953c69280eeb2e97f7))
* **validation:** treat empty body as {} so empty-schema routes work ([e34e7d8](https://github.com/lucasmailland/orchester/commit/e34e7d8807aabc7fa9ec60c1f0e655ea5a2a5fd1))
* **web:** zero ESLint + TypeScript warnings across the app ([ea5f2a7](https://github.com/lucasmailland/orchester/commit/ea5f2a70627235cb475498f6bfec46c0c185faf1))
* **workspace:** GdprExportProgress persists {slug, jobId} together ([19f22fa](https://github.com/lucasmailland/orchester/commit/19f22fab9497bfa055aa0e9f01b543552e7224d0))
* **workspace:** preserve only top-level section when switching workspaces (drop tenant-scoped IDs) ([0597515](https://github.com/lucasmailland/orchester/commit/0597515354853232e45725615178638c8b801a3c))
* **workspace:** prevent out-of-order optimistic toggles in FeatureFlagAdminPanel ([c40a04e](https://github.com/lucasmailland/orchester/commit/c40a04e2a60664bc4fc61142a148253e71737fef))
* **workspaces:** atomic audit + sync append on transfer, log session revoke error ([da18159](https://github.com/lucasmailland/orchester/commit/da181590b5c1a8c24062f0d3fe0bd25c9271d88b))
* **workspaces:** block [slug]/* on suspended/deleted ([3260424](https://github.com/lucasmailland/orchester/commit/3260424414e19aeac7c2b188de4a957c8a56c362))
* **workspaces:** collapse restore pre-auth to single 403 ([1472659](https://github.com/lucasmailland/orchester/commit/1472659e5c138345f2e7d64f6ebe56ee9ab5d3c3))
* **workspaces:** deduplicate workspace rows to prevent duplicate React key warning ([24dd3ab](https://github.com/lucasmailland/orchester/commit/24dd3ab2cf18ed1aa5b7a6f67bc5e40310b8805c))
* **workspace:** set GUCs per-transaction not session ([11b0054](https://github.com/lucasmailland/orchester/commit/11b005429aa467bbe81552848451a18342ebe4bc))
* **workspaces:** rate-limit transfer password retry + audit denials ([2e71d52](https://github.com/lucasmailland/orchester/commit/2e71d52ae211474b2a9d4246eb91ea97bdbefd41))
* **workspaces:** trace unsuspend-on-active before lifecycle throw ([490a8d8](https://github.com/lucasmailland/orchester/commit/490a8d838302badfc69215a1a6d0a78b6ac411dc))
* **workspace:** surface error + validate cursor in AuditLogViewer ([af2f91f](https://github.com/lucasmailland/orchester/commit/af2f91fff12ea46fc2c128031d23f52f990bc434))
* **workspaces:** wrap POST in tx so member row is atomic ([0204828](https://github.com/lucasmailland/orchester/commit/020482841e45352f155e8da503cf2377b8afab48))
* **workspace:** trim slug confirmation in delete modal ([3af0853](https://github.com/lucasmailland/orchester/commit/3af085335d96afc0372d789e68135e8494e3a986))
* **workspace:** unicode-normalize slug derivation ([7b5b506](https://github.com/lucasmailland/orchester/commit/7b5b50685594630a83532346ae77a86c2231cc64))
* **workspace:** use role=alert on SuspendedBanner (allows interactive content) ([fa200dd](https://github.com/lucasmailland/orchester/commit/fa200dd533f76e04ca028b5751896f00f125a1ea))


### Changed

* **agent-runtime:** thread tx into loadAgent + tool execution ([4f4c746](https://github.com/lucasmailland/orchester/commit/4f4c7467f0dace6514fab50245a35b71fe010a4e))
* **audit:** migrate call sites to new audit_log + appendAuditSync ([d099b9b](https://github.com/lucasmailland/orchester/commit/d099b9b9d141356a9b535201e63e494e518dbde0))
* **billing:** accept optional tx in checkQuota/checkEmployeeBudget/assertWithinSpend ([c7aebbc](https://github.com/lucasmailland/orchester/commit/c7aebbc467bf799d217626ed65a827cd2574128b))
* **channels:** split handleInbound around generator (tx per phase) ([5f18fea](https://github.com/lucasmailland/orchester/commit/5f18fea7e9c756952aabd553078debc9477926fb))
* **channels:** thread tx through router resolveInbound + helpers ([fedf511](https://github.com/lucasmailland/orchester/commit/fedf5115559ce223d561d054b315d138fb516d8e))
* **db-queries:** thread tx into dashboard helpers ([c91bb7c](https://github.com/lucasmailland/orchester/commit/c91bb7c05af0b00ccfbb5e513faa34a9bd1e3683))
* **feature-flags:** accept optional tx for check/set/list ([85bedb1](https://github.com/lucasmailland/orchester/commit/85bedb18c13e0baff1ef321de8e85ce2f0bf5d50))
* **flow-engine:** wrap queries in withFlowTx (FORCE RLS compatible) ([2c9a26c](https://github.com/lucasmailland/orchester/commit/2c9a26cc89566b15b4d89ab38ce233ab89ee77af))
* **gdpr:** exporters require db (no fallback) + drop unused getDb ([af10b2e](https://github.com/lucasmailland/orchester/commit/af10b2e463a027b286810493ae2de628439a0c22))
* **integrations:** thread tx into store helpers ([57a93d2](https://github.com/lucasmailland/orchester/commit/57a93d2d35f3c6e4a2904e922b8a1b0f6dbf2281))
* **llm:** thread tx into getProviderKey + pickAvailableModel ([d5b77b8](https://github.com/lucasmailland/orchester/commit/d5b77b89edd49d2cdc42d3e0d749c16dd488ba8b))
* **memory:** thread tx through memory helpers + compactConversation ([2808e0d](https://github.com/lucasmailland/orchester/commit/2808e0d59be3ee074b69270f575e62d71fa92d45))
* **retention:** require db (no fallback) ([5f8e85e](https://github.com/lucasmailland/orchester/commit/5f8e85e4cced14e0295ce72e4819627b88a0a89c))
* **tenant:** set GUC inside audit/cron transactions ahead of RLS FORCE ([930c441](https://github.com/lucasmailland/orchester/commit/930c4412e3625393d0f37e2ad2030499a14221c1))
* **tools:** drop dynamic-import antipattern, accept tx in ToolContext ([c058055](https://github.com/lucasmailland/orchester/commit/c058055ada0ffb0f63b498acd6492433dc3c72a9))
* unify landing — remove /welcome, point all links to /[locale] ([354a77b](https://github.com/lucasmailland/orchester/commit/354a77bde4a149558228daef4c07e30d1133eb5a))
* **webhooks-out:** thread tx into dispatchEvent + cost-alerts errors ([a7447b4](https://github.com/lucasmailland/orchester/commit/a7447b4b860a07abb2d54ac09827478345b7efb7))


### Documentation

* **adr:** ADR-0010 corrects deployed role + documents P0 fix ([a876e7a](https://github.com/lucasmailland/orchester/commit/a876e7a2040b6370c265ad15dfe0a9fdc2610a6f))
* **adr:** ADR-0020 — correct verb list + table count + v1.4 amendment ([556da04](https://github.com/lucasmailland/orchester/commit/556da043f88ced22b001637e56691637132d081e))
* **adr:** ADR-0020 — multi-tenant memory architecture (Mnemosyne) ([6808b08](https://github.com/lucasmailland/orchester/commit/6808b08e5064320fb6e78b139f971557ce0a8a38))
* **adr:** ADR-0020 amendment 2026-05-26 — v1.5 + v1.6 evolution ([6942a4a](https://github.com/lucasmailland/orchester/commit/6942a4a794af9382453669d248cd630ed6d33d46))
* **adr:** ADRs 0014-0019 for Brain Core (sub-spec 2) ([b52c420](https://github.com/lucasmailland/orchester/commit/b52c42061474ec3c95b9b90ae41f191baea3d446))
* **adr:** record 8 ADRs from tenant hardening spec (006-013) ([690ee47](https://github.com/lucasmailland/orchester/commit/690ee47da5e2f9e644426c86bffdb3dc185499a0))
* architecture deep dive, ADR system, Makefile front door ([858900c](https://github.com/lucasmailland/orchester/commit/858900c4a7e7a5e23ac53e609950e22d8279a969))
* **audit:** catalog provider-specific behaviors in brain/ ([6a6f9f9](https://github.com/lucasmailland/orchester/commit/6a6f9f9e1daba12a52cd21da4a3459cac8f478ab))
* **audit:** comprehensive UI audit — Mnemosyne v1.6 frontend surfaces ([83bb432](https://github.com/lucasmailland/orchester/commit/83bb43288da1af8acdc0749218cdf6422ecb133b))
* **audit:** final comprehensive audit of mnemosyne v1.0 ([69ca142](https://github.com/lucasmailland/orchester/commit/69ca142e3d7bb02152c4c942e87d220b052995d3))
* **audit:** final comprehensive audit of mnemosyne v1.4 ([f667477](https://github.com/lucasmailland/orchester/commit/f667477f4fb834872eec7b38bdd23944a27c8efe))
* **audit:** final comprehensive audit of mnemosyne v1.6 — 10/10 ([ce991b0](https://github.com/lucasmailland/orchester/commit/ce991b079525b3c0564cdb7d63ca80954289b52c))
* **audit:** fresh second-opinion audit of mnemosyne final state ([28a702c](https://github.com/lucasmailland/orchester/commit/28a702ca33d416bb3bd133c8f5c828152d597bd3))
* **audit:** mnemosyne provider audit complete with fix plan ([eed03e5](https://github.com/lucasmailland/orchester/commit/eed03e5371e10ae840cdcafa60eb9b0347c6e33b))
* **audit:** mode A compatibility analysis for brain/ ([95f07e8](https://github.com/lucasmailland/orchester/commit/95f07e8dab91e9aeaee2880fe058404971270366))
* **audit:** record hardcoded provider references in brain/ ([e1c5809](https://github.com/lucasmailland/orchester/commit/e1c580933c5a8086572e57ab83690a96df2e9ac7))
* **audit:** scaffold mnemosyne provider audit report ([b81a5e1](https://github.com/lucasmailland/orchester/commit/b81a5e14bf03772cac77168991ac2330ba1258ae))
* **brain-core:** preflight current-state + worker-health + perf baseline ([936dd79](https://github.com/lucasmailland/orchester/commit/936dd792b9bbfbd04735dede0a80020249cfcdb7))
* **brain:** implementation status v1-alpha (shipped vs deferred) ([9a62e6e](https://github.com/lucasmailland/orchester/commit/9a62e6ee300c2630301b5698f4236ac2213b771b))
* launch-day checklist for the public flip ([e56efe4](https://github.com/lucasmailland/orchester/commit/e56efe4a8ba79cd5c7f2fd4e19387f62f755c6d9))
* **mnemo:** roadmap final — todas las tareas ejecutables al 100% ([5d06f49](https://github.com/lucasmailland/orchester/commit/5d06f495f4a86e18da4fd259029e0ed50b35288f))
* **mnemosyne:** clarify baseUrl rationale in tsconfig comment ([24343a5](https://github.com/lucasmailland/orchester/commit/24343a5fa1368644ae3a1f9dbc04acf965a3f1a7))
* **mnemosyne:** JSDoc orphan v1.0 functions — public API, not yet consumed ([665aec8](https://github.com/lucasmailland/orchester/commit/665aec8e275c32d131b419a499a680f2a25b349f))
* **mnemo:** v1.1 roadmap — reflect actual state (23/29 done, 6 deferred) ([e4cda10](https://github.com/lucasmailland/orchester/commit/e4cda1045437198e2f33b1f0889f409ae2939cfe))
* **mnemo:** v1.1 roadmap + 29-ideas audit handoff ([8345209](https://github.com/lucasmailland/orchester/commit/8345209317db6597132df30b6db3291c1029892a))
* **mnemo:** v2 design + Inspector UI v2 design + cross-workspace consolidation design ([824dc40](https://github.com/lucasmailland/orchester/commit/824dc40ed871fbeec8f30ce6021a5f35ab7ddc8c))
* **mnemo:** v2 spec §11 — poisoning gate ([ddb35e9](https://github.com/lucasmailland/orchester/commit/ddb35e96a702a3f5e82372872cecff5ffc7d78b0))
* **mnemo:** v2 spec §12 — trust decay + env flags ([3fa62e9](https://github.com/lucasmailland/orchester/commit/3fa62e921c9bc873af0abc3a9458706260f8d930))
* **phase-e:** mark UI followups shipped + document invite-action skip ([e7d653b](https://github.com/lucasmailland/orchester/commit/e7d653b5fc7708b0b8bd1ea27b0cafc92c39d696))
* **phase-K.2+N:** v1.0 CHANGELOG draft + CONTRIBUTING cross-refs ([ae9f120](https://github.com/lucasmailland/orchester/commit/ae9f1204a319059809d8dd18328ccbba084a35a7))
* **plan:** implementation plan for tenant hardening (Sub-spec 1) ([4d3875f](https://github.com/lucasmailland/orchester/commit/4d3875f3629af71cac221688767e5737aef658ed))
* **plan:** Mnemosyne implementation plan v0.0 → v1.0 ([4b44c42](https://github.com/lucasmailland/orchester/commit/4b44c42501ade317b468a04a9c995c9f31adbd8c))
* **plan:** self-review pass — 5 critical fixes applied ([7e3ad42](https://github.com/lucasmailland/orchester/commit/7e3ad426eb2334bb3f677c6f9176ef25780ce062))
* **plan:** tick Phase 0 task checkboxes (Tasks 0.1-0.6) ([0903c53](https://github.com/lucasmailland/orchester/commit/0903c534fee4aeffe807de9c954a460dbd0b628b))
* **plan:** tick Phase 1A task checkboxes ([4e1d571](https://github.com/lucasmailland/orchester/commit/4e1d571bb41b7bb708513bd823511a51a3d0aae2))
* **plan:** tick Phase 1B task checkboxes ([ce9ea26](https://github.com/lucasmailland/orchester/commit/ce9ea26a483bd02d9afd51b3ceeff5d9343fe79c))
* **plan:** tick Phase 1C task checkboxes ([c55c85d](https://github.com/lucasmailland/orchester/commit/c55c85d36189039a03c0ab8284ec665162c4d51b))
* **plan:** tick Phase 2 task checkboxes ([2723be5](https://github.com/lucasmailland/orchester/commit/2723be5d35972dd82525becd6c1636e66a82a1e9))
* **plan:** tick Phase 3 task checkboxes ([ee7ab1e](https://github.com/lucasmailland/orchester/commit/ee7ab1eeb516f23f21128edd0466c3240a5ecff7))
* **plan:** tick Phase 4 task checkboxes ([a8a947e](https://github.com/lucasmailland/orchester/commit/a8a947ea74016f29f55fa7d652434b1ef6c43b0e))
* **plan:** tick Phase 5+6 task checkboxes ([51c58fb](https://github.com/lucasmailland/orchester/commit/51c58fbe1af103cff185408ee1835a2a059627d1))
* **plan:** tick Phase 7 task checkboxes ([70d7070](https://github.com/lucasmailland/orchester/commit/70d7070445784fba3aeeea10a85cb55d31b24a03))
* **plan:** v1.0 GA plan — phase-E followups + cross-cutting work ([4bd2a93](https://github.com/lucasmailland/orchester/commit/4bd2a93e282c7e70691bc997297e7476ad981ad5))
* **readme:** elevate to landing-grade with richer visuals + matrix 4x ([bd61b7e](https://github.com/lucasmailland/orchester/commit/bd61b7efd194667afa288913ff1fd80c7c1725c4))
* **readme:** fix hero clipping, repair sequence diagram, retarget matrix ([71464ef](https://github.com/lucasmailland/orchester/commit/71464ef491e1b335b60e2c3feae6d30f0cd84e55))
* **readme:** refine banner typography + replace empty star chart ([6501228](https://github.com/lucasmailland/orchester/commit/6501228d81d830fcd2ec25d8e8338a951aded2da))
* **readme:** rewrite as spectacular landing page with Mermaid diagrams ([a78bb6a](https://github.com/lucasmailland/orchester/commit/a78bb6a0553096c630d54a0e20f52bce6ebd5e88))
* release-notes categorization + CITATION.cff ([d026bb5](https://github.com/lucasmailland/orchester/commit/d026bb520cfcc4039341f036068ae12a301df9c6))
* **runbook:** incident response for tenant isolation + audit breaks ([3e53533](https://github.com/lucasmailland/orchester/commit/3e53533306b1195c99a2a5011d94d9353fa9767a))
* **spec:** §43 v1.5+v1.6 evolution + §44 final snapshot + §45 v2.0 roadmap ([dc2bfa7](https://github.com/lucasmailland/orchester/commit/dc2bfa78f3f21c2ce97966f95d16cb299930e7de))
* **spec:** brain core (sub-spec 2) design ([62fbc53](https://github.com/lucasmailland/orchester/commit/62fbc5308024fbacb29274e55bd7b85a9d885fbd))
* **spec:** Mnemosyne — close mnemo_forget_suggestion schema gap ([e5a117c](https://github.com/lucasmailland/orchester/commit/e5a117c13604cd63ae0be236632a8e72e52dd18a))
* **spec:** Mnemosyne — memory architecture for AI agents ([de2a88e](https://github.com/lucasmailland/orchester/commit/de2a88e0f365c8f2d0cad9cc7f19a8f2cd6fbe06))
* **spec:** mnemosyne design doc — §40 evolution + §41 deferred + §42 v1.4 snapshot ([1f9c3fb](https://github.com/lucasmailland/orchester/commit/1f9c3fb3889ceb0711c48432dd36afb8c336fa38))
* **spec:** Mnemosyne v2 — provider-agnostic + Tier 1 cost engineering ([405617e](https://github.com/lucasmailland/orchester/commit/405617ecaed628020a55f1c025157fe40990f8fb))
* **spec:** Mnemosyne v3 — enterprise edition (governance + scale + vault) ([43bc81b](https://github.com/lucasmailland/orchester/commit/43bc81b4053487a79708cc272832b3ae14660d81))
* **spec:** Mnemosyne v4 — graceful degradation (3 modes, no-AI viable) ([54cc1e4](https://github.com/lucasmailland/orchester/commit/54cc1e4c55bffd899dc4aaa50b4c5163988a26b7))
* **spec:** tenant hardening + workspace switcher design ([2943053](https://github.com/lucasmailland/orchester/commit/2943053ef00dc6f7bc57f829582c844392f3a0b2))
* **tenant:** Phase B output gate + manual verification checklist ([251b4a4](https://github.com/lucasmailland/orchester/commit/251b4a40d41848c1c734b957b516e93d02c8953e))
* **tenant:** Phase D output gate + manual verification (multi-tab, 301, k6) ([0a823c6](https://github.com/lucasmailland/orchester/commit/0a823c60d7c6c60edba008a915b2856c7032b7f2))
* **tenant:** Phase E output gate + manual verification ([e419c85](https://github.com/lucasmailland/orchester/commit/e419c857964dba1f76db2ee53623f0f65d937152))
* **tenant:** post-hardening audit follow-ups (router.ts refactor, cluster cache) ([75b5321](https://github.com/lucasmailland/orchester/commit/75b5321d1192f8667ded2d50396294831e10a54e))
* **tenant:** refresh phase-e-followups post v1.2 — what shipped, what's left ([dcdf0e8](https://github.com/lucasmailland/orchester/commit/dcdf0e8bc9e8d406d323fb4e3d3e5c599924a8d4))

## [Unreleased]

### Mnemosyne v2 (Phases A → L)

Cognitive memory architecture maturation — every executable item from the
2026-05-28 audit of 29 ideas is now shipped (21 with concrete content +
2 deferred with firm rationale + 6 audit gaps with no original entry).
On top of the audit, the v2 design + implementation lands.

**Audit deliverables (commits `1d0d6db`, `3dfea6e`):**

- #3 hybrid BM25+vector, #4 single-term dampener, #6 co-location boost,
  #7 confidence early-exit rerank, #8 per-entity diversity cap, #10
  Hebbian/Ebbinghaus/Cepeda, #11 edge provenance, #12 inverted-interval
  WRITE validation, #13 virtual line numbering, #20 sweeper backfill,
  #22 unresolved-mention queue, #24 advisory contradiction wire,
  #25 adaptive recall budget, #26 BFS verb priority, #27 containment
  hops, #28 MCP anti-pattern guidance, #29 LongMemEval benchmark,
  #1+#2 pointer index + drawer-grep.

**v2 design + implementation (Phases A → L):**

- **Telemetría** — per-stage `onMetric` callback in `searchMnemo` /
  `recallUnified`; 11 stages instrumented; host wires `recordMetric`
  → Sentry distributions.
- **Inspector UI v2** — `captureTrace` flag + `RecallSample[]`,
  `/api/mnemo/recall-debug` endpoint (rate-limited, audit-logged),
  `<RecallFunnel>` + `<RecallDebugClient>` components, hot-path
  regression test that fails CI if production turns `captureTrace` on.
- **v2 partials** — `makeLocalLexicalRerank` is now the package
  default; trust ladder (verified > llm > heuristic > pending >
  unverified); per-stage cap helpers tiered on workspace fact count
  (wired into `runSearchPipeline`).
- **Cross-workspace consolidation** — pure clustering algorithm
  (`clusterCrossWorkspace`, 22 unit tests); migrations 0049 (`org`
  tenancy primitive) + 0050 (`mnemo_org_fact_view` + `app_org_user`
  role + RLS) ship the data path end-to-end; weekly Sunday 02:30 UTC
  cron schedule wired into pg-boss, gated by
  `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION` env.
- **Episodes first-class** — migrations 0048 (nullable `episode_id`)
  - 0051 (SQL-level backfill + NOT NULL flip); `createFact()`
    auto-derives and upserts the synthetic episode in the same tx;
    daily 04:15 UTC backfill cron as a safety net.
- **Opt-in scoring helpers** — #5 multi-term multiplicative
  (`multiTermBoost`), #9 signal-strength cutoff (`signalCutoff`),
  #16 source-scoped dedup (`sourceScopedDedupThreshold`), #17 quality
  interlock (`qualityThreshold`), episode-coherence boost
  (`episodeCoherenceBoost`). All default off; flip when telemetry
  calibration arrives.
- **Memory Protocol** bumped to `v1.3.0` to reflect the
  `MEMORY_RECALL_GUIDANCE` expansion (drawer-first awareness +
  trust-ladder hints).
- **Admin REST** — `GET /api/admin/orgs/[orgId]/cross-workspace-facts`
  for read-side admin access to org-level summaries.

### Tests + invariants

928+ tests passing (mnemosyne + apps/web). tsc clean across `packages/db`,
`packages/mnemosyne`, `apps/web`. CI audit-invariants pass.

## [1.0.0] — 2026-05-28

> First stable release. Multi-tenant correctness hardened end-to-end,
> Mnemosyne cognitive memory v1.6, GDPR streaming pipeline.

This release is the v1.0 milestone — multi-tenant correctness hardened
end-to-end, the **Mnemosyne** cognitive memory layer reaches v1.6, and
the GDPR data-portability pipeline is rebuilt to stream instead of
buffer. The platform is ready for production self-host and managed
cloud at this point.

### Added

#### Mnemosyne — cognitive memory v1.5 → v1.6

- **Entity primitive** (the 4th cognitive primitive alongside fact, decision, episode). Canonical "things" — people, organizations, projects, concepts, places — with aliases, kinds, mention counts, and a `canonical_id` self-reference for merge. Heuristic + LLM extraction populates `mnemo_fact.entity_id` in the same write path. CRUD + `findOrCreate` + linked-facts endpoint at `/api/mnemo/entities`.
- **Per-user actor isolation** (`mnemo_fact.actor_id`). Opt-in RLS layer: when `app.enforce_actor_isolation='true'` and `app.actor_id` is set, the policy restricts SELECT to NULL-actor (workspace-shared) or own-actor rows. NULL by default — non-breaking back-compat. `withMnemoTx` accepts an optional `actorId` and `enforceActorIsolation` flag.
- **TimeTravelPicker** — bitemporal `asOf` UI in the Memory Inspector lets operators replay the memory state at any past moment.
- **Premium embedding tier** — `resolveEmbeddingTier` routes pinned / high-confidence / workspace-flagged facts to the upgraded model; settings UI exposes the selector. Workers batch by tier (one API call per tier per workspace).
- **HNSW `halfvec` quantization** on `mnemo_fact.embedding` — 2× storage reduction with no measurable recall loss.
- **L3 query cache** — write-through cache with 0.95 cosine lookup and 5-minute TTL on the search hot path.
- **Agent runtime v1.5** — wires HyDE, rerank, and graph expansion into the recall pipeline; defaults flipped to ON with kill-switches.
- **Memory Inspector** — review-queue counts, deep-linked fact citations to source conversations, and `mnemo.disable_*` kill-switches for every recall stage.
- **Memory operations panel** with manual cron triggers for compaction, prune, embed, and consolidate.
- **Sensitivity toggle** embedded in conversation detail with server persistence.
- **Mnemosyne protocol v1.2** — entity awareness + per-user privacy tagging.

#### UX

- **Account dropdown** in the global shell + Conversations page polish (HeroUI Select replaces native selects).
- **Recall quality** section in settings exposing the premium embedding model selector.

#### GDPR

- **Secret scrubber** (`lib/gdpr/redact.ts`) — recursive non-mutating walker covering 15 known credential prefixes (OpenAI `sk-`, Anthropic `sk-ant-`, Stripe `sk_live_`, Google `AIza`, Slack `xoxb`, Notion `ntn_`, GitHub `ghp_`, Orchester `ok_live_`, etc.) plus 17 key-name matches (`apiKey`, `secret`, `password`, `authorization`, `bearer`, …). Wired into the messages, agents, knowledge, and brain exporters so JSONB columns with unstructured user content cannot leak embedded credentials.
- **True streaming pipeline** — `archiver` pipes straight into the storage adapter. S3 via `@aws-sdk/lib-storage` multipart `Upload` (auto-aborts on source error); filesystem via `pipeline(stream, createWriteStream)` with unlink-on-error cleanup. Peak memory now bounded by `archiver`'s deflate buffer + one multipart part instead of the full archive — multi-GB tenant exports no longer OOM the worker.

#### Testing

- **Tenant isolation matrix suite** (`apps/web/tests/isolation/`):
  - `db-scan.spec.ts` — cross-tenant SELECT isolation across 21 host Pattern A tables.
  - `writes-cross-tenant.spec.ts` — INSERT-with-foreign-workspace rejection + foreign-row UPDATE/DELETE returning 0 rows on 6 representative tables.
  - `mnemo-tenant.spec.ts` — same matrix across all 5 Mnemosyne primitives + 4-cell verification of the per-actor RESTRICTIVE policy.
  - `routes-static-audit.spec.ts` — pure-text walker over `apps/web/app/api/` (130 routes, ~20ms) that fails CI when a new route forgets to use a tenant helper.
  - `injection-probes.spec.ts` — SQL-injection payloads stored literally, no GUC bypass.

### Changed

- **LLM tool loop transactional tx propagation** — `runConversationalTurn` now threads a single workspace-scoped `tx` through `llmCall`, `executeTool`, and `getRelevantMemories`. The legacy path opened nested connections that fell back to the BYPASSRLS connection role for provider-key reads, defeating tenant isolation in flight. `getProviderKey` accepts an optional `tx` and opens its own short workspace-scoped tx when the caller can't provide one.
- **Flow-engine inline branch tx** now downgrades to `app_user` (`SET LOCAL ROLE app_user`) so FORCE RLS actually applies — flow-engine writes used to run as the BYPASSRLS connection role, making FORCE a no-op on the entire flow runtime path.
- **Brain extract-job** populates `entity_id` and stamps `protocol_version='v1.2'` on every fact.
- **i18n** — final closeout across landing, legal, billing, invite email, integrations catalog, ConnectProviderModal, MCP JSON-RPC errors, and shared UI surfaces. `brain.*` and `settings.*` keys added across `en`, `es`, `pt-BR`.

### Fixed

- **Hydration bugs** — UserMenu Dropdown trigger className diff, RecallQualitySection Premium Select, settings nav `aria-current` hash-based active state, Brain Inspector FactFilters Select2 React Aria IDs, TeamCard initials slicing emoji surrogate pairs, Conversations HeroUI Select.
- **`parseBody`** — empty body now treated as `{}` so empty-schema routes (pin/unpin/forget/restore) work instead of 400-ing.
- **`GeneralSection.Save`** — was sending `workspace.id` where the API expected `workspace.slug`.
- **Notifications Toggle** — knob no longer escapes the track on certain viewport widths.
- **`pg-boss createQueue`** — boot-time deadlock window closed via pre-create + retry-on-deadlock; queue init is idempotent.
- **MCP error strings** translated — JSON-RPC error envelopes no longer leak Spanish to non-Spanish clients.
- **Seed** — stopped seeding fake-ready KB docs (status='ready' with NULL embedding); a backfill helper now re-embeds the existing rows.

### Security

- **GDPR exports cannot leak credentials**. Even if a tool response or chat message embedded a real API key, the scrubber replaces it with `<REDACTED>` before the archive lands.
- **FORCE RLS in the flow-engine + LLM tool loop**. Both paths previously ran as the BYPASSRLS connection role; the role downgrade closes the only remaining surface where FORCE was bypassed.
- **Tenant isolation matrix in CI** — `tests/isolation/` proves cross-tenant SELECT/INSERT/UPDATE/DELETE isolation on every Pattern A table on every PR.
- **Route static audit** — fails CI when a new API route forgets to use a tenant helper.
- **Per-actor isolation policy** (migration 0040) ships as a restrictive RLS layer that AND's with the workspace policy, gated by an opt-in GUC. No breakage for existing callers; available immediately to per-user agents.

### Documentation

- **Mnemosyne v1.6 final audit** + ADR-0020 amendment + v2.0 roadmap (`docs/specs/§43–§45`).
- **CONTRIBUTING.md** cross-references SECURITY.md and adds `lib/tenant/` + `lib/gdpr/` + `packages/db/migrations/` to the CODEOWNERS-protected security-sensitive areas list.
- **Verification runbooks** moved out of `tests/perf/` into `docs/runbooks/` (`tenant-context-verification.md`, `workspace-switcher-verification.md`, `lifecycle-features-smoke.md`).

### Migrations

This release ships **25 schema migrations** beyond v0.1.0 (last shipped
migration: `0014`). The big arc is the **Brain Core → Mnemosyne**
evolution: `mnemo_fact`, `mnemo_decision`, `mnemo_relation`,
`mnemo_citation`, `mnemo_summary`, `mnemo_fact_archive`,
`mnemo_health`, `mnemo_review_queue`, `mnemo_episode`,
`mnemo_attribution`, `mnemo_agent_memory_policy`, `mnemo_entity`,
plus their indexes, RLS policies, and the bitemporal GIST exclusion
constraint. Apply in order with `pnpm --filter @orchester/db migrate`:

- `0015` — idempotency PK scoped to workspace.
- `0016` — Brain Core (initial fact table + extraction job).
- `0017` — Mnemosyne rename: `brain_fact` → `mnemo_fact`.
- `0018` — `mnemo_decision` primitive.
- `0020` — `mnemo_relation` (typed memory→memory edges).
- `0021` — `mnemo_citation` (memory→source attribution).
- `0022` — `mnemo_query_cache` (L3 search cache).
- `0024` — Brain → Mnemo data backfill.
- `0025` — extraction skip state.
- `0026` — bitemporal GIST exclusion (no valid-time overlap).
- `0027` — provider health rollup table.
- `0028` — `mnemo_summary` (per-agent injection blob).
- `0029` — `mnemo_fact_archive` (merged + pruned rows).
- `0031` — `mnemo_health` (per-workspace cognitive vitals).
- `0032` — `mnemo_review_queue` (low-confidence inbox).
- `0033` — memory types catalog.
- `0034` — `mnemo_episode` (timeline + multi-fact narrative).
- `0035` — attribution columns.
- `0036` — agent memory policy.
- `0037` — `mnemo_fact.actor_id`.
- `0038` — `conversation.sensitivity` toggle.
- `0039` — `mnemo_entity` primitive + linked-facts index.
- `0040` — opt-in per-actor RESTRICTIVE RLS policy.
- `0041` — protocol v1.2 tagging (`protocol_version` columns).
- `0042` — HNSW `halfvec(1536)` quantization on `mnemo_fact.embedding`.

No destructive operations. Every migration has a `.down.sql` companion
so deployment rollouts can roll back one step if a canary fails.

## [0.1.0] - 2026-05-22

First public release. Establishes the foundation: a multi-tenant, self-hostable platform for building AI agents and orchestrating them in workflows.

### Added

- **Visual flow builder** with 30+ node types (triggers, agents, tools, conditions, switches, loops, parallel, subflows, code, spreadsheet, KB, integrations, HTTP, wait-for-human, end).
- **Agent runtime** with memory, tools, handoffs, structured outputs, and streamable responses.
- **AI catalog** covering 10 capabilities (chat, image, video, embeddings, rerank, TTS, STT, code, vision, OCR) across 80+ providers via a unified adapter layer.
- **MCP server** (HTTP + stdio, read+write) so any MCP-aware client can talk to your data.
- **Integrations framework** with real connectors plus a webhook receiver, management UI, and expanded event catalog.
- **Authoring productivity**: drag-and-drop palette, auto-connect, labeled Sí/No handles, copy/paste/duplicate, dagre auto-layout, visual variable picker, run-as-form (no JSON), inline validation badges, pin/dry-run.
- **AI copilot** for build / explain / debug with preview-then-merge edits to the active flow.
- **Observability**: live execution view, run inspector, inline error badges, distributed run telemetry, cost breakdown.
- **Templates gallery** with rich node cards and a path to community contributions.

### Security

- **AES-256-GCM credential encryption** with versioned key rotation.
- **Code-node RCE closed**: per-workspace gate plus a sandboxed execution boundary.
- **RBAC enforced on every mutating route** via zod schemas + role checks.
- **Per-workspace AI spend cap** with hard fail-closed semantics, metered through `usage_events`.
- **Postgres advisory locks** on quota and spend writes — no TOCTOU windows.
- **Structural CI guard** (`scripts/audit-invariants.sh`) enforces the four cross-cutting invariants (spend guard, AI metering, RBAC+zod, flow signal).

### Changed

- Flow execution decoupled from request lifecycle via a Postgres-backed job queue (pg-boss) with an orphan-run reaper.
- Database workflow standardized on `drizzle-kit generate` + `migrate` (no more `push --force`).
- Provider field migrated from enum to text with credentials handled per-workspace.

### Documentation

- Public-facing [`README.md`](README.md), [`ROADMAP.md`](ROADMAP.md), [`GOVERNANCE.md`](GOVERNANCE.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`.github/SUPPORT.md`](.github/SUPPORT.md), [`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md).
- Apache 2.0 license with NOTICE; Developer Certificate of Origin (DCO) for contributions.
- Per-node documentation surfaced inside the studio.

---

<!--
GUIDE for editors / release-please:

  ## [Unreleased]
  ### Added         — new user-facing features
  ### Changed       — changes in existing functionality
  ### Deprecated    — soon-to-be removed features
  ### Removed       — removed features (breaking)
  ### Fixed         — bug fixes
  ### Security      — vulnerability fixes (link to advisories)

When a release is cut, the [Unreleased] block becomes the version block and a
new empty [Unreleased] is added on top.

The version comparison links at the bottom should also be updated.
-->

[Unreleased]: https://github.com/lucasmailland/orchester/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lucasmailland/orchester/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/lucasmailland/orchester/releases/tag/v0.1.0
