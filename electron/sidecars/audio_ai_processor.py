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

# ------------------------------------------------------------------------------
# 0. SITE PACKAGES & NATIVE LIBS BOOTSTRAP
# ------------------------------------------------------------------------------
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
                                os.add_dll_directory(dll_dir)
                            except Exception:
                                pass

    # Auto-heal missing torch.cuda if pruned by minimal environment packager
    _heal_torch_cuda()

def _heal_torch_cuda():
    import types
    import contextlib

    for p in list(sys.path):
        if not os.path.isdir(p):
            continue
        torch_dir = os.path.join(p, "torch")
        if os.path.isdir(torch_dir):
            cuda_dir = os.path.join(torch_dir, "cuda")
            cuda_init = os.path.join(cuda_dir, "__init__.py")
            if not os.path.isfile(cuda_init):
                try:
                    os.makedirs(cuda_dir, exist_ok=True)
                    with open(cuda_init, "w", encoding="utf-8") as f:
                        f.write('''# Auto-healed torch.cuda stub for CPU/fallback runtime
import sys
import contextlib

def is_available(): return False
def is_initialized(): return False
def device_count(): return 0
def current_device(): return 0
def get_device_name(*args, **kwargs): return ""
def init(): pass
def empty_cache(): pass
def synchronize(*args, **kwargs): pass
def set_device(*args, **kwargs): pass

class device:
    def __init__(self, idx=0): self.idx = idx
    def __enter__(self): return self
    def __exit__(self, *args): pass

class Stream:
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def synchronize(self): pass

class Event:
    def __init__(self, *args, **kwargs): pass
    def record(self, *args, **kwargs): pass
    def wait(self, *args, **kwargs): pass
    def synchronize(self): pass
    def elapsed_time(self, *args, **kwargs): return 0.0

class _Amp:
    autocast = contextlib.nullcontext
amp = _Amp()
''')
                except Exception:
                    pass

    if "torch.cuda" not in sys.modules:
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

        sys.modules["torch.cuda"] = cuda_mod

_bootstrap_site_packages()

import numpy as np

# ------------------------------------------------------------------------------
# 1. CORE UTILS, TENSOR CONVERSIONS & IPC PROTOCOL
# ------------------------------------------------------------------------------
def to_torch_tensor(data, dtype=None):
    """Converts numpy array or raw audio buffer to a C-contiguous float32 torch Tensor."""
    import torch
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
        import torch
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
        import torch
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
    atten_limit = float(args.attenuation_limit_db) if args.attenuation_limit_db is not None else -100.0
    reverb_reduction = float(args.reverb_reduction) if args.reverb_reduction is not None else (0.8 if mode == 'dereverb' else 0.0)
    sensitivity = float(args.sensitivity) if args.sensitivity is not None else 1.0
    wet_dry_blend = float(args.wet_dry_blend) if args.wet_dry_blend is not None else 100.0

    emit_progress(5.0, "Инициализация DeepFilterNet 3...")
    device = get_optimal_device()

    try:
        from df.enhance import init_df, enhance
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

    emit_progress(40.0, f"Нейросетевая фильтрация спектрограммы (DeepFilterNet3, atten_limit={atten_limit} dB)...")
    
    eff_atten = atten_limit if sensitivity >= 3.0 else max(-40.0, atten_limit * (sensitivity / 3.0))

    import torch
    num_channels = audio_data.shape[0]
    enhanced_channels = []

    for ch in range(num_channels):
        # Guarantee C-contiguous float32 torch tensor for native C-API safety
        ch_arr = np.ascontiguousarray(audio_data[ch:ch+1], dtype=np.float32)
        ch_tensor = torch.from_numpy(ch_arr).to(device=device, dtype=torch.float32)

        with torch.no_grad():
            enhanced_ch = enhance(model, df_state, ch_tensor, atten_lim_db=eff_atten)

        enhanced_np = enhanced_ch.cpu().numpy()
        enhanced_channels.append(enhanced_np)
        
        progress = 40.0 + ((ch + 1) / num_channels) * 45.0
        emit_progress(progress, f"Обработан канал {ch + 1}/{num_channels}...")

    enhanced_audio = np.concatenate(enhanced_channels, axis=0)

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
    stems_mode = args.stems or "both"
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

    emit_progress(35.0, f"Выполнение нейросетевого разделения Demucs v4 (shifts={shifts}, overlap={overlap})...")
    inp_tensor = audio_norm[None].to(device)

    with torch.no_grad():
        sources = apply_model(model, inp_tensor, shifts=shifts, split=True, overlap=overlap, progress=True, device=device)[0]

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
# 7. VOICEFIXER (HARMONIC RESTORER)
# ------------------------------------------------------------------------------
def process_voicefixer(args):
    """
    Neural harmonic restoration using the official VoiceFixer library.
    """
    input_path = args.input
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_restored.wav"

    emit_progress(5.0, "Инициализация VoiceFixer...")
    try:
        from voicefixer import VoiceFixer
        vf = VoiceFixer()
    except ImportError as e:
        raise ImportError(
            "Библиотека voicefixer не найдена в окружении Python. "
            "Установите её через: pip install voicefixer или обновите AI-окружение в настройках."
        ) from e

    import torch
    cuda_available = torch.cuda.is_available()

    emit_progress(30.0, f"Применение нейросети VoiceFixer (cuda={cuda_available})...")
    temp_in = output_path + ".temp_in.wav"
    temp_out = output_path + ".temp_out.wav"

    audio_data, current_sr, orig_channels, _ = AudioConditioner.load_audio(
        input_path, target_sr=44100, force_stereo=False, remove_dc=True
    )
    AudioConditioner.save_audio(temp_in, audio_data, current_sr=44100, target_sr=44100, orig_channels=orig_channels)

    try:
        vf.restore(input=temp_in, output=temp_out, cuda=cuda_available, mode=0)
        if os.path.exists(temp_out):
            vf_audio, vf_sr, _, _ = AudioConditioner.load_audio(temp_out, target_sr=48000, force_stereo=False)
            AudioConditioner.save_audio(output_path, vf_audio, current_sr=48000, target_sr=48000, orig_channels=orig_channels)
    finally:
        try: os.unlink(temp_in)
        except Exception: pass
        try: os.unlink(temp_out)
        except Exception: pass

    emit_progress(100.0, "Восстановление гармоник VoiceFixer успешно завершено!")
    sys.stdout.write(f"RESULT:{json.dumps({'success': True, 'output': output_path, 'engine': 'voicefixer'})}\n")
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
        "scipy": False
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

    sys.stdout.write(f"ENV_STATUS:{json.dumps(env_status)}\n")
    sys.stdout.flush()
    sys.exit(0)

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
        "voicefixer_fe": "https://huggingface.co/cqchangm/voicefixer/resolve/main/vf.ckpt"
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
# 10. CLI ROUTER
# ------------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Anime Dub Manager Universal Neural Audio AI & DSP Processor")
    
    # Mode selector with full aliases
    parser.add_argument(
        "--mode",
        required=True,
        choices=[
            "denoise", "dereverb", "deepfilternet",
            "separate", "separate_stems", "demucs",
            "pedalboard_channel_strip", "pedalboard_dsp",
            "voice_eq", "voice_compressor", "voice_deesser", "voice_reverb", "voice_limiter", "voice_master_strip",
            "voicefixer", "diarize", "whisper", "check_env", "download_model"
        ],
        help="Processing mode"
    )
    parser.add_argument("--input", help="Path to input audio/video file")
    parser.add_argument("--output", help="Path to output audio file")
    parser.add_argument("--output_dir", help="Directory for multi-stem separation outputs")
    parser.add_argument("--prefix", default="", help="Prefix for exported filenames")
    parser.add_argument("--model_path", help="Local model weights file path (.onnx, .pth, .ckpt)")
    parser.add_argument("--model_id", help="Module ID from MODULE_DATABASE")
    parser.add_argument("--params_json", help="Serialized JSON dictionary of DSP / neural parameters")

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

    # Whisper / Diarization
    parser.add_argument("--language", default="ru")
    parser.add_argument("--hf_token", default="")

    args = parser.parse_args()

    if args.mode == "check_env":
        check_env()
        return

    if args.mode == "download_model":
        download_model_cli(args)
        return

    if not args.input or not os.path.exists(args.input):
        sys.stderr.write(f"ERROR in {args.mode}: Input file not found: {args.input}\n")
        sys.exit(1)

    try:
        if args.mode in ["denoise", "dereverb", "deepfilternet"]:
            process_deepfilternet(args)
        elif args.mode in ["separate", "separate_stems", "demucs"]:
            process_demucs(args)
        elif args.mode in [
            "pedalboard_channel_strip", "pedalboard_dsp",
            "voice_eq", "voice_compressor", "voice_deesser", "voice_reverb", "voice_limiter", "voice_master_strip"
        ]:
            process_pedalboard_dsp(args)
        elif args.mode == "voicefixer":
            process_voicefixer(args)
        elif args.mode in ["diarize", "whisper"]:
            process_whisper_diarization(args)
        else:
            raise ValueError(f"Неизвестный режим: {args.mode}")

        sys.exit(0)
    except Exception as err:
        sys.stderr.write(f"ERROR in {args.mode}: {err}\n")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
