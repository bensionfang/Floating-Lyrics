import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import wave


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stem_separator.py"
MODEL_ID = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"


def wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * 8)


def invoke(input_path: Path, output_dir: Path, model_dir: Path, env=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--input", str(input_path), "--output-dir", str(output_dir), "--model-dir", str(model_dir)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="kanaric-stem-contract-") as raw_root:
        root = Path(raw_root)
        input_path = root / "input.wav"
        output_dir = root / "output"
        model_dir = root / "models"
        output_dir.mkdir()
        model_dir.mkdir()
        wav(input_path)

        missing_env = os.environ.copy()
        missing_env.pop("PYTHONPATH", None)
        missing = invoke(input_path, output_dir, model_dir, missing_env)
        assert missing.returncode != 0
        assert missing.stdout == ""
        assert "karaoke-stem-dependency-unavailable" in missing.stderr

        relative = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", "relative.wav", "--output-dir", str(output_dir), "--model-dir", str(model_dir)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
        )
        assert relative.returncode != 0
        assert relative.stdout == ""
        assert "karaoke-stem-arguments-invalid" in relative.stderr

        fake_root = root / "fake"
        package = fake_root / "audio_separator"
        package.mkdir(parents=True)
        (package / "__init__.py").write_text("", encoding="utf-8")
        (package / "separator.py").write_text(textwrap.dedent("""
            import os
            from pathlib import Path
            import wave

            class Separator:
                def __init__(self, output_dir, output_format, model_file_dir):
                    assert output_format == 'WAV'
                    self.output_dir = Path(output_dir)

                def load_model(self, model_filename):
                    assert model_filename == 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'

                def separate(self, input_path):
                    def write(path):
                        with wave.open(str(path), 'wb') as output:
                            output.setnchannels(1)
                            output.setsampwidth(2)
                            output.setframerate(8000)
                            output.writeframes(b'\\0\\0' * 8)
                    instrumental = self.output_dir / 'input_(Instrumental)_model.wav'
                    vocals = self.output_dir / 'input_(Vocals)_model.wav'
                    write(instrumental)
                    write(vocals)
                    if os.environ.get('FAKE_STEM_ESCAPE') == '1':
                        outside = self.output_dir.parent / 'outside.wav'
                        write(outside)
                        instrumental = outside
                    return [str(instrumental), str(vocals)]
        """), encoding="utf-8")
        fake_env = os.environ.copy()
        fake_env["PYTHONPATH"] = str(fake_root)

        escaped_env = fake_env.copy()
        escaped_env["FAKE_STEM_ESCAPE"] = "1"
        escaped = invoke(input_path, output_dir, model_dir, escaped_env)
        assert escaped.returncode != 0
        assert escaped.stdout == ""
        assert "karaoke-stem-output-invalid" in escaped.stderr

        success = invoke(input_path, output_dir, model_dir, fake_env)
        assert success.returncode == 0, success.stderr
        lines = success.stdout.splitlines()
        assert len(lines) == 1
        assert json.loads(lines[0]) == {
            "ok": True,
            "instrumental": "instrumental.wav",
            "vocals": "vocals.wav",
            "modelId": MODEL_ID,
        }
        assert (output_dir / "instrumental.wav").stat().st_size > 0
        assert (output_dir / "vocals.wav").stat().st_size > 0
        print("test_stem_separator_contract: PASS")


if __name__ == "__main__":
    main()
