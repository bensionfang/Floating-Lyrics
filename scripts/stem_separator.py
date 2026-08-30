import argparse
import json
import os
from pathlib import Path
import sys


MODEL_ID = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"


def fail(code: str) -> int:
    print(code, file=sys.stderr)
    return 2


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-dir", required=True)
    return parser.parse_args()


def contained_file(raw_path, output_dir: Path) -> Path:
    value = Path(raw_path)
    candidate = (value if value.is_absolute() else output_dir / value).resolve()
    if not candidate.is_relative_to(output_dir) or not candidate.is_file() or candidate.stat().st_size <= 0:
        raise ValueError("karaoke-stem-output-invalid")
    return candidate


def main() -> int:
    try:
        args = parse_args()
    except SystemExit:
        return fail("karaoke-stem-arguments-invalid")

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    model_dir = Path(args.model_dir)
    if not all(path.is_absolute() for path in (input_path, output_dir, model_dir)):
        return fail("karaoke-stem-arguments-invalid")
    input_path = input_path.resolve()
    output_dir = output_dir.resolve()
    model_dir = model_dir.resolve()
    if not input_path.is_file() or not output_dir.is_dir() or not model_dir.is_dir():
        return fail("karaoke-stem-arguments-invalid")

    try:
        from audio_separator.separator import Separator
    except Exception:
        return fail("karaoke-stem-dependency-unavailable")

    try:
        separator = Separator(
            output_dir=str(output_dir),
            output_format="WAV",
            model_file_dir=str(model_dir),
        )
        separator.load_model(model_filename=MODEL_ID)
        raw_files = separator.separate(str(input_path))
        files = [contained_file(value, output_dir) for value in raw_files]
        instrumental = next((value for value in files if "instrumental" in value.name.lower()), None)
        vocals = next((value for value in files if "vocals" in value.name.lower()), None)
        if not instrumental or not vocals or instrumental == vocals:
            return fail("karaoke-stem-output-invalid")
        instrumental_target = output_dir / "instrumental.wav"
        vocals_target = output_dir / "vocals.wav"
        os.replace(instrumental, instrumental_target)
        os.replace(vocals, vocals_target)
    except ValueError:
        return fail("karaoke-stem-output-invalid")
    except Exception:
        return fail("karaoke-stem-separation-failed")

    print(json.dumps({
        "ok": True,
        "instrumental": instrumental_target.name,
        "vocals": vocals_target.name,
        "modelId": MODEL_ID,
    }, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
