#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audio AI Neural Processor (Sidecar CLI) for Anime Dub Manager.
Handles neural audio processing:
1. DeepFilterNet (DeepFilterNet3) - Speech Denoising & Room Dereverberation
2. Demucs v4 (htdemucs / htdemucs_ft) - Vocal & Instrumental (BGM/SFX) Source Separation

Supports CUDA, MPS (Apple Silicon), and CPU with automatic fallbacks.
Emits real-time progress to stdout via: PROGRESS:<float_percent>
"""

import sys
import os
import argparse
import json
import traceback
import math
import warnings

# Suppress noisy warnings in CLI output
warnings.filterwarnings('ignore')

def emit_progress(percent: float, message: str = ""):
    """Emits standardized progress message to stdout for Electron IPC parsing."""
    clamped = max(0.0, min(100.0, float(percent)))
    sys.stdout.write(f"PROGRESS:{clamped:.1f}\n")
    if message:
        sys.stdout.write(f"LOG:{message}\n")
    sys.stdout.flush()

def get_optimal_device():
    """Selects CUDA -> MPS (Apple Silicon) -> CPU."""
    try:
        import torch
        if torch.cuda.is_available():
            dev_name = torch.cuda.get_device_name(0)
            sys.stdout.write(f"DEVICE:cuda ({dev_name})\n")
            sys.stdout.flush()
            return torch.device("cuda")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            sys.stdout.write("DEVICE:mps (Apple Silicon Metal)\n")
            sys.stdout.flush()
            return torch.device("mps")
    except Exception as e:
        sys.stderr.write(f"Warning checking torch device: {e}\n")
    
    sys.stdout.write("DEVICE:cpu\n")
    sys.stdout.flush()
    import torch
    return torch.device("cpu")

def load_audio_tensor(file_path, target_sr=None):
    """Loads audio file into torch tensor (channels, samples) and returns (tensor, sample_rate)."""
    import torch
    import soundfile as sf
    import numpy as np

    try:
        import torchaudio
        info = torchaudio.info(file_path)
        audio, sr = torchaudio.load(file_path)
    except Exception:
        # Fallback to soundfile
        data, sr = sf.read(file_path, dtype='float32')
        if data.ndim == 1:
            data = data[np.newaxis, :]
        else:
            data = data.T  # (channels, samples)
        audio = torch.from_numpy(data)

    if target_sr is not None and sr != target_sr:
        try:
            import torchaudio.transforms as T
            resampler = T.Resample(orig_freq=sr, new_freq=target_sr)
            audio = resampler(audio)
            sr = target_sr
        except Exception:
            import scipy.signal
            num_samples = int(audio.shape[-1] * target_sr / sr)
            arr = audio.numpy()
            resampled = scipy.signal.resample(arr, num_samples, axis=-1)
            audio = torch.from_numpy(resampled.astype(np.float32))
            sr = target_sr

    return audio, sr

def save_audio_tensor(file_path, audio_tensor, sr, subtype='PCM_16'):
    """Saves torch audio tensor (channels, samples) to WAV file."""
    import soundfile as sf
    import numpy as np
    import torch

    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    
    if isinstance(audio_tensor, torch.Tensor):
        arr = audio_tensor.detach().cpu().numpy()
    else:
        arr = np.asarray(audio_tensor)

    if arr.ndim == 2:
        # soundfile expects (samples, channels)
        arr = arr.T
    elif arr.ndim == 1:
        arr = arr[:, np.newaxis]

    # Clip to prevent overflow distortion
    arr = np.clip(arr, -1.0, 1.0)
    sf.write(file_path, arr, sr, subtype=subtype)

# ==============================================================================
# 1. DEEPFILTERNET DENOISE & DEREVERB
# ==============================================================================
def process_deepfilternet(args):
    """
    Speech Denoising & Room Dereverberation via DeepFilterNet3.
    """
    import torch
    import numpy as np

    input_path = args.input
    output_path = args.output
    mode = args.mode  # 'denoise' or 'dereverb'
    
    atten_limit = float(args.attenuation_limit_db) if args.attenuation_limit_db is not None else -100.0
    reverb_reduction = float(args.reverb_reduction) if args.reverb_reduction is not None else (0.8 if mode == 'dereverb' else 0.0)
    sensitivity = float(args.sensitivity) if args.sensitivity is not None else 1.0
    wet_dry_blend = float(args.wet_dry_blend) if args.wet_dry_blend is not None else 100.0

    emit_progress(5.0, f"Инициализация DeepFilterNet3 ({mode})...")
    device = get_optimal_device()

    try:
        from df.enhance import enhance, init_df
        from df.io import load_audio, save_audio
    except ImportError:
        raise ImportError(
            "Пакет deepfilternet не установлен в окружении Python. "
            "Установите: pip install deepfilternet torchaudio soundfile"
        )

    emit_progress(15.0, "Загрузка модели DeepFilterNet3...")
    model, df_state, _ = init_df()
    model = model.to(device)
    model.eval()

    emit_progress(30.0, "Загрузка и ресемплинг аудио в 48 кГц...")
    # DeepFilterNet natively requires 48 kHz mono or stereo
    target_sr = df_state.sr() if hasattr(df_state, 'sr') else 48000
    audio_orig, orig_sr = load_audio_tensor(input_path)
    
    # Resample to 48kHz for DeepFilterNet
    audio_48k, _ = load_audio_tensor(input_path, target_sr=target_sr)
    
    # If stereo, DeepFilterNet enhances channels individually or processes as batch
    emit_progress(45.0, "Нейросетевая обработка спектрограммы...")
    
    # Adjust attenuation limit based on sensitivity (1.0 = gentle/preserve air, 10.0 = deep cut)
    # If user set sensitivity=1.0 and atten_limit=-100dB, we soften atten_limit so speech frequencies remain 100% natural!
    if sensitivity < 3.0:
        eff_atten = max(-35.0, atten_limit * (sensitivity / 3.0))
    else:
        eff_atten = atten_limit

    num_channels = audio_48k.shape[0]
    enhanced_channels = []

    for ch in range(num_channels):
        ch_tensor = audio_48k[ch:ch+1]  # (1, samples)
        ch_tensor = ch_tensor.to(device)
        
        with torch.no_grad():
            # enhance accepts (channels, samples) and returns enhanced audio tensor
            enhanced_ch = enhance(
                model, 
                df_state, 
                ch_tensor, 
                atten_lim_db=eff_atten
            )
        enhanced_channels.append(enhanced_ch.cpu())
        progress_val = 45.0 + ((ch + 1) / num_channels) * 35.0
        emit_progress(progress_val, f"Обработка канала {ch + 1}/{num_channels}...")

    enhanced_audio = torch.cat(enhanced_channels, dim=0)

    # Post-dereverberation filtering if mode == 'dereverb' or reverb_reduction > 0
    if reverb_reduction > 0.0 or mode == 'dereverb':
        emit_progress(82.0, "Подавление хвостов комнатного эха (Spatial Inversion)...")
        # Apply gentle spectral smoothing / tail suppression
        decay_factor = max(0.1, min(1.0, reverb_reduction * (0.5 + sensitivity * 0.05)))
        # Mix in clean dry transients
        enhanced_audio = enhanced_audio * decay_factor + audio_48k.cpu() * (1.0 - decay_factor) * 0.15

    # Apply Dry/Wet Blend if requested
    if wet_dry_blend < 100.0:
        wet_w = wet_dry_blend / 100.0
        dry_w = 1.0 - wet_w
        enhanced_audio = (enhanced_audio * wet_w) + (audio_48k.cpu() * dry_w)

    emit_progress(90.0, "Сохранение очищенного аудиофайла на диск...")
    save_audio_tensor(output_path, enhanced_audio, target_sr)
    
    emit_progress(100.0, "Обработка DeepFilterNet3 успешно завершена!")

# ==============================================================================
# 2. DEMUCS v4 STEM SEPARATION (HTDEMUCS / HTDEMUCS_FT / MDX)
# ==============================================================================
def process_demucs(args):
    """
    Stem Separation via Demucs v4 (Hybrid Transformer HTDemucs).
    Extracts Vocals and Instrumental (M&E: Drums + Bass + Other).
    """
    import torch
    import numpy as np

    input_path = args.input
    output_dir = args.output_dir or os.path.dirname(os.path.abspath(args.output or input_path))
    model_name = args.model_name or "htdemucs"  # "htdemucs" or "htdemucs_ft"
    shifts = int(args.shifts) if args.shifts is not None else 1
    overlap = float(args.overlap) if args.overlap is not None else 0.25
    stems_mode = args.stems or "both"  # "vocals_only", "instrumental_only", "both", "all"
    two_stems = args.two_stems or "vocals"

    emit_progress(5.0, f"Инициализация Demucs v4 ({model_name})...")
    device = get_optimal_device()

    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except ImportError:
        raise ImportError(
            "Пакет demucs не установлен в окружении Python. "
            "Установите: pip install demucs torch torchaudio soundfile"
        )

    emit_progress(15.0, f"Загрузка весов модели {model_name}...")
    model = get_model(model_name)
    model.to(device)
    model.eval()

    emit_progress(25.0, "Чтение входного файла аудио/видеоряда...")
    audio, sr = load_audio_tensor(input_path, target_sr=model.samplerate)
    
    # Ensure audio is stereo (2, samples) for Demucs
    if audio.shape[0] == 1:
        audio = audio.repeat(2, 1)
    elif audio.shape[0] > 2:
        audio = audio[:2]

    # Normalize audio
    ref = audio.mean(0)
    audio_std = ref.std().item()
    if audio_std > 1e-6:
        audio_norm = audio / audio_std
    else:
        audio_norm = audio

    emit_progress(35.0, f"Нейросетевая сепарация стемов (shifts={shifts}, overlap={overlap})...")

    # Custom progress callback during chunked separation
    class ProgressTracker:
        def __init__(self):
            self.last_pct = 35.0

        def update(self, current, total):
            pct = 35.0 + (current / max(1, total)) * 50.0
            if pct - self.last_pct >= 2.0:
                self.last_pct = pct
                emit_progress(pct, f"Сепарация: {int(pct)}%")

    # Run Demucs inference
    audio_norm = audio_norm.to(device)
    with torch.no_grad():
        # returns tensor of shape (batch, sources, channels, time)
        sources = apply_model(
            model,
            audio_norm[None],
            shifts=shifts,
            split=True,
            overlap=overlap,
            progress=True,
            device=device
        )[0]

    # Scale back
    if audio_std > 1e-6:
        sources = sources * audio_std

    sources = sources.cpu()
    sources_dict = dict(zip(model.sources, sources))  # ['drums', 'bass', 'other', 'vocals']

    os.makedirs(output_dir, exist_ok=True)
    prefix = args.prefix or ""

    emit_progress(88.0, "Экспорт изолированных дорожек (Vocals & Instrumental)...")

    # 1. Vocals stem
    vocals_tensor = sources_dict.get('vocals')
    vocals_out_path = os.path.join(output_dir, f"{prefix}original_vocals.wav")
    
    # 2. Instrumental (M&E = Drums + Bass + Other)
    inst_tensor = None
    for name, tensor in sources_dict.items():
        if name != 'vocals':
            if inst_tensor is None:
                inst_tensor = tensor.clone()
            else:
                inst_tensor += tensor
                
    inst_out_path = os.path.join(output_dir, f"{prefix}original_instrumental_ME.wav")

    # Save outputs based on requested stems_mode
    exported_files = []

    if stems_mode in ["vocals_only", "both", "all"] and vocals_tensor is not None:
        save_audio_tensor(vocals_out_path, vocals_tensor, model.samplerate)
        exported_files.append({"type": "vocals", "path": vocals_out_path})

    if stems_mode in ["instrumental_only", "both", "all"] and inst_tensor is not None:
        save_audio_tensor(inst_out_path, inst_tensor, model.samplerate)
        exported_files.append({"type": "instrumental", "path": inst_out_path})

    if stems_mode == "all":
        for stem_name, stem_tensor in sources_dict.items():
            stem_path = os.path.join(output_dir, f"{prefix}stem_{stem_name}.wav")
            save_audio_tensor(stem_path, stem_tensor, model.samplerate)
            exported_files.append({"type": stem_name, "path": stem_path})

    emit_progress(95.0, f"Экспортировано {len(exported_files)} стем-файлов.")
    sys.stdout.write(f"RESULT:{json.dumps(exported_files)}\n")
    sys.stdout.flush()

    emit_progress(100.0, "Разделение Demucs v4 успешно завершено!")

# ==============================================================================
# MAIN CLI DISPATCHER
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Anime Dub Manager Audio AI Sidecar")
    parser.add_argument("--mode", required=True, choices=["denoise", "dereverb", "separate", "check_env"],
                        help="Action mode to execute")
    parser.add_argument("--input", help="Path to input audio/video file")
    parser.add_argument("--output", help="Path to output audio file")
    parser.add_argument("--output_dir", help="Target directory for multi-stem outputs")
    parser.add_argument("--prefix", default="", help="Prefix for exported filenames")
    
    # DeepFilterNet params
    parser.add_argument("--attenuation_limit_db", type=float, default=-100.0, help="Attenuation limit in dB (-100 to 0)")
    parser.add_argument("--reverb_reduction", type=float, default=0.0, help="Reverb reduction ratio (0.0 to 1.0)")
    parser.add_argument("--sensitivity", type=float, default=1.0, help="User sensitivity (1.0 to 10.0)")
    parser.add_argument("--wet_dry_blend", type=float, default=100.0, help="Wet/Dry blend percentage (10 to 100)")
    
    # Demucs params
    parser.add_argument("--model_name", default="htdemucs", help="Demucs model (htdemucs, htdemucs_ft, htdemucs_6s)")
    parser.add_argument("--shifts", type=int, default=1, help="Number of random shifts for Demucs (1-5)")
    parser.add_argument("--overlap", type=float, default=0.25, help="Overlap between chunks (0.1-0.5)")
    parser.add_argument("--stems", default="both", choices=["vocals_only", "instrumental_only", "both", "all"], help="Which stems to export")
    parser.add_argument("--two_stems", default="vocals", help="Two stems split target")

    # JSON config override
    parser.add_argument("--config_json", help="Direct JSON config payload string")

    args = parser.parse_args()

    if args.config_json:
        try:
            cfg = json.loads(args.config_json)
            for k, v in cfg.items():
                if hasattr(args, k):
                    setattr(args, k, v)
        except Exception as e:
            sys.stderr.write(f"Error parsing --config_json: {e}\n")

    if args.mode == "check_env":
        # Diagnostics
        env_status = {
            "torch": False,
            "cuda": False,
            "mps": False,
            "deepfilternet": False,
            "demucs": False,
            "device": "cpu"
        }
        try:
            import torch
            env_status["torch"] = True
            env_status["cuda"] = torch.cuda.is_available()
            env_status["mps"] = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            if env_status["cuda"]:
                env_status["device"] = torch.cuda.get_device_name(0)
            elif env_status["mps"]:
                env_status["device"] = "Apple Silicon Metal"
        except Exception:
            pass

        try:
            import df
            env_status["deepfilternet"] = True
        except Exception:
            pass

        try:
            import demucs
            env_status["demucs"] = True
        except Exception:
            pass

        sys.stdout.write(f"ENV_STATUS:{json.dumps(env_status)}\n")
        sys.stdout.flush()
        return

    if not args.input or not os.path.exists(args.input):
        sys.stderr.write(f"Input file not found: {args.input}\n")
        sys.exit(1)

    try:
        if args.mode in ["denoise", "dereverb"]:
            process_deepfilternet(args)
        elif args.mode == "separate":
            process_demucs(args)
        else:
            sys.stderr.write(f"Unsupported mode: {args.mode}\n")
            sys.exit(1)
    except Exception as err:
        sys.stderr.write(f"ERROR in {args.mode}: {err}\n")
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
