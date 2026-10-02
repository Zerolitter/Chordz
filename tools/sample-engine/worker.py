"""Isolated Demucs adapter. Installation/model preparation are explicit CLI operations."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys

MODELS = {"htdemucs": ["vocals", "drums", "bass", "other"], "htdemucs_6s": ["vocals", "drums", "bass", "other", "piano", "guitar"]}


def model_ready(cache: Path, model: str) -> bool:
    try:
        marker = json.loads((cache / (model + ".ready.json")).read_text(encoding="utf-8"))
        files = marker["files"]
        if marker["model"] != model or not files or len(files) > 32:
            return False
        return all(isinstance(name, str) and Path(name).name == name and (cache / "hub" / "checkpoints" / name).is_file()
                   and (cache / "hub" / "checkpoints" / name).stat().st_size > 1000 for name in files)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--prepare", choices=MODELS)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--model", choices=MODELS, default="htdemucs")
    parser.add_argument("--target", choices=sorted({stem for values in MODELS.values() for stem in values}))
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.threads <= 8:
        parser.error("Use 1 to 8 inference threads.")
    # Heavy packages never load into the web server or the browser's audio engine.
    import numpy as np
    import soundfile as sf
    import torch
    from torchaudio.functional import resample
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    torch.set_num_threads(args.threads)
    torch.manual_seed(0)
    args.cache.mkdir(parents=True, exist_ok=True)
    torch.hub.set_dir(str(args.cache / "hub"))
    if args.prepare:
        print("Preparing", args.prepare, "from the official Demucs model repository. No audio is involved.", flush=True)
        get_model(args.prepare)
        files = sorted(path.name for path in (args.cache / "hub" / "checkpoints").glob("*.th"))
        if not files:
            raise RuntimeError("No downloaded checkpoints were found; model readiness was not recorded.")
        marker = {"model": args.prepare, "files": files, "torch": torch.__version__}
        (args.cache / (args.prepare + ".ready.json")).write_text(json.dumps(marker), encoding="utf-8")
        print("Model prepared:", args.prepare, flush=True)
        return
    if not args.input or not args.output or args.target not in MODELS[args.model]:
        parser.error("Supply input, output and a supported target.")
    if not model_ready(args.cache, args.model):
        raise RuntimeError("Model is not prepared. Run worker.py --prepare explicitly first.")
    def no_download(*_args, **_kwargs):
        raise RuntimeError("Automatic model downloads are disabled during extraction. Prepare the model first.")
    torch.hub.download_url_to_file = no_download
    data, sample_rate = sf.read(args.input, dtype="float32", always_2d=True)
    if not 8000 <= sample_rate <= 192000 or data.shape[1] not in (1, 2) or not 0 < data.shape[0] <= sample_rate * 24 or not np.isfinite(data).all():
        raise RuntimeError("Invalid or oversized input audio.")
    model = get_model(args.model).eval()
    if args.target not in model.sources:
        raise RuntimeError("The loaded model does not support this target.")
    original_frames, original_channels = data.shape
    waveform = torch.from_numpy(data.T.copy())
    if original_channels == 1:
        waveform = waveform.repeat(2, 1)
    if sample_rate != model.samplerate:
        waveform = resample(waveform, sample_rate, model.samplerate)
    reference = waveform.mean(0)
    mean = reference.mean()
    # Do not divide antiphase stereo by the almost-zero mono-mix deviation.
    scale = reference.std()
    if scale < 1e-5:
        scale = waveform.std()
    scale = scale.clamp(min=1e-6)
    with torch.inference_mode():
        stems = apply_model(model, ((waveform - mean) / scale)[None], device=args.device,
                            shifts=1, split=True, overlap=.25, progress=False, num_workers=0)[0]
        target = stems[model.sources.index(args.target)].cpu() * scale.cpu() + mean.cpu()
        if model.samplerate != sample_rate:
            target = resample(target, model.samplerate, sample_rate)
        if original_channels == 1:
            target = target.mean(0, keepdim=True)
        if target.shape[1] < original_frames:
            target = torch.nn.functional.pad(target, (0, original_frames - target.shape[1]))
        target = target[:, :original_frames]
        if not torch.isfinite(target).all():
            raise RuntimeError("The separator returned invalid samples.")
        # Float output retains gain for an honest source-minus-target residual.
        sf.write(args.output, target.numpy().T, sample_rate, format="WAV", subtype="FLOAT")
    print("Extraction completed; perceptual review is still required.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Sample engine:", str(error), file=sys.stderr, flush=True)
        sys.exit(1)
