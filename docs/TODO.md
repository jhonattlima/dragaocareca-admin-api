# TODO and Tech Debt

Durable backlog for follow-up work that should not block the current milestone.

## Open Items

### TD-001: Re-evaluate the local transcription engine before changing the transcript pipeline

**Status:** Deferred  
**Deferred on:** 2026-07-23  
**Priority:** Medium  
**Related milestone:** v1.2 Episode AI authoring API

**Current implementation**

- Episode transcription supports `internal` (`whisper.cpp`) and `gemini` providers through `EPISODE_TRANSCRIPTION_PROVIDER`
- The current development configuration selects Gemini for transcript generation; `ggml-small.bin` remains the local baseline when `internal` is selected
- The backend writes `transcript.txt` into the episode folder and uses that transcript as the input for later AI features

**Why revisit later**

- We want to confirm whether `whisper.cpp` is still the best local transcription runtime for the VPS constraints we expect in production
- The deployment target is a Hostinger VPS with 4 GB RAM, where sequential processing and low memory use matter
- `faster-whisper` may be worth comparing later, but that evaluation should not block v1.2

**Current decision**

- Keep the local Whisper-family workflow available as a fallback
- Compare production quality, cost, and rate limits before making Gemini the permanent production default
- Proceed with Gemini summary generation from the transcript that the workflow already produces; the summary remains a separate draft artifact

**When to revisit**

- Before a milestone that changes the transcription runtime
- If transcription speed becomes a production bottleneck
- If memory pressure on the VPS makes the current transcription workflow unreliable

**Suggested comparison scope for the future**

- `whisper.cpp` vs `faster-whisper`
- CPU-only runtime behavior on the target VPS
- Memory usage during long episode transcription
- Portuguese-BR transcript quality on real Dragao Careca episodes
- Operational complexity for `admin-api` deployment and maintenance

**Context links**

- [Episode Transcription](./features/003-episode-transcription/README.md)
- [Episode Transcription Plan](./features/003-episode-transcription/PLAN.md)
- [Episode Summary Suggestion](./features/004-episode-summary-suggestion/README.md)
- [Episode Summary Suggestion Plan](./features/004-episode-summary-suggestion/PLAN.md)
- [VPS Setup](./VPS-SETUP.md)
