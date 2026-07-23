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

The transcription worker also needs:

- a transcription binary exposed through `EPISODE_TRANSCRIPTION_COMMAND`
- a model file such as `ggml-small.bin` referenced by `EPISODE_TRANSCRIPTION_MODEL_PATH`

The current implementation expects a Whisper-family local CLI such as `whisper.cpp`.

If we revisit the transcription runtime later, track that work under [TODO.md](./TODO.md#td-001-re-evaluate-the-local-transcription-engine-before-changing-the-transcript-pipeline) rather than changing the current production path ad hoc.

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
