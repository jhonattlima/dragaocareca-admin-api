#!/usr/bin/env python3
"""Transcribe one normalized audio chunk with faster-whisper."""

import argparse
import sys

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="pt")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--cpu-threads", type=int, default=4)
    args = parser.parse_args()

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=max(1, args.cpu_threads),
        num_workers=1,
    )
    segments, _ = model.transcribe(
        args.audio,
        language=args.language,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )

    for segment in segments:
        text = segment.text.strip()
        if text:
            print(text)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"faster-whisper failed: {error}", file=sys.stderr)
        raise
