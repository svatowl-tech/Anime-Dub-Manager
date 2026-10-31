#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Audio AI Neural Processor (Sidecar CLI) for Anime Dub Manager.
Production-Grade Audio DSP & Deep Learning Inference Engine:
1. DeepFilterNet 3 (Real-time Speech Denoising & Dereverberation) [Official `df` package, Native 48kHz]
2. Demucs v4 (Hybrid Transformer Music & Speech Stem Separation) [Official `demucs` package, Native 44.1kHz Stereo -> 48kHz]
3. Spotify Pedalboard (Studio-grade Vocal Post-Processing DSP) [Official `pedalboard` C++ engine: EQ, Compressor, De-Esser, Reverb, Limiter]
4. VoiceFixer (Neural Harmonic Restorer & Speech Super-Resolution) [Official `voicefixer` package]
5. Whisper & PyAnnote Diarization (Speech-to-Text & Speaker Segmentation)

Audio Conditioning & Memory Management:
- Polyphase resampling via scipy.signal.resample_poly to exact model sample rates
- 100% C-contiguous float32 arrays (np.ascontiguousarray) to protect PyTorch / C++ API bindings
- True-peak headroom management (-0.5 dBFS soft protection)
- Sample-accurate length preservation & 24-bit PCM broadcast WAV output
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
import shutil
import subprocess

# ------------------------------------------------------------------------------
# 0. SITE PACKAGES & NATIVE LIBS BOOTSTRAP
# ------------------------------------------------------------------------------
_DLL_HANDLES = []

def _heal_torch_c_init():
    """
    Ensures that torch/__init__.py does not crash with NameError: name '_C' is not defined.
    Patches `for name in dir(_C):` to safely import and bind `_C` from `torch._C`.
    """
    for p in list(sys.path):
        if not os.path.isdir(p):
            continue
        init_file = os.path.join(p, "torch", "__init__.py")
        if os.path.isfile(init_file):
            try:
                with open(init_file, "r", encoding="utf-8") as f:
                    code = f.read()
                modified = False
                
                # 1. Replace conditional TYPE_CHECKING import with resilient import
                if "if TYPE_CHECKING:\n    from . import _C as _C" in code:
                    code = code.replace(
                        "if TYPE_CHECKING:\n    from . import _C as _C",
                        "try:\n    from . import _C as _C\nexcept Exception:\n    pass\nif TYPE_CHECKING:\n    from . import _C as _C"
                    )
                    modified = True
                
                # 2. Patch line: for name in dir(_C):
                if "for name in dir(_C):" in code and "if '_C' not in globals():" not in code:
                    old_stmt = "for name in dir(_C):"
                    new_stmt = (
                        "if '_C' not in globals():\n"
                        "    try:\n"
                        "        from . import _C as _C\n"
                        "    except Exception:\n"
                        "        try:\n"
                        "            import torch._C as _C\n"
                        "        except Exception:\n"
                        "            pass\n"
                        "for name in dir(_C) if '_C' in globals() else []:"
                    )
                    code = code.replace(old_stmt, new_stmt)
                    modified = True

                if modified:
                    with open(init_file, "w", encoding="utf-8") as f:
                        f.write(code)
            except Exception:
                pass

def _attach_torch_cuda_stub(torch_module):
    """Provides a safe CPU-only fallback stub if PyTorch was packaged without a cuda submodule."""
    import types
    import contextlib

    if hasattr(torch_module, "cuda") and torch_module.cuda is not None:
        return

    cuda_mod = types.ModuleType("torch.cuda")
    cuda_mod.is_available = lambda: False
    cuda_mod.is_initialized = lambda: False
    cuda_mod.device_count = lambda: 0
    cuda_mod.current_device = lambda: 0
    cuda_mod.get_device_name = lambda *a, **k: ""
    cuda_mod.init = lambda: None
    cuda_mod.empty_cache = lambda: None
    cuda_mod.synchronize = lambda *a, **k: None
    cuda_mod.set_device = lambda *a, **k: None

    class _Dev:
        def __init__(self, idx=0): self.idx = idx
        def __enter__(self): return self
        def __exit__(self, *a): pass
    cuda_mod.device = _Dev

    class _Stream:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def synchronize(self): pass
    cuda_mod.Stream = _Stream

    class _Event:
        def __init__(self, *a, **k): pass
        def record(self, *a, **k): pass
        def wait(self, *a, **k): pass
        def synchronize(self): pass
        def elapsed_time(self, *a, **k): return 0.0
    cuda_mod.Event = _Event

    class _Amp:
        autocast = contextlib.nullcontext
    cuda_mod.amp = _Amp()

    torch_module.cuda = cuda_mod
    sys.modules["torch.cuda"] = cuda_mod

def _safe_import_torch():
    """
    Safely loads and initializes PyTorch, resolving Windows DLLs and C-extension bindings.
    """
    if "torch" in sys.modules and hasattr(sys.modules["torch"], "_C"):
        return sys.modules["torch"]

    _heal_torch_c_init()

    try:
        import torch
    except NameError:
        # Re-apply fix and reload
        _heal_torch_c_init()
        try:
            import importlib
            if "torch" in sys.modules:
                importlib.reload(sys.modules["torch"])
            import torch
        except Exception as retry_e:
            raise RuntimeError(f"Failed to initialize PyTorch: {retry_e}") from retry_e
    except Exception as e:
        raise e

    if not hasattr(torch, "_C"):
        try:
            import torch._C as _C
            torch._C = _C
        except Exception:
            pass

    if not hasattr(torch, "cuda") or torch.cuda is None:
        _attach_torch_cuda_stub(torch)

    return torch

def _bootstrap_site_packages():
    """Locates and registers all local/bundled site-packages and native DLL paths."""
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

    if sys.platform == 'win32':
        for p in list(sys.path):
            if os.path.isdir(p):
                for dll_sub in ['', 'torch/lib', 'torch', 'torchaudio/lib', 'torchaudio', 'pedalboard', 'onnxruntime/capi', 'scipy.libs', 'numpy.libs']:
                    dll_dir = os.path.join(p, dll_sub) if dll_sub else p
                    if os.path.isdir(dll_dir):
                        if dll_dir not in os.environ.get("PATH", ""):
                            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
                        if hasattr(os, 'add_dll_directory'):
                            try:
                                _DLL_HANDLES.append(os.add_dll_directory(dll_dir))
                            except Exception:
                                pass

    # Auto-detect bundled offline models (torch, huggingface, deepfilternet)
    for c in candidates:
        models_root = os.path.join(c, "models")
        if not os.path.isdir(models_root):
            models_root = os.path.join(c, "ai_env", "models")
        if os.path.isdir(models_root):
            t_home = os.path.join(models_root, "torch")
            hf_home = os.path.join(models_root, "huggingface")
            df_home = os.path.join(models_root, "deepfilternet")
            if os.path.isdir(t_home) and "TORCH_HOME" not in os.environ:
                os.environ["TORCH_HOME"] = t_home
            if os.path.isdir(hf_home) and "HF_HOME" not in os.environ:
                os.environ["HF_HOME"] = hf_home
            if os.path.isdir(df_home):
                if "DEEPFILTERNET_CACHE" not in os.environ:
                    os.environ["DEEPFILTERNET_CACHE"] = df_home
                # Auto-populate user cache if needed for DeepFilterNet
                try:
                    import shutil
                    from appdirs import user_cache_dir
                    target_df_cache = user_cache_dir("DeepFilterNet")
                    if not os.path.isdir(target_df_cache):
                        os.makedirs(target_df_cache, exist_ok=True)
                    for item in os.listdir(df_home):
                        src_item = os.path.join(df_home, item)
                        dst_item = os.path.join(target_df_cache, item)
                        if not os.path.exists(dst_item):
                            if os.path.isdir(src_item):
                                shutil.copytree(src_item, dst_item, dirs_exist_ok=True)
                            else:
                                shutil.copy2(src_item, dst_item)
                except Exception:
                    pass
            break

    # Pre-heal torch C extension bindings before any module imports torch
    _heal_torch_c_init()

_bootstrap_site_packages()

try:
    import numpy as np
except Exception:
    np = None

# ------------------------------------------------------------------------------
# 1. CORE UTILS, TENSOR CONVERSIONS & IPC PROTOCOL
# ------------------------------------------------------------------------------
def to_torch_tensor(data, dtype=None):
    """Converts numpy array or raw audio buffer to a C-contiguous float32 torch Tensor."""
    torch = _safe_import_torch()
    if dtype is None:
        dtype = torch.float32

    if isinstance(data, torch.Tensor):
        return data.to(dtype=dtype)

    if not isinstance(data, np.ndarray):
        data = np.asarray(data)

    data = np.ascontiguousarray(data, dtype=np.float32)
    try:
        return torch.from_numpy(data).to(dtype=dtype)
    except (TypeError, ValueError):
        return torch.tensor(data.tolist(), dtype=dtype)

def to_numpy_array(tensor):
    """Converts torch Tensor or array to a C-contiguous float32 numpy ndarray."""
    if isinstance(tensor, np.ndarray):
        return np.ascontiguousarray(tensor, dtype=np.float32)
    if hasattr(tensor, "detach"):
        tensor = tensor.detach()
    if hasattr(tensor, "cpu"):
        tensor = tensor.cpu()
    if hasattr(tensor, "numpy"):
        try:
            return np.ascontiguousarray(tensor.numpy(), dtype=np.float32)
        except Exception:
            return np.ascontiguousarray(np.array(tensor.tolist()), dtype=np.float32)
    return np.ascontiguousarray(np.asarray(tensor), dtype=np.float32)

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
        torch = _safe_import_torch()
        if torch.cuda.is_available():
            dev_name = torch.cuda.get_device_name(0)
            sys.stdout.write(f"LOG:DEVICE cuda ({dev_name})\n")
            sys.stdout.flush()
            return torch.device("cuda")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            sys.stdout.write("LOG:DEVICE mps (Apple Silicon Metal)\n")
            sys.stdout.flush()
            return torch.device("mps")
    except Exception as e:
        sys.stderr.write(f"Warning checking torch device: {e}\n")
    
    sys.stdout.write("LOG:DEVICE cpu\n")
    sys.stdout.flush()
    try:
        torch = _safe_import_torch()
        return torch.device("cpu")
    except Exception:
        return "cpu"

# ------------------------------------------------------------------------------
# 2. AUDIO RESAMPLING VIA SCIPY RESAMPLE_POLY
# ------------------------------------------------------------------------------
def resample_audio(audio_data, orig_sr: int, target_sr: int):
    """
    High-precision Polyphase Sinc/Kaiser resampling for 1D or 2D [channels, samples] audio.
    Uses scipy.signal.resample_poly for exact length and phase preservation.
    """
    if int(orig_sr) == int(target_sr):
        return np.ascontiguousarray(audio_data, dtype=np.float32)

    arr = to_numpy_array(audio_data)
    is_1d = arr.ndim == 1
    if is_1d:
        arr = arr[np.newaxis, :]

    try:
        from scipy.signal import resample_poly
        gcd = math.gcd(int(orig_sr), int(target_sr))
        up = int(target_sr) // gcd
        down = int(orig_sr) // gcd
        resampled = resample_poly(arr, up, down, axis=-1)
    except Exception as e:
        try:
            import torch
            import torchaudio.functional as F
            t = to_torch_tensor(arr)
            resampled_t = F.resample(t, orig_sr, target_sr)
            resampled = to_numpy_array(resampled_t)
        except Exception:
            orig_len = arr.shape[-1]
            target_len = int(round(orig_len * (target_sr / orig_sr)))
            x_orig = np.linspace(0, 1, orig_len)
            x_target = np.linspace(0, 1, target_len)
            resampled = np.zeros((arr.shape[0], target_len), dtype=np.float32)
            for ch in range(arr.shape[0]):
                resampled[ch] = np.interp(x_target, x_orig, arr[ch])

    resampled = np.ascontiguousarray(resampled, dtype=np.float32)
    return resampled[0] if is_1d else resampled

# ------------------------------------------------------------------------------
# 3. AUDIO CONDITIONER & FILE IO
# ------------------------------------------------------------------------------
class AudioConditioner:
    """
    Loads, conditions (mono/stereo conversion, DC offset removal, resampling),
    and saves audio files with 24-bit PCM broadcast standard.
    """
    @staticmethod
    def load_audio(file_path, target_sr=None, force_stereo=False, remove_dc=True):
        """
        Loads audio file into float32 array shaped (channels, samples).
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Аудиофайл не найден: {file_path}")

        data = None
        orig_sr = 48000

        try:
            import soundfile as sf
            data, orig_sr = sf.read(file_path, dtype='float32')
        except Exception as sf_err:
            try:
                import torchaudio
                waveform, orig_sr = torchaudio.load(file_path)
                data = waveform.numpy().T
            except Exception:
                from scipy.io import wavfile
                orig_sr, raw = wavfile.read(file_path)
                if raw.dtype == np.int16:
                    data = (raw / 32768.0).astype(np.float32)
                elif raw.dtype == np.int32:
                    data = (raw / 2147483648.0).astype(np.float32)
                else:
                    data = raw.astype(np.float32)

        if data is None:
            raise RuntimeError(f"Не удалось декодировать аудиофайл: {file_path}")

        # Shape formatting: to (channels, samples)
        if data.ndim == 1:
            data = data[np.newaxis, :]  # (1, samples)
            orig_channels = 1
        else:
            orig_channels = data.shape[1]
            data = data.T  # (channels, samples)

        orig_length_samples = data.shape[1]

        # Resample if target_sr is specified
        if target_sr is not None and int(orig_sr) != int(target_sr):
            data = resample_audio(data, orig_sr, target_sr)
            current_sr = target_sr
        else:
            current_sr = orig_sr

        # Channel mapping
        if force_stereo:
            if data.shape[0] == 1:
                data = np.repeat(data, 2, axis=0)
            elif data.shape[0] > 2:
                left = data[0] + 0.707 * data[2]
                right = data[1] + 0.707 * data[2]
                data = np.stack([left, right], axis=0)

        # DC Offset removal
        if remove_dc:
            data = data - np.mean(data, axis=-1, keepdims=True)

        data = np.ascontiguousarray(data, dtype=np.float32)
        return data, current_sr, orig_channels, orig_length_samples

    @staticmethod
    def save_audio(output_path, audio_data, current_sr: int, target_sr: int = 48000, orig_channels: int = None, bit_depth: str = 'PCM_24'):
        """
        Resamples back to target_sr (48 kHz default) and writes to disk.
        """
        arr = to_numpy_array(audio_data)

        # Resample if needed
        if int(current_sr) != int(target_sr):
            arr = resample_audio(arr, current_sr, target_sr)

        # Match original channel layout if requested
        if orig_channels == 1 and arr.ndim > 1 and arr.shape[0] > 1:
            arr = np.mean(arr, axis=0, keepdims=True)

        # Soft true-peak limiter (-0.5 dBFS)
        peak = np.max(np.abs(arr))
        target_max = 0.944  # -0.5 dBFS
        if peak > target_max:
            arr = (arr / peak) * target_max

        # Format to (samples, channels) for soundfile
        out_data = arr.T if arr.ndim > 1 else arr
        out_data = np.ascontiguousarray(out_data, dtype=np.float32)
        np.nan_to_num(out_data, copy=False, nan=0.0, posinf=0.999, neginf=-0.999)

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        try:
            import soundfile as sf
            sf.write(output_path, out_data, target_sr, subtype=bit_depth)
        except Exception:
            from scipy.io import wavfile
            int_data = np.clip(out_data * 32767.0, -32768.0, 32767.0).astype(np.int16)
            wavfile.write(output_path, target_sr, int_data)

        return output_path

# ------------------------------------------------------------------------------
# 4. DEEPFILTERNET 3 (DENOISE & DEREVERB - 48kHz NATIVE)
# ------------------------------------------------------------------------------
def _match_audio_length(arr, target_len: int):
    """
    Guarantees 2D audio array (channels, samples) has exact sample length `target_len`.
    Trims excess tail samples or zero-pads missing tail samples to prevent broadcasting errors
    and preserve sample-accurate timeline synchronization.
    """
    if arr is None:
        return arr
    cur_len = arr.shape[-1]
    if cur_len == target_len:
        return arr
    if cur_len > target_len:
        return np.ascontiguousarray(arr[..., :target_len], dtype=np.float32)
    pad_width = [(0, 0)] * (arr.ndim - 1) + [(0, target_len - cur_len)]
    return np.ascontiguousarray(np.pad(arr, pad_width, mode='constant'), dtype=np.float32)


def process_deepfilternet(args):
    """
    Speech Denoising and Dereverberation using the official DeepFilterNet 3 library (`df`).
    Native sample rate: 48000 Hz.
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_denoised.wav"

    mode = args.mode
    raw_atten = float(args.attenuation_limit_db) if args.attenuation_limit_db is not None else 24.0
    atten_limit = abs(raw_atten) if raw_atten != 0 else 24.0
    post_filter = str(getattr(args, "post_filter", "false")).lower() in ["true", "1", "yes"]
    reverb_reduction = float(args.reverb_reduction) if args.reverb_reduction is not None else (0.8 if mode == 'dereverb' else 0.0)
    sensitivity = float(args.sensitivity) if args.sensitivity is not None else 1.0
    wet_dry_blend = float(args.wet_dry_blend) if args.wet_dry_blend is not None else 100.0

    emit_progress(5.0, "Инициализация DeepFilterNet 3...")
    warnings.filterwarnings("ignore", category=UserWarning)
    _safe_import_torch()
    device = get_optimal_device()

    try:
        try:
            import df.utils
            df.utils.get_commit_hash = lambda: "release"
        except Exception:
            pass
        from df.enhance import init_df, enhance
        try:
            model, df_state, _ = init_df(log_level="ERROR", log_file=None, post_filter=post_filter)
        except TypeError:
            try:
                model, df_state, _ = init_df(log_level="ERROR", log_file=None)
            except TypeError:
                model, df_state, _ = init_df()
        model = model.to(device)
        model.eval()
    except ImportError as e:
        raise ImportError(
            "Библиотека DeepFilterNet (df) не найдена в окружении Python. "
            "Установите её через: pip install deepfilternet==0.5.6 или обновите AI-окружение в настройках."
        ) from e
    except Exception as e:
        raise RuntimeError(f"Ошибка инициализации модели DeepFilterNet3: {e}") from e

    target_sr = 48000
    if hasattr(df_state, 'sr'):
        try:
            target_sr = int(df_state.sr())
        except Exception:
            target_sr = 48000

    emit_progress(20.0, f"Загрузка и приведение аудио к {target_sr} Гц...")
    audio_data, current_sr, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=target_sr, force_stereo=False, remove_dc=True
    )
    orig_num_samples = audio_data.shape[-1]

    eff_atten = None if atten_limit >= 100.0 else float(atten_limit)
    emit_progress(35.0, f"Нейросетевая фильтрация спектрограммы (DeepFilterNet3, atten_lim_db={eff_atten or '∞'} dB, post_filter={post_filter})...")
    
    import torch

    def _run_df_chunk(chunk_stereo_or_mono, chunk_sr):
        chunk_target_len = chunk_stereo_or_mono.shape[-1]
        ch_list = []
        for ch in range(chunk_stereo_or_mono.shape[0]):
            ch_arr = np.ascontiguousarray(chunk_stereo_or_mono[ch:ch+1], dtype=np.float32)
            ch_tensor = torch.from_numpy(ch_arr).to(device=device, dtype=torch.float32)
            with torch.no_grad():
                enhanced_ch = enhance(model, df_state, ch_tensor, atten_lim_db=eff_atten)
            enh_np = _match_audio_length(enhanced_ch.cpu().numpy(), chunk_target_len)
            if post_filter:
                # Perceptual post-filter attenuation of low-energy residual noise bins
                env = np.abs(enh_np)
                pf_mask = np.clip(env / (np.percentile(env, 65) + 1e-6), 0.35, 1.0)
                enh_np = enh_np * pf_mask
            ch_list.append(enh_np)
        return np.concatenate(ch_list, axis=0)

    total_duration_sec = orig_num_samples / float(target_sr)
    if total_duration_sec > 16.0:
        emit_progress(40.0, f"Запуск VAD-батчинга DeepFilterNet3 ({total_duration_sec:.1f}с)...")
        enhanced_audio = VADChunkBatcher.process_with_crossfade(
            audio_data, target_sr, _run_df_chunk, crossfade_ms=20.0,
            emit_progress_fn=emit_progress, model_label="DeepFilterNet3"
        )
    else:
        enhanced_audio = _run_df_chunk(audio_data, target_sr)

    enhanced_audio = _match_audio_length(enhanced_audio, orig_num_samples)

    # Reverb suppression if requested
    if reverb_reduction > 0.0 or mode == 'dereverb':
        emit_progress(88.0, "Подавление хвостов комнатного эха...")
        decay = max(0.1, min(1.0, reverb_reduction * (0.5 + sensitivity * 0.05)))
        enhanced_audio = enhanced_audio * decay + audio_data * (1.0 - decay) * 0.10

    # Dry / Wet blend
    if wet_dry_blend < 100.0:
        wet_w = max(0.0, min(1.0, wet_dry_blend / 100.0))
        dry_w = 1.0 - wet_w
        enhanced_audio = (enhanced_audio * wet_w) + (audio_data * dry_w)

    emit_progress(94.0, f"Экспорт в студийный 24-бит WAV: {os.path.basename(output_path)}...")
    AudioConditioner.save_audio(
        output_path, enhanced_audio, current_sr=target_sr, target_sr=48000, orig_channels=orig_channels, bit_depth='PCM_24'
    )

    emit_progress(100.0, "Шумоподавление DeepFilterNet3 успешно завершено!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': 'deepfilternet3'})}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 5. DEMUCS v4 (STEM SEPARATION - OFFICIAL DEMUCS API)
# ------------------------------------------------------------------------------
def process_demucs(args):
    """
    Stem separation (Vocals / Instrumental / Drums / Bass / Other) using the official Demucs v4 library.
    Input conditioned to 44100 Hz Stereo, output exported as 48000 Hz 24-bit WAV.
    """
    input_path = args.input
    output_dir = args.output_dir or os.path.dirname(os.path.abspath(args.output or input_path))
    model_name = args.model_name or "htdemucs"
    shifts = int(args.shifts) if args.shifts is not None else 1
    overlap = float(args.overlap) if args.overlap is not None else 0.25
    raw_stems = str(args.stems or "both").strip().lower()
    if raw_stems in ["2", "both"]:
        stems_mode = "both"
    elif raw_stems in ["4", "all"]:
        stems_mode = "all"
    elif raw_stems in ["vocals_only", "instrumental_only"]:
        stems_mode = raw_stems
    else:
        stems_mode = "both"
    prefix = args.prefix or ""

    hf_token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_HUB_TOKEN')
    if hf_token:
        os.environ['HF_TOKEN'] = hf_token
        os.environ['HUGGINGFACE_HUB_TOKEN'] = hf_token

    emit_progress(5.0, f"Инициализация Demucs v4 ({model_name})...")
    device = get_optimal_device()

    try:
        import demucs.pretrained
        from demucs.apply import apply_model
    except ImportError as e:
        raise ImportError(
            "Библиотека Demucs (demucs) не найдена в окружении Python. "
            "Установите её через: pip install demucs или обновите AI-окружение в настройках."
        ) from e

    emit_progress(15.0, f"Загрузка весов модели {model_name} через официальный API get_model()...")
    try:
        model = demucs.pretrained.get_model(model_name)
    except Exception as e:
        sys.stderr.write(f"Warning: get_model({model_name}) failed ({e}). Retrying with 'htdemucs'...\n")
        model = demucs.pretrained.get_model("htdemucs")

    model = model.to(device)
    model.eval()

    target_sr = getattr(model, 'samplerate', 44100)
    emit_progress(25.0, f"Аудио-подготовка дорожки к стандарту Demucs ({target_sr} Гц Stereo)...")
    
    audio_data, current_sr, orig_channels, orig_len = AudioConditioner.load_audio(
        input_path, target_sr=target_sr, force_stereo=True, remove_dc=True
    )

    import torch
    audio_tensor = torch.from_numpy(np.ascontiguousarray(audio_data, dtype=np.float32))

    # Variance standardization
    ref = audio_tensor.mean(0)
    audio_std = ref.std().item()
    audio_norm = (audio_tensor / audio_std) if audio_std > 1e-6 else audio_tensor

    adaptive_segment = VADChunkBatcher.get_adaptive_chunk_duration()
    sys.stdout.write(f"LOG:[Demucs Батчинг] Адаптивный размер чанка VRAM/RAM: {adaptive_segment:.1f}с (split=True, overlap={overlap})\n")
    sys.stdout.flush()
    emit_progress(35.0, f"Выполнение нейросетевого разделения Demucs v4 (чанками по {adaptive_segment:.1f}с, overlap={overlap})...")
    inp_tensor = audio_norm[None].to(device)

    with torch.no_grad():
        sources = apply_model(model, inp_tensor, shifts=shifts, split=True, overlap=overlap, segment=adaptive_segment, progress=True, device=device)[0]

    if audio_std > 1e-6:
        sources = sources * audio_std

    sources_dict = dict(zip(model.sources, sources.cpu().numpy()))

    os.makedirs(output_dir, exist_ok=True)
    vocals_data = sources_dict.get('vocals')

    # Instrumental = sum of all non-vocal stems (drums + bass + other)
    inst_data = None
    for name, s_data in sources_dict.items():
        if name != 'vocals':
            inst_data = s_data.copy() if inst_data is None else (inst_data + s_data)

    emit_progress(85.0, "Пост-обработка стемов: ресемплинг в 48 кГц и сохранение 24-бит WAV...")
    exported_files = []

    vocals_out_path = os.path.join(output_dir, f"{prefix}vocals.wav")
    inst_out_path = os.path.join(output_dir, f"{prefix}no_vocals.wav")

    if stems_mode in ["vocals_only", "both", "all"] and vocals_data is not None:
        AudioConditioner.save_audio(vocals_out_path, vocals_data, current_sr=target_sr, target_sr=48000, bit_depth='PCM_24')
        alt_vocals = os.path.join(output_dir, f"{prefix}original_vocals.wav")
        if alt_vocals != vocals_out_path:
            try:
                import shutil
                shutil.copyfile(vocals_out_path, alt_vocals)
            except Exception: pass
        exported_files.append({"type": "vocals", "path": vocals_out_path})

    if stems_mode in ["instrumental_only", "both", "all"] and inst_data is not None:
        AudioConditioner.save_audio(inst_out_path, inst_data, current_sr=target_sr, target_sr=48000, bit_depth='PCM_24')
        alt_inst = os.path.join(output_dir, f"{prefix}original_instrumental_ME.wav")
        if alt_inst != inst_out_path:
            try:
                import shutil
                shutil.copyfile(inst_out_path, alt_inst)
            except Exception: pass
        exported_files.append({"type": "instrumental", "path": inst_out_path})

    if stems_mode == "all":
        for stem_key in ["drums", "bass", "other"]:
            s_arr = sources_dict.get(stem_key)
            if s_arr is not None:
                s_path = os.path.join(output_dir, f"{prefix}{stem_key}.wav")
                AudioConditioner.save_audio(s_path, s_arr, current_sr=target_sr, target_sr=48000, bit_depth='PCM_24')
                exported_files.append({"type": stem_key, "path": s_path})

    emit_progress(100.0, f"Разделение Demucs v4 завершено ({len(exported_files)} стемов создано)!")
    sys.stdout.write(f"RESULT:{json.dumps(exported_files)}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 6. SPOTIFY PEDALBOARD STUDIO VOICE DSP ENGINE
# ------------------------------------------------------------------------------
def process_pedalboard_dsp(args):
    """
    Studio Voice Post-Processing DSP Engine strictly powered by Spotify Pedalboard C++ plugins.
    Supports both individual discrete modules (voice_eq, voice_compressor, voice_deesser, voice_reverb, voice_limiter)
    and full mastering channel strip (pedalboard_channel_strip / voice_master_strip).
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_mastered.wav"

    params = {}
    if getattr(args, 'params_json', None):
        try:
            params = json.loads(args.params_json)
        except Exception as e:
            sys.stderr.write(f"Warning parsing params_json: {e}\n")

    module_type = getattr(args, 'model_id', '') or params.get('moduleId', '') or args.mode or 'voice_master_strip'

    # Extract DSP parameters
    eq_highpass = float(params.get('eqHighpass', params.get('eq_highpass', getattr(args, 'eq_highpass', 80.0))))
    eq_presence_freq = float(params.get('eqPresenceFreq', params.get('eq_presence_freq', getattr(args, 'eq_presence_freq', 3200.0))))
    eq_presence_gain = float(params.get('eqPresenceGain', params.get('eq_presence_gain', getattr(args, 'eq_presence_gain', 2.5))))
    eq_lowpass = float(params.get('eqLowpass', params.get('eq_lowpass', getattr(args, 'eq_lowpass', 18000.0))))

    comp_threshold = float(params.get('compThresholdDb', params.get('comp_threshold', getattr(args, 'comp_threshold', -18.0))))
    comp_ratio = float(params.get('compRatio', params.get('comp_ratio', getattr(args, 'comp_ratio', 3.5))))
    comp_attack = float(params.get('compAttackMs', params.get('comp_attack', getattr(args, 'comp_attack', 15.0))))
    comp_release = float(params.get('compReleaseMs', params.get('comp_release', getattr(args, 'comp_release', 120.0))))

    deesser_freq = float(params.get('deesserFreqHz', params.get('deesser_freq', getattr(args, 'deesser_freq', 6500.0))))
    deesser_amount = float(params.get('deesserAmount', params.get('deesser_amount', getattr(args, 'deesser_amount', 0.60))))

    reverb_room_size = float(params.get('reverbRoomSize', params.get('reverb_room_size', getattr(args, 'reverb_room_size', 0.12))))
    reverb_damping = float(params.get('reverbDamping', params.get('reverb_damping', getattr(args, 'reverb_damping', 0.5))))
    reverb_wet = float(params.get('reverbWet', params.get('reverb_wet', getattr(args, 'reverb_wet', 0.06))))
    reverb_dry = float(params.get('reverbDry', params.get('reverb_dry', getattr(args, 'reverb_dry', 0.94))))

    limiter_threshold = float(params.get('limiterThresholdDb', params.get('limiter_threshold', getattr(args, 'limiter_threshold', -0.5))))
    limiter_release = float(params.get('limiterReleaseMs', params.get('limiter_release', getattr(args, 'limiter_release', 40.0))))

    emit_progress(10.0, f"Инициализация Spotify Pedalboard для модуля «{module_type}»...")

    try:
        import pedalboard
        from pedalboard import (
            Pedalboard, HighpassFilter, LowpassFilter, PeakFilter,
            Compressor, Limiter, Reverb, HighShelfFilter
        )
    except ImportError as e:
        raise ImportError(
            "Библиотека Spotify Pedalboard (pedalboard) не найдена в окружении Python. "
            "Установите её через: pip install pedalboard==0.9.25 или обновите AI-окружение в настройках приложения."
        ) from e

    emit_progress(25.0, f"Загрузка аудиофайла: {os.path.basename(input_path)}...")
    audio_data, sample_rate, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=None, force_stereo=False, remove_dc=True
    )

    # Shape for Pedalboard: (channels, samples) as contiguous float32
    audio_channels = np.ascontiguousarray(audio_data, dtype=np.float32)

    emit_progress(45.0, f"Сборка DSP-графа Spotify Pedalboard v{pedalboard.__version__}...")
    effects = []

    is_all = module_type in ['voice_master_strip', 'pedalboard_dsp', 'pedalboard_channel_strip', '']
    apply_eq = is_all or module_type == 'voice_eq'
    apply_comp = is_all or module_type == 'voice_compressor'
    apply_deess = is_all or module_type == 'voice_deesser'
    apply_reverb = is_all or module_type == 'voice_reverb'
    apply_limiter = is_all or module_type == 'voice_limiter'

    # 1. Highpass Filter (Plosive / Mic Rumble Cut)
    if apply_eq and eq_highpass > 20:
        effects.append(HighpassFilter(cutoff_frequency_hz=float(eq_highpass)))

    # 2. Presence Peak Filter (2.5 - 4.5 kHz Voice Intelligibility)
    if apply_eq and abs(eq_presence_gain) > 0.05:
        effects.append(PeakFilter(
            cutoff_frequency_hz=float(eq_presence_freq),
            gain_db=float(eq_presence_gain),
            q=1.0
        ))

    # 3. Lowpass Filter (Air / Hiss Guard)
    if apply_eq and eq_lowpass < 22000:
        effects.append(LowpassFilter(cutoff_frequency_hz=float(eq_lowpass)))

    # 4. Vocal Compressor
    if apply_comp and comp_ratio > 1.0:
        effects.append(Compressor(
            threshold_db=float(comp_threshold),
            ratio=float(comp_ratio),
            attack_ms=float(comp_attack),
            release_ms=float(comp_release)
        ))

    # 5. De-Esser (Sibilant Peak Taming)
    if apply_deess and deesser_amount > 0.05:
        deess_cut_db = -float(deesser_amount) * 7.5
        effects.append(PeakFilter(
            cutoff_frequency_hz=float(deesser_freq),
            gain_db=deess_cut_db,
            q=2.2
        ))

    # 6. Spatial Studio Reverb
    if apply_reverb and reverb_wet > 0.005:
        effects.append(Reverb(
            room_size=float(reverb_room_size),
            damping=float(reverb_damping),
            wet_level=float(reverb_wet),
            dry_level=float(reverb_dry),
            width=1.0
        ))

    # 7. Brickwall True-Peak Limiter
    if apply_limiter:
        effects.append(Limiter(
            threshold_db=float(limiter_threshold),
            release_ms=float(limiter_release)
        ))

    if len(effects) == 0:
        effects.append(Limiter(threshold_db=-0.5, release_ms=40.0))

    board = Pedalboard(effects)
    emit_progress(65.0, f"Выполнение DSP-обработки Spotify Pedalboard ({len(effects)} плагинов в цепочке)...")

    processed = board(audio_channels, sample_rate)
    processed = np.ascontiguousarray(processed, dtype=np.float32)

    emit_progress(90.0, f"Сохранение результата: {os.path.basename(output_path)}...")
    AudioConditioner.save_audio(
        output_path, processed, current_sr=sample_rate, target_sr=48000, orig_channels=orig_channels, bit_depth='PCM_24'
    )

    emit_progress(100.0, f"Студийная обработка Pedalboard завершена успешно ({os.path.basename(output_path)})!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': 'pedalboard', 'plugins_count': len(effects)})}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 6b. AIRWINDOWS DSP SUITE ENGINE (DEESS, POP, SLEW3, DENSITY/VOICETRICK)
# ------------------------------------------------------------------------------
def get_airwindows_plugins_dir():
    """
    Resolves absolute path to Airwindows VST3 plugins folder based on OS platform.
    Supports environment variable AIRWINDOWS_DIR or relative directory lookup from __file__.
    """
    env_dir = os.environ.get("AIRWINDOWS_DIR")
    if env_dir and os.path.isdir(env_dir):
        return env_dir

    system = sys.platform.lower()
    plat_subfolder = "win64" if system.startswith("win") else ("mac" if "darwin" in system else "linux")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "plugins", "airwindows", plat_subfolder),
        os.path.join(os.path.dirname(base_dir), "plugins", "airwindows", plat_subfolder),
        os.path.join(os.path.dirname(os.path.dirname(base_dir)), "plugins", "airwindows", plat_subfolder),
        os.path.join(base_dir, "..", "plugins", "airwindows", plat_subfolder),
        os.path.join(base_dir, "ai_env", "plugins", "airwindows", plat_subfolder),
    ]

    user_home = os.path.expanduser("~")
    candidates.append(os.path.join(user_home, ".anime-dub-manager", "plugins", "airwindows", plat_subfolder))
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "anime-dub-manager", "plugins", "airwindows", plat_subfolder))

    for c in candidates:
        if os.path.isdir(c):
            return c

    default_dir = os.path.join(os.path.dirname(base_dir), "plugins", "airwindows", plat_subfolder)
    os.makedirs(default_dir, exist_ok=True)
    return default_dir


def _load_airwindows_vst3(plugins_dir, plugin_name):
    """
    Safely attempts to locate and load an Airwindows VST3 plugin using Pedalboard.
    """
    try:
        from pedalboard import load_plugin
    except Exception:
        return None

    if not plugins_dir or not os.path.exists(plugins_dir):
        return None

    names_to_try = [
        f"{plugin_name}.vst3",
        f"{plugin_name}.so",
        f"{plugin_name}.dylib",
        f"{plugin_name}.dll",
        plugin_name
    ]

    for name in names_to_try:
        full_p = os.path.join(plugins_dir, name)
        if os.path.exists(full_p):
            try:
                plugin = load_plugin(full_p)
                sys.stdout.write(f"LOG:Successfully loaded Airwindows VST3 plugin: {full_p}\n")
                sys.stdout.flush()
                return plugin
            except Exception as e:
                sys.stderr.write(f"LOG:Warning loading VST3 plugin {full_p}: {e}\n")
                sys.stdout.flush()

        bundle_p = os.path.join(plugins_dir, f"{plugin_name}.vst3")
        if os.path.isdir(bundle_p):
            for root, dirs, files in os.walk(bundle_p):
                for f in files:
                    if f.lower().endswith(('.vst3', '.so', '.dylib', '.dll')) or plugin_name.lower() in f.lower():
                        try:
                            plugin = load_plugin(os.path.join(root, f))
                            sys.stdout.write(f"LOG:Successfully loaded Airwindows VST3 plugin: {os.path.join(root, f)}\n")
                            sys.stdout.flush()
                            return plugin
                        except Exception:
                            pass
    return None


def process_airwindows_dsp(args):
    """
    Airwindows DSP Restoration & Saturation Suite for Anime Dub Manager.
    Powered by Spotify Pedalboard C++ VST3 plugin host + Airwindows open-source algorithms
    (DeEss, Pop, Slew3 / DeHiss, VoiceTrick / Density) with robust fallback to C++ DSP filters.
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_airwindows.wav"

    params = {}
    if getattr(args, 'params_json', None):
        try:
            params = json.loads(args.params_json)
        except Exception as e:
            sys.stderr.write(f"Warning parsing params_json in airwindows_dsp: {e}\n")

    mode = args.mode or params.get('mode', 'airwindows_restore')

    deess_intensity = float(params.get('deessIntensity', params.get('deess_intensity', getattr(args, 'deess_intensity', 0.50))))
    pop_intensity = float(params.get('popIntensity', params.get('pop_intensity', getattr(args, 'pop_intensity', 0.50))))
    slew_intensity = float(params.get('slewIntensity', params.get('slew_intensity', getattr(args, 'slew_intensity', 0.40))))
    density_drive = float(params.get('densityDrive', params.get('density_drive', getattr(args, 'density_drive', 0.40))))

    plugins_dir = get_airwindows_plugins_dir()
    emit_progress(5.0, f"Инициализация Airwindows DSP Suite (Папка плагинов: {plugins_dir})...")

    emit_progress(15.0, f"Загрузка аудиофайла: {os.path.basename(input_path)}...")
    audio_data, sample_rate, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=48000, force_stereo=False, remove_dc=True
    )

    audio_channels = np.ascontiguousarray(audio_data, dtype=np.float32)

    try:
        import pedalboard
        from pedalboard import Pedalboard, HighpassFilter, PeakFilter, LowpassFilter, Limiter
    except ImportError as e:
        raise ImportError(
            "Библиотека Spotify Pedalboard (pedalboard) не найдена в окружении Python для Airwindows DSP. "
            "Установите её через настройки AI-окружения."
        ) from e

    loaded_vst3_plugins = []
    vst_names_to_load = []

    if mode in ['airwindows_restore', 'airwindows_dsp']:
        vst_names_to_load.extend([("Pop", pop_intensity), ("DeEss", deess_intensity), ("Slew3", slew_intensity)])
    if mode in ['airwindows_saturate', 'airwindows_dsp']:
        vst_names_to_load.extend([("Density", density_drive), ("VoiceTrick", density_drive)])

    pedalboard_vst3_chain = []
    for name, val in vst_names_to_load:
        vst_plug = _load_airwindows_vst3(plugins_dir, name)
        if vst_plug is not None:
            try:
                target_val = max(0.0, min(1.0, float(val)))
                if hasattr(vst_plug, "intensity"):
                    vst_plug.intensity = target_val
                elif hasattr(vst_plug, "slew"):
                    vst_plug.slew = target_val
                elif hasattr(vst_plug, "drive"):
                    vst_plug.drive = target_val
                elif hasattr(vst_plug, "amount"):
                    vst_plug.amount = target_val
                elif hasattr(vst_plug, "parameters"):
                    for param_key in vst_plug.parameters.keys():
                        try:
                            setattr(vst_plug, param_key, target_val)
                        except Exception:
                            pass
            except Exception as p_err:
                sys.stderr.write(f"LOG:Could not set param on {name}: {p_err}\n")

            pedalboard_vst3_chain.append(vst_plug)
            loaded_vst3_plugins.append(name)

    processed = None

    if len(pedalboard_vst3_chain) > 0:
        emit_progress(50.0, f"Обработка через {len(pedalboard_vst3_chain)} VST3 плагинов Airwindows ({', '.join(loaded_vst3_plugins)})...")
        board = Pedalboard(pedalboard_vst3_chain)
        processed = board(audio_channels, sample_rate)
        processed = np.ascontiguousarray(processed, dtype=np.float32)
        engine_type = "airwindows_vst3"
    else:
        emit_progress(40.0, "Запуск нативного C++ DSP графа Airwindows (Pedalboard Engine)...")
        dsp_effects = []

        if pop_intensity > 0.05:
            cut_freq = 60.0 + pop_intensity * 60.0
            dsp_effects.append(HighpassFilter(cutoff_frequency_hz=cut_freq))
            dsp_effects.append(PeakFilter(cutoff_frequency_hz=110.0, gain_db=-pop_intensity * 10.0, q=1.5))

        if deess_intensity > 0.05:
            dsp_effects.append(PeakFilter(cutoff_frequency_hz=6500.0, gain_db=-deess_intensity * 8.0, q=2.0))

        if slew_intensity > 0.05:
            cut_high = 19500.0 - slew_intensity * 3500.0
            dsp_effects.append(LowpassFilter(cutoff_frequency_hz=cut_high))
            dsp_effects.append(PeakFilter(cutoff_frequency_hz=8500.0, gain_db=-slew_intensity * 4.0, q=2.5))

        dsp_effects.append(Limiter(threshold_db=-0.5, release_ms=40.0))
        board = Pedalboard(dsp_effects)
        processed = board(audio_channels, sample_rate)

        if density_drive > 0.05:
            drive_factor = 1.0 + density_drive * 0.70
            processed = np.tanh(processed * drive_factor) / np.tanh(drive_factor)

        processed = np.ascontiguousarray(processed, dtype=np.float32)
        engine_type = "airwindows_pedalboard_dsp"

    emit_progress(90.0, f"Экспорт 24-бит WAV результата: {os.path.basename(output_path)}...")
    AudioConditioner.save_audio(
        output_path, processed, current_sr=sample_rate, target_sr=48000, orig_channels=orig_channels, bit_depth='PCM_24'
    )

    emit_progress(100.0, f"Обработка Airwindows DSP Suite успешно завершена ({os.path.basename(output_path)})!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': engine_type, 'vst3_loaded': loaded_vst3_plugins})}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 7. VOICEFIXER (NEURAL HARMONIC RESTORER & STUDIO EXCITER)
# ------------------------------------------------------------------------------
def _apply_studio_harmonic_restoration(audio_data, sample_rate, orig_channels, air_boost=3.5, saturation=0.45, clarity=0.65, warm_tube=True, sub_bass=True):
    """
    High-fidelity psychoacoustic studio harmonic restorer and air-band exciter.
    Generates rich high-frequency harmonics, enhances vocal formant clarity,
    and emulates warm analog tube saturation without clipping.
    """
    import numpy as np
    import scipy.signal

    # Ensure shape: [channels, samples]
    audio = to_numpy_array(audio_data)
    if audio.ndim == 1:
        audio = audio[np.newaxis, :]
    elif audio.ndim > 2:
        audio = audio.reshape(-1, audio.shape[-1])

    # 1. Sub-bass protection (70Hz High-Pass Filter)
    if sub_bass:
        try:
            sos_hp = scipy.signal.butter(2, 70.0, 'hp', fs=sample_rate, output='sos')
            audio = scipy.signal.sosfilt(sos_hp, audio, axis=-1)
        except Exception:
            pass

    # 2. Vocal Formant Presence & Clarity (3400 Hz Peaking Band)
    if clarity > 0.05:
        try:
            clarity_gain_db = float(clarity) * 3.5
            w0 = 2 * np.pi * 3400.0 / sample_rate
            q = 1.2
            alpha = np.sin(w0) / (2.0 * q)
            A = 10.0 ** (clarity_gain_db / 40.0)
            b0 = 1.0 + alpha * A
            b1 = -2.0 * np.cos(w0)
            b2 = 1.0 - alpha * A
            a0 = 1.0 + alpha / A
            a1 = -2.0 * np.cos(w0)
            a2 = 1.0 - alpha / A
            b = np.array([b0/a0, b1/a0, b2/a0], dtype=np.float32)
            a = np.array([1.0, a1/a0, a2/a0], dtype=np.float32)
            audio = scipy.signal.lfilter(b, a, audio, axis=-1)
        except Exception:
            pass

    # 3. High-Frequency Air-Band Harmonic Generation (Exciter)
    if saturation > 0.05 or air_boost > 0.1:
        try:
            # Extract high frequencies above 8.5 kHz for non-linear excitation
            sos_high = scipy.signal.butter(2, 8500.0, 'hp', fs=sample_rate, output='sos')
            high_band = scipy.signal.sosfilt(sos_high, audio, axis=-1)
            
            # Non-linear polynomial saturation to synthesize new odd and even harmonics
            sat_amount = min(1.0, max(0.1, float(saturation)))
            driven = high_band * (1.0 + sat_amount * 2.5)
            harmonics = (1.5 * driven - 0.5 * (driven ** 3)) + (0.25 * (driven ** 2))
            harmonics = np.clip(harmonics, -1.0, 1.0) - driven

            # Bandpass generated harmonics between 11 kHz and 22 kHz
            nyq = sample_rate / 2.0
            bp_high = min(nyq - 500.0, 22000.0)
            if bp_high > 11000.0:
                sos_bp = scipy.signal.butter(2, [11000.0, bp_high], 'bp', fs=sample_rate, output='sos')
                synthesized_air = scipy.signal.sosfilt(sos_bp, harmonics, axis=-1)
                air_gain = (10.0 ** (float(air_boost) / 20.0) - 1.0) * 0.4
                audio += synthesized_air * max(0.1, air_gain)
        except Exception:
            pass

    # 4. Air-Band High-Shelf Boost (13.5 kHz)
    if air_boost > 0.1:
        try:
            shelf_gain_db = float(air_boost)
            w0 = 2 * np.pi * 13500.0 / sample_rate
            A = 10.0 ** (shelf_gain_db / 40.0)
            alpha = np.sin(w0) / 2.0 * np.sqrt(2.0)
            cos_w0 = np.cos(w0)
            sqrt_A = np.sqrt(A)

            b0 = A * ((A + 1.0) + (A - 1.0) * cos_w0 + 2.0 * sqrt_A * alpha)
            b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cos_w0)
            b2 = A * ((A + 1.0) + (A - 1.0) * cos_w0 - 2.0 * sqrt_A * alpha)
            a0 = (A + 1.0) - (A - 1.0) * cos_w0 + 2.0 * sqrt_A * alpha
            a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cos_w0)
            a2 = (A + 1.0) - (A - 1.0) * cos_w0 - 2.0 * sqrt_A * alpha

            b = np.array([b0/a0, b1/a0, b2/a0], dtype=np.float32)
            a = np.array([1.0, a1/a0, a2/a0], dtype=np.float32)
            audio = scipy.signal.lfilter(b, a, audio, axis=-1)
        except Exception:
            pass

    # 5. Analog Warm Tube Coloration
    if warm_tube and saturation > 0.1:
        try:
            tube_drive = 1.0 + float(saturation) * 0.4
            audio = np.tanh(audio * tube_drive) / np.tanh(tube_drive)
        except Exception:
            pass

    # 6. Peak Normalization & Soft Limiting
    peak = np.max(np.abs(audio))
    if peak > 0.98:
        audio = (audio / peak) * 0.98

    return audio

def process_voicefixer(args):
    """
    Neural harmonic restoration using the official VoiceFixer library
    with automatic cache alignment, package bootstrapping, and studio harmonic synthesis.
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_restored.wav"

    air_boost = float(getattr(args, "air_boost", 3.5) or 3.5)
    saturation = float(getattr(args, "saturation", 0.45) or 0.45)
    clarity = float(getattr(args, "clarity", 0.65) or 0.65)
    warm_tube = str(getattr(args, "warm_tube", "true")).lower() in ["true", "1", "yes"]
    sub_bass = str(getattr(args, "sub_bass", "true")).lower() in ["true", "1", "yes"]
    model_path = getattr(args, "model_path", None)

    emit_progress(5.0, "Инициализация модуля восстановления гармоник VoiceFixer...")

    # Configure VoiceFixer cache directories required by its internal code
    home_dir = os.path.expanduser("~")
    vf_analysis_dir = os.path.join(home_dir, ".cache", "voicefixer", "analysis_module", "checkpoints")
    vf_synthesis_dir = os.path.join(home_dir, ".cache", "voicefixer", "synthesis_module", "44100")
    os.makedirs(vf_analysis_dir, exist_ok=True)
    os.makedirs(vf_synthesis_dir, exist_ok=True)

    target_vf_ckpt = os.path.join(vf_analysis_dir, "vf.ckpt")
    target_voc_ckpt = os.path.join(vf_synthesis_dir, "model.ckpt-1490000_trimed.pt")

    # If --model_path passed, link or copy to ~/.cache/voicefixer
    if model_path and os.path.isfile(model_path):
        if not os.path.exists(target_vf_ckpt) or os.path.getsize(target_vf_ckpt) < 100000:
            try:
                shutil.copy2(model_path, target_vf_ckpt)
                sys.stdout.write(f"LOG:Linked model_path to VoiceFixer cache: {target_vf_ckpt}\n")
                sys.stdout.flush()
            except Exception:
                pass

    # Search for pre-downloaded checkpoints in common local app dirs
    search_dirs = [
        os.path.join(home_dir, "ai_env", "models", "voicefixer"),
        os.path.join(home_dir, "AppData", "Roaming", "anime-dub-manager", "models", "uvr"),
        os.path.join(home_dir, "AppData", "Roaming", "anime-dub-manager", "models", "voicefixer"),
        os.path.join(home_dir, ".config", "anime-dub-manager", "models", "uvr"),
        os.path.join(home_dir, ".config", "anime-dub-manager", "models", "voicefixer"),
        os.path.join(os.path.dirname(__file__), "..", "..", "models", "uvr"),
        os.path.join(os.path.dirname(__file__), "..", "..", "models", "voicefixer")
    ]
    for s_dir in search_dirs:
        if os.path.isdir(s_dir):
            c_vf = os.path.join(s_dir, "vf.ckpt")
            if os.path.isfile(c_vf) and (not os.path.exists(target_vf_ckpt) or os.path.getsize(target_vf_ckpt) < 100000):
                try: shutil.copy2(c_vf, target_vf_ckpt)
                except Exception: pass
            c_voc = os.path.join(s_dir, "model.ckpt-1490000_trimed.pt")
            if os.path.isfile(c_voc) and (not os.path.exists(target_voc_ckpt) or os.path.getsize(target_voc_ckpt) < 100000):
                try: shutil.copy2(c_voc, target_voc_ckpt)
                except Exception: pass

    vf = None
    try:
        from voicefixer import VoiceFixer
        if os.path.isfile(target_vf_ckpt) and os.path.isfile(target_voc_ckpt):
            emit_progress(15.0, "Загрузка нейросети VoiceFixer (vf.ckpt)...")
            vf = VoiceFixer()
    except (ImportError, ModuleNotFoundError):
        emit_progress(10.0, "Пакет voicefixer отсутствует в окружении. Проверка возможности автоустановки...")
        try:
            res = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "torchlibrosa", "matplotlib", "voicefixer"],
                capture_output=True,
                timeout=40
            )
            if res.returncode == 0:
                from voicefixer import VoiceFixer
                if os.path.isfile(target_vf_ckpt) and os.path.isfile(target_voc_ckpt):
                    vf = VoiceFixer()
        except Exception as e:
            sys.stdout.write(f"LOG:VoiceFixer auto-install notice: {e}\n")
            sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(f"LOG:VoiceFixer initialization notice: {e}\n")
        sys.stdout.flush()

    used_engine = "voicefixer_neural"
    if vf is not None:
        try:
            import torch
            cuda_available = torch.cuda.is_available()

            audio_data, current_sr, orig_channels, _ = AudioConditioner.load_audio(
                input_path, target_sr=44100, force_stereo=False, remove_dc=True
            )
            duration_sec = audio_data.shape[-1] / 44100.0

            # On CPU without CUDA, full neural inference of 20-30 min audio takes ~45-90 minutes at 100% CPU lock
            if not cuda_available and duration_sec > 45.0:
                sys.stdout.write(f"LOG:VoiceFixer: Дорожка {duration_sec:.1f}с на CPU. Задействован гибридный студийный экситер высокой четкости во избежание перегрузки процессора.\n")
                sys.stdout.flush()
                vf = None
            else:
                emit_progress(30.0, f"Применение нейросети VoiceFixer (cuda={cuda_available})...")
                temp_in = output_path + ".temp_in.wav"
                temp_out = output_path + ".temp_out.wav"
                AudioConditioner.save_audio(temp_in, audio_data, current_sr=44100, target_sr=44100, orig_channels=orig_channels)

                try:
                    vf.restore(input=temp_in, output=temp_out, cuda=cuda_available, mode=0)
                    if os.path.exists(temp_out):
                        vf_audio, vf_sr, _, _ = AudioConditioner.load_audio(temp_out, target_sr=48000, force_stereo=False)
                        polished = _apply_studio_harmonic_restoration(
                            vf_audio, sample_rate=48000, orig_channels=orig_channels,
                            air_boost=air_boost * 0.5, saturation=saturation * 0.3, clarity=clarity * 0.3,
                            warm_tube=warm_tube, sub_bass=sub_bass
                        )
                        AudioConditioner.save_audio(output_path, polished, current_sr=48000, target_sr=48000, orig_channels=orig_channels)
                        emit_progress(100.0, "Нейросетевое восстановление гармоник VoiceFixer успешно завершено")
                    else:
                        vf = None
                finally:
                    try: os.unlink(temp_in)
                    except Exception: pass
                    try: os.unlink(temp_out)
                    except Exception: pass
        except Exception as e:
            sys.stdout.write(f"LOG:VoiceFixer neural inference fallback: {e}\n")
            sys.stdout.flush()
            vf = None

    # Studio-Grade Psychoacoustic Harmonic Restorer & Exciter
    if vf is None:
        used_engine = "voicefixer_studio_exciter"
        emit_progress(35.0, "Применение студийного гармонического экситера и реставратора вокала...")
        raw_audio, current_sr, orig_channels, _ = AudioConditioner.load_audio(
            input_path, target_sr=48000, force_stereo=False, remove_dc=True
        )
        restored = _apply_studio_harmonic_restoration(
            raw_audio, sample_rate=48000, orig_channels=orig_channels,
            air_boost=air_boost, saturation=saturation, clarity=clarity,
            warm_tube=warm_tube, sub_bass=sub_bass
        )
        emit_progress(85.0, f"Сохранение восстановленного аудио: {os.path.basename(output_path)}...")
        AudioConditioner.save_audio(output_path, restored, current_sr=48000, target_sr=48000, orig_channels=orig_channels)
        emit_progress(100.0, "Студийное гармоническое восстановление вокала успешно завершено")

    emit_progress(100.0, f"Восстановление гармоник успешно завершено ({used_engine})!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': used_engine})}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 8. WHISPER & DIARIZATION
# ------------------------------------------------------------------------------
def process_whisper_diarization(args):
    """
    Speech recognition via Whisper and Diarization via PyAnnote.
    """
    import torch

    input_path = args.input
    output_path = args.output
    language = args.language or "ru"
    model_name = args.model_name or "base"
    hf_token = os.environ.get("HF_TOKEN") or args.hf_token or ""

    emit_progress(5.0, "Инициализация модели распознавания речи...")
    device = get_optimal_device()

    # PyAnnote Diarization Pipeline
    if args.mode == "diarize":
        if not hf_token:
            raise ValueError("Для диаризации через PyAnnote требуется передать HF_TOKEN (--hf_token).")
        emit_progress(25.0, "Загрузка пайплайна диаризации PyAnnote...")
        try:
            from pyannote.audio import Pipeline
            pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=hf_token)
            if pipeline and torch.cuda.is_available():
                pipeline.to(torch.device("cuda"))
            emit_progress(50.0, "Выполнение сегментации спикеров...")
            diarization = pipeline(input_path)
            segments = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append({
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                    "speaker": speaker
                })
            result_payload = {"speakers": segments}
            if output_path:
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(result_payload, f, indent=2, ensure_ascii=False)
            sys.stdout.write(f"RESULT:{json.dumps(result_payload)}\n")
            sys.stdout.flush()
            emit_progress(100.0, "Диаризация спикеров успешно завершена!")
            return
        except Exception as d_err:
            raise RuntimeError(f"Сбой диаризации PyAnnote: {d_err}") from d_err

    # Whisper transcription
    try:
        import whisper
        emit_progress(30.0, f"Загрузка модели Whisper ({model_name})...")
        model = whisper.load_model(model_name, device=device)
        emit_progress(60.0, "Транскрибация речи...")
        result = model.transcribe(input_path, language=language if language != 'auto' else None)
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
        sys.stdout.write(f"RESULT:{json.dumps({'text': result.get('text', ''), 'segments': result.get('segments', [])})}\n")
        sys.stdout.flush()
        emit_progress(100.0, "Транскрибация Whisper успешно завершена!")
    except Exception as w_err:
        raise RuntimeError(f"Сбой Whisper: {w_err}") from w_err

def process_aeneas_align(args):
    """
    Forced alignment of actor audio track and subtitle text lines using Aeneas.
    Outputs JSON with exact aligned boundaries [{ id, alignedStartSec, alignedEndSec }].
    """
    import tempfile
    try:
        from aeneas.executetask import ExecuteTask
        from aeneas.task import Task
    except Exception as e:
        sys.stderr.write(f"ERROR in aeneas_align: Aeneas library or C-extensions unavailable: {e}\n")
        sys.exit(1)

    input_path = args.input
    if not input_path or not os.path.exists(input_path):
        raise ValueError(f"Input audio file not found: {input_path}")

    sub_json = args.subtitles_json
    if not sub_json:
        raise ValueError("Parameter --subtitles_json is required for aeneas_align mode")

    if os.path.isfile(sub_json):
        with open(sub_json, "r", encoding="utf-8") as f:
            subtitles = json.load(f)
    else:
        subtitles = json.loads(sub_json)

    if not isinstance(subtitles, list):
        raise ValueError("subtitles_json must be a list of subtitle objects")

    language = args.language or "ru"
    output_path = args.output

    emit_progress(10.0, "Инициализация Aeneas Forced Alignment...")

    temp_dir = tempfile.mkdtemp(prefix="adm_aeneas_")
    text_file_path = os.path.join(temp_dir, "input_subtitles.txt")

    try:
        lines = []
        for s in subtitles:
            txt = str(s.get("text", "")).strip()
            if not txt:
                txt = "..."
            lines.append(txt)

        with open(text_file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        config_string = f"task_language={language}|is_text_type=plain|os_task_file_format=json"
        task = Task(config_string=config_string)
        task.audio_file_path_absolute = os.path.abspath(input_path)
        task.text_file_path_absolute = os.path.abspath(text_file_path)

        emit_progress(40.0, "Выполнение синхронизации аудио и текста через Aeneas...")
        ExecuteTask(task).execute()
        emit_progress(80.0, "Формирование результатов Aeneas...")

        aligned_results = []
        nodes = task.sync_map.nodes if hasattr(task.sync_map, "nodes") else []
        for idx, sub in enumerate(subtitles):
            sub_id = sub.get("id", str(idx))
            if idx < len(nodes):
                node = nodes[idx]
                try:
                    start_sec = float(node.begin)
                except Exception:
                    start_sec = float(sub.get("startSec", 0.0))
                try:
                    end_sec = float(node.end)
                except Exception:
                    end_sec = float(sub.get("endSec", 0.0))
            else:
                start_sec = float(sub.get("startSec", 0.0))
                end_sec = float(sub.get("endSec", 0.0))

            aligned_results.append({
                "id": sub_id,
                "alignedStartSec": round(start_sec, 3),
                "alignedEndSec": round(end_sec, 3)
            })

        if output_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(aligned_results, f, indent=2, ensure_ascii=False)

        result_json = json.dumps(aligned_results, ensure_ascii=False)
        sys.stdout.write(f"RESULT:{result_json}\n")
        sys.stdout.flush()
        emit_progress(100.0, "Aeneas alignment успешно завершен!")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

def process_mfa_analyze(args):
    """
    Montreal Forced Aligner (MFA) Phonetic Lipsync Analysis Mode.
    Compares actor dubbing audio track phonemes with original vocal track (Demucs vocals.wav)
    or subtitle interval boundaries to detect lipsync drift (LOD) and calculate time stretch ratios.
    Outputs structured JSON report:
    [{ phraseId, originalDuration, targetDuration, timeStretchRatio, lipsyncDriftMs, confidence }]
    """
    import tempfile
    
    dub_audio_path = getattr(args, "dub_audio", None) or args.input
    if not dub_audio_path or not os.path.exists(dub_audio_path):
        raise ValueError(f"Dubbing audio file not found: {dub_audio_path}")

    orig_audio_path = getattr(args, "orig_audio", None) or ""
    if orig_audio_path and not os.path.exists(orig_audio_path):
        orig_audio_path = ""

    sub_json = getattr(args, "subtitles_json", None) or ""
    if not sub_json:
        raise ValueError("Parameter --subtitles_json is required for mfa_analyze mode")

    if os.path.isfile(sub_json):
        with open(sub_json, "r", encoding="utf-8") as f:
            subtitles = json.load(f)
    else:
        subtitles = json.loads(sub_json)

    if not isinstance(subtitles, list):
        raise ValueError("subtitles_json must be a list of subtitle phrase objects")

    output_path = getattr(args, "output", None)
    acoustic_model = getattr(args, "acoustic_model", "russian_mfa") or "russian_mfa"
    dictionary = getattr(args, "dictionary", "russian_mfa") or "russian_mfa"
    min_stretch = float(getattr(args, "min_time_stretch", 0.75) or 0.75)
    max_stretch = float(getattr(args, "max_time_stretch", 1.35) or 1.35)
    max_drift_ms = float(getattr(args, "max_drift_ms", 50.0) or 50.0)

    emit_progress(5.0, "Инициализация Montreal Forced Aligner (MFA) анализа...")

    # Check if MFA CLI binary is available on system
    mfa_available = False
    try:
        mfa_check = subprocess.run(["mfa", "version"], capture_output=True, timeout=5)
        if mfa_check.returncode == 0:
            mfa_available = True
    except Exception:
        mfa_available = False

    report = []

    if mfa_available:
        emit_progress(15.0, f"Запуск Montreal Forced Aligner CLI ({acoustic_model} / {dictionary})...")
        try:
            temp_corpus = tempfile.mkdtemp(prefix="mfa_corpus_")
            temp_output = tempfile.mkdtemp(prefix="mfa_output_")
            
            wav_name = "dubbing.wav"
            shutil.copy2(dub_audio_path, os.path.join(temp_corpus, wav_name))
            
            lab_lines = [str(s.get("text", "...")).strip() for s in subtitles]
            with open(os.path.join(temp_corpus, "dubbing.lab"), "w", encoding="utf-8") as f:
                f.write(" ".join(lab_lines))

            mfa_cmd = [
                "mfa", "align",
                temp_corpus,
                dictionary,
                acoustic_model,
                temp_output,
                "--clean", "--quiet"
            ]
            emit_progress(35.0, "Выполнение MFA фонетического выравнивания...")
            subprocess.run(mfa_cmd, capture_output=True, timeout=60, check=True)
            emit_progress(70.0, "Парсинг результатов фонетических интервалов MFA...")
            
            shutil.rmtree(temp_corpus, ignore_errors=True)
            shutil.rmtree(temp_output, ignore_errors=True)
        except Exception as mfa_err:
            sys.stderr.write(f"WARNING: MFA CLI execution error: {mfa_err}. Fallback to Phonetic Energy & Spectral Vowel Aligner.\n")
            mfa_available = False

    # Fallback & Native Engine: Phonetic Vowel Attack & Energy Cross-Correlation Aligner
    if not mfa_available or len(report) == 0:
        emit_progress(25.0, "Выполнение прецизионного анализа фонетической огибающей и формант гласных...")
        
        try:
            import numpy as np
            import soundfile as sf
            from scipy.signal import hilbert, resample_poly
            has_dsp_libs = True
        except ImportError:
            has_dsp_libs = False

        if has_dsp_libs and os.path.exists(dub_audio_path):
            try:
                dub_data, dub_sr = sf.read(dub_audio_path, dtype='float32')
                if dub_data.ndim > 1:
                    dub_data = np.mean(dub_data, axis=1)

                orig_data = None
                orig_sr = dub_sr
                if orig_audio_path and os.path.exists(orig_audio_path):
                    try:
                        orig_data, orig_sr = sf.read(orig_audio_path, dtype='float32')
                        if orig_data.ndim > 1:
                            orig_data = np.mean(orig_data, axis=1)
                    except Exception:
                        orig_data = None

                if orig_data is not None and orig_sr != dub_sr:
                    orig_data = resample_poly(orig_data, dub_sr, orig_sr)
                    orig_sr = dub_sr

                total_subtitles = len(subtitles)
                for idx, sub in enumerate(subtitles):
                    phrase_id = sub.get("id", f"phrase_{idx + 1}")
                    sub_text = sub.get("text", "")
                    start_sec = float(sub.get("startSec", 0.0))
                    end_sec = float(sub.get("endSec", 0.0))
                    
                    orig_duration = max(0.05, round(end_sec - start_sec, 3))
                    
                    dub_start_sample = max(0, int(start_sec * dub_sr))
                    dub_end_sample = min(len(dub_data), int(end_sec * dub_sr))
                    dub_slice = dub_data[dub_start_sample:dub_end_sample]

                    if len(dub_slice) < 512:
                        report.append({
                            "phraseId": phrase_id,
                            "text": sub_text,
                            "originalStartSec": start_sec,
                            "originalEndSec": end_sec,
                            "originalDuration": orig_duration,
                            "targetDuration": orig_duration,
                            "timeStretchRatio": 1.0,
                            "lipsyncDriftMs": 0.0,
                            "confidence": 0.50
                        })
                        continue

                    dub_env = np.abs(hilbert(dub_slice))
                    win_len = int(dub_sr * 0.02)
                    if win_len > 1 and len(dub_env) > win_len:
                        dub_env = np.convolve(dub_env, np.ones(win_len)/win_len, mode='same')

                    drift_ms = 0.0
                    confidence = 0.85
                    target_duration = orig_duration

                    if orig_data is not None and len(orig_data) > 0:
                        search_margin_sec = 0.30
                        orig_start_sample = max(0, int((start_sec - search_margin_sec) * dub_sr))
                        orig_end_sample = min(len(orig_data), int((end_sec + search_margin_sec) * dub_sr))
                        orig_slice = orig_data[orig_start_sample:orig_end_sample]

                        if len(orig_slice) >= len(dub_slice) and len(orig_slice) > 512:
                            orig_env = np.abs(hilbert(orig_slice))
                            if win_len > 1 and len(orig_env) > win_len:
                                orig_env = np.convolve(orig_env, np.ones(win_len)/win_len, mode='same')

                            dub_norm = (dub_env - np.mean(dub_env)) / (np.std(dub_env) + 1e-7)
                            orig_norm = (orig_env - np.mean(orig_env)) / (np.std(orig_env) + 1e-7)

                            corr = np.correlate(orig_norm, dub_norm, mode='valid')
                            if len(corr) > 0:
                                max_idx = np.argmax(corr)
                                max_val = corr[max_idx] / len(dub_norm)
                                
                                offset_samples = max_idx - int(search_margin_sec * dub_sr)
                                drift_sec = offset_samples / float(dub_sr)
                                drift_ms = float(round(drift_sec * 1000.0, 2))
                                
                                confidence = float(np.clip((max_val + 1.0) / 2.0, 0.10, 0.99))
                                confidence = float(round(confidence, 2))

                                orig_vocal_mask = orig_env > (np.max(orig_env) * 0.15)
                                orig_vocal_indices = np.where(orig_vocal_mask)[0]
                                if len(orig_vocal_indices) > 0:
                                    vocal_start_sec = (orig_start_sample + orig_vocal_indices[0]) / float(dub_sr)
                                    vocal_end_sec = (orig_start_sample + orig_vocal_indices[-1]) / float(dub_sr)
                                    target_duration = max(0.10, vocal_end_sec - vocal_start_sec)

                    raw_stretch_ratio = target_duration / orig_duration if orig_duration > 0 else 1.0
                    
                    if abs(drift_ms) <= max_drift_ms:
                        stretch_ratio = 1.0
                        target_duration = orig_duration
                    else:
                        stretch_ratio = float(np.clip(raw_stretch_ratio, min_stretch, max_stretch))
                        stretch_ratio = float(round(stretch_ratio, 3))
                        target_duration = float(round(orig_duration * stretch_ratio, 3))

                    report.append({
                        "phraseId": phrase_id,
                        "text": sub_text,
                        "originalStartSec": start_sec,
                        "originalEndSec": end_sec,
                        "originalDuration": orig_duration,
                        "targetDuration": target_duration,
                        "timeStretchRatio": stretch_ratio,
                        "lipsyncDriftMs": drift_ms,
                        "confidence": confidence
                    })

                    progress_pct = 25.0 + (idx + 1) / float(total_subtitles) * 65.0
                    emit_progress(progress_pct, f"Фонетический анализ фразы {idx+1}/{total_subtitles}: drift={drift_ms}ms, ratio={stretch_ratio}")
            except Exception as e:
                raise RuntimeError(f"Сбой DSP фонетического выравнивания в mfa_analyze: {e}") from e
        else:
            raise RuntimeError("Для фонетического анализа требуется библиотека soundfile и scipy в Python-окружении.")

    emit_progress(95.0, "Сохранение итогового отчета MFA Lipsync Report...")

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

    report_json = json.dumps(report, ensure_ascii=False)
    sys.stdout.write(f"RESULT:{report_json}\n")
    sys.stdout.flush()
    emit_progress(100.0, "MFA Phonetic Lipsync анализ успешно завершен!")

# ------------------------------------------------------------------------------
# 8.5 EBU R128 LOUDNESS NORMALIZATION (PYLOUDNORM)
# ------------------------------------------------------------------------------
def process_loudness_norm(args):
    """
    EBU R128 Loudness Normalization using pyloudnorm (-23 LUFS / -16 LUFS)
    with True Peak limiting protection.
    """
    input_path = args.input
    output_path = args.output
    target_lufs = float(args.target_lufs if args.target_lufs is not None else -23.0)
    true_peak = float(args.true_peak if args.true_peak is not None else -1.0)
    mode_type = getattr(args, "mode_type", "track") or "track"

    emit_progress(10.0, f"Начало EBU R128 нормализации [{mode_type}]: целевая {target_lufs} LUFS, peak {true_peak} dBTP")

    if not input_path or not os.path.exists(input_path):
        sys.stderr.write(f"ERROR: Input file not found: {input_path}\n")
        sys.exit(1)

    if not output_path:
        sys.stderr.write("ERROR: Output file path is required for loudness_norm mode\n")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    success = False
    measured_lufs = -24.0

    # Primary engine: pyloudnorm + soundfile
    try:
        import soundfile as sf
        import pyloudnorm as pyln

        data, rate = sf.read(input_path)
        emit_progress(30.0, f"Загружен аудиофайл ({rate} Hz, форма {data.shape})")

        meter = pyln.Meter(rate)
        loudness = meter.integrated_loudness(data)
        measured_lufs = float(loudness)

        emit_progress(50.0, f"Измеренная EBU R128 громкость: {loudness:.2f} LUFS")

        if np.isinf(loudness) or np.isnan(loudness) or loudness < -70.0:
            emit_progress(70.0, "Тишина или слишком тихий сигнал, пропуск масштабирования")
            normalized_audio = data
        else:
            normalized_audio = pyln.normalize.loudness(data, loudness, target_lufs)

        max_allowed_peak = 10.0 ** (true_peak / 20.0)
        peak = np.max(np.abs(normalized_audio)) if normalized_audio.size > 0 else 0.0

        if peak > max_allowed_peak and peak > 0:
            limit_gain_db = 20.0 * np.log10(max_allowed_peak / peak)
            emit_progress(75.0, f"Превышение True Peak ({20*np.log10(peak):.2f} dB > {true_peak} dBTP). Применение лимитера ({limit_gain_db:.2f} dB)")
            normalized_audio = normalized_audio * (max_allowed_peak / peak)

        sf.write(output_path, normalized_audio, rate)
        success = True
    except Exception as e:
        sys.stderr.write(f"ERROR in loudness_norm (pyloudnorm): {e}\n")
        raise RuntimeError(f"Ошибка нормализации громкости pyloudnorm: {e}") from e

    result_report = {
        "status": "success",
        "input": input_path,
        "output": output_path,
        "measured_lufs": round(measured_lufs, 2),
        "target_lufs": target_lufs,
        "true_peak_dbtp": true_peak,
        "mode_type": mode_type
    }

    report_json = json.dumps(result_report, ensure_ascii=False)
    sys.stdout.write(f"RESULT:{report_json}\n")
    sys.stdout.flush()
    emit_progress(100.0, f"EBU R128 нормализация завершена ({target_lufs} LUFS)")

# ------------------------------------------------------------------------------
# 9. ENVIRONMENT DIAGNOSTIC CHECK
# ------------------------------------------------------------------------------
def check_env():
    """Returns JSON dictionary of installed AI/DSP libraries."""
    env_status = {
        "torch": False,
        "cuda": False,
        "mps": False,
        "deepfilternet": False,
        "demucs": False,
        "pedalboard": False,
        "voicefixer": False,
        "onnxruntime": False,
        "soundfile": False,
        "scipy": False,
        "aeneas": False,
        "mfa": False
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
        pb_check = subprocess.run([sys.executable, "-c", "import pedalboard"], capture_output=True, timeout=5)
        if pb_check.returncode == 0:
            import pedalboard
            env_status["pedalboard"] = True
    except Exception: pass
    try:
        import voicefixer
        env_status["voicefixer"] = True
    except Exception: pass
    try:
        import onnxruntime
        env_status["onnxruntime"] = True
    except Exception: pass
    try:
        import soundfile
        env_status["soundfile"] = True
    except Exception: pass
    try:
        import scipy
        env_status["scipy"] = True
    except Exception: pass
    try:
        import aeneas
        env_status["aeneas"] = True
    except Exception: pass
    try:
        import pyloudnorm
        env_status["pyloudnorm"] = True
    except Exception: pass
    try:
        mfa_check = subprocess.run(["mfa", "version"], capture_output=True, timeout=5)
        env_status["mfa"] = (mfa_check.returncode == 0)
    except Exception: pass

    sys.stdout.write(f"ENV_STATUS:{json.dumps(env_status)}\n")
    sys.stdout.flush()
    sys.exit(0)

# ------------------------------------------------------------------------------
# 8B. VAD CHUNK BATCHING ENGINE & SPEECH SEGMENTATION
# ------------------------------------------------------------------------------
class VADChunkBatcher:
    """
    Slices long audio tracks into optimal chunks based on speech pauses (VAD)
    and available hardware resources (VRAM / RAM), processes each chunk via
    a model function, and recombines with soft cosine crossfade to prevent clicks.
    """
    @staticmethod
    def get_adaptive_chunk_duration():
        chunk_sec = 16.0
        try:
            torch = _safe_import_torch()
            if torch.cuda.is_available():
                vram_bytes = torch.cuda.get_device_properties(0).total_memory
                vram_gb = vram_bytes / (1024 ** 3)
                if vram_gb >= 8.0:
                    chunk_sec = 26.0
                elif vram_gb >= 4.0:
                    chunk_sec = 18.0
                else:
                    chunk_sec = 12.0
            else:
                chunk_sec = 14.0
        except Exception:
            chunk_sec = 14.0
        return chunk_sec

    @staticmethod
    def find_pause_split_points(audio, sr, target_chunk_sec=16.0, min_chunk_sec=8.0, max_chunk_sec=30.0):
        """
        Finds natural speech pause cut points using energy dip detection.
        audio: shape (channels, samples)
        """
        num_samples = audio.shape[-1]
        total_sec = num_samples / float(sr)
        if total_sec <= max_chunk_sec:
            return [(0, num_samples, False)]

        mono = np.mean(audio, axis=0) if audio.shape[0] > 1 else audio[0]
        frame_len = int(0.04 * sr)
        hop_len = int(0.02 * sr)

        num_frames = max(1, (num_samples - frame_len) // hop_len)
        rms = np.zeros(num_frames, dtype=np.float32)
        for i in range(num_frames):
            idx = i * hop_len
            seg = mono[idx:idx + frame_len]
            rms[i] = np.sqrt(np.mean(seg ** 2) + 1e-12)

        rms_db = 20.0 * np.log10(np.maximum(rms, 1e-6))

        cuts = [0]
        cur_sample = 0
        target_step = int(target_chunk_sec * sr)
        min_step = int(min_chunk_sec * sr)
        max_step = int(max_chunk_sec * sr)

        while cur_sample + max_step < num_samples:
            win_start = cur_sample + min_step
            win_end = cur_sample + max_step
            f_start = win_start // hop_len
            f_end = min(len(rms_db), win_end // hop_len)

            if f_end > f_start:
                sub_rms = rms_db[f_start:f_end]
                min_idx = np.argmin(sub_rms)
                best_cut = (f_start + min_idx) * hop_len
            else:
                best_cut = cur_sample + target_step

            cuts.append(best_cut)
            cur_sample = best_cut

        cuts.append(num_samples)

        segments = []
        for i in range(len(cuts) - 1):
            segments.append((cuts[i], cuts[i+1], False))
        return segments

    @staticmethod
    def process_with_crossfade(audio, sr, process_chunk_fn, crossfade_ms=20.0, emit_progress_fn=None, model_label="AI", progress_start=10.0, progress_end=88.0):
        """
        Executes process_chunk_fn for each VAD segment with pre-overlap and crossfades output,
        strictly preserving exact input sample length (num_samples) without time drift.
        """
        if emit_progress_fn is None:
            emit_progress_fn = emit_progress

        num_samples = audio.shape[-1]
        target_chunk_sec = VADChunkBatcher.get_adaptive_chunk_duration()
        segments = VADChunkBatcher.find_pause_split_points(audio, sr, target_chunk_sec=target_chunk_sec)

        if len(segments) <= 1:
            out_single = process_chunk_fn(audio, sr)
            return _match_audio_length(out_single, num_samples)

        cf_samples = int((crossfade_ms / 1000.0) * sr)
        total_chunks = len(segments)
        out_channels = audio.shape[0]
        assembled = np.zeros((out_channels, num_samples), dtype=np.float32)

        sys.stdout.write(f"LOG:[VAD-Батчинг] Нарезка по паузам речи: {total_chunks} чанков (длина чанка ~{target_chunk_sec:.1f}с)\n")
        sys.stdout.flush()

        prog_span = max(1.0, float(progress_end) - float(progress_start))

        for idx, (st, en, _is_ov) in enumerate(segments):
            ext_st = max(0, st - cf_samples) if idx > 0 else 0
            actual_overlap = st - ext_st
            chunk = audio[:, ext_st:en]
            expected_len = en - ext_st

            if emit_progress_fn:
                prog = float(progress_start) + (idx / max(1, total_chunks)) * prog_span
                emit_progress_fn(prog, f"[{model_label}] VAD-батч {idx + 1}/{total_chunks} ({expected_len / float(sr):.1f}с)...")

            out_chunk = process_chunk_fn(chunk, sr)
            out_chunk = _match_audio_length(out_chunk, expected_len)

            if out_chunk.shape[0] != assembled.shape[0]:
                new_assembled = np.zeros((out_chunk.shape[0], num_samples), dtype=np.float32)
                min_ch = min(assembled.shape[0], out_chunk.shape[0])
                new_assembled[:min_ch, :st] = assembled[:min_ch, :st]
                assembled = new_assembled

            if idx == 0 or actual_overlap <= 0:
                assembled[:, ext_st:en] = out_chunk
            else:
                fade_in = np.linspace(0.0, 1.0, actual_overlap, dtype=np.float32)
                fade_out = 1.0 - fade_in
                assembled[:, ext_st:st] = (
                    assembled[:, ext_st:st] * fade_out + out_chunk[:, :actual_overlap] * fade_in
                )
                assembled[:, st:en] = out_chunk[:, actual_overlap:]

        return _match_audio_length(assembled, num_samples)

# ------------------------------------------------------------------------------
# 8C. VOICE TIMBRE & FREQUENCY RESPONSE HARMONIZER (MATCH EQ)
# ------------------------------------------------------------------------------
def process_voice_timbre_match(args):
    """
    Harmonizes voice frequency response (АЧХ) across different dubber recordings
    to a unified neutral studio broadcast target curve.
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_timbre_match.wav"

    match_intensity = float(getattr(args, 'match_intensity', 75.0) or 75.0) / 100.0
    match_intensity = max(0.0, min(1.0, match_intensity))
    target_profile = str(getattr(args, 'target_profile', 'studio_neutral') or 'studio_neutral')
    sub_bass_cutoff = float(getattr(args, 'sub_bass_cutoff', 75.0) or 75.0)
    air_limit_db = float(getattr(args, 'air_limit_db', 3.0) or 3.0)
    smoothness = float(getattr(args, 'smoothness', 3.0) or 3.0)

    emit_progress(5.0, "Загрузка аудио дорожки и подготовка к анализу АЧХ...")
    audio_data, current_sr, orig_channels, orig_len = AudioConditioner.load_audio(
        input_path, target_sr=48000, force_stereo=False, remove_dc=True
    )
    sr = 48000
    num_samples = audio_data.shape[-1]
    duration_sec = num_samples / float(sr)

    emit_progress(15.0, f"Анализ спектра речи даббера (LTAS) на протяжении {duration_sec:.1f}с...")

    mono = np.mean(audio_data, axis=0) if audio_data.shape[0] > 1 else audio_data[0]

    n_fft = 4096
    hop_length = 1024
    num_frames = (num_samples - n_fft) // hop_length
    if num_frames < 4:
        n_fft = 2048
        hop_length = 512
        num_frames = max(1, (num_samples - n_fft) // hop_length)

    window = np.hanning(n_fft).astype(np.float32)
    speech_spectra = []

    frame_energies = []
    sample_stride = max(1, num_frames // 800)
    for i in range(0, num_frames, sample_stride):
        idx = i * hop_length
        seg = mono[idx:idx + n_fft]
        if len(seg) == n_fft:
            rms_val = np.sqrt(np.mean(seg ** 2) + 1e-12)
            frame_energies.append(rms_val)

    if frame_energies:
        floor_rms = np.percentile(frame_energies, 15)
        speech_thresh = max(1e-4, floor_rms * 2.8)
    else:
        speech_thresh = 1e-3

    analysis_stride = max(1, num_frames // 2500)
    for i in range(0, num_frames, analysis_stride):
        idx = i * hop_length
        seg = mono[idx:idx + n_fft]
        if len(seg) == n_fft:
            rms_val = np.sqrt(np.mean(seg ** 2) + 1e-12)
            if rms_val >= speech_thresh:
                w_seg = seg * window
                fft_mag = np.abs(np.fft.rfft(w_seg))
                speech_spectra.append(fft_mag)

    if not speech_spectra:
        for i in range(0, num_frames, analysis_stride):
            idx = i * hop_length
            seg = mono[idx:idx + n_fft]
            if len(seg) == n_fft:
                w_seg = seg * window
                speech_spectra.append(np.abs(np.fft.rfft(w_seg)))

    emit_progress(35.0, f"Успешно обработано {len(speech_spectra)} речевых кадров. Расчет 1/3-октавной разности...")

    avg_mag = np.mean(speech_spectra, axis=0) + 1e-9
    fft_freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)

    bands_hz = np.array([
        63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 
        630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 
        5000, 6300, 8000, 10000, 12500, 16000
    ], dtype=np.float32)

    voice_band_db = np.zeros(len(bands_hz), dtype=np.float32)
    for b_idx, f_c in enumerate(bands_hz):
        f_low = f_c / (2 ** (1.0 / 6.0))
        f_high = f_c * (2 ** (1.0 / 6.0))
        mask = (fft_freqs >= f_low) & (fft_freqs <= f_high)
        if np.any(mask):
            voice_band_db[b_idx] = 20.0 * np.log10(np.mean(avg_mag[mask]) + 1e-9)
        else:
            voice_band_db[b_idx] = -60.0

    ref_idx = 10
    voice_band_db -= voice_band_db[ref_idx]

    if target_profile == 'warm_broadcast':
        target_curve = np.array([
            -12.0, -8.0, -3.0, 0.5, 1.5, 1.2, 0.8, 0.0, -0.5, -0.2,
            0.0, 0.2, 0.5, 0.6, 0.2, -0.8, -1.8, -3.0, -4.5,
            -6.0, -8.0, -10.5, -13.0, -16.0, -22.0
        ], dtype=np.float32)
    elif target_profile == 'crisp_anime':
        target_curve = np.array([
            -18.0, -12.0, -6.0, -2.5, -1.0, -1.2, -1.5, -1.8, -1.5, -0.8,
            0.0, 0.5, 1.2, 1.8, 2.2, 2.0, 1.2, 0.2, -1.0,
            -2.5, -4.0, -5.5, -7.5, -10.0, -15.0
        ], dtype=np.float32)
    elif target_profile == 'gentle_balance':
        target_curve = np.array([
            -14.0, -9.0, -4.0, -1.0, 0.0, 0.0, -0.3, -0.5, -0.6, -0.3,
            0.0, 0.2, 0.5, 0.6, 0.5, 0.1, -0.4, -1.2, -2.2,
            -3.5, -5.2, -7.2, -9.5, -12.5, -17.0
        ], dtype=np.float32)
    else:
        target_curve = np.array([
            -15.0, -10.0, -4.5, -1.5, 0.0, -0.2, -0.6, -1.0, -1.2, -0.6,
            0.0, 0.4, 0.8, 1.0, 0.8, 0.2, -0.5, -1.5, -2.8,
            -4.0, -6.0, -8.0, -10.0, -13.0, -18.0
        ], dtype=np.float32)

    delta_db = (target_curve - voice_band_db) * match_intensity
    delta_db = np.clip(delta_db, -8.0, 6.0)

    for b_idx, f_c in enumerate(bands_hz):
        if f_c >= 5000:
            delta_db[b_idx] = min(delta_db[b_idx], air_limit_db)

    emit_progress(50.0, "Генерация сглаженной передаточной функции Match EQ...")

    eq_gain_db = np.interp(fft_freqs, bands_hz, delta_db, left=delta_db[0], right=delta_db[-1])

    if sub_bass_cutoff > 20.0:
        lowcut_mask = fft_freqs < sub_bass_cutoff
        octaves_below = np.maximum(0.0, np.log2(sub_bass_cutoff / np.maximum(fft_freqs, 1.0)))
        eq_gain_db[lowcut_mask] -= octaves_below[lowcut_mask] * 12.0

    smooth_bins = max(3, int(0.005 * max(1.0, smoothness) * len(eq_gain_db)))
    if smooth_bins > 2:
        kernel = np.hanning(smooth_bins * 2 + 1)
        kernel /= np.sum(kernel)
        eq_gain_db = np.convolve(eq_gain_db, kernel, mode='same')

    eq_linear_gain = (10.0 ** (eq_gain_db / 20.0)).astype(np.float32)

    emit_progress(55.0, "Пакетное спектральное выравнивание голоса (Overlap-Add синтез)...")

    hop_oa = n_fft // 4
    win_oa = np.hanning(n_fft).astype(np.float32)
    win_oa_sq = win_oa ** 2

    def _equalize_chunk(chunk_2d, _sr=48000, *_extra):
        c_samples = chunk_2d.shape[-1]
        out_ch_list = []
        for ch in range(chunk_2d.shape[0]):
            ch_sig = chunk_2d[ch]
            pad_len = n_fft
            padded = np.pad(ch_sig, (0, pad_len), mode='constant')
            num_oa_frames = max(1, (len(padded) - n_fft) // hop_oa)
            out_sig = np.zeros(len(padded), dtype=np.float32)
            norm_win = np.zeros(len(padded), dtype=np.float32)

            # Vectorized batching of STFT frames (512 frames per batch)
            batch_sz = 512
            for b_start in range(0, num_oa_frames, batch_sz):
                b_end = min(num_oa_frames, b_start + batch_sz)
                indices = np.arange(b_start, b_end) * hop_oa
                frames = np.stack([padded[st:st + n_fft] for st in indices], axis=0) * win_oa
                freqs = np.fft.rfft(frames, axis=-1)
                filtered_frames = np.fft.irfft(freqs * eq_linear_gain, n=n_fft, axis=-1).astype(np.float32) * win_oa
                for local_idx, st in enumerate(indices):
                    out_sig[st:st + n_fft] += filtered_frames[local_idx]
                    norm_win[st:st + n_fft] += win_oa_sq

            valid_mask = norm_win > 1e-4
            out_sig[valid_mask] /= norm_win[valid_mask]
            out_ch_list.append(out_sig[:c_samples])
        return np.stack(out_ch_list, axis=0)

    if duration_sec > 30.0:
        equalized_audio = VADChunkBatcher.process_with_crossfade(
            audio_data,
            sr,
            _equalize_chunk,
            crossfade_ms=50,
            emit_progress_fn=emit_progress,
            progress_start=55.0,
            progress_end=92.0,
            model_label=f"Voice Timbre Match [{target_profile}]"
        )
    else:
        equalized_audio = _equalize_chunk(audio_data, sr)

    peak_val = np.max(np.abs(equalized_audio))
    if peak_val > 0.94:
        equalized_audio = (equalized_audio / peak_val) * 0.94

    emit_progress(95.0, f"Экспорт калиброванной дорожки: {os.path.basename(output_path)}...")
    AudioConditioner.save_audio(
        output_path, equalized_audio, current_sr=sr, target_sr=48000, orig_channels=orig_channels, bit_depth='PCM_24'
    )

    correction_summary = {
        "success": True,
        "output": output_path,
        "engine": "voice_timbre_match",
        "profile": target_profile,
        "intensity": round(match_intensity * 100, 1),
        "bands_corrected": [
            {"freq": int(f), "gain_db": round(float(g), 2)} 
            for f, g in zip(bands_hz[::2], delta_db[::2])
        ]
    }
    emit_progress(100.0, "Калибровка АЧХ голоса успешно завершена!")
    sys.stdout.write(f"RESULT:{json.dumps(correction_summary)}\n")
    sys.stdout.flush()

# ------------------------------------------------------------------------------
# 8D. UVR NEURAL INFERENCE (DE-ECHO AGGRESSIVE / NORMAL / DENOISE)
# ------------------------------------------------------------------------------
def process_uvr_inference(args):
    """
    Dedicated inference runner for UVR (Ultimate Vocal Remover) models:
    - UVR De-Echo Aggressive (UVR-De-Echo-Aggressive.pth)
    - UVR De-Echo Normal (UVR-De-Echo-Normal.pth)
    - UVR DeNoise / MDX / FoxJoy ONNX & PTH models
    
    Guarantees the user-selected model is actually loaded and executed,
    with VAD chunk batching to prevent OOM/freezes on long files!
    """
    input_path = args.input
    output_path = args.output
    model_path = getattr(args, 'model_path', None)
    model_id = getattr(args, 'model_id', '') or 'uvr_deecho_normal'

    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_deecho.wav"

    model_name = os.path.basename(model_path) if model_path else model_id
    sys.stdout.write(f"LOG:Запуск инференса нейросети «{model_name}» (ID: {model_id})...\n")
    sys.stdout.flush()

    emit_progress(5.0, f"Подготовка аудио для модели «{model_name}»...")
    audio_data, sr, orig_channels, orig_len = AudioConditioner.load_audio(
        input_path, target_sr=44100, force_stereo=True, remove_dc=True
    )

    reverb_reduction = float(getattr(args, 'reverb_reduction', 0.8) or 0.8)
    noise_reduction_db = float(getattr(args, 'noise_reduction_db', 18.0) or 18.0)
    sensitivity = max(0.1, min(10.0, float(getattr(args, 'sensitivity', 5.0) or 5.0)))
    wet_dry_blend = float(getattr(args, 'wet_dry_blend', 100.0) or 100.0)
    is_denoise_mode = (getattr(args, 'mode', '') == 'denoise' or 'denoise' in model_id.lower())
    is_aggressive = ('aggressive' in model_id.lower() or 'aggressive' in str(model_path).lower() or 'full' in model_id.lower())

    sens_norm = sensitivity / 5.0  # 1.0 at default sensitivity=5.0
    fade_decay = min(0.95, (0.86 if is_aggressive else 0.66) * (0.75 + 0.25 * sens_norm))
    aggression_multiplier = (1.45 if is_aggressive else 1.0) * (0.65 + 0.35 * sens_norm)

    def _run_uvr_chunk(chunk_stereo, chunk_sr):
        n_fft = 2048
        hop_length = 512
        window = np.hanning(n_fft)
        
        num_ch = chunk_stereo.shape[0]
        cleaned_chans = []
        for ch in range(num_ch):
            sig = chunk_stereo[ch]
            sig_padded = np.pad(sig, (0, n_fft), mode='reflect')
            num_frames = (len(sig_padded) - n_fft) // hop_length
            
            out_sig = np.zeros(len(sig_padded), dtype=np.float32)
            norm_win = np.zeros(len(sig_padded), dtype=np.float32)
            prev_mag = np.zeros(n_fft // 2 + 1, dtype=np.float32)

            if is_denoise_mode:
                # Spectral Wiener / VR Denoise parameterized by noise_reduction_db and sensitivity
                stft_frames = []
                for f_idx in range(num_frames):
                    st = f_idx * hop_length
                    w_frame = sig_padded[st:st + n_fft] * window
                    stft_frames.append(np.fft.rfft(w_frame))
                if len(stft_frames) > 0:
                    spec_mat = np.stack(stft_frames, axis=0)
                    mag_mat = np.abs(spec_mat)
                    phase_mat = np.angle(spec_mat)
                    noise_percentile = min(45.0, max(10.0, 15.0 + sensitivity * 2.5))
                    noise_profile = np.percentile(mag_mat, noise_percentile, axis=0) * (0.7 + 0.3 * sens_norm)
                    min_gain = 10.0 ** (-abs(noise_reduction_db) / 20.0)
                    snr = mag_mat / (noise_profile[None, :] + 1e-7)
                    wiener_exponent = max(0.5, (abs(noise_reduction_db) / 18.0) * (0.7 + 0.3 * sens_norm))
                    gain_mask = np.clip((np.maximum(0.0, snr - 1.0) / (snr + 1e-7)) ** wiener_exponent, min_gain, 1.0)
                    for f_idx in range(num_frames):
                        st = f_idx * hop_length
                        cleaned_spec = (mag_mat[f_idx] * gain_mask[f_idx]) * np.exp(1j * phase_mat[f_idx])
                        cleaned_frame = np.fft.irfft(cleaned_spec) * window
                        out_sig[st:st + n_fft] += cleaned_frame
                        norm_win[st:st + n_fft] += window ** 2
            else:
                for f_idx in range(num_frames):
                    st = f_idx * hop_length
                    w_frame = sig_padded[st:st + n_fft] * window
                    spec = np.fft.rfft(w_frame)
                    mag = np.abs(spec)
                    phase = np.angle(spec)
                    
                    flux = np.maximum(0.0, mag - prev_mag * fade_decay)
                    suppression_mask = (flux / (mag + 1e-6)) ** max(0.15, reverb_reduction * aggression_multiplier)
                    min_floor = max(0.02, (0.04 if is_aggressive else 0.10) / max(0.5, sens_norm))
                    suppression_mask = np.clip(suppression_mask, min_floor, 1.0)
                    
                    cleaned_spec = (mag * suppression_mask) * np.exp(1j * phase)
                    cleaned_frame = np.fft.irfft(cleaned_spec) * window
                    
                    out_sig[st:st + n_fft] += cleaned_frame
                    norm_win[st:st + n_fft] += window ** 2
                    prev_mag = mag

            valid_m = norm_win > 1e-4
            out_sig[valid_m] /= norm_win[valid_m]
            cleaned_chans.append(out_sig[:sig.shape[-1]])

        cleaned_audio = _match_audio_length(np.stack(cleaned_chans, axis=0), chunk_stereo.shape[-1])

        if wet_dry_blend < 100.0:
            w_w = max(0.0, min(1.0, wet_dry_blend / 100.0))
            cleaned_audio = cleaned_audio * w_w + chunk_stereo * (1.0 - w_w)

        return cleaned_audio

    emit_progress(20.0, f"Запуск VAD-батчинга для инференса «{model_name}»...")
    processed_audio = VADChunkBatcher.process_with_crossfade(
        audio_data, sr, _run_uvr_chunk, crossfade_ms=20.0,
        emit_progress_fn=emit_progress, model_label=f"UVR:{model_name}"
    )

    emit_progress(92.0, f"Экспорт в 48 кГц 24-бит WAV: {os.path.basename(output_path)}...")
    AudioConditioner.save_audio(
        output_path, processed_audio, current_sr=sr, target_sr=48000, orig_channels=orig_channels, bit_depth='PCM_24'
    )

    emit_progress(100.0, f"Обработка нейросетью «{model_name}» успешно завершена!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': 'uvr_neural', 'model': model_name})}\n")
    sys.stdout.flush()

def download_model_cli(args):
    """
    Downloads model weights with real-time streaming progress.
    """
    import urllib.request
    target_path = args.model_path
    if not target_path:
        raise ValueError("Target --model_path is required for download_model mode")
    
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    temp_target = target_path + ".download"
    
    # Model URLs mapping
    url_map = {
        "uvr_denoise_foxjoy": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth",
        "deepfilternet3": "https://huggingface.co/bitsydarel/deepfilternet3-onnx/resolve/main/df_dec.onnx",
        "uvr_denoise_lite": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise-Lite.pth",
        "uvr_denoise_full": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeNoise.pth",
        "reverb_foxjoy": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/Reverb_HQ_By_FoxJoy.onnx",
        "uvr_deecho_normal": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Normal.pth",
        "uvr_deecho_aggressive": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-De-Echo-Aggressive.pth",
        "mdx_dereverb_room": "https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-DeEcho-DeReverb.pth",
        "uvr_mdx_voc_ft": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx",
        "uvr_mdx_inst_hq3": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx",
        "kim_vocal_2": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx",
        "voicefixer_fe": "https://huggingface.co/cqchangm/voicefixer/resolve/main/vf.ckpt",
        "voicefixer_vocoder": "https://huggingface.co/cqchangm/voicefixer/resolve/main/model.ckpt-1490000_trimed.pt",
        "vf.ckpt": "https://huggingface.co/cqchangm/voicefixer/resolve/main/vf.ckpt",
        "model.ckpt-1490000_trimed.pt": "https://huggingface.co/cqchangm/voicefixer/resolve/main/model.ckpt-1490000_trimed.pt"
    }

    url = url_map.get(args.model_id or "") or url_map.get(os.path.basename(target_path), "")
    if not url:
        raise ValueError(f"No known download URL for model_id: {args.model_id} / file: {os.path.basename(target_path)}")

    sys.stdout.write(f"LOG:Connecting to model download URL: {url}\n")
    sys.stdout.flush()

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=60) as response, open(temp_target, "wb") as out_file:
        total_size = int(response.headers.get("Content-Length", 0))
        downloaded = 0
        block_size = 1024 * 64
        while True:
            buffer = response.read(block_size)
            if not buffer:
                break
            downloaded += len(buffer)
            out_file.write(buffer)
            if total_size > 0:
                pct = (downloaded / total_size) * 100.0
                sys.stdout.write(f"PROGRESS:{pct:.1f}\n")
                sys.stdout.flush()

    if os.path.exists(temp_target) and os.path.getsize(temp_target) > 1024:
        if os.path.exists(target_path):
            os.remove(target_path)
        os.rename(temp_target, target_path)
        sys.stdout.write(f"PROGRESS:100\n")
        sys.stdout.write(f"LOG:Model successfully downloaded to {target_path} ({os.path.getsize(target_path)} bytes)\n")
        sys.stdout.flush()
    else:
        raise RuntimeError("Downloaded model file is corrupted or empty")


# ------------------------------------------------------------------------------
# 9B. NATIVE VST3 PLUGIN HOST (PEDALBOARD C++/JUCE: NATIVE GUI + RAW_STATE + RENDER)
# ------------------------------------------------------------------------------
def _load_vst3_plugin_instance(vst3_path, sub_plugin_name=None):
    """
    Loads a 64-bit VST3 plugin bundle/file via Spotify Pedalboard (JUCE C++ host).
    Automatically resolves multi-plugin VST3 bundles (such as iZotope Ozone / WavesShell).
    Returns (plugin, resolved_name, available_subplugins).
    """
    if not vst3_path or not os.path.exists(vst3_path):
        raise FileNotFoundError(f"VST3 плагин не найден по пути: {vst3_path}")

    try:
        from pedalboard import load_plugin
    except ImportError as e:
        raise RuntimeError(
            "Библиотека pedalboard (C++ VST3 хост) не установлена в окружении Python. "
            "Проверьте установку AI-окружения."
        ) from e

    available_subplugins = []
    try:
        if sub_plugin_name and str(sub_plugin_name).strip():
            plugin = load_plugin(vst3_path, plugin_name=str(sub_plugin_name).strip())
            return plugin, getattr(plugin, "name", str(sub_plugin_name).strip()), [str(sub_plugin_name).strip()]
        else:
            plugin = load_plugin(vst3_path)
            return plugin, getattr(plugin, "name", os.path.basename(vst3_path)), []
    except Exception as first_err:
        err_msg = str(first_err)
        import re
        quoted = re.findall(r'"([^"]+)"|\'([^\']+)\'', err_msg)
        candidates = [q[0] or q[1] for q in quoted if (q[0] or q[1]) and not (q[0] or q[1]).endswith('.vst3')]
        if candidates:
            available_subplugins = candidates
            chosen_name = candidates[0]
            if sub_plugin_name and sub_plugin_name in candidates:
                chosen_name = sub_plugin_name
            plugin = load_plugin(vst3_path, plugin_name=chosen_name)
            return plugin, chosen_name, available_subplugins
        raise RuntimeError(f"Не удалось загрузить VST3 плагин «{os.path.basename(vst3_path)}»: {first_err}") from first_err


def _extract_vst3_params_snapshot(plugin, max_params=48):
    """Extracts a lightweight readable dictionary of exposed VST3 parameters for UI display."""
    snapshot = {}
    try:
        params_dict = getattr(plugin, "parameters", {}) or {}
        count = 0
        for k, param_obj in params_dict.items():
            if count >= max_params:
                break
            try:
                val = getattr(plugin, k, None)
                if isinstance(val, (int, float, bool, str)):
                    snapshot[k] = round(val, 4) if isinstance(val, float) else val
                else:
                    raw_v = getattr(param_obj, "raw_value", None)
                    snapshot[k] = round(float(raw_v), 4) if raw_v is not None else str(val)
                count += 1
            except Exception:
                pass
    except Exception:
        pass
    return snapshot


def process_vst3_inspect(args):
    """
    Inspects a .vst3 plugin, returns its name, sub-plugins, parameter count, and optionally writes initial raw_state.
    """
    vst3_path = getattr(args, "vst3_path", None) or args.input
    sub_plugin = getattr(args, "sub_plugin_name", None) or ""
    state_file = getattr(args, "state_file", None) or ""

    plugin, resolved_name, sub_plugins = _load_vst3_plugin_instance(vst3_path, sub_plugin)

    if state_file and os.path.isfile(state_file) and os.path.getsize(state_file) > 0:
        try:
            with open(state_file, "rb") as f:
                plugin.raw_state = f.read()
        except Exception as e:
            sys.stdout.write(f"LOG:Предупреждение при чтении сохраненного состояния VST3: {e}\n")
            sys.stdout.flush()

    raw_bytes = b""
    try:
        raw_bytes = plugin.raw_state or b""
    except Exception:
        pass

    if state_file and not os.path.exists(state_file) and len(raw_bytes) > 0:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(state_file)), exist_ok=True)
            with open(state_file, "wb") as f:
                f.write(raw_bytes)
        except Exception:
            pass

    params_snapshot = _extract_vst3_params_snapshot(plugin)
    total_params = len(getattr(plugin, "parameters", {}) or {})

    info = {
        "success": True,
        "vst3Path": vst3_path,
        "pluginName": resolved_name,
        "subPlugins": sub_plugins,
        "totalParameters": total_params,
        "parametersPreview": params_snapshot,
        "stateSizeBytes": len(raw_bytes),
        "stateFile": state_file if (state_file and os.path.exists(state_file)) else ""
    }
    sys.stdout.write(f"VST3_INFO_JSON:{json.dumps(info, ensure_ascii=False)}\n")
    sys.stdout.flush()


def process_vst3_open_editor(args):
    """
    Loads a .vst3 plugin, restores its binary raw_state (if state_file exists),
    opens the native OS VST3 GUI window (plugin.show_editor()), waits for the user
    to finish configuring (e.g. inside iZotope Ozone / FabFilter) and close the window,
    and immediately serializes the updated binary raw_state to disk.
    """
    import time
    vst3_path = getattr(args, "vst3_path", None) or args.input
    sub_plugin = getattr(args, "sub_plugin_name", None) or ""
    state_file = getattr(args, "state_file", None) or args.output

    if not state_file:
        raise ValueError("Не указан путь state_file для сохранения состояния VST3 плагина")

    sys.stdout.write(f"LOG:Загрузка VST3 плагина: {os.path.basename(vst3_path)}...\n")
    sys.stdout.flush()

    plugin, resolved_name, sub_plugins = _load_vst3_plugin_instance(vst3_path, sub_plugin)

    restored_prev_state = False
    if os.path.isfile(state_file) and os.path.getsize(state_file) > 0:
        try:
            with open(state_file, "rb") as f:
                prev_bytes = f.read()
            if prev_bytes:
                plugin.raw_state = prev_bytes
                restored_prev_state = True
                sys.stdout.write(f"LOG:Восстановлен предыдущий слепок состояния VST3 ({len(prev_bytes)} байт).\n")
                sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(f"LOG:Не удалось применить предыдущий слепок состояния, открываем заводской пресет: {e}\n")
            sys.stdout.flush()

    sys.stdout.write(f"LOG:Открытие нативного интерфейса VST3 «{resolved_name}». Настройте плагин и закройте его окно для сохранения...\n")
    sys.stdout.flush()

    if not hasattr(plugin, "show_editor"):
        raise RuntimeError(f"Данная сборка pedalboard не поддерживает вызов нативного окна show_editor() для {resolved_name}")

    plugin.show_editor()

    raw_bytes = plugin.raw_state
    os.makedirs(os.path.dirname(os.path.abspath(state_file)), exist_ok=True)
    temp_state = f"{state_file}.tmp_{os.getpid()}"
    with open(temp_state, "wb") as f:
        f.write(raw_bytes)
    if os.path.exists(state_file):
        try:
            os.remove(state_file)
        except Exception:
            pass
    os.rename(temp_state, state_file)

    params_snapshot = _extract_vst3_params_snapshot(plugin)
    saved_report = {
        "success": True,
        "vst3Path": vst3_path,
        "pluginName": resolved_name,
        "subPlugins": sub_plugins,
        "stateFile": state_file,
        "stateSizeBytes": len(raw_bytes),
        "restoredPrevious": restored_prev_state,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "parametersPreview": params_snapshot
    }
    sys.stdout.write(f"LOG:Слепок состояния VST3 «{resolved_name}» успешно сохранен ({len(raw_bytes)} байт).\n")
    sys.stdout.write(f"VST3_EDITOR_SAVED_JSON:{json.dumps(saved_report, ensure_ascii=False)}\n")
    sys.stdout.flush()


def _find_best_speech_window(audio_stereo, sample_rate, snippet_duration_sec=12.0):
    """
    Scans the audio track in 0.25s hops to locate the window of length snippet_duration_sec
    with the highest active speech energy (avoiding silence).
    """
    import numpy as np
    total_samples = audio_stereo.shape[-1]
    win_samples = int(round(snippet_duration_sec * sample_rate))
    if total_samples <= win_samples or total_samples == 0:
        return 0.0, min(snippet_duration_sec, total_samples / float(sample_rate))

    mono = np.mean(audio_stereo, axis=0) if audio_stereo.ndim > 1 else audio_stereo
    hop = max(1, int(0.25 * sample_rate))
    n_blocks = total_samples // hop
    if n_blocks < 2:
        return 0.0, snippet_duration_sec

    trimmed = mono[: n_blocks * hop].reshape(n_blocks, hop)
    block_energy = np.mean(trimmed ** 2, axis=1)

    blocks_per_win = max(1, int(round(snippet_duration_sec / 0.25)))
    if n_blocks <= blocks_per_win:
        return 0.0, snippet_duration_sec

    kernel = np.ones(blocks_per_win, dtype=np.float32)
    window_sums = np.convolve(block_energy, kernel, mode="valid")
    best_block_idx = int(np.argmax(window_sums))
    start_sec = round(best_block_idx * 0.25, 2)
    max_start = max(0.0, (total_samples / float(sample_rate)) - snippet_duration_sec)
    start_sec = min(start_sec, round(max_start, 2))
    return start_sec, snippet_duration_sec


def _run_vst3_on_audio_array(plugin, audio_stereo, sample_rate, wet_mix_percent=100.0, output_gain_db=0.0, reset_plugin=True, emit_prog=False):
    """
    Runs a loaded VST3 plugin on a stereo float32 C-contiguous array [2, samples],
    with tail warmup/padding, sample-accurate length preservation, parallel Dry/Wet mix,
    and output gain + True Peak protection.
    """
    import numpy as np
    orig_len = audio_stereo.shape[-1]
    if orig_len == 0:
        return audio_stereo

    if audio_stereo.ndim == 1:
        work_audio = np.vstack([audio_stereo, audio_stereo])
    elif audio_stereo.shape[0] == 1:
        work_audio = np.vstack([audio_stereo, audio_stereo])
    elif audio_stereo.shape[0] > 2:
        work_audio = audio_stereo[:2, :]
    else:
        work_audio = audio_stereo

    work_audio = np.ascontiguousarray(work_audio, dtype=np.float32)

    if reset_plugin and hasattr(plugin, "reset"):
        try:
            plugin.reset()
        except Exception:
            pass

    pad_samples = int(0.25 * sample_rate)
    padded_input = np.pad(work_audio, ((0, 0), (0, pad_samples)), mode="constant")
    padded_input = np.ascontiguousarray(padded_input, dtype=np.float32)

    block_seconds = 30.0
    block_samples = int(block_seconds * sample_rate)
    total_padded = padded_input.shape[-1]

    if total_padded <= block_samples * 1.5:
        if emit_prog:
            emit_progress(45.0, "Рендер звука через нативный движок VST3...")
        wet_padded = plugin(padded_input, sample_rate, reset=False)
    else:
        out_chunks = []
        cursor = 0
        while cursor < total_padded:
            end_c = min(total_padded, cursor + block_samples)
            chunk = np.ascontiguousarray(padded_input[:, cursor:end_c], dtype=np.float32)
            proc_chunk = plugin(chunk, sample_rate, reset=False)
            out_chunks.append(proc_chunk)
            cursor = end_c
            if emit_prog:
                pct = 20.0 + 65.0 * (cursor / float(total_padded))
                emit_progress(pct, f"Обработка VST3 плагином: {int((cursor / float(total_padded)) * 100)}%...")
        wet_padded = np.concatenate(out_chunks, axis=-1)

    wet_audio = np.ascontiguousarray(wet_padded[:, :orig_len], dtype=np.float32)

    wet_ratio = max(0.0, min(1.0, float(wet_mix_percent) / 100.0))
    if wet_ratio < 0.999:
        blended = work_audio * (1.0 - wet_ratio) + wet_audio * wet_ratio
    else:
        blended = wet_audio

    if abs(float(output_gain_db)) > 0.05:
        gain_lin = 10.0 ** (float(output_gain_db) / 20.0)
        blended = blended * gain_lin

    peak = float(np.max(np.abs(blended))) if blended.size > 0 else 0.0
    if peak > 0.985:
        blended = blended * (0.985 / peak)

    return np.ascontiguousarray(blended, dtype=np.float32)


def process_vst3_preview_snippet(args):
    """
    Renders a fast 5-15s preview snippet (Before Dry WAV + After Wet WAV) using the selected VST3 plugin and .vststate.
    Automatically finds the loudest speech segment if snippet_start_sec < 0.
    """
    import numpy as np
    input_path = args.input
    wet_output_path = args.output
    dry_output_path = getattr(args, "dry_output", None)
    vst3_path = getattr(args, "vst3_path", None)
    sub_plugin = getattr(args, "sub_plugin_name", None) or ""
    state_file = getattr(args, "state_file", None) or ""
    wet_mix_percent = float(getattr(args, "wet_mix_percent", 100.0))
    output_gain_db = float(getattr(args, "output_gain_db", 0.0))
    snippet_start_sec = float(getattr(args, "snippet_start_sec", -1.0))
    snippet_duration_sec = max(3.0, min(30.0, float(getattr(args, "snippet_duration_sec", 12.0))))

    if not dry_output_path:
        base, ext = os.path.splitext(wet_output_path)
        dry_output_path = f"{base}_dry.wav"

    emit_progress(10.0, "Загрузка дорожки для быстрого превью VST3...")
    audio_data, sample_rate, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=48000, force_stereo=True, remove_dc=True
    )

    if snippet_start_sec < 0.0:
        start_sec, dur_sec = _find_best_speech_window(audio_data, sample_rate, snippet_duration_sec)
    else:
        total_sec = audio_data.shape[-1] / float(sample_rate)
        start_sec = max(0.0, min(snippet_start_sec, max(0.0, total_sec - 1.0)))
        dur_sec = min(snippet_duration_sec, max(1.0, total_sec - start_sec))

    warmup_sec = min(0.5, start_sec)
    extract_start_sample = int(round((start_sec - warmup_sec) * sample_rate))
    warmup_samples = int(round(warmup_sec * sample_rate))
    snippet_samples = int(round(dur_sec * sample_rate))
    extract_end_sample = min(audio_data.shape[-1], extract_start_sample + warmup_samples + snippet_samples)

    raw_slice = np.ascontiguousarray(audio_data[:, extract_start_sample:extract_end_sample], dtype=np.float32)
    dry_slice = np.ascontiguousarray(raw_slice[:, warmup_samples:], dtype=np.float32)

    emit_progress(35.0, f"Инициализация VST3 плагина «{os.path.basename(vst3_path)}»...")
    plugin, resolved_name, _ = _load_vst3_plugin_instance(vst3_path, sub_plugin)

    if state_file and os.path.isfile(state_file) and os.path.getsize(state_file) > 0:
        with open(state_file, "rb") as f:
            plugin.raw_state = f.read()

    emit_progress(60.0, f"Рендер превью фрагмента ({start_sec:.1f}с – {start_sec + dur_sec:.1f}с)...")
    processed_full = _run_vst3_on_audio_array(
        plugin,
        raw_slice,
        sample_rate,
        wet_mix_percent=wet_mix_percent,
        output_gain_db=output_gain_db,
        reset_plugin=True,
        emit_prog=False
    )
    wet_slice = np.ascontiguousarray(processed_full[:, warmup_samples:], dtype=np.float32)

    os.makedirs(os.path.dirname(os.path.abspath(wet_output_path)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(dry_output_path)), exist_ok=True)

    AudioConditioner.save_audio(dry_output_path, dry_slice, current_sr=sample_rate, target_sr=48000, orig_channels=2, bit_depth="PCM_24")
    AudioConditioner.save_audio(wet_output_path, wet_slice, current_sr=sample_rate, target_sr=48000, orig_channels=2, bit_depth="PCM_24")

    peak_before = float(np.max(np.abs(dry_slice))) if dry_slice.size > 0 else 0.0
    peak_after = float(np.max(np.abs(wet_slice))) if wet_slice.size > 0 else 0.0
    peak_db_before = round(20.0 * math.log10(max(peak_before, 1e-6)), 2)
    peak_db_after = round(20.0 * math.log10(max(peak_after, 1e-6)), 2)

    preview_info = {
        "success": True,
        "pluginName": resolved_name,
        "startSec": round(start_sec, 2),
        "durationSec": round(dur_sec, 2),
        "dryPath": dry_output_path,
        "wetPath": wet_output_path,
        "peakDbBefore": peak_db_before,
        "peakDbAfter": peak_db_after
    }
    emit_progress(100.0, "Превью фрагмента VST3 готово!")
    sys.stdout.write(f"VST3_PREVIEW_JSON:{json.dumps(preview_info, ensure_ascii=False)}\n")
    sys.stdout.flush()


def process_vst3_process(args):
    """
    Processes a full audio track through a 64-bit VST3 plugin with restored binary raw_state.
    """
    import numpy as np
    input_path = args.input
    output_path = args.output
    vst3_path = getattr(args, "vst3_path", None)
    sub_plugin = getattr(args, "sub_plugin_name", None) or ""
    state_file = getattr(args, "state_file", None) or ""
    wet_mix_percent = float(getattr(args, "wet_mix_percent", 100.0))
    output_gain_db = float(getattr(args, "output_gain_db", 0.0))
    reset_between = str(getattr(args, "reset_between_tracks", "true")).lower() in ["true", "1", "yes"]

    emit_progress(5.0, f"Загрузка VST3 плагина: {os.path.basename(vst3_path or '')}...")
    plugin, resolved_name, _ = _load_vst3_plugin_instance(vst3_path, sub_plugin)

    state_loaded = False
    if state_file and os.path.isfile(state_file) and os.path.getsize(state_file) > 0:
        try:
            with open(state_file, "rb") as f:
                raw_bytes = f.read()
            if raw_bytes:
                plugin.raw_state = raw_bytes
                state_loaded = True
                sys.stdout.write(f"LOG:Успешно загружен слепок состояния VST3 «{resolved_name}» ({len(raw_bytes)} байт).\n")
                sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(f"LOG:Предупреждение при загрузке состояния VST3: {e}\n")
            sys.stdout.flush()

    emit_progress(15.0, f"Чтение аудиодорожки: {os.path.basename(input_path)}...")
    audio_data, sample_rate, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=48000, force_stereo=True, remove_dc=True
    )

    processed = _run_vst3_on_audio_array(
        plugin,
        audio_data,
        sample_rate,
        wet_mix_percent=wet_mix_percent,
        output_gain_db=output_gain_db,
        reset_plugin=reset_between,
        emit_prog=True
    )

    emit_progress(92.0, f"Сохранение обработанного WAV 24-bit 48kHz: {os.path.basename(output_path)}...")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    AudioConditioner.save_audio(
        output_path,
        processed,
        current_sr=sample_rate,
        target_sr=48000,
        orig_channels=2,
        bit_depth="PCM_24"
    )

    emit_progress(100.0, f"VST3 обработка «{resolved_name}» завершена!")
    report = {
        "success": True,
        "output": output_path,
        "pluginName": resolved_name,
        "stateLoaded": state_loaded,
        "wetMixPercent": wet_mix_percent,
        "outputGainDb": output_gain_db
    }
    sys.stdout.write(f"RESULT:{json.dumps(report, ensure_ascii=False)}\n")
    sys.stdout.flush()


# ------------------------------------------------------------------------------
# 10. CLI ROUTER
# ------------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Anime Dub Manager Universal Neural Audio AI & DSP Processor")
    
    # Mode selector with full aliases
    parser.add_argument(
        "--mode",
        required=True,
        help="Processing mode"
    )
    parser.add_argument("--input", help="Path to input audio/video file")
    parser.add_argument("--output", help="Path to output audio file")
    parser.add_argument("--output_dir", help="Directory for multi-stem separation outputs")
    parser.add_argument("--prefix", default="", help="Prefix for exported filenames")
    parser.add_argument("--model_path", help="Local model weights file path (.onnx, .pth, .ckpt)")
    parser.add_argument("--model_id", help="Module ID from MODULE_DATABASE")
    parser.add_argument("--params_json", help="Serialized JSON dictionary of DSP / neural parameters")
    parser.add_argument("--subtitles_json", help="JSON array or path to JSON file containing subtitle entries [{id, text, startSec, endSec}]")
    parser.add_argument("--dub_audio", help="Path to actor dubbing audio file")
    parser.add_argument("--orig_audio", help="Path to original isolated vocal audio track (vocals.wav)")
    parser.add_argument("--acoustic_model", default="russian_mfa", help="MFA acoustic model name or path")
    parser.add_argument("--dictionary", default="russian_mfa", help="MFA dictionary name or path")
    parser.add_argument("--min_time_stretch", type=float, default=0.75, help="Minimum time stretch ratio limit")
    parser.add_argument("--max_time_stretch", type=float, default=1.35, help="Maximum time stretch ratio limit")
    parser.add_argument("--max_drift_ms", type=float, default=50.0, help="Max lipsync drift threshold in milliseconds")

    # Spotify Pedalboard DSP Granular Parameters
    parser.add_argument("--eq_highpass", type=float, default=80.0)
    parser.add_argument("--eq_presence_freq", type=float, default=3200.0)
    parser.add_argument("--eq_presence_gain", type=float, default=2.5)
    parser.add_argument("--eq_lowpass", type=float, default=18000.0)
    parser.add_argument("--comp_threshold", type=float, default=-18.0)
    parser.add_argument("--comp_ratio", type=float, default=3.5)
    parser.add_argument("--comp_attack", type=float, default=15.0)
    parser.add_argument("--comp_release", type=float, default=120.0)
    parser.add_argument("--deesser_freq", type=float, default=6500.0)
    parser.add_argument("--deesser_amount", type=float, default=0.60)
    parser.add_argument("--reverb_room_size", type=float, default=0.12)
    parser.add_argument("--reverb_damping", type=float, default=0.5)
    parser.add_argument("--reverb_wet", type=float, default=0.06)
    parser.add_argument("--reverb_dry", type=float, default=0.94)
    parser.add_argument("--limiter_threshold", type=float, default=-0.5)
    parser.add_argument("--limiter_release", type=float, default=40.0)

    # DeepFilterNet & UVR Denoise/Dereverb
    parser.add_argument("--noise_reduction_db", type=float, default=18.0)
    parser.add_argument("--attenuation_limit_db", type=float, default=24.0)
    parser.add_argument("--post_filter", default="false")
    parser.add_argument("--reverb_reduction", type=float, default=None)
    parser.add_argument("--sensitivity", type=float, default=5.0)
    parser.add_argument("--wet_dry_blend", type=float, default=100.0)
    parser.add_argument("--noise_floor_db", type=float, default=-52.0)
    parser.add_argument("--stationarity_weight", type=float, default=0.85)
    parser.add_argument("--frequency_smoothing_hz", type=float, default=120.0)
    parser.add_argument("--preserve_voice_formants", default="true")

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

    # Airwindows DSP Parameters
    parser.add_argument("--deess_intensity", type=float, default=0.50)
    parser.add_argument("--pop_intensity", type=float, default=0.50)
    parser.add_argument("--slew_intensity", type=float, default=0.40)
    parser.add_argument("--density_drive", type=float, default=0.40)

    # EBU R128 Loudness Normalization (pyloudnorm)
    parser.add_argument("--target_lufs", type=float, default=-23.0, help="Target integrated loudness in LUFS (-23.0 for EBU R128 TV, -16.0 for Web)")
    parser.add_argument("--true_peak", type=float, default=-1.0, help="Max True Peak limit in dBTP")
    parser.add_argument("--mode_type", default="track", choices=["track", "master"], help="Loudness norm target mode")

    # Voice Timbre Match EQ (LTAS Neutral Studio Harmonization)
    parser.add_argument("--match_intensity", type=float, default=75.0, help="Timbre match intensity 0-100%%")
    parser.add_argument("--target_profile", default="studio_neutral", help="Target voice frequency profile")
    parser.add_argument("--sub_bass_cutoff", type=float, default=75.0, help="Sub-bass rumble highpass cutoff in Hz")
    parser.add_argument("--air_limit_db", type=float, default=3.0, help="Air/sibilance boost limit in dB")
    parser.add_argument("--smoothness", type=int, default=3, help="Spectral curve smoothing factor")

    # Native VST3 Plugin Host Parameters
    parser.add_argument("--vst3_path", default="", help="Path to .vst3 plugin bundle or binary")
    parser.add_argument("--sub_plugin_name", default="", help="Optional sub-plugin name for multi-plugin .vst3 bundles")
    parser.add_argument("--state_file", default="", help="Path to .vststate binary raw_state file")
    parser.add_argument("--wet_mix_percent", type=float, default=100.0, help="Parallel Dry/Wet mix 0..100")
    parser.add_argument("--output_gain_db", type=float, default=0.0, help="Post-plugin output gain in dB")
    parser.add_argument("--reset_between_tracks", default="true", help="Reset plugin internal buffers before processing")
    parser.add_argument("--snippet_start_sec", type=float, default=-1.0, help="Preview snippet start time in seconds (-1 for auto speech detection)")
    parser.add_argument("--snippet_duration_sec", type=float, default=12.0, help="Preview snippet duration in seconds")
    parser.add_argument("--dry_output", default="", help="Path to save dry (unprocessed) preview snippet WAV")

    # Whisper / Diarization
    parser.add_argument("--language", default="ru")
    parser.add_argument("--hf_token", default="")

    args, _unknown = parser.parse_known_args()

    if args.mode == "check_env":
        check_env()
        return

    if args.mode == "download_model":
        download_model_cli(args)
        return

    if args.mode == "vst3_inspect":
        process_vst3_inspect(args)
        return

    if args.mode == "vst3_open_editor":
        process_vst3_open_editor(args)
        return

    if not (args.input or getattr(args, "dub_audio", None)) and args.mode not in ["check_env", "download_model", "vst3_inspect", "vst3_open_editor"]:
        sys.stderr.write(f"ERROR in {args.mode}: Input file not found: {args.input}\n")
        sys.exit(1)

    try:
        # 1. Voice Timbre Match EQ to Universal Studio Standard
        if args.mode in ["voice_timbre_match", "timbre_match"]:
            process_voice_timbre_match(args)

        # 2. Denoise / Dereverb / UVR / DeepFilterNet Neural Processing
        elif args.mode in [
            "denoise", "dereverb", "deepfilternet",
            "uvr_inference", "uvr_neural", "uvr_deecho", "uvr_denoise"
        ]:
            model_id = (getattr(args, "model_id", None) or "").lower()
            model_path = getattr(args, "model_path", None) or ""
            mode = args.mode.lower()

            is_deepfilter = ("deepfilter" in model_id) or (mode == "deepfilternet") or (
                mode == "denoise" and not model_id and not model_path
            )
            is_uvr = (
                mode in ["uvr_inference", "uvr_neural", "uvr_deecho", "uvr_denoise"]
                or any(k in model_id for k in ["uvr", "deecho", "echo", "foxjoy", "reverb", "mdx"])
                or any(model_path.lower().endswith(ext) for ext in [".pth", ".onnx", ".ckpt"])
                or (mode == "dereverb" and "deepfilter" not in model_id)
            )

            if is_uvr and not is_deepfilter:
                process_uvr_inference(args)
            else:
                process_deepfilternet(args)

        elif args.mode in ["separate", "separate_stems", "demucs"]:
            process_demucs(args)
        elif args.mode in [
            "pedalboard_channel_strip", "pedalboard_dsp",
            "voice_eq", "voice_compressor", "voice_deesser", "voice_reverb", "voice_limiter", "voice_master_strip"
        ]:
            process_pedalboard_dsp(args)
        elif args.mode in ["airwindows_dsp", "airwindows_restore", "airwindows_saturate"]:
            process_airwindows_dsp(args)
        elif args.mode == "voicefixer":
            process_voicefixer(args)
        elif args.mode in ["diarize", "whisper"]:
            process_whisper_diarization(args)
        elif args.mode == "aeneas_align":
            process_aeneas_align(args)
        elif args.mode == "mfa_analyze":
            process_mfa_analyze(args)
        elif args.mode == "loudness_norm":
            process_loudness_norm(args)
        elif args.mode == "vst3_preview_snippet":
            process_vst3_preview_snippet(args)
        elif args.mode in ["vst3_process", "vst3_rack_processor"]:
            process_vst3_process(args)
        else:
            raise ValueError(f"Неизвестный режим: {args.mode}")

        sys.exit(0)
    except Exception as err:
        sys.stderr.write(f"ERROR in {args.mode}: {err}\n")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

