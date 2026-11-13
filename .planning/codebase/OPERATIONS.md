# Operations Runbook

**Last updated:** 2026-07-28

## VPS prerequisites

- Node.js 18+ and npm
- `ffmpeg`, `python3`, `python3-pip`, `python3-venv`, `build-essential`, and `curl`
- `python3 -m pip install -r requirements-vps.txt` when Spotify metrics are enabled
- Writable `data/database/`, `data/media/`, and `data/generated/` paths
- Outbound internet access when Gemini providers are enabled

Use `scripts/bootstrap-vps.sh` for the full bootstrap or `scripts/install-vps-deps.sh` for worker dependencies only.

## Embedded episode MP3 metadata

`Save Episode` (create and edit) writes ID3v2.4 tags to the main MP3 after staged media promotion and before save/publication. Title uses `DC {episodeNumber} - {type if present} - {title}`; this does not change the canonical title used by the feed. Artist combines participant names and structured/plain guest names, removes duplicates and sorts in Portuguese. Track uses episodeNumber, never episodeId. Genre is `Podcast`; Album Artist is `Dragão Careca`. The uploaded JPEG is embedded as the single Front Cover picture. The release date is stored in the date/TDRC field as YYYY-MM-DD; players may label/display its year separately.

```bash
EPISODE_AUDIO_ALBUM=Season 4
EPISODE_AUDIO_TIME_ZONE=America/Sao_Paulo
```

Change the album env value for the next season. Tagging copies encoded audio without re-encoding, verifies the tags/cover/audio fingerprint, replaces the MP3 atomically and updates the saved duration/byte count. Failed persistence restores the previous MP3; delivery failures after the DB commit retain the new tags. Hidden `.audio-before-tags-*.mp3` files are rollback hardlinks; a process crash can retain one for recovery. No historical batch rewrite runs at deployment. Missing legacy audio remains editable; an existing audio requires JPEG cover and episodeNumber. Temporary files require room for one MP3 plus cover on the same filesystem.

Speech checkpoint identity now hashes encoded audio packets rather than whole-file ID3 bytes, so metadata edits preserve in-flight speech progress. Checkpoint format v2 regenerates older cached identities as needed; existing final transcripts remain intact. Verify with `npm run verify:episode-audio-tags` and `npm run verify:transcription-checkpoints`.

## Episode AI configuration

Episode and trailer transcription use Groq Whisper directly. Episode audio is processed in sequential five-minute chunks. Completed text and quota retry deadlines are persisted under `data/generated/transcription-checkpoints` (next to the configured private trailer-candidates root). Keys bind the SHA-256 of the audio, model, language and chunk duration, so a replaced source cannot reuse old text. WAV chunks remain temporary and are removed after each attempt. Keep provider secrets outside version control.

```bash
EPISODE_TRANSCRIPTION_ENABLED=true
EPISODE_TRANSCRIPTION_PROVIDER=groq
EPISODE_TRANSCRIPTION_LANGUAGE=pt
EPISODE_TRANSCRIPTION_TIMEOUT_MS=7200000

GROQ_API_KEY=replace-with-secret
EPISODE_TRANSCRIPTION_GROQ_MODEL=whisper-large-v3-turbo

# Summary and hashtag authoring are separate from speech transcription
EPISODE_SUMMARY_ENABLED=true
GEMINI_API_KEY=replace-with-secret
EPISODE_SUMMARY_PRIMARY_PROVIDER=gemini
EPISODE_SUMMARY_PROVIDER=groq
YOUTUBE_HASHTAG_PRIMARY_PROVIDER=gemini
YOUTUBE_HASHTAG_PROVIDER=groq
EPISODE_SUMMARY_GEMINI_MODEL=gemini-3.6-flash
EPISODE_SUMMARY_GEMINI_THINKING_LEVEL=low
EPISODE_SUMMARY_PROMPT_VERSION=4
```

Provider keys and selection are server-side only. WhisperX remains only for optional timed-caption alignment of edited trailer transcripts. Keep speech requests sequential on the 4 GB VPS. HTTP 429 leaves an episode draft `pending`, with its progress and a quota-wait message; the worker polls at most every 30 seconds and respects the durable retry deadline. Restart recovery scans existing pending/processing drafts and continues their checkpoints without blocking HTTP startup. Permanent failures stay `error` for operator correction. Text-only checkpoints are retained for reuse; they contain no WAV/MP3 copies. This change preserves the existing optional waveform-only trailer fallback when trailer transcription fails.

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
npm run verify:transcription-checkpoints
npm run verify:meta-connection
npm run verify:episode-publication-delivery
```
