# Operations Runbook

**Last updated:** 2026-07-28

## VPS prerequisites

- Node.js 18+ and npm
- `ffmpeg`, `python3`, `python3-pip`, `python3-venv`, `build-essential`, and `curl`
- `python3 -m pip install -r requirements-vps.txt` when Spotify metrics are enabled
- Writable `data/database/`, `data/media/`, and `data/generated/` paths
- Outbound internet access when Gemini providers are enabled

Use `scripts/bootstrap-vps.sh` for the full bootstrap or `scripts/install-vps-deps.sh` for worker dependencies only.

## Episode AI configuration

Episode transcription tries Gemini first and falls back to Groq. Faster Whisper and local Whisper CLI transcription are no longer installed. Keep provider secrets outside version control.

```bash
EPISODE_TRANSCRIPTION_ENABLED=true
EPISODE_TRANSCRIPTION_PROVIDER=gemini
EPISODE_TRANSCRIPTION_LANGUAGE=pt
EPISODE_TRANSCRIPTION_TIMEOUT_MS=7200000

# Optional alternative transcription providers
GEMINI_API_KEY=replace-with-secret
EPISODE_TRANSCRIPTION_GEMINI_MODEL=gemini-3.6-flash

# Summary and hashtag authoring are separate from speech transcription
EPISODE_SUMMARY_ENABLED=true
EPISODE_SUMMARY_PRIMARY_PROVIDER=gemini
EPISODE_SUMMARY_PROVIDER=groq
YOUTUBE_HASHTAG_PRIMARY_PROVIDER=gemini
YOUTUBE_HASHTAG_PROVIDER=groq
EPISODE_SUMMARY_GEMINI_MODEL=gemini-3.6-flash
EPISODE_SUMMARY_GEMINI_THINKING_LEVEL=low
EPISODE_SUMMARY_PROMPT_VERSION=4
```

The xAI key and provider selection are server-side only. WhisperX remains only for optional timed-caption alignment of edited trailer transcripts. Keep transcription and summary generation sequential on the 4 GB VPS.

## Runtime contract

1. Audio upload queues transcription.
2. The transcript provider writes `transcript.txt` and marks `episode.state.json` as complete.
3. Summary generation starts only after transcription and writes draft `summary.txt`.
4. The final database summary remains operator-owned and is saved only through the episode form.

The production RSS feed guides the summary prompt's style but is never fetched by a job and is not factual input. Status snapshots expose the provider actually used for transcript, summary, and hashtag authoring; the UI must not infer it from configuration.

## Deployment verification

```bash
npm run typecheck
npm run build
npm run verify:public-episodes
npm run verify:summary-runtime-contract
npm run verify:summary-quality-contract
```
