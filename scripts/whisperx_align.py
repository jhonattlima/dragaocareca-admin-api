#!/usr/bin/env python3
"""Offline-only exact-text Portuguese word aligner for private trailer snapshots."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata

ALIGNER_VERSION = "whisperx==3.8.6"
MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese"
MODEL_REVISION = "634ac655299bcdc46c83bc01da9bab52d2987e4f"
MAX_TRANSCRIPT_BYTES = 20_000
MAX_WORDS = 5_000
MODEL_MANIFEST = "dragaocareca-model-manifest.json"


def canonical_tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFC", text).casefold()
    return re.findall(r"[\w]+", normalized, flags=re.UNICODE)


def safe_regular_file(value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_file():
        raise ValueError("invalid private input")
    return candidate.resolve(strict=True)


def model_identity(model_dir: Path) -> dict[str, str]:
    if model_dir.is_symlink() or not model_dir.is_dir():
        raise ValueError("local model unavailable")
    manifest_path = model_dir / MODEL_MANIFEST
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("local model unavailable")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("modelId") != MODEL_ID or manifest.get("revision") != MODEL_REVISION:
        raise ValueError("local model unavailable")
    model_hash = manifest.get("modelSha256")
    declared_files = manifest.get("files")
    if not isinstance(model_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", model_hash) or not isinstance(declared_files, list) or not declared_files:
        raise ValueError("local model unavailable")
    verified: list[tuple[str, str]] = []
    declared_paths: set[str] = set()
    for item in declared_files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("sha256"), str):
            raise ValueError("local model unavailable")
        relative = item["path"].replace("\\", "/")
        if relative.startswith("/") or ".." in relative.split("/") or relative in declared_paths or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
            raise ValueError("local model unavailable")
        declared_paths.add(relative)
        model_file = model_dir / relative
        if model_file.is_symlink() or not model_file.is_file():
            raise ValueError("local model unavailable")
        resolved = model_file.resolve(strict=True)
        resolved_root = model_dir.resolve(strict=True)
        if os.path.commonpath((str(resolved_root), str(resolved))) != str(resolved_root):
            raise ValueError("local model unavailable")
        digest = hashlib.sha256()
        with resolved.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        actual = digest.hexdigest()
        if actual != item["sha256"]:
            raise ValueError("local model unavailable")
        verified.append((relative, actual))
    actual_paths: set[str] = set()
    for entry in model_dir.rglob("*"):
        if entry.is_symlink():
            raise ValueError("local model unavailable")
        if entry.is_file() and entry.name != MODEL_MANIFEST:
            actual_paths.add(entry.relative_to(model_dir).as_posix())
    if actual_paths != declared_paths:
        raise ValueError("local model unavailable")
    actual_model_hash = hashlib.sha256("\n".join(f"{name}:{digest}" for name, digest in sorted(verified)).encode()).hexdigest()
    if actual_model_hash != model_hash:
        raise ValueError("local model unavailable")
    return {"modelId": MODEL_ID, "revision": MODEL_REVISION, "modelSha256": model_hash}


def run_alignment(audio_path: Path, transcript_path: Path, model_dir: Path) -> dict[str, object]:
    manifest = model_identity(model_dir)
    transcript_bytes = transcript_path.read_bytes()
    if not transcript_bytes or len(transcript_bytes) > MAX_TRANSCRIPT_BYTES:
        raise ValueError("invalid transcript bounds")
    transcript = transcript_bytes.decode("utf-8", errors="strict")
    if not transcript.strip() or "\x00" in transcript:
        raise ValueError("invalid transcript")
    tokens = canonical_tokens(transcript)
    if not tokens or len(tokens) > MAX_WORDS:
        raise ValueError("invalid transcript token count")

    # Offline flags are set before importing transformers/Hugging Face clients.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import whisperx  # type: ignore[import-not-found]

    audio = whisperx.load_audio(str(audio_path))
    audio_seconds = len(audio) / 16_000
    if audio_seconds <= 0:
        raise ValueError("empty audio")
    model, metadata = whisperx.load_align_model(
        language_code="pt",
        device="cpu",
        model_name=str(model_dir),
        model_dir=str(model_dir),
        model_cache_only=True,
    )
    aligned = whisperx.align(
        [{"start": 0.0, "end": audio_seconds, "text": transcript}],
        model,
        metadata,
        audio,
        "cpu",
        return_char_alignments=False,
        print_progress=False,
    )
    words: list[dict[str, object]] = []
    for segment in aligned.get("segments", []):
        for item in segment.get("words", []):
            text = item.get("word")
            start = item.get("start")
            end = item.get("end")
            if isinstance(text, str) and isinstance(start, (int, float)) and isinstance(end, (int, float)):
                words.append({"start": float(start), "end": float(end), "text": text.strip()})
    if len(words) > MAX_WORDS:
        raise ValueError("alignment output too large")
    # Deliberately return no audio/transcript/model paths or transcript text.
    return {
        "status": "aligned",
        "alignerVersion": ALIGNER_VERSION,
        "modelId": manifest["modelId"],
        "modelRevision": manifest["revision"],
        "modelSha256": manifest["modelSha256"],
        "audioSha256": hash_file(audio_path),
        "transcriptSha256": hashlib.sha256(transcript_bytes).hexdigest(),
        "words": words,
    }


def hash_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def self_test() -> None:
    assert canonical_tokens("Ação, CAFÉ! Nº 344") == ["ação", "café", "nº", "344"]
    assert safe_regular_file(str(Path(__file__).resolve())).is_file()
    payload = {"status": "aligned", "words": [{"start": 0.0, "end": 0.1, "text": "ok"}]}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    assert json.loads(encoded) == payload
    with tempfile.TemporaryDirectory(prefix="dc-aligner-manifest-test-") as temp_dir:
        model_dir = Path(temp_dir)
        artifact = b"synthetic-offline-model-file"
        artifact_path = model_dir / "pytorch_model.bin"
        artifact_path.write_bytes(artifact)
        artifact_hash = hashlib.sha256(artifact).hexdigest()
        model_hash = hashlib.sha256(f"pytorch_model.bin:{artifact_hash}".encode()).hexdigest()
        manifest = {
            "modelId": MODEL_ID,
            "revision": MODEL_REVISION,
            "modelSha256": model_hash,
            "files": [{"path": "pytorch_model.bin", "sha256": artifact_hash}],
        }
        (model_dir / MODEL_MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
        assert model_identity(model_dir)["modelSha256"] == model_hash
        artifact_path.write_bytes(b"tampered")
        try:
            model_identity(model_dir)
        except ValueError:
            pass
        else:
            raise AssertionError("model manifest must reject altered weights")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--transcript")
    parser.add_argument("--model-dir")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        print("PASS: offline aligner adapter self-test")
        return 0
    if not args.audio or not args.transcript or not args.model_dir:
        raise ValueError("audio, transcript, and model paths are required")
    result = run_alignment(safe_regular_file(args.audio), safe_regular_file(args.transcript), Path(args.model_dir).resolve())
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Do not echo third-party exception text, which can contain paths or transcript fragments.
        print(json.dumps({"status": "unavailable", "reason": "aligner_unavailable"}), file=sys.stdout)
        raise SystemExit(2)
