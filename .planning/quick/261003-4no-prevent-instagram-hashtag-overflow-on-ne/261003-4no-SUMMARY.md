---
quick_id: 261003-4no
status: complete
completed: 2026-10-03
---

# Summary

- Extracted bounded caption rendering into `social-caption.ts`.
- Instagram and Facebook now rebuild captions from structured stored metadata at provider-send time. Legacy effect snapshots with 50 tags therefore send no more than 30 on retries.
- The common snapshot-creation path remains capped at 30, while raw episode hashtag authoring remains unchanged.
- Added offline coverage for an old 50-tag snapshot.
- Verification passed: `npm run typecheck`, `npm run build`, `npm run verify:episode-publication-contract`, and `npm run verify:episode-publication-delivery`.
- Production deploy/requeue not performed: deploy repository policy still requires its own GSD scope resolution and fresh exact-command approval.
