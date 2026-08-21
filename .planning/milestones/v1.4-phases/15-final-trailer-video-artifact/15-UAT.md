---
status: complete
phase: 15-final-trailer-video-artifact
source: 15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-03-SUMMARY.md, 15-04-SUMMARY.md
started: 2026-08-03T20:19:28-03:00
updated: 2026-08-03T20:20:00-03:00
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete — one frontend scenario explicitly deferred to the sibling admin-web milestone]

## Tests

### 1. Upload de Trailer MP4 Protegido
expected: Com a API em execucao e autenticacao administrativa valida, envie um MP4 pequeno para POST /v1/episodes/{episodeId}/trailer-video usando o campo multipart file. A resposta deve confirmar o trailer-video final no episodio, sem URL de YouTube nova e sem publicar nada no YouTube. O arquivo final deve ficar disponivel no seletor de artefato trailer-video.
result: deferred
blocked_by: prior-phase
reason: "User requested validation through the frontend, but Phase 15 is API-only and admin-web integration plus YouTube publication are outside this phase."

### 2. Metadados de trailer-video preservam episodios legados
expected: Legacy episode databases gain typed trailer-video metadata without losing rows.
result: pass
source: automated
coverage_id: D1

### 3. Layout MP4 final separado do trailer de audio
expected: Final MP4 media layout remains distinct from the audio trailer layout.
result: pass
source: automated
coverage_id: D2

### 4. Limite configuravel de upload
expected: Validated trailer-video byte limit defaults to 500 MiB and rejects unsafe values.
result: pass
source: automated
coverage_id: D1

### 5. Seletor ZIP trailer-video canonico
expected: Authenticated artifact ZIP jobs select only the canonical final trailer video under the fixed trailer-video selector.
result: pass
source: automated
coverage_id: D1

### 6. Invalidação do cache ZIP por evidencia de video
expected: Default-all missing markers, fixed trailer.mp4 archive entries, and changed-or-appearing video source evidence invalidate stale ZIP jobs.
result: pass
source: automated
coverage_id: D2

### 7. Fluxo offline de upload e substituicao
expected: Protected MP4 upload, safe rejection, replacement sync state, and canonical trailer-video ZIP artifact are proven offline.
result: pass
source: automated
coverage_id: D1

### 8. Revalidacao do seletor fechado
expected: Closed trailer-video artifact selection is revalidated with the existing artifact lifecycle verifier.
result: pass
source: automated
coverage_id: D2

## Summary

total: 8
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0
deferred: 1

## Gaps

[none yet]
