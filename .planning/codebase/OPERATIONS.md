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

## Meta social-publication configuration and recovery

Production Facebook/Instagram publication is configured with
`META_SYSTEM_USER_ACCESS_TOKEN`; legacy `META_USER_ACCESS_TOKEN`,
`META_PAGE_ACCESS_TOKEN`, and `META_INSTAGRAM_ACCESS_TOKEN` are not part of
the normal deployment profile. Generate the credential from the Meta Business
system user that has the target Facebook Page and linked professional Instagram
account assigned. The token debug response must report `type: SYSTEM_USER`;
do not place a short-lived `USER` token in the system-user variable.

Keep these values private in the ignored production environment file. After a
token change, recreate only the API service and verify the authenticated
`GET /v1/meta-connection/status` response. Both publication gates must be
`ready`; a token with fewer than seven days remaining is deliberately blocked
before the workers can start a social upload.

The social effects retain their caption snapshot so retries do not rebuild
unreviewed copy. Finalizing an episode refreshes only effects that have not
been published. If an old published post contains `[Draft ...]`, first inspect
the exact remote ID and final episode metadata. Do not clear the local remote
ID or requeue while the incorrect remote post exists. Correct Facebook fields
in place when Meta accepts it; otherwise replace the Facebook video. Published
Instagram Reels can require manual deletion in Instagram because the current
system-user token may publish but still receive Graph error `(#10)` on delete.
After manual deletion, reset/requeue the matching Instagram effect exactly once
and verify the newly persisted remote ID and final caption.

## Deployment verification

```bash
npm run typecheck
npm run build
npm run verify:public-episodes
npm run verify:summary-runtime-contract
npm run verify:summary-quality-contract
npm run verify:meta-connection
npm run verify:episode-publication-delivery
```
