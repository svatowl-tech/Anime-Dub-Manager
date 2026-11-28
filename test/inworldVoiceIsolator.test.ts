import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('Inworld Voice Isolator v1 Integration & Safe Python AI Environment', () => {
  it('registers inworld_voice_isolator in both MixingPipelineService and modular MixingModuleDatabaseVoice', () => {
    const MixingPipelineService = require('../electron/services/MixingPipelineService.cjs');
    const { MODULE_DATABASE_VOICE } = require('../electron/services/mixing/MixingModuleDatabaseVoice.cjs');

    const mainDb = MixingPipelineService.getModuleDatabase();
    const mainMod = mainDb.find((m: any) => m.id === 'inworld_voice_isolator');
    const mirrorMod = MODULE_DATABASE_VOICE.find((m: any) => m.id === 'inworld_voice_isolator');

    expect(mainMod).toBeDefined();
    expect(mirrorMod).toBeDefined();

    for (const mod of [mainMod, mirrorMod]) {
      expect(mod.category).toBe('denoise');
      expect(mod.filename).toBe('denoiser.safetensors');
      expect(mod.format).toBe('safetensors');
      expect(mod.urls).toContain('https://huggingface.co/inworld/voice-isolator/resolve/main/denoiser.safetensors');
      expect(mod.defaultParams.isolatorMode).toBe('offline');
      expect(mod.defaultParams.wetDryBlend).toBe(100);
      expect(Array.isArray(mod.presets)).toBe(true);
      expect(mod.presets.length).toBeGreaterThanOrEqual(3);
      expect(mod.presets.some((p: any) => p.params.isolatorMode === 'streaming')).toBe(true);
    }

    // Ensure existing neural denoise/separation modules remain completely intact
    expect(mainDb.some((m: any) => m.id === 'deepfilternet3')).toBe(true);
    expect(mainDb.some((m: any) => m.id === 'uvr_denoise_foxjoy')).toBe(true);
    expect(mainDb.some((m: any) => m.id === 'htdemucs')).toBe(true);
    expect(mainDb.some((m: any) => m.id === 'voicefixer_fe')).toBe(true);
  });

  it('keeps electron/services/audio_ai_processor.py and electron/sidecars/audio_ai_processor.py identical with INWORLD_VOICE_ISOLATOR_V9', () => {
    const masterPath = path.join(process.cwd(), 'electron', 'services', 'audio_ai_processor.py');
    const sidecarPath = path.join(process.cwd(), 'electron', 'sidecars', 'audio_ai_processor.py');

    const masterContent = fs.readFileSync(masterPath, 'utf8');
    const sidecarContent = fs.readFileSync(sidecarPath, 'utf8');

    expect(masterContent).toBe(sidecarContent);
    expect(masterContent).toContain('INWORLD_VOICE_ISOLATOR_V9');
    expect(masterContent).toContain('INWORLD_NATIVE_CHUNK_V10');
    expect(masterContent).toContain('def process_inworld_voice_isolator(args):');
    expect(masterContent).toContain('def _isolate_inworld_offline_channel(');
    expect(masterContent).toContain('def _isolate_inworld_streaming_channel(');
    expect(masterContent).toContain('denoiser.safetensors');
    expect(masterContent).toContain('denoiser_realtime.safetensors');
    expect(masterContent).toContain('--isolator_mode');
    expect(masterContent).toContain('--lookahead_frames');
    expect(masterContent).toContain('HTDEMUCS_SAFE_SEGMENT_V8');
    expect(masterContent).toContain('VST3_WAVESHELL_V7');
  });

  it('upgrades stale sidecar scripts missing INWORLD_NATIVE_CHUNK_V10 via AudioNeuralService._sanitizeSidecarScript', () => {
    const AudioNeuralService = require('../electron/services/AudioNeuralService.cjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-inworld-test-'));
    const staleScript = path.join(tmpDir, 'audio_ai_processor.py');

    try {
      fs.writeFileSync(
        staleScript,
        '# stale v9 sidecar\nVST3_WAVESHELL_V7\nHTDEMUCS_SAFE_SEGMENT_V8\nINWORLD_VOICE_ISOLATOR_V9\n',
        'utf8'
      );

      AudioNeuralService._sanitizeSidecarScript(staleScript);
      const updated = fs.readFileSync(staleScript, 'utf8');
      expect(updated).toContain('INWORLD_NATIVE_CHUNK_V10');
      expect(updated).toContain('def _isolate_inworld_offline_channel(');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updates scripts/build-ai-env.py safely without breaking pinned PyTorch 2.2.2, NumPy 1.26.4, or existing neural nets', () => {
    const builderPath = path.join(process.cwd(), 'scripts', 'build-ai-env.py');
    const content = fs.readFileSync(builderPath, 'utf8');

    // Inworld & safetensors safely added with --no-deps and prune protection
    expect(content).toContain('"safetensors==0.4.3"');
    expect(content).toContain('"--no-deps", "inworld-voice-isolation"');
    expect(content).toContain("'inworld', 'safetensors'");
    expect(content).toMatch(/"inworld_voice_isolator":\s*(?:true|True)/);

    // Strictly preserved core pins so existing neural models never break
    expect(content).toContain('torch==2.2.2');
    expect(content).toContain('torchaudio==2.2.2');
    expect(content).toContain('numpy==1.26.4');
    expect(content).toContain('packaging>=23.0,<24.0');
    expect(content).toContain('onnxruntime==1.16.3');
    expect(content).toContain('deepfilternet>=0.5.6,<0.6.0');
    expect(content).toContain('demucs>=4.0.0,<4.1.0');
    expect(content).toContain('voicefixer>=0.1.3');
    // Must never install CUDA-only compilation extras in portable builds
    expect(content).not.toContain('inworld-voice-isolation[fast]');
  });

  it('detects .safetensors weight status for offline & realtime Inworld models and routes step in voice chain', async () => {
    const MixingPipelineService = require('../electron/services/MixingPipelineService.cjs');

    const dbEntry = MixingPipelineService.getModuleDatabase().find((m: any) => m.id === 'inworld_voice_isolator');
    expect(dbEntry).toBeDefined();
    expect(dbEntry).toHaveProperty('installed_bytes');
    expect(dbEntry).toHaveProperty('local_path');

    const offlineStatus = await MixingPipelineService.checkUvrModelStatus({ modelId: 'inworld_voice_isolator' });
    expect(offlineStatus.success).toBe(true);
    expect(offlineStatus.modelInfo.id).toBe('inworld_voice_isolator');
    expect(offlineStatus.modelInfo.filename).toBe('denoiser.safetensors');
    expect(offlineStatus.modelInfo.format).toBe('safetensors');

    const realtimeStatus = await MixingPipelineService.checkUvrModelStatus({ modelId: 'inworld_voice_isolator_realtime' });
    expect(realtimeStatus.success).toBe(true);
    expect(realtimeStatus.modelInfo.id).toBe('inworld_voice_isolator_realtime');
    expect(realtimeStatus.modelInfo.filename).toBe('denoiser_realtime.safetensors');
    expect(realtimeStatus.modelInfo.format).toBe('safetensors');

    expect(MixingPipelineService._isVoiceChainStep('inworld_voice_isolator')).toBe(true);
    expect(MixingPipelineService._isOriginalSeparationStep('inworld_voice_isolator')).toBe(false);
  });

  it('enforces exact 1D float32 NaN-safe tensors, trained lookahead (0/2/4), native 8s/2s offline windows, and 0.5s streaming sessions', () => {
    const { spawnSync } = require('child_process');
    const pyCode = `
import importlib.util, math, sys, types

# Minimal pure-Python array shim if system python3 in CI has no numpy installed
try:
    import numpy as np
except ImportError:
    class _Arr:
        def __init__(self, data, shape=None, dtype="float32"):
            if isinstance(data, _Arr):
                self._flat = list(data._flat)
                self.shape = shape if shape is not None else data.shape
            elif isinstance(data, list) and data and isinstance(data[0], list):
                self.shape = (len(data), len(data[0]))
                self._flat = [float(v) for row in data for v in row]
            else:
                self._flat = [float(v) for v in data]
                self.shape = shape if shape is not None else (len(self._flat),)
            self.dtype = dtype
            self.ndim = len(self.shape)
            self.size = len(self._flat)
        def reshape(self, *s):
            if len(s) == 1 and isinstance(s[0], tuple): s = s[0]
            if s == (-1,): return _Arr(self._flat, (len(self._flat),), self.dtype)
            return _Arr(self._flat, s, self.dtype)
        def all(self): return all(bool(x) for x in self._flat)
        def __len__(self): return self.shape[0]
        def __getitem__(self, idx):
            if isinstance(idx, tuple):
                if idx[0] is None:
                    return _Arr(self._flat, (1, len(self._flat)), self.dtype)
                if idx[0] is Ellipsis:
                    return self[idx[1]]
                if self.ndim == 2:
                    r, c = idx
                    cols = self.shape[1]
                    if isinstance(r, int) and isinstance(c, slice):
                        return _Arr(self._flat[r*cols:(r+1)*cols][c], dtype=self.dtype)
                    if isinstance(r, int) and isinstance(c, int):
                        return self._flat[r*cols + c]
            if isinstance(idx, slice):
                return _Arr(self._flat[idx], dtype=self.dtype)
            if isinstance(idx, int):
                if self.ndim == 2:
                    cols = self.shape[1]
                    return _Arr(self._flat[idx*cols:(idx+1)*cols], (cols,), self.dtype)
                return self._flat[idx]
            raise TypeError(f"Unsupported idx: {idx}")
        def __setitem__(self, idx, val):
            if isinstance(idx, slice):
                start, stop, step = idx.indices(len(self._flat))
                vals = val._flat if isinstance(val, _Arr) else [float(val)] * len(range(start, stop, step))
                for k, pos in enumerate(range(start, stop, step)):
                    self._flat[pos] = float(vals[k])
            else:
                self._flat[idx] = float(val)
        def __mul__(self, other):
            if isinstance(other, _Arr):
                return _Arr([a * b for a, b in zip(self._flat, other._flat)], self.shape, self.dtype)
            return _Arr([a * float(other) for a in self._flat], self.shape, self.dtype)
        def __add__(self, other):
            if isinstance(other, _Arr):
                return _Arr([a + b for a, b in zip(self._flat, other._flat)], self.shape, self.dtype)
            return _Arr([a + float(other) for a in self._flat], self.shape, self.dtype)
        def __sub__(self, other):
            if isinstance(other, _Arr):
                return _Arr([a - b for a, b in zip(self._flat, other._flat)], self.shape, self.dtype)
            return _Arr([a - float(other) for a in self._flat], self.shape, self.dtype)
        def __truediv__(self, other):
            if isinstance(other, _Arr):
                return _Arr([a / b for a, b in zip(self._flat, other._flat)], self.shape, self.dtype)
            return _Arr([a / float(other) for a in self._flat], self.shape, self.dtype)
    np = types.SimpleNamespace(
        ndarray=_Arr,
        float32="float32",
        float64="float64",
        nan=float("nan"),
        inf=float("inf"),
        newaxis=None,
        array=lambda d, dtype="float32": _Arr(d, dtype=dtype),
        asarray=lambda d, dtype="float32": _Arr(d, dtype=dtype),
        ascontiguousarray=lambda d, dtype="float32": _Arr(d, dtype=dtype),
        zeros=lambda s, dtype="float32": _Arr([0.0] * (s if isinstance(s, int) else math.prod(s)), (s,) if isinstance(s, int) else s, dtype),
        ones=lambda s, dtype="float32": _Arr([1.0] * (s if isinstance(s, int) else math.prod(s)), (s,) if isinstance(s, int) else s, dtype),
        linspace=lambda a, b, n, dtype="float32": _Arr([a if n <= 1 else a + (b - a) * i / (n - 1) for i in range(n)], (n,), dtype),
        sin=lambda arr: _Arr([math.sin(x) for x in arr._flat], arr.shape, arr.dtype),
        isfinite=lambda arr: _Arr([1.0 if math.isfinite(x) else 0.0 for x in arr._flat], arr.shape, "bool"),
        nan_to_num=lambda arr, nan=0.0, posinf=0.0, neginf=0.0: _Arr([nan if math.isnan(x) else (posinf if math.isinf(x) and x > 0 else (neginf if math.isinf(x) else x)) for x in arr._flat], arr.shape, arr.dtype),
        clip=lambda arr, lo, hi: _Arr([min(hi, max(lo, x)) for x in arr._flat], arr.shape, arr.dtype),
        abs=lambda arr: _Arr([abs(x) for x in arr._flat], arr.shape, arr.dtype),
        max=lambda arr: max(arr._flat),
        maximum=lambda arr, v: _Arr([max(x, float(v)) for x in arr._flat], arr.shape, arr.dtype),
        concatenate=lambda seq, axis=0: _Arr([x for a in seq for x in a._flat], (sum(a.shape[0] for a in seq),), "float32"),
        pad=lambda arr, pad_width, mode="constant": _Arr(arr._flat + [0.0] * pad_width[-1][1], (arr.shape[0], arr.shape[1] + pad_width[-1][1]) if arr.ndim == 2 else (arr.shape[0] + pad_width[-1][1],), arr.dtype),
    )

class FakeTensor:
    def __init__(self, arr):
        self._arr = np.ascontiguousarray(arr, dtype=np.float32)
        self.dtype = "float32"
        self.ndim = self._arr.ndim
        self.shape = self._arr.shape
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self._arr

fake_torch = types.SimpleNamespace(from_numpy=lambda arr: FakeTensor(arr))

spec = importlib.util.spec_from_file_location("audio_ai_processor", "electron/services/audio_ai_processor.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
if mod.np is None:
    mod.np = np

# 1. Trained lookahead_frames snapping strictly to (0, 2, 4)
assert mod._normalize_inworld_lookahead(0) == 0
assert mod._normalize_inworld_lookahead(1) == 0
assert mod._normalize_inworld_lookahead(2) == 2
assert mod._normalize_inworld_lookahead(3) == 2
assert mod._normalize_inworld_lookahead(4) == 4
assert mod._normalize_inworld_lookahead(8) == 4
assert mod._normalize_inworld_lookahead(-5) == 0

# 2. NaN / Inf / float64 -> strict finite 1D float32 tensor
dirty = np.array([0.25, np.nan, np.inf, -np.inf, 99.0, -0.5], dtype=np.float64)
t = mod._prepare_inworld_channel_tensor(dirty, fake_torch)
assert isinstance(t, FakeTensor)
assert t.ndim == 1 and t.shape == (6,) and t.dtype == "float32"
assert np.isfinite(t.numpy()).all()
assert t.numpy()[1] == 0.0 and t.numpy()[2] == 0.0 and t.numpy()[3] == 0.0
assert t.numpy()[4] == 10.0

# 3. Offline native 8.0s / 2.0s windowing
seen_offline_lens = []
class FakeModel:
    config = types.SimpleNamespace(hop_length=480, sample_rate=48000)
    def default_window(self):
        return (8.0, 2.0)

class FakeOfflineIsolator:
    sample_rate = 48000
    model = FakeModel()
    def isolate(self, wav, sr):
        assert isinstance(wav, FakeTensor), "Expected 1D torch Tensor"
        assert wav.ndim == 1 and wav.dtype == "float32"
        assert np.isfinite(wav.numpy()).all()
        seen_offline_lens.append(wav.shape[0])
        return FakeTensor(wav.numpy() * 0.5)

# Verify exact 48 kHz window calculation: 8.0s = 384,000 samples, 2.0s = 96,000 samples, hop = 480
c48, o48, h48, cs, os_ = mod._resolve_inworld_offline_window(FakeOfflineIsolator(), 48000)
assert (c48, o48, h48) == (384000, 96000, 480), f"Bad 48kHz window: {(c48, o48, h48)}"

# Run full sliding-window OLA with sr=1000 (chunk=8000, overlap=2000, len=20500 = 20.5s)
FakeModel.config = types.SimpleNamespace(hop_length=10, sample_rate=1000)
x_long = np.sin(np.linspace(0.0, 200.0, 20500, dtype=np.float32))
y_long = mod._isolate_inworld_offline_channel(FakeOfflineIsolator(), x_long, 1000, fake_torch, 30.0, 90.0, "Mono")
assert y_long.shape == (20500,), f"Bad output length: {y_long.shape}"
assert seen_offline_lens == [8000, 8000, 8000, 8000], f"Non-native chunk sizes: {seen_offline_lens}"
max_err = float(np.max(np.abs(y_long - x_long * 0.5)))
assert max_err < 1e-5, f"Overlap-add unity error too high: {max_err}"

# 4. Short clip (3.0s < 8.0s) -> single direct pass
seen_offline_lens.clear()
x_short = np.linspace(-0.5, 0.5, 3000, dtype=np.float32)
y_short = mod._isolate_inworld_offline_channel(FakeOfflineIsolator(), x_short, 1000, fake_torch, 30.0, 90.0, "Mono")
assert seen_offline_lens == [3000]
assert y_short.shape == (3000,)

# 5. Realtime streaming session -> continuous 0.5s pushes + flush, zero resets
pushed_lens = []
flushed = [False]
class FakeStream:
    def __init__(self):
        self.buf = []
    def push(self, piece):
        assert isinstance(piece, FakeTensor) and piece.ndim == 1 and piece.dtype == "float32"
        pushed_lens.append(piece.shape[0])
        self.buf.append(piece.numpy())
        return FakeTensor(piece.numpy() * 0.75) if len(pushed_lens) > 1 else FakeTensor(np.zeros((0,), dtype=np.float32))
    def flush(self):
        flushed[0] = True
        return FakeTensor(self.buf[0] * 0.75)

class FakeStreamIsolator:
    sample_rate = 48000
    def stream(self):
        return FakeStream()

# At sr=48000, 0.5s = 24,000 samples (3 full 0.5s pieces + 3,000 tail = 75,000)
x_stream = np.linspace(-0.4, 0.4, 75000, dtype=np.float32)
y_stream = mod._isolate_inworld_streaming_channel(FakeStreamIsolator(), x_stream, 48000, fake_torch, 30.0, 90.0, "Mono")
assert flushed[0] is True
assert pushed_lens == [24000, 24000, 24000, 3000], f"Unexpected stream piece sizes: {pushed_lens}"
assert y_stream.shape == (75000,)
print("INWORLD_CONTRACT_TESTS_OK")
`;
    const res = spawnSync('python3', ['-B', '-c', pyCode], { encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('INWORLD_CONTRACT_TESTS_OK');
  });
});

