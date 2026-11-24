# Guild foundation — implementation record

Date: 2026-11-24. Scope: additive creation-only migration and initial read endpoints. Central owner: ecosystem; executor: admin-api. Design reference: `../dragaocareca-ecosystem/.planning/proposals/guilda-unification/SCHEMA-PROPOSAL.md`.

Implemented: 34-table versioned/checksummed transactional SQLite migration with explicit target CLI; independent game/achievement/progression modules; scope and game key for achievements; source-aware XP ledger; eight GET contracts and OpenAPI; disposable offline verification. No activation on startup, import, media copying, member auth, mutation workflows or deployment.

Compatibility: existing podcast schema/endpoints untouched except additive Guild router/OpenAPI registration. V2 adapter, bot, legacy site and deployment configuration unchanged. Admin routes use existing podcast-admin auth; new member auth will be separate. Existing local AGENTS/feed-service edits were present before this work and are outside it.

Migration order: provision/rehearse isolated copy → future member auth/domain services → V2 adapter → final snapshot/import/cutover. API owns schema/security tests; V2 owns future journey verification; deploy owns backup/recovery/rollout. No production migration or cutover implied by this record. Detailed operation/contracts and limitations: `docs/features/guild-foundation.md`.

Production update 2026-11-24: schema/read foundation deployed at `ad8a7f9`; typecheck/build and fixture verification passed in the exact previous production runtime. Final backup and fingerprint comparison preserved 29 prior tables/16,234 rows. No import, member login, gameplay or reward activation. Full evidence is recorded in `docs/features/guild-foundation.md`.
