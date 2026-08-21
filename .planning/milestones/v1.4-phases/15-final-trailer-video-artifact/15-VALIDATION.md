---
phase: 15
slug: final-trailer-video-artifact
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-21
---

# Phase 15 — Validation Strategy

The compiled repository-native verifiers cover protected MP4 upload/replacement, canonical artifact selection, ZIP preparation, and rejection boundaries.

| Area | Requirement | Command | Status |
|---|---|---|---|
| Upload and replacement | TRAILER-01 | `npm run verify:trailer-video-artifact` | passed |
| Artifact allowlist and ZIP | TRAILER-05 | `npm run verify:episode-artifact-downloads` | passed |
| Draft/staging regression | TRAILER-01 | `npm run verify:trailer-video-upload-lifecycle` | passed |
