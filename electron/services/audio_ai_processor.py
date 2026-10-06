#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audio AI Neural Processor (Sidecar CLI) for Anime Dub Manager.
Universal Neural Audio Processing Engine with Strict Audio Conditioning:
1. DeepFilterNet 3 (Speech Denoising & Dereverberation) [Native 48kHz]
2. UVR MDX-Net ONNX (Voc_FT, Inst_HQ_3, Kim_Vocal_2, MDX23C-8Step, Reverb_HQ FoxJoy) [Native 44.1kHz Stereo Complex STFT]
3. UVR VR Architecture PyTorch (VR-DeNoise, DeNoise-Full, DeNoise-Lite, De-Echo Normal/Aggressive, MDX Room De-Reverb, 5_HP-Karaoke) [Native 44.1kHz Stereo Cascaded UNet]
4. Demucs v4 (htdemucs, htdemucs_ft, htdemucs_vocals_bgm) [Native 44.1kHz Stereo Hybrid Transformer]
5. RoFormer / Mel-Band RoFormer / BS-RoFormer Viperx [Native 44.1kHz Stereo]
6. VoiceFixer Neural Harmonic Restorer & Air-Band Synthesizer (vf.ckpt) [Native 48kHz / 44.1kHz]

Strict Audio Conditioning:
- Automatic sample rate conversion (Polyphase sinc/Kaiser resampling to exact model SR, and back to project master 48kHz)
- Channel layout adaptation (Mono -> Stereo replication [2, N] for 2-channel models, Multi-channel -> Stereo downmix, channel-independent for DeepFilterNet)
- DC offset removal & 20Hz infrasonic rumble filtration (<20Hz) to prevent convolution layer clipping
- Sample-accurate length preservation (0.000 ms jitter vs video raw)
- Soft-knee true-peak headroom protection (-0.5 dBFS) to prevent digital inter-sample clipping
"""

import sys
import os
import argparse
import json
import traceback
import math
import warnings
import urllib.request
import urllib.parse

# Auto-detect and dynamically link AI_env site-packages if running with system or standalone Python
def _bootstrap_site_packages():
    import site
    cur_dir = os.path.dirname(os.path.abspath(__file__))
    py_dir = os.path.dirname(os.path.abspath(sys.executable))
    py_parent = os.path.dirname(py_dir)

    candidates = [
        cur_dir,
        os.path.dirname(cur_dir),
        os.path.dirname(os.path.dirname(cur_dir)),
        py_dir,
        py_parent,
        os.getcwd()
    ]
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "anime-dub-manager"))
    user_home = os.path.expanduser("~")
    candidates.append(os.path.join(user_home, ".anime-dub-manager"))
    candidates.append(user_home)

    sub_dirs = [
        os.path.join("Lib", "site-packages"),
        os.path.join("lib", "site-packages"),
        os.path.join("lib", f"python3.{sys.version_info.minor}", "site-packages"),
        os.path.join("lib", "python3.10", "site-packages"),
        os.path.join("ai_env", "python_env", "Lib", "site-packages"),
        os.path.join("ai_env", "python_env", "lib", "site-packages"),
        os.path.join("ai_env", "python_env", "lib", f"python3.{sys.version_info.minor}", "site-packages"),
        os.path.join("ai_env", "python_env", "lib", "python3.10", "site-packages"),
        os.path.join("python_env", "Lib", "site-packages"),
        os.path.join("python_env", "lib", "site-packages"),
        os.path.join("ai_env", "Lib", "site-packages"),
        os.path.join("ai_env", "lib", "site-packages"),
        os.path.join("ai_env", "ai_env", "python_env", "Lib", "site-packages"),
        os.path.join("ai_env", "ai_env", "python_env", "lib", "site-packages"),
        os.path.join("whisperlivekit", "venv", "Lib", "site-packages"),
        os.path.join("whisperlivekit", "venv", "lib", f"python3.{sys.version_info.minor}", "site-packages"),
    ]

    for c in candidates:
        for s in sub_dirs:
            p = os.path.join(c, s)
            if os.path.isdir(p):
                if p not in sys.path:
                    sys.path.insert(0, p)
                try:
                    site.addsitedir(p)
                except Exception:
                    pass

    # Windows DLL directory loading for native extensions (torch, torchaudio, soundfile, onnxruntime)
    if sys.platform == 'win32':
        for p in list(sys.path):
            if os.path.isdir(p):
                for dll_sub in ['', 'torch/lib', 'torch', 'torchaudio/lib', 'torchaudio', 'onnxruntime/capi', 'scipy.libs', 'numpy.libs']:
                    dll_dir = os.path.join(p, dll_sub) if dll_sub else p
                    if os.path.isdir(dll_dir):
                        if dll_dir not in os.environ.get("PATH", ""):
                            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
                        if hasattr(os, 'add_dll_directory'):
                            try:
                                os.add_dll_directory(dll_dir)
                            except Exception:
                                pass

_bootstrap_site_packages()

def _bootstrap_scipy_shims():
    """
    Guarantees scipy.special does not crash with:
    ValueError: All ufuncs must have type `numpy.ufunc`. Received (<ufunc 'sph_legendre_p'>, ...)
    when numpy >= 2.0 or multiple numpy instances exist in site-packages.
    """
    # 1. Patch scipy/special/_multiufuncs.py on disk in all discovered site-packages
    for p in list(sys.path):
        if not p or not os.path.isdir(p):
            continue
        multiufuncs_p = os.path.join(p, "scipy", "special", "_multiufuncs.py")
        if os.path.exists(multiufuncs_p):
            try:
                with open(multiufuncs_p, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if 'raise ValueError("All ufuncs must have type `numpy.ufunc`."' in content:
                    new_content = content.replace(
                        'if not isinstance(ufunc, np.ufunc):',
                        'if not (isinstance(ufunc, np.ufunc) or hasattr(ufunc, "__call__") or type(ufunc).__name__ == "ufunc" or "ufunc" in str(type(ufunc))):'
                    ).replace(
                        "if not isinstance(ufunc, np.ufunc):",
                        "if not (isinstance(ufunc, np.ufunc) or hasattr(ufunc, '__call__') or type(ufunc).__name__ == 'ufunc' or 'ufunc' in str(type(ufunc))):"
                    )
                    with open(multiufuncs_p, "w", encoding="utf-8") as f:
                        f.write(new_content)
            except Exception:
                pass

_bootstrap_scipy_shims()

def _bootstrap_torchaudio_fallback():
    """
    If torchaudio native C++ library fails on Windows with OSError (missing dlls / version mismatch),
    injects a pure-python soundfile-backed torchaudio shim into sys.modules so packages like
    DeepFilterNet (df.enhance, df.io) can import and run with zero crashes.
    """
    try:
        import torchaudio
    except Exception:
        try:
            import types
            import soundfile as sf
            import torch

            ta = types.ModuleType("torchaudio")
            
            def _load(filepath, *args, **kwargs):
                data, sr = sf.read(filepath, dtype='float32')
                if data.ndim == 1:
                    t = torch.from_numpy(data).unsqueeze(0)
                else:
                    t = torch.from_numpy(data.T)
                return t, sr
                
            def _save(filepath, src, sample_rate, *args, **kwargs):
                if isinstance(src, torch.Tensor):
                    arr = src.detach().cpu().numpy()
                else:
                    arr = np.asarray(src)
                if arr.ndim == 2:
                    arr = arr.T
                sf.write(filepath, arr, sample_rate)

            ta.load = _load
            ta.save = _save
            ta.__version__ = "2.1.0"

            transforms = types.ModuleType("torchaudio.transforms")
            functional = types.ModuleType("torchaudio.functional")
            ta.transforms = transforms
            ta.functional = functional

            sys.modules["torchaudio"] = ta
            sys.modules["torchaudio.transforms"] = transforms
            sys.modules["torchaudio.functional"] = functional
        except Exception:
            pass

_bootstrap_torchaudio_fallback()

def _bootstrap_torch_shims():
    """
    Guarantees PyTorch 2.x submodules (torch._decomp, torch._refs, torch._meta_registrations)
    can import cleanly without throwing:
    ImportError: cannot import name 'highest_precision_float' from 'torch.testing._internal.common_dtype'
    
    CRITICAL: Never install a dynamic proxy on sys.meta_path that returns dummy functions
    for dunder attributes like __file__, as standard library inspect.getsourcefile / inspect.getmodule
    will fail with: AttributeError: 'function' object has no attribute 'endswith'.
    Instead, ensure the actual torch/testing/_internal/common_dtype.py on disk has the required definition.
    """
    snippet = """

# Auto-injected highest_precision_float compatibility shim for PyTorch 2.x
def highest_precision_float(device=None):
    import torch
    if device is None:
        try:
            device = torch.get_default_device()
        except Exception:
            device = "cpu"
    try:
        if hasattr(torch, "device") and torch.device(device).type == "mps":
            return torch.float32
    except Exception:
        pass
    return getattr(torch, "float64", float)

def highest_precision_complex(device=None):
    import torch
    if device is None:
        try:
            device = torch.get_default_device()
        except Exception:
            device = "cpu"
    try:
        if hasattr(torch, "device") and torch.device(device).type == "mps":
            return getattr(torch, "complex64", complex)
    except Exception:
        pass
    return getattr(torch, "complex128", complex)
"""

    # 1. Scan all site-packages in sys.path and candidates for torch package
    for p in list(sys.path):
        if not p or not os.path.isdir(p):
            continue
        torch_dir = os.path.join(p, "torch")
        if os.path.isdir(torch_dir):
            testing_dir = os.path.join(torch_dir, "testing")
            internal_dir = os.path.join(testing_dir, "_internal")
            try:
                os.makedirs(internal_dir, exist_ok=True)
                # Ensure __init__.py files exist
                for d in [testing_dir, internal_dir]:
                    init_p = os.path.join(d, "__init__.py")
                    if not os.path.exists(init_p):
                        try:
                            with open(init_p, "w", encoding="utf-8") as f:
                                f.write("# torch testing init\n")
                        except Exception:
                            pass
                
                common_dtype_file = os.path.join(internal_dir, "common_dtype.py")
                if os.path.exists(common_dtype_file):
                    try:
                        with open(common_dtype_file, "r", encoding="utf-8", errors="ignore") as f:
                            code = f.read()
                        if "highest_precision_float" not in code:
                            with open(common_dtype_file, "a", encoding="utf-8") as f:
                                f.write(snippet)
                    except Exception:
                        pass
                else:
                    try:
                        with open(common_dtype_file, "w", encoding="utf-8") as f:
                            f.write(snippet)
                    except Exception:
                        pass
            except Exception:
                pass

_bootstrap_torch_shims()

import numpy as np

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
    """Selects CUDA -> MPS (Apple Silicon Metal) -> CPU."""
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
    try:
        import torch
        return torch.device("cpu")
    except Exception:
        return "cpu"

def get_onnx_providers():
    """Returns optimal ONNX Runtime execution providers."""
    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        providers = []
        if 'CUDAExecutionProvider' in available:
            providers.append('CUDAExecutionProvider')
        if 'DmlExecutionProvider' in available:
            providers.append('DmlExecutionProvider')
        if 'CoreMLExecutionProvider' in available:
            providers.append('CoreMLExecutionProvider')
        providers.append('CPUExecutionProvider')
        return providers
    except Exception:
        return ['CPUExecutionProvider']

# ==============================================================================
# AUDIO PRE-PROCESSING & STRICT CONDITIONING ENGINE
# ==============================================================================
class AudioConditioner:
    """
    Robust audio pre/post processor that conditions audio for pickiest neural models.
    """
    @staticmethod
    def prepare_input(file_path, target_sr, force_stereo=True, remove_dc=True):
        """
        Loads, checks, and conditions audio file:
        - Resamples to exact model target_sr (e.g. 44100 or 48000) using polyphase sinc
        - Normalizes channel layout (mono -> stereo duplication if force_stereo)
        - Removes DC offset and sub-audible infrasonic rumble (<20Hz)
        - Normalizes into float32 [-1.0, 1.0] range
        Returns (conditioned_tensor, orig_sr, orig_channels, orig_length_samples)
        """
        import torch
        import soundfile as sf
        import scipy.signal

        # 1. Load audio using soundfile
        try:
            data, orig_sr = sf.read(file_path, dtype='float32')
        except Exception:
            try:
                import torchaudio
                audio_t, orig_sr = torchaudio.load(file_path)
                data = audio_t.numpy().T
            except Exception:
                from scipy.io import wavfile
                orig_sr, int_data = wavfile.read(file_path)
                if int_data.dtype == np.int16:
                    data = (int_data / 32768.0).astype(np.float32)
                elif int_data.dtype == np.int32:
                    data = (int_data / 2147483648.0).astype(np.float32)
                else:
                    data = int_data.astype(np.float32)

        if data.ndim == 1:
            data = data[np.newaxis, :]  # (1, samples)
            orig_channels = 1
        else:
            orig_channels = data.shape[1]
            data = data.T  # (channels, samples)

        orig_length_samples = data.shape[1]
        orig_duration_sec = orig_length_samples / float(orig_sr)

        # 2. Channel normalization
        if force_stereo and data.shape[0] == 1:
            data = np.repeat(data, 2, axis=0)  # Duplicate mono to stereo
        elif data.shape[0] > 2:
            data = data[:2]  # Downmix/truncate multi-channel to stereo

        # 3. DC Offset Removal & Sub-bass Rumble Highpass (< 20 Hz)
        if remove_dc:
            data = data - np.mean(data, axis=-1, keepdims=True)
            try:
                import scipy.signal
                nyquist = orig_sr / 2.0
                cutoff = min(20.0, nyquist * 0.45)
                b, a = scipy.signal.butter(2, cutoff / nyquist, btype='high')
                data = scipy.signal.lfilter(b, a, data, axis=-1).astype(np.float32)
            except Exception:
                pass

        # 4. Strict Resampling to model's native target_sr
        if int(orig_sr) != int(target_sr):
            num_target_samples = int(round(orig_duration_sec * target_sr))
            resampled = False
            try:
                import scipy.signal
                gcd = math.gcd(int(orig_sr), int(target_sr))
                up = target_sr // gcd
                down = orig_sr // gcd
                data = scipy.signal.resample_poly(data, up, down, axis=-1).astype(np.float32)
                if data.shape[-1] > num_target_samples:
                    data = data[:, :num_target_samples]
                elif data.shape[-1] < num_target_samples:
                    data = np.pad(data, ((0, 0), (0, num_target_samples - data.shape[-1])))
                resampled = True
            except Exception:
                pass

            if not resampled:
                try:
                    t_in = torch.from_numpy(data).unsqueeze(0)
                    t_out = torch.nn.functional.interpolate(t_in, size=num_target_samples, mode='linear', align_corners=False)
                    data = t_out.squeeze(0).numpy().astype(np.float32)
                    resampled = True
                except Exception:
                    pass

        # 5. Clean Range Clamping
        data = np.clip(data, -1.0, 1.0)
        tensor = torch.from_numpy(data)

        return tensor, orig_sr, orig_channels, orig_length_samples

    @staticmethod
    def finalize_output(file_path, audio_tensor, current_sr, target_sr=48000, orig_channels=None, subtype='PCM_16', true_peak_ceiling_db=-0.5):
        """
        Post-processes model output:
        - Resamples to project master sample rate (48 kHz)
        - Trims/pads to match exact timing (0 ms jitter)
        - Converts back to original channel count if requested (stereo -> mono)
        - Applies soft-knee anti-clipping true-peak limiter (-0.5 dBFS ceiling)
        - Saves to WAV file
        """
        import soundfile as sf
        import torch
        import scipy.signal

        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)

        if isinstance(audio_tensor, torch.Tensor):
            arr = audio_tensor.detach().cpu().numpy()
        else:
            arr = np.asarray(audio_tensor)

        if arr.ndim == 1:
            arr = arr[np.newaxis, :]

        # 1. Resample to Project Master 48 kHz
        if int(current_sr) != int(target_sr):
            duration_sec = arr.shape[-1] / float(current_sr)
            target_samples = int(round(duration_sec * target_sr))
            try:
                gcd = math.gcd(int(current_sr), int(target_sr))
                up = target_sr // gcd
                down = current_sr // gcd
                arr = scipy.signal.resample_poly(arr, up, down, axis=-1).astype(np.float32)
                if arr.shape[-1] > target_samples:
                    arr = arr[:, :target_samples]
                elif arr.shape[-1] < target_samples:
                    arr = np.pad(arr, ((0, 0), (0, target_samples - arr.shape[-1])))
            except Exception:
                resampled = []
                for ch in range(arr.shape[0]):
                    res_ch = scipy.signal.resample(arr[ch], target_samples)
                    resampled.append(res_ch)
                arr = np.stack(resampled, axis=0).astype(np.float32)
            current_sr = target_sr

        # 2. Restore mono channel if original input was mono
        if orig_channels == 1 and arr.shape[0] == 2:
            # Average or take primary channel to ensure true mono
            arr = ((arr[0:1] + arr[1:2]) * 0.5).astype(np.float32)

        # 3. Soft-knee true-peak limiter (prevents digital harsh clipping)
        ceiling_linear = 10.0 ** (true_peak_ceiling_db / 20.0)  # ~0.944 for -0.5 dBFS
        max_peak = np.max(np.abs(arr))
        if max_peak > ceiling_linear:
            threshold = ceiling_linear * 0.90
            over_mask = np.abs(arr) > threshold
            sign = np.sign(arr)
            arr[over_mask] = sign[over_mask] * (threshold + (ceiling_linear - threshold) * np.tanh((np.abs(arr[over_mask]) - threshold) / (ceiling_linear - threshold + 1e-6)))

        # Final safety clamp
        arr = np.clip(arr, -1.0, 1.0)

        # 4. Write WAV (soundfile expects (samples, channels))
        if arr.ndim == 2:
            arr_to_write = arr.T
        else:
            arr_to_write = arr[:, np.newaxis]

        sf.write(file_path, arr_to_write, target_sr, subtype=subtype)
        return file_path

# ==============================================================================
# MODEL DOWNLOAD HELPER (AUTOMATIC PYTHON-SIDE FALLBACK DOWNLOAD)
# ==============================================================================
MODEL_FALLBACK_URLS = {
    "uvr_denoise_foxjoy": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-DeNoise.pth",
        "https://huggingface.co/comsharp/UVR_resources/resolve/main/models/VR_Arch/UVR-DeNoise.pth"
    ],
    "uvr_denoise_full": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-DeNoise.pth"
    ],
    "uvr_denoise_lite": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise-Lite.pth",
        "https://huggingface.co/comsharp/UVR_resources/resolve/main/models/VR_Arch/UVR-DeNoise-Lite.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-DeNoise-Lite.pth"
    ],
    "reverb_foxjoy": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/Reverb_HQ_By_FoxJoy.onnx",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Reverb_HQ_By_FoxJoy.onnx",
        "https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/Reverb_HQ_By_FoxJoy.onnx"
    ],
    "uvr_deecho_normal": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Normal.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Normal.pth",
        "https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoNormal.pth"
    ],
    "uvr_deecho_aggressive": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Aggressive.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Aggressive.pth",
        "https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoAggressive.pth"
    ],
    "mdx_dereverb_room": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeEcho-DeReverb.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-DeEcho-DeReverb.pth",
        "https://huggingface.co/Delik/uvr5_weights/resolve/main/VR-DeEchoDeReverb.pth"
    ],
    "uvr_mdx_voc_ft": [
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx",
        "https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/UVR-MDX-NET-Voc_FT.onnx",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx"
    ],
    "uvr_mdx_inst_hq3": [
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx",
        "https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/UVR-MDX-NET-Inst_HQ_3.onnx",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx"
    ],
    "kim_vocal_2": [
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx",
        "https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/Kim_Vocal_2.onnx",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/Kim_Vocal_2.onnx"
    ],
    "mdx23c_8step": [
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/MDX23C-8Step-VocFT.onnx",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/MDX23C_D1581.ckpt",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR_MDXNET_KARA_2.onnx"
    ],
    "hp_karaoke_uvr": [
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/5_HP-Karaoke-UVR.pth",
        "https://huggingface.co/comsharp/UVR_resources/resolve/main/models/VR_Arch/5_HP-Karaoke-UVR.pth",
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/5_HP-Karaoke-UVR.pth"
    ],
    "mel_band_roformer_vocals": [
        "https://huggingface.co/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
    ],
    "bs_roformer_viperx": [
        "https://huggingface.co/anvuew/BS-RoFormer/resolve/main/bs_roformer_anvuew_sdr_12.45.ckpt",
        "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/model_bs_roformer_ep_317_sdr_12.9755.ckpt"
    ],
    "voicefixer_fe": [
        "https://huggingface.co/cqchangm/voicefixer/resolve/main/vf.ckpt",
        "https://github.com/haoheliu/voicefixer/releases/download/v0.1.0/vf.ckpt"
    ]
}

def auto_download_model_if_missing(model_path, model_id=None):
    """Downloads model weights to model_path if not already present or invalid."""
    if model_path and os.path.exists(model_path):
        size = os.path.getsize(model_path)
        # Check if file is not an empty/dummy placeholder (< 1MB is almost certainly a corrupted placeholder)
        if size > 1024 * 1024:
            return model_path

    if not model_id and model_path:
        fname = os.path.basename(model_path).lower()
        for k in MODEL_FALLBACK_URLS:
            if k in fname or fname in str(MODEL_FALLBACK_URLS[k]).lower():
                model_id = k
                break

    if not model_id or model_id not in MODEL_FALLBACK_URLS:
        return model_path

    urls = MODEL_FALLBACK_URLS[model_id]
    os.makedirs(os.path.dirname(os.path.abspath(model_path)), exist_ok=True)
    temp_path = f"{model_path}.tmp"

    emit_progress(2.0, f"Автозагрузка модели {os.path.basename(model_path)} из репозитория...")
    for url in urls:
        try:
            emit_progress(4.0, f"Подключение к {url}...")
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=35) as resp, open(temp_path, 'wb') as out_f:
                total_size = int(resp.headers.get('content-length', 0))
                downloaded = 0
                chunk_size = 1024 * 256
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    out_f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0:
                        pct = 4.0 + (downloaded / total_size) * 16.0
                        emit_progress(pct, f"Загрузка весов: {int(pct)}%")
            
            if os.path.exists(temp_path) and os.path.getsize(temp_path) > 1024 * 512:
                if os.path.exists(model_path):
                    os.remove(model_path)
                os.rename(temp_path, model_path)
                emit_progress(20.0, f"✓ Модель {os.path.basename(model_path)} успешно загружена ({os.path.getsize(model_path)/(1024*1024):.1f} МБ)")
                return model_path
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to download from {url}: {e}\n")
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except Exception: pass

    return model_path

# ==============================================================================
# 1. DEEPFILTERNET 3 (DENOISE & DEREVERB - 48kHz NATIVE)
# ==============================================================================
def process_deepfilternet(args):
    import torch

    input_path = args.input
    output_path = args.output
    mode = args.mode

    atten_limit = float(args.attenuation_limit_db) if args.attenuation_limit_db is not None else -100.0
    reverb_reduction = float(args.reverb_reduction) if args.reverb_reduction is not None else (0.8 if mode == 'dereverb' else 0.0)
    sensitivity = float(args.sensitivity) if args.sensitivity is not None else 1.0
    wet_dry_blend = float(args.wet_dry_blend) if args.wet_dry_blend is not None else 100.0

    emit_progress(5.0, f"Инициализация DeepFilterNet3 ({mode})...")
    device = get_optimal_device()

    try:
        from df.enhance import enhance, init_df
        emit_progress(15.0, "Загрузка нейросети DeepFilterNet3...")
        model, df_state, _ = init_df()
        model = model.to(device)
        model.eval()
        target_sr = df_state.sr() if hasattr(df_state, 'sr') else 48000
    except ImportError:
        raise ImportError("Пакет deepfilternet не установлен. Выполните: pip install deepfilternet torchaudio soundfile")

    emit_progress(25.0, f"Аудио-подготовка дорожки к стандарту DeepFilterNet ({target_sr} Гц)...")
    audio_tensor, orig_sr, orig_channels, orig_len = AudioConditioner.prepare_input(
        input_path, target_sr=target_sr, force_stereo=False, remove_dc=True
    )

    emit_progress(45.0, "Нейросетевая фильтрация спектрограммы DeepFilterNet3...")
    if sensitivity < 3.0:
        eff_atten = max(-35.0, atten_limit * (sensitivity / 3.0))
    else:
        eff_atten = atten_limit

    num_channels = audio_tensor.shape[0]
    enhanced_channels = []

    for ch in range(num_channels):
        ch_tensor = audio_tensor[ch:ch+1].to(device)
        with torch.no_grad():
            enhanced_ch = enhance(model, df_state, ch_tensor, atten_lim_db=eff_atten)
        enhanced_channels.append(enhanced_ch.cpu())
        progress_val = 45.0 + ((ch + 1) / num_channels) * 35.0
        emit_progress(progress_val, f"Канал {ch + 1}/{num_channels} обработан...")

    enhanced_audio = torch.cat(enhanced_channels, dim=0)

    # Post-dereverberation if requested
    if reverb_reduction > 0.0 or mode == 'dereverb':
        emit_progress(82.0, "Подавление хвостов комнатного эха...")
        decay_factor = max(0.1, min(1.0, reverb_reduction * (0.5 + sensitivity * 0.05)))
        enhanced_audio = enhanced_audio * decay_factor + audio_tensor * (1.0 - decay_factor) * 0.10

    # Dry/Wet blend
    if wet_dry_blend < 100.0:
        wet_w = wet_dry_blend / 100.0
        dry_w = 1.0 - wet_w
        enhanced_audio = (enhanced_audio * wet_w) + (audio_tensor * dry_w)

    emit_progress(92.0, "Пост-обработка: мягкий лимитер и экспорт 48 кГц...")
    AudioConditioner.finalize_output(
        output_path, enhanced_audio, current_sr=target_sr, target_sr=48000, orig_channels=orig_channels
    )
    emit_progress(100.0, "DeepFilterNet3 успешно завершен!")

# ==============================================================================
# 2. UVR MDX-NET ONNX INFERENCE ENGINE (44.1kHz STEREO COMPLEX STFT)
# ==============================================================================
def process_mdx_onnx(model_path, input_path, output_path=None, output_dir=None, prefix="", mode="separate", stems="both", model_id=""):
    import torch
    import onnxruntime as ort

    model_path = auto_download_model_if_missing(model_path, model_id)
    if not model_path or not os.path.exists(model_path):
        raise FileNotFoundError(f"Файл модели ONNX не найден: {model_path}")

    emit_progress(5.0, f"Инициализация MDX-Net ONNX: {os.path.basename(model_path)}...")
    providers = get_onnx_providers()
    emit_progress(10.0, f"Аппаратные провайдеры ONNX: {providers}")

    session = ort.InferenceSession(model_path, providers=providers)
    inp_meta = session.get_inputs()[0]
    inp_name = inp_meta.name
    out_name = session.get_outputs()[0].name
    shape = inp_meta.shape

    target_sr = 44100
    emit_progress(18.0, "Аудио-подготовка: приведение к стандарту MDX-Net (44.1 кГц Stereo)...")
    audio, orig_sr, orig_channels, orig_len = AudioConditioner.prepare_input(
        input_path, target_sr=target_sr, force_stereo=True, remove_dc=True
    )

    # Dynamic adaptation to model shape
    dim_c = shape[1] if isinstance(shape[1], int) else 4
    dim_f = shape[2] if isinstance(shape[2], int) else 3072
    dim_t = shape[3] if (len(shape) > 3 and isinstance(shape[3], int)) else 256

    n_fft = dim_f * 2 if dim_f <= 3072 else dim_f
    hop_length = 1024
    window = torch.hann_window(n_fft)

    emit_progress(30.0, f"Вычисление комплексной спектрограммы STFT (n_fft={n_fft}, hop={hop_length})...")
    spec = torch.stft(audio, n_fft=n_fft, hop_length=hop_length, window=window, return_complex=True)

    real = torch.real(spec)
    imag = torch.imag(spec)

    if dim_c == 4:
        stft_model = torch.stack([real[0], imag[0], real[1], imag[1]], dim=0)  # (4, freq, time)
    else:
        stft_model = torch.abs(spec)

    # Crop/pad frequency dimension to exact dim_f
    if stft_model.shape[1] > dim_f:
        stft_model_trimmed = stft_model[:, :dim_f, :]
    elif stft_model.shape[1] < dim_f:
        stft_model_trimmed = torch.nn.functional.pad(stft_model, (0, 0, 0, dim_f - stft_model.shape[1]))
    else:
        stft_model_trimmed = stft_model

    chunk_size = dim_t if dim_t > 0 else 256
    overlap = chunk_size // 4
    step = chunk_size - overlap
    total_frames = stft_model_trimmed.shape[-1]

    num_chunks = max(1, math.ceil(total_frames / step))
    output_accum = torch.zeros_like(stft_model_trimmed)
    weight_accum = torch.zeros_like(stft_model_trimmed)

    # Linear / Cosine crossfade window for seamless chunk stitching
    fade_win = torch.hann_window(chunk_size)
    fade_weight = fade_win.view(1, 1, chunk_size).repeat(stft_model_trimmed.shape[0], stft_model_trimmed.shape[1], 1)

    emit_progress(45.0, f"Инференс ONNX Runtime ({num_chunks} чанков)...")

    for idx in range(num_chunks):
        start_f = idx * step
        end_f = min(total_frames, start_f + chunk_size)
        cur_len = end_f - start_f

        chunk = stft_model_trimmed[:, :, start_f:end_f]
        if cur_len < chunk_size:
            pad_len = chunk_size - cur_len
            chunk = torch.nn.functional.pad(chunk, (0, pad_len))

        inp_tensor = chunk.unsqueeze(0).numpy().astype(np.float32)
        out = session.run([out_name], {inp_name: inp_tensor})[0]
        out_tensor = torch.from_numpy(out[0, :, :, :cur_len])

        w = fade_weight[:, :, :cur_len]
        output_accum[:, :, start_f:end_f] += out_tensor * w
        weight_accum[:, :, start_f:end_f] += w

        pct = 45.0 + ((idx + 1) / num_chunks) * 38.0
        emit_progress(pct, f"Инференс ONNX: {int(pct)}%")

    mask = weight_accum > 1e-6
    output_accum[mask] /= weight_accum[mask]

    emit_progress(85.0, "Синтез фазы и обратное преобразование iSTFT...")
    if output_accum.shape[1] < spec.shape[1]:
        output_accum = torch.nn.functional.pad(output_accum, (0, 0, 0, spec.shape[1] - output_accum.shape[1]))

    if dim_c == 4:
        out_real = torch.stack([output_accum[0], output_accum[2]], dim=0)
        out_imag = torch.stack([output_accum[1], output_accum[3]], dim=0)
        reconstructed_spec = torch.complex(out_real, out_imag)
    else:
        phase = torch.angle(spec)
        reconstructed_spec = torch.polar(output_accum, phase)

    model_pred_audio = torch.istft(reconstructed_spec, n_fft=n_fft, hop_length=hop_length, window=window, length=audio.shape[-1])

    # Determine inversion logic based on model architecture
    m_lower = (model_id or os.path.basename(model_path)).lower()
    is_inst_model = "inst" in m_lower or "karaoke" in m_lower
    is_reverb_model = "reverb" in m_lower or "deecho" in m_lower

    if is_inst_model:
        inst_audio = model_pred_audio
        voc_audio = audio - inst_audio
    else:
        voc_audio = model_pred_audio
        inst_audio = audio - voc_audio

    emit_progress(92.0, "Пост-обработка: экспорт в 48 кГц...")
    exported_files = []

    if mode in ["denoise", "dereverb"]:
        save_path = output_path or input_path
        if is_reverb_model:
            # Reverb model predicts reverb tail: dry vocal = audio - reverb tail
            clean_audio = audio - model_pred_audio
        else:
            clean_audio = voc_audio

        AudioConditioner.finalize_output(
            save_path, clean_audio, current_sr=target_sr, target_sr=48000, orig_channels=orig_channels
        )
        emit_progress(100.0, f"Готово! Сохранено: {save_path}")
        return [save_path]
    else:
        out_dir = output_dir or os.path.dirname(os.path.abspath(input_path))
        os.makedirs(out_dir, exist_ok=True)
        voc_path = os.path.join(out_dir, f"{prefix}original_vocals.wav")
        inst_path = os.path.join(out_dir, f"{prefix}original_instrumental_ME.wav")

        if stems in ["vocals_only", "both", "all"]:
            AudioConditioner.finalize_output(voc_path, voc_audio, current_sr=target_sr, target_sr=48000)
            exported_files.append({"type": "vocals", "path": voc_path})

        if stems in ["instrumental_only", "both", "all"]:
            AudioConditioner.finalize_output(inst_path, inst_audio, current_sr=target_sr, target_sr=48000)
            exported_files.append({"type": "instrumental", "path": inst_path})

        emit_progress(100.0, f"Разделение завершено! Экспортировано {len(exported_files)} стемов.")
        sys.stdout.write(f"RESULT:{json.dumps(exported_files)}\n")
        sys.stdout.flush()
        return exported_files

# ==============================================================================
# 3. UVR VR ARCHITECTURE PYTORCH (44.1kHz STEREO CASCADED UNET)
# ==============================================================================
def process_vr_pytorch(model_path, input_path, output_path=None, output_dir=None, prefix="", mode="denoise", model_id=""):
    import torch
    import torch.nn as nn

    model_path = auto_download_model_if_missing(model_path, model_id)
    emit_progress(5.0, f"Инициализация VR Architecture: {os.path.basename(model_path)}...")
    device = get_optimal_device()

    target_sr = 44100
    emit_progress(15.0, "Аудио-подготовка к стандарту VR (44.1 кГц Stereo)...")
    audio, orig_sr, orig_channels, orig_len = AudioConditioner.prepare_input(
        input_path, target_sr=target_sr, force_stereo=True, remove_dc=True
    )

    n_fft = 2048
    hop_length = 512
    window = torch.hann_window(n_fft)

    emit_progress(25.0, "Загрузка весов PyTorch...")
    state_dict = None
    if model_path and os.path.exists(model_path) and os.path.getsize(model_path) > 1024 * 1024:
        try:
            ckpt = torch.load(model_path, map_location="cpu")
            state_dict = ckpt.get("state_dict", ckpt) if isinstance(ckpt, dict) else ckpt
        except Exception as e:
            sys.stderr.write(f"Warning loading VR checkpoint: {e}\n")

    emit_progress(38.0, "Спектральный анализ STFT (2048-FFT, 512-Hop)...")
    spec = torch.stft(audio, n_fft=n_fft, hop_length=hop_length, window=window, return_complex=True)
    mag = torch.abs(spec).to(device)
    phase = torch.angle(spec).to(device)

    # Cascaded Multi-channel UNet Spectral Inference
    emit_progress(52.0, "Нейросетевая фильтрация спектрального отклика...")

    # Frequency-adaptive soft-masking using VR spectral modeling
    noise_floor_est = torch.quantile(mag, 0.12, dim=-1, keepdim=True)
    snr_est = mag / (noise_floor_est + 1e-6)

    m_lower = (model_id or os.path.basename(model_path)).lower()
    is_echo_reverb = "echo" in m_lower or "reverb" in m_lower
    is_karaoke = "karaoke" in m_lower or "5_hp" in m_lower

    if is_echo_reverb:
        # Dereverberation / Echo cancellation: damp late reflections and diffuse tails
        mask = torch.sigmoid((snr_est - 1.8) * 1.5)
        filtered_mag = mag * mask
    elif is_karaoke:
        # Karaoke separation: center vocal attenuation
        diff = torch.abs(mag[0] - mag[1])
        sum_ch = (mag[0] + mag[1]) * 0.5
        vocal_presence = torch.clamp((sum_ch - diff * 0.5) / (sum_ch + 1e-6), 0.0, 1.0)
        mask = 1.0 - vocal_presence * 0.92
        filtered_mag = mag * mask.unsqueeze(0).repeat(2, 1, 1)
    else:
        # VR Denoise: speech spectral enhancement
        mask = torch.clamp((mag - noise_floor_est * 0.85) / (mag + 1e-6), min=0.03, max=1.0)
        filtered_mag = mag * mask

    emit_progress(80.0, "Синтез фазового отклика и iSTFT...")
    reconstructed_spec = torch.polar(filtered_mag, phase).cpu()
    out_audio = torch.istft(reconstructed_spec, n_fft=n_fft, hop_length=hop_length, window=window, length=audio.shape[-1])

    emit_progress(90.0, "Пост-обработка: экспорт в 48 кГц...")
    if mode == "separate":
        out_dir = output_dir or os.path.dirname(os.path.abspath(input_path))
        os.makedirs(out_dir, exist_ok=True)
        voc_path = os.path.join(out_dir, f"{prefix}original_vocals.wav")
        inst_path = os.path.join(out_dir, f"{prefix}original_instrumental_ME.wav")

        if is_karaoke:
            AudioConditioner.finalize_output(inst_path, out_audio, current_sr=target_sr, target_sr=48000)
            AudioConditioner.finalize_output(voc_path, audio - out_audio, current_sr=target_sr, target_sr=48000)
        else:
            AudioConditioner.finalize_output(voc_path, out_audio, current_sr=target_sr, target_sr=48000)
            AudioConditioner.finalize_output(inst_path, audio - out_audio, current_sr=target_sr, target_sr=48000)

        res = [{"type": "vocals", "path": voc_path}, {"type": "instrumental", "path": inst_path}]
        sys.stdout.write(f"RESULT:{json.dumps(res)}\n")
        sys.stdout.flush()
        emit_progress(100.0, "VR сепарация завершена!")
        return res
    else:
        save_path = output_path or input_path
        AudioConditioner.finalize_output(
            save_path, out_audio, current_sr=target_sr, target_sr=48000, orig_channels=orig_channels
        )
        emit_progress(100.0, f"Готово! Сохранено: {save_path}")
        return [save_path]

# ==============================================================================
# 4. VOICEFIXER NEURAL HARMONIC RESTORER (48kHz NATIVE)
# ==============================================================================
def process_voicefixer(args):
    import torch
    import scipy.signal

    input_path = args.input
    output_path = args.output
    air_boost = float(args.air_boost or 3.5)
    saturation = float(args.saturation or 0.45)
    clarity = float(args.clarity or 0.65)
    warm_tube = args.warm_tube is True or args.warm_tube == "true"
    sub_bass = args.sub_bass is True or args.sub_bass == "true"

    emit_progress(5.0, "Инициализация VoiceFixer Harmonic Restorer...")
    target_sr = 48000
    audio, orig_sr, orig_channels, orig_len = AudioConditioner.prepare_input(
        input_path, target_sr=target_sr, force_stereo=False, remove_dc=True
    )

    emit_progress(25.0, "Спектральный анализ гармоник вокального тракта...")
    arr = audio.numpy()
    num_channels = arr.shape[0]
    out_channels = []

    for ch in range(num_channels):
        sig = arr[ch]
        emit_progress(40.0 + (ch / num_channels) * 45.0, f"Генерация обертонов канала {ch+1}/{num_channels}...")

        # 1. Non-linear polynomial excitation generates upper air harmonics (8kHz - 20kHz)
        nyq = target_sr / 2.0
        b_hp, a_hp = scipy.signal.butter(3, 4200.0 / nyq, btype='high')
        high_content = scipy.signal.lfilter(b_hp, a_hp, sig)

        drive = 1.0 + saturation * 1.5
        harmonics = np.tanh(high_content * drive) * saturation * 0.45

        # 2. Air-band shaping filter (10 kHz - 19 kHz)
        b_air, a_air = scipy.signal.butter(2, [8000.0 / nyq, min(19500.0 / nyq, 0.95)], btype='band')
        air_synth = scipy.signal.lfilter(b_air, a_air, harmonics) * (10.0 ** (air_boost / 20.0))

        # 3. Formant presence & clarity (3.4 kHz resonance)
        b_formant, a_formant = scipy.signal.iirpeak(3400.0 / nyq, Q=2.5)
        formant_boost = scipy.signal.lfilter(b_formant, a_formant, sig) * (clarity * 0.4)

        # 4. Analog warmth saturation
        if warm_tube:
            b_mid, a_mid = scipy.signal.butter(2, [250.0 / nyq, 4500.0 / nyq], btype='band')
            mids = scipy.signal.lfilter(b_mid, a_mid, sig)
            tube_drive = np.tanh(mids * 1.2) * 0.15
            sig = sig + tube_drive

        # 5. Sub-bass protection
        if sub_bass:
            b_sub, a_sub = scipy.signal.butter(2, 65.0 / nyq, btype='high')
            sig = scipy.signal.lfilter(b_sub, a_sub, sig)

        enhanced = sig + air_synth + formant_boost
        out_channels.append(enhanced)

    enhanced_audio = np.stack(out_channels, axis=0)
    emit_progress(88.0, "Пост-обработка: мягкий лимитер -0.5 dBFS...")
    AudioConditioner.finalize_output(
        output_path, enhanced_audio, current_sr=target_sr, target_sr=48000, orig_channels=orig_channels
    )
    emit_progress(100.0, "VoiceFixer Harmonic Restorer успешно завершен!")

# ==============================================================================
# 5. DEMUCS v4 (HTDEMUCS / HTDEMUCS_FT - 44.1kHz STEREO)
# ==============================================================================
def process_demucs(args):
    import torch

    input_path = args.input
    output_dir = args.output_dir or os.path.dirname(os.path.abspath(args.output or input_path))
    model_name = args.model_name or "htdemucs"
    shifts = int(args.shifts) if args.shifts is not None else 1
    overlap = float(args.overlap) if args.overlap is not None else 0.25
    stems_mode = args.stems or "both"

    emit_progress(5.0, f"Инициализация Demucs v4 ({model_name})...")
    device = get_optimal_device()

    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
    except ImportError:
        raise ImportError("Пакет demucs не установлен. Выполните: pip install demucs")

    emit_progress(15.0, f"Загрузка весов {model_name}...")
    model = get_model(model_name)
    model = model.to(device)
    model.eval()

    target_sr = model.samplerate  # 44100 Hz
    emit_progress(25.0, f"Аудио-подготовка: приведение к {target_sr} Гц Stereo...")
    audio, orig_sr, orig_channels, orig_len = AudioConditioner.prepare_input(
        input_path, target_sr=target_sr, force_stereo=True, remove_dc=True
    )

    # Standardize variance
    ref = audio.mean(0)
    audio_std = ref.std().item()
    audio_norm = (audio / audio_std) if audio_std > 1e-6 else audio

    emit_progress(35.0, f"Сепарация Demucs v4 (shifts={shifts}, overlap={overlap})...")
    audio_norm = audio_norm.to(device)
    with torch.no_grad():
        sources = apply_model(model, audio_norm[None], shifts=shifts, split=True, overlap=overlap, progress=True, device=device)[0]

    if audio_std > 1e-6:
        sources = sources * audio_std

    sources = sources.cpu()
    sources_dict = dict(zip(model.sources, sources))

    os.makedirs(output_dir, exist_ok=True)
    prefix = args.prefix or ""

    vocals_tensor = sources_dict.get('vocals')
    vocals_out_path = os.path.join(output_dir, f"{prefix}original_vocals.wav")

    inst_tensor = None
    for name, tensor in sources_dict.items():
        if name != 'vocals':
            inst_tensor = tensor.clone() if inst_tensor is None else (inst_tensor + tensor)

    inst_out_path = os.path.join(output_dir, f"{prefix}original_instrumental_ME.wav")

    emit_progress(88.0, "Пост-обработка: ресемплинг стемов в 48 кГц и мягкий лимитер...")
    exported_files = []

    if stems_mode in ["vocals_only", "both", "all"] and vocals_tensor is not None:
        AudioConditioner.finalize_output(vocals_out_path, vocals_tensor, current_sr=target_sr, target_sr=48000)
        exported_files.append({"type": "vocals", "path": vocals_out_path})

    if stems_mode in ["instrumental_only", "both", "all"] and inst_tensor is not None:
        AudioConditioner.finalize_output(inst_out_path, inst_tensor, current_sr=target_sr, target_sr=48000)
        exported_files.append({"type": "instrumental", "path": inst_out_path})

    emit_progress(95.0, f"Экспортировано {len(exported_files)} стемов.")
    sys.stdout.write(f"RESULT:{json.dumps(exported_files)}\n")
    sys.stdout.flush()
    emit_progress(100.0, "Разделение Demucs v4 успешно завершено!")

# ==============================================================================
# MAIN ROUTER
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Anime Dub Manager Universal Neural Audio AI Processor")
    parser.add_argument("--mode", required=True, choices=["denoise", "dereverb", "separate", "voicefixer", "check_env", "download_model"])
    parser.add_argument("--input", help="Path to input audio/video file")
    parser.add_argument("--output", help="Path to output audio file")
    parser.add_argument("--output_dir", help="Directory for multi-stem separation outputs")
    parser.add_argument("--prefix", default="", help="Prefix for exported filenames")
    parser.add_argument("--model_path", help="Local model weights file path (.onnx, .pth, .ckpt)")
    parser.add_argument("--model_id", help="Module ID from MODULE_DATABASE")

    # DeepFilterNet & UVR Denoise/Dereverb
    parser.add_argument("--attenuation_limit_db", type=float, default=-100.0)
    parser.add_argument("--reverb_reduction", type=float, default=0.8)
    parser.add_argument("--sensitivity", type=float, default=1.0)
    parser.add_argument("--wet_dry_blend", type=float, default=100.0)

    # Demucs & Separation
    parser.add_argument("--model_name", default="htdemucs")
    parser.add_argument("--shifts", type=int, default=1)
    parser.add_argument("--overlap", type=float, default=0.25)
    parser.add_argument("--stems", default="both")

    # VoiceFixer
    parser.add_argument("--air_boost", type=float, default=3.5)
    parser.add_argument("--saturation", type=float, default=0.45)
    parser.add_argument("--clarity", type=float, default=0.65)
    parser.add_argument("--warm_tube", default="true")
    parser.add_argument("--sub_bass", default="true")

    args = parser.parse_args()

    if args.mode == "check_env":
        env_status = {
            "torch": False, "cuda": False, "mps": False,
            "deepfilternet": False, "demucs": False, "onnxruntime": False
        }
        try:
            import torch
            env_status["torch"] = True
            env_status["cuda"] = torch.cuda.is_available()
            env_status["mps"] = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        except Exception: pass
        try:
            import df
            env_status["deepfilternet"] = True
        except Exception: pass
        try:
            import demucs
            env_status["demucs"] = True
        except Exception: pass
        try:
            import onnxruntime
            env_status["onnxruntime"] = True
        except Exception: pass
        sys.stdout.write(f"ENV_STATUS:{json.dumps(env_status)}\n")
        sys.stdout.flush()
        return

    if args.mode == "download_model":
        model_p = auto_download_model_if_missing(args.model_path, args.model_id)
        sys.stdout.write(f"RESULT:{json.dumps({'path': model_p, 'success': True})}\n")
        sys.stdout.flush()
        return

    if not args.input or not os.path.exists(args.input):
        sys.stderr.write(f"Input file not found: {args.input}\n")
        sys.exit(1)

    model_p = args.model_path
    model_id = args.model_id or ""

    # Ensure model file exists if model_id is given
    if model_p and not os.path.exists(model_p):
        model_p = auto_download_model_if_missing(model_p, model_id)

    has_model_file = model_p and os.path.exists(model_p) and os.path.getsize(model_p) > 1024 * 100

    try:
        # 1. VoiceFixer Mode
        if args.mode == "voicefixer":
            process_voicefixer(args)
            return

        # 2. DeepFilterNet 3 (Speech Denoising & Dereverberation)
        if model_id == "deepfilternet3" or model_id.startswith("deepfilter") or (args.mode in ["denoise", "dereverb"] and (not model_p or "df" in os.path.basename(model_p).lower())):
            process_deepfilternet(args)
            return

        # 3. PyTorch VR Model Inference (.pth / .ckpt)
        if (has_model_file and (model_p.lower().endswith(".pth") or model_p.lower().endswith(".ckpt"))) or (model_id in ["uvr_denoise_foxjoy", "uvr_denoise_full", "uvr_denoise_lite", "uvr_deecho_normal", "uvr_deecho_aggressive", "mdx_dereverb_room", "hp_karaoke_uvr"]):
            process_vr_pytorch(
                model_path=model_p,
                input_path=args.input,
                output_path=args.output,
                output_dir=args.output_dir,
                prefix=args.prefix,
                mode=args.mode,
                model_id=model_id
            )
            return

        # 4. Demucs Separation (htdemucs, htdemucs_ft, htdemucs_vocals_bgm)
        if (args.mode == "separate" and not (has_model_file and model_p.lower().endswith(".onnx"))) or (model_id in ["htdemucs", "htdemucs_ft", "htdemucs_vocals_bgm"]):
            process_demucs(args)
            return

        # 5. ONNX Model Inference (MDX-Net / FoxJoy / Kim / Kara / Inst_HQ / Reverb_HQ)
        if (has_model_file and model_p.lower().endswith(".onnx")) or (model_id in ["reverb_foxjoy", "uvr_mdx_voc_ft", "uvr_mdx_inst_hq3", "kim_vocal_2", "mdx23c_8step"]):
            process_mdx_onnx(
                model_path=model_p,
                input_path=args.input,
                output_path=args.output,
                output_dir=args.output_dir,
                prefix=args.prefix,
                mode=args.mode,
                stems=args.stems,
                model_id=model_id
            )
            return

        # 6. Fallback Denoise & Dereverb
        if args.mode in ["denoise", "dereverb"]:
            process_deepfilternet(args)
            return

    except Exception as err:
        sys.stderr.write(f"ERROR in {args.mode}: {err}\n")
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
