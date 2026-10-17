# Implementation Plan: Dubber Spectrum Equalizer, Neural AI Model Execution Fix, and Media Protocol Repair

A unified solution to homogenize dubber voice tracks to a standard broadcast frequency response (АЧХ) prior to mixing, strictly execute user-selected neural AI models (such as The Echo Aggressive and UVR ONNX/PTH models), resolve Chromium custom-media Windows drive letter URL bugs, and provide enhanced video transport controls with precision seeking.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed by the user in Phase 1:
> - **Dubber Frequency Equalization Strategy**: Apply a standard broadcast target EQ curve (smooth sub-cut, warm body, presence clarity, high air) to all dubber voice tracks automatically to bring diverse microphones and rooms to a single baseline.
> - **Neural AI Model Handling**: Strictly execute the exact downloaded model selected by the user for each track (e.g., The Echo Aggressive / UVR ONNX models), raising an explicit error if the model is missing or fails instead of silently falling back to DeepFilterNet.
> - **Video Transport & Media Player**: Implement enhanced video transport with precision time scrubbing, frame-stepping (±1 frame, ±1s, ±5s), timecode jumps (`HH:MM:SS:FF`), and silent media error handling.

---

## 1. Overview & Core Concept

### What It Does
1. **Dubber Spectrum Equalizer ("Приведение к единому знаменателю АЧХ")**: A new processing module in the Mixing Pipeline (`dubber_spectrum_equalizer`) that analyzes the frequency spectrum of each actor's recording and applies FFT-based spectral matching towards a standard broadcast vocal curve. This eliminates differences caused by varied microphones, audio cards, and acoustic environments before downstream processing.
2. **Strict User-Selected Neural Model Execution**: Refactors `AudioNeuralService` and `audio_ai_processor.py` so that when a user selects a specific downloaded model (such as `The Echo Aggressive` / `uvr_deecho_aggressive` or UVR ONNX models), the Python sidecar loads and runs that exact ONNX/PyTorch model instead of forcibly redirecting to DeepFilterNet3.
3. **Chromium `custom-media://` Protocol Path Fix**: Fixes Windows drive letter URL normalization in `electron/main.cjs` where `custom-media://i/YandexDisk/...` was improperly converted to relative path `i\YandexDisk\...`. Replaces broken `fs.existsSync` with synchronous `fsSync.existsSync`.
4. **Enhanced Video Transport & Silent Error Logging**: Prevents false crash reports from `<video>` element network/decoding errors and adds precision timeline transport controls (frame-by-frame navigation, timecode input, waveform synchronization).

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Mixing Pipeline - Dubber Spectrum Equalizer**:
   - User navigates to **Mixing Panel** -> **Pipeline Steps**.
   - A new step **"Приведение АЧХ даберов к единому знаменателю (Dubber Spectrum Equalizer)"** appears at the top of the chain (before EQ, noise suppression, and dynamic compression).
   - User can select target voice profiles (*Standard Broadcast*, *Cinematic Deep Voice*, *Bright Anime Vocal*, *Podcast Warmth*) or adjust FFT spectral matching strength (0–100%).
   - Running the step processes each dubber track independently, displaying real-time frequency analysis and curve correction feedback.

2. **Neural Model Selection & Execution**:
   - User selects an AI Dereverb or Denoise model in step settings (e.g., *The Echo Aggressive*, *Reverb HQ FoxJoy*, *UVR DeNoise*, or *DeepFilterNet 3*).
   - When executed, the system logs the exact model name being loaded (`[Neural AI] Запуск модели: UVR-De-Echo-Aggressive (ONNX/PyTorch)...`).
   - If the requested model is missing or fails, a clear error dialog is displayed rather than secretly running DeepFilterNet.

3. **Video Player Transport**:
   - Clean custom-media streaming without `net::ERR_UNEXPECTED` errors.
   - Video transport bar includes:
     - Play/Pause & Frame Stepping (`<` / `>`).
     - Timecode display (`01:23:45:12`) with click-to-edit jump.
     - Seek slider with hover time tooltip and audio waveform alignment.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: FFT Spectral Matching Target Engine**:
  - *Chosen Approach*: Implement an impulse response / FFT spectral envelope normalization in `audio_ai_processor.py` that computes average 1/3-octave power spectral density (PSD) per dubber track and applies linear-phase FIR filtering to match the target curve.
  - *Why*: Fast, deterministic, artifact-free equalization that works across all sample rates without introducing phase distortion.

- **Decision 2: Strict Model Dispatch in Python Sidecar**:
  - *Chosen Approach*: Expand `audio_ai_processor.py` to support ONNX Runtime and PyTorch UVR model execution for `uvr_deecho_aggressive`, `reverb_foxjoy`, `uvr_denoise`, etc.
  - *Why*: Respects user choice explicitly without silent fallbacks.

- **Decision 3: Robust Windows Path Normalization for `custom-media`**:
  - *Chosen Approach*: Support both `custom-media:///I:/...` and Chromium-normalized `custom-media://i/...` in `protocol.handle('custom-media')`. Check if the URL host is a single letter (e.g. `i`), and construct `I:\...`. Use `fsSync.existsSync` to test MP4 proxy files.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ELECTRON RENDERER (UI)                           │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │
│  │    MixingPanel.tsx     │  │ StandaloneMediaSelect │  │ VideoPlayer UI  │ │
│  │ (Dubber Spectrum EQ)   │  │ (Custom Media Stream) │  │ (Precision Transport)│
│  └───────────┬────────────┘  └───────────┬───────────┘  └────────┬────────┘ │
└──────────────┼───────────────────────────┼───────────────────────┼──────────┘
               │ IPC Calls                 │ custom-media://       │ Time / Error
               ▼                           ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON MAIN PROCESS                              │
│  ┌────────────────────────┐  ┌────────────────────────────────────────────┐ │
│  │ MixingController.cjs   │  │ protocol.handle('custom-media')             │ │
│  │ MixingPipelineService  │  │ - Fixes host drive letter 'i' -> 'I:\'     │ │
│  │ AudioNeuralService.cjs │  │ - Fixes fsSync.existsSync for MP4 proxies  │ │
│  └───────────┬────────────┘  └────────────────────────────────────────────┘ │
└──────────────┼──────────────────────────────────────────────────────────────┘
               │ CLI Spawning (Python sidecar)
               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PYTHON SIDECAR (audio_ai_processor.py)                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Spectrum Equalizer (--mode spectrum_equalize)                      │  │
│  │    - 1/3 Octave PSD Analysis -> Inverse FIR Target Matching Filter    │  │
│  ├───────────────────────────────────────────────────────────────────────┤  │
│  │ 2. Neural Model Dispatcher (--mode dereverb / denoise)                │  │
│  │    - uvr_deecho_aggressive (ONNX / PyTorch UVR engine)               │  │
│  │    - reverb_foxjoy / uvr_denoise / deepfilternet3                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key File Changes
1. `electron/sidecars/audio_ai_processor.py` & `electron/services/AudioNeuralService.cjs`:
   - Implement `process_spectrum_equalize` for dubber track equalization.
   - Implement ONNX/PTH model inference for UVR dereverb models (`uvr_deecho_aggressive`, etc.) so requested models actually execute.
2. `electron/services/MixingPipelineService.cjs`:
   - Add `dubber_spectrum_equalizer` step definition to `MODULE_DATABASE`.
   - Wire step execution handler to call `AudioNeuralService.spectrumEqualizeAudio`.
3. `electron/main.cjs`:
   - Fix `custom-media` protocol handler for Windows single-letter drive hosts (`i/...` -> `I:\...`).
   - Replace `fs.existsSync` with `fsSync.existsSync`.
   - Prevent false crash logging on media load errors.
4. `src/components/MixingPanel.tsx` & Media Components:
   - Add Dubber Spectrum Equalizer configuration UI and controls.
   - Enhance video player transport controls with precision seeking and frame stepping.

---

## Verification Plan

1. **Compilation Check**: Run `compile_applet` to ensure code compiles cleanly.
2. **Protocol & Path Test**: Verify `custom-media://i/YandexDisk/...` URLs resolve to absolute Windows drive paths without `net::ERR_UNEXPECTED`.
3. **Neural Model Execution Test**: Verify selecting `The Echo Aggressive` executes the ONNX UVR model.
4. **Dubber Spectrum Equalizer Test**: Verify step executes across dubber tracks and produces balanced target audio.
