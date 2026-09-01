#!/usr/bin/env python3
"""
Wavely Local AI Stem Separator Runner
Wraps Demucs (htdemucs) with CUDA GPU acceleration and JSON stdout telemetry.
"""

import sys
import os
import json
import argparse
import traceback

def main():
    parser = argparse.ArgumentParser(description="Wavely Demucs AI Stem Separator")
    parser.add_argument("--input", required=True, help="Input audio file path")
    parser.add_argument("--output", required=True, help="Output folder for stems")
    parser.add_argument("--model", default="htdemucs", help="Demucs model name (htdemucs / mdx_extra)")
    parser.add_argument("--device", default="auto", help="Device (cuda / cpu / auto)")
    args = parser.parse_args()

    input_file = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output)
    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(input_file):
        print(json.dumps({"type": "ERROR", "message": f"Input file not found: {input_file}"}))
        sys.exit(1)

    print(json.dumps({"type": "PROGRESS", "percent": 5, "message": "Initializing PyTorch and loading Demucs model..."}), flush=True)

    try:
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
        from demucs.audio import AudioFile, save_audio

        # Determine compute device
        if args.device == "cuda" or (args.device == "auto" and torch.cuda.is_available()):
            device = "cuda"
            device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CUDA"
            print(json.dumps({"type": "INFO", "message": f"Using GPU acceleration: {device_name}"}), flush=True)
        else:
            device = "cpu"
            print(json.dumps({"type": "INFO", "message": "Using CPU for processing"}), flush=True)

        print(json.dumps({"type": "PROGRESS", "percent": 15, "message": f"Loading model {args.model}..."}), flush=True)
        model = get_model(args.model)
        model.to(device)

        print(json.dumps({"type": "PROGRESS", "percent": 25, "message": "Decoding input audio..."}), flush=True)
        wav = AudioFile(input_file).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        wav = wav.to(device)

        print(json.dumps({"type": "PROGRESS", "percent": 40, "message": "Separating stems with AI neural network..."}), flush=True)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]

        sources *= ref.std() + 1e-8
        sources += ref.mean()

        base_name = os.path.splitext(os.path.basename(input_file))[0]
        stems_dict = {}

        stem_names = model.sources # ['drums', 'bass', 'other', 'vocals']
        total_stems = len(stem_names)

        for i, name in enumerate(stem_names):
            pct = 75 + int((i / total_stems) * 20)
            print(json.dumps({"type": "PROGRESS", "percent": pct, "message": f"Exporting {name.capitalize()} stem..."}), flush=True)
            stem_source = sources[i].cpu()
            stem_filename = f"{base_name}_{name.capitalize()}.wav"
            stem_path = os.path.join(output_dir, stem_filename)
            save_audio(stem_source, stem_path, samplerate=model.samplerate, clip='rescale', as_float=False, bits_per_sample=16)
            stems_dict[name] = stem_path

        print(json.dumps({
            "type": "SUCCESS",
            "percent": 100,
            "outputDir": output_dir,
            "stems": stems_dict,
            "message": "AI Stem Separation complete!"
        }), flush=True)

    except Exception as e:
        err_msg = traceback.format_exc()
        print(json.dumps({"type": "ERROR", "message": str(e), "trace": err_msg}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
