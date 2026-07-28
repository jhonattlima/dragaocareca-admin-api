# VPS Setup

This document lists the runtime dependencies needed to run the backend workers on a VPS.

## Required packages

- Node.js 18+ and npm
- `ffmpeg`
- `python3`
- `python3-pip`
- `python3-venv`
- `build-essential`
- `curl`

## Python worker dependencies

Install the Python dependency file with:

```bash
python3 -m pip install -r requirements-vps.txt
```

The current Python dependency list is:

- `spotifyconnector`

## Transcription dependencies

The transcription worker supports two providers, selected by `EPISODE_TRANSCRIPTION_PROVIDER`:

- `gemini`: `GEMINI_API_KEY`, `EPISODE_TRANSCRIPTION_GEMINI_MODEL` (default `gemini-3.6-flash`), and outbound internet access. Audio is uploaded temporarily to Gemini and deleted when the job finishes.
- `internal`: a Whisper-family CLI exposed through `EPISODE_TRANSCRIPTION_COMMAND` and a model file such as `ggml-small.bin` referenced by `EPISODE_TRANSCRIPTION_MODEL_PATH`.

Both providers produce the same local `transcript.txt`, update the same draft state, and trigger summary generation only after transcription completes.

## Summary dependencies

The summary worker supports two providers, selected by `EPISODE_SUMMARY_PROVIDER`:

- `gemini`: `GEMINI_API_KEY` and `EPISODE_SUMMARY_GEMINI_MODEL` (default `gemini-3.6-flash`); `EPISODE_SUMMARY_GEMINI_THINKING_LEVEL=low` reserves enough output for the description without local VPS memory use
- `llama`: a summary command exposed through `EPISODE_SUMMARY_COMMAND` and a model file referenced by `EPISODE_SUMMARY_MODEL_PATH`

The worker remains sequential with transcription. This avoids overlapping jobs and preserves the shared episode state; Gemini removes the local CPU and RAM cost of the summary step. The current development configuration uses Gemini for both steps, while the internal transcription and Llama summary options remain available as fallbacks.

The summary runtime reads the transcript file, writes a draft `summary.txt`, and updates the shared `episode.state.json` metadata for the episode. It never writes the final `episodes.summary` database field. Do not run transcription and summary generation in parallel on the same VPS host.

## Suggested AI configuration

Set the following in the production environment, substituting the real API key outside version control:

```bash
EPISODE_TRANSCRIPTION_ENABLED=true
EPISODE_TRANSCRIPTION_PROVIDER=gemini
EPISODE_TRANSCRIPTION_GEMINI_MODEL=gemini-3.6-flash
EPISODE_TRANSCRIPTION_GEMINI_MAX_OUTPUT_TOKENS=32768
EPISODE_TRANSCRIPTION_GEMINI_THINKING_LEVEL=minimal

EPISODE_SUMMARY_ENABLED=true
EPISODE_SUMMARY_PROVIDER=gemini
EPISODE_SUMMARY_GEMINI_MODEL=gemini-3.6-flash
EPISODE_SUMMARY_GEMINI_THINKING_LEVEL=low
EPISODE_SUMMARY_PROMPT_VERSION=4
GEMINI_API_KEY=replace-with-secret
```

The summary prompt is designed to match the production feed's editorial shape while treating `transcript.txt` as the sole factual source. It is not necessary, or desirable, to allow the VPS to fetch the public feed for each job.

Before deployment, run:

```bash
npm run typecheck
npm run build
npm run verify:summary-runtime-contract
npm run verify:summary-quality-contract
```

## Suggested bootstrap

Run the full bootstrap script from the project root:

```bash
scripts/bootstrap-vps.sh
```

That script installs Node.js 18, the base OS packages, the Python package list, and the Node project dependencies.

If you only need the worker dependencies, run:

```bash
scripts/install-vps-deps.sh
```

## Runtime paths

Make sure the VPS user can write to:

- `data/database/`
- `data/media/`
- `data/generated/`
