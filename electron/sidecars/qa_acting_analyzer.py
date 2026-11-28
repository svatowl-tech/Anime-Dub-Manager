#!/usr/bin/env python3
"""
Local Acting, Diction, Stress & Persona QA Analyzer Sidecar for Anime Dub Manager.
100% offline/local inference inside AI_env (Zero cloud APIs).

Modes:
  --mode check_models --profile fast_diction|full_acting
  --mode download_models --profile fast_diction|full_acting
  --mode analyze --manifest <path_to_manifest.json>
"""

import os
import sys
import re
import gc
import json
import math
import argparse
import traceback
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
        sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    except Exception:
        pass


MODEL_SPECS = [
    {
        "id": "faster_whisper_small",
        "repo": "Systran/faster-whisper-small",
        "title": "Faster-Whisper Small (сбивки и тайминги слов)",
        "profile": "fast_diction",
        "sizeMb": 480,
        "kind": "hf_snapshot",
    },
    {
        "id": "wav2vec2_ru_gop",
        "repo": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
        "title": "Wav2Vec2 XLSR-53 Russian (чёткость дикции и фонемы)",
        "profile": "fast_diction",
        "sizeMb": 1200,
        "kind": "hf_snapshot",
    },
    {
        "id": "ruaccent",
        "repo": "ruaccent/turbo3.1",
        "title": "RUAccent ONNX (ударения в русском языке)",
        "profile": "fast_diction",
        "sizeMb": 210,
        "kind": "ruaccent",
    },
    {
        "id": "ast_audioset",
        "repo": "MIT/ast-finetuned-audioset-10-10-0.4593",
        "title": "AST AudioSet (кашель, вздохи, клики, оговорки)",
        "profile": "full_acting",
        "sizeMb": 345,
        "kind": "hf_snapshot",
    },
    {
        "id": "emotion_msp_dim",
        "repo": "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim",
        "title": "MSP-Dim Emotion (энергетика, доминантность, валентность JP↔RU)",
        "profile": "full_acting",
        "sizeMb": 660,
        "kind": "hf_snapshot",
    },
    {
        "id": "emotion_ru",
        "repo": "Aniemore/wav2vec2-xlsr-53-russian-emotion-recognition",
        "title": "Aniemore Russian Emotion (эмоции в русской речи)",
        "profile": "full_acting",
        "sizeMb": 1200,
        "kind": "hf_snapshot",
    },
    {
        "id": "age_gender",
        "repo": "audeering/wav2vec2-large-robust-24-ft-age-gender",
        "title": "Wav2Vec2 Age & Gender (возраст и тембр персонажа)",
        "profile": "full_acting",
        "sizeMb": 1250,
        "kind": "hf_snapshot",
    },
    {
        "id": "ecapa_speaker",
        "repo": "speechbrain/spkrec-ecapa-voxceleb",
        "title": "SpeechBrain ECAPA-TDNN (сходство голоса с базой ролей)",
        "profile": "full_acting",
        "sizeMb": 95,
        "kind": "speechbrain",
    },
]

RU_VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")
DISFLUENCY_FILLERS = {
    "ээ", "эээ", "мм", "ммм", "аа", "ааа", "нуу", "типа", "короче", "блин", "ой", "эм", "гм", "хм"
}


def emit_progress(percent: float, message: str):
    pct = max(0.0, min(100.0, float(percent)))
    print(f"PROGRESS:{pct:.1f}:{message}", flush=True)


def emit_result(payload: dict):
    print("RESULT:" + json.dumps(payload, ensure_ascii=False), flush=True)


def get_hf_cache_dir() -> Path:
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def get_ruaccent_cache_dir() -> Path:
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).parent / "ruaccent"
    return Path.home() / ".cache" / "ruaccent"


def _hf_repo_cached(repo_id: str) -> bool:
    cache_hub = get_hf_cache_dir()
    slug = "models--" + repo_id.replace("/", "--")
    repo_dir = cache_hub / slug
    if not repo_dir.exists():
        return False
    snapshots_dir = repo_dir / "snapshots"
    if not snapshots_dir.exists():
        return False
    for snap in snapshots_dir.iterdir():
        if snap.is_dir():
            has_weights = any(
                snap.rglob(pat)
                for pat in ("*.safetensors", "*.bin", "*.onnx", "*.ckpt", "model.bin")
            )
            if has_weights or any(snap.glob("config.json")):
                # Ensure config + weights or ctranslate2 model.bin exist
                if any(snap.glob("model.bin")) or any(snap.glob("*.safetensors")) or any(snap.glob("*.bin")) or any(snap.glob("*.ckpt")):
                    return True
    return False


def _speechbrain_cached(repo_id: str) -> bool:
    if _hf_repo_cached(repo_id):
        return True
    sb_dir = get_hf_cache_dir().parent / "speechbrain_ecapa"
    return sb_dir.exists() and any(sb_dir.glob("*.ckpt"))


def _ruaccent_cached() -> bool:
    try:
        import ruaccent
        pkg_dir = Path(ruaccent.__file__).resolve().parent
        # ruaccent downloads models inside package dir or HF/user cache
        for cand in [
            pkg_dir / "nn",
            pkg_dir / "dictionary",
            get_ruaccent_cache_dir(),
            Path.home() / ".cache" / "ruaccent",
        ]:
            if cand.exists() and any(cand.rglob("*.onnx")):
                return True
        # Check huggingface hub cache used by newer ruaccent versions
        hub = get_hf_cache_dir()
        if hub.exists():
            for d in hub.glob("models--*ruaccent*"):
                if (d / "snapshots").exists() and any((d / "snapshots").rglob("*.onnx")):
                    return True
    except Exception:
        pass
    return False


def is_model_downloaded(spec: dict) -> bool:
    kind = spec.get("kind")
    repo = spec.get("repo", "")
    if kind == "ruaccent":
        return _ruaccent_cached()
    if kind == "speechbrain":
        return _speechbrain_cached(repo)
    return _hf_repo_cached(repo)


def filter_specs_for_profile(profile: str) -> list:
    if profile == "fast_diction":
        return [m for m in MODEL_SPECS if m["profile"] == "fast_diction"]
    return list(MODEL_SPECS)


def cmd_check_models(profile: str):
    specs = filter_specs_for_profile(profile)
    models_out = []
    for spec in MODEL_SPECS:
        downloaded = is_model_downloaded(spec)
        required_for_profile = spec in specs
        models_out.append({
            "id": spec["id"],
            "repo": spec["repo"],
            "title": spec["title"],
            "profile": spec["profile"],
            "sizeMb": spec["sizeMb"],
            "downloaded": downloaded,
            "required": required_for_profile,
        })
    missing_required = [m for m in models_out if m["required"] and not m["downloaded"]]
    total_missing_mb = sum(m["sizeMb"] for m in missing_required)
    emit_result({
        "profile": profile,
        "ready": len(missing_required) == 0,
        "missingCount": len(missing_required),
        "totalMissingMb": total_missing_mb,
        "models": models_out,
    })


def cmd_download_models(profile: str):
    specs = filter_specs_for_profile(profile)
    missing = [s for s in specs if not is_model_downloaded(s)]
    if not missing:
        emit_progress(100.0, "Все локальные модели уже установлены.")
        cmd_check_models(profile)
        return

    from huggingface_hub import snapshot_download

    total = len(missing)
    for idx, spec in enumerate(missing):
        base_pct = (idx / total) * 95.0
        emit_progress(base_pct, f"Загрузка модели ({idx + 1}/{total}): {spec['title']}...")
        kind = spec["kind"]
        repo = spec["repo"]
        try:
            if kind == "ruaccent":
                from ruaccent import RUAccent
                accentizer = RUAccent()
                accentizer.load(omograph_model_size="turbo3.1", use_dictionary=True)
                del accentizer
            elif kind == "speechbrain":
                sb_savedir = get_hf_cache_dir().parent / "speechbrain_ecapa"
                sb_savedir.mkdir(parents=True, exist_ok=True)
                snapshot_download(repo_id=repo, local_dir=str(sb_savedir))
            else:
                snapshot_download(repo_id=repo)
        except Exception as dl_err:
            print(f"LOG: Warning downloading {repo}: {dl_err}", flush=True)
            raise
        gc.collect()

    emit_progress(100.0, "Локальные модели для AI QA успешно загружены.")
    cmd_check_models(profile)


def load_wav_16k(path_str: str):
    import numpy as np
    import soundfile as sf

    if not path_str or not os.path.exists(path_str):
        return np.zeros(0, dtype=np.float32), 16000
    data, sr = sf.read(path_str, dtype="float32", always_2d=False)
    if getattr(data, "ndim", 1) > 1:
        data = np.mean(data, axis=1)
    data = np.asarray(data, dtype=np.float32)
    if sr != 16000 and len(data) > 0:
        import librosa
        data = librosa.resample(data, orig_sr=sr, target_sr=16000).astype(np.float32)
        sr = 16000
    return data, sr


def compute_rms_db(arr) -> float:
    import numpy as np
    if len(arr) == 0:
        return -90.0
    rms = float(np.sqrt(np.mean(np.square(arr)) + 1e-12))
    return float(20.0 * math.log10(max(rms, 1e-9)))


def compute_f0_stats(audio, sr=16000):
    import numpy as np
    import librosa
    if len(audio) < int(0.15 * sr):
        return {"f0MedianHz": 0.0, "f0StdHz": 0.0, "f0IqrHz": 0.0}
    try:
        f0 = librosa.yin(audio, fmin=65.0, fmax=520.0, sr=sr, frame_length=1024, hop_length=256)
        rms = librosa.feature.rms(y=audio, frame_length=1024, hop_length=256)[0]
        min_len = min(len(f0), len(rms))
        f0 = f0[:min_len]
        rms = rms[:min_len]
        voiced = f0[(rms > 0.012) & (f0 > 70.0) & (f0 < 500.0)]
        if len(voiced) < 4:
            return {"f0MedianHz": 0.0, "f0StdHz": 0.0, "f0IqrHz": 0.0}
        q25, q50, q75 = np.percentile(voiced, [25, 50, 75])
        return {
            "f0MedianHz": float(q50),
            "f0StdHz": float(np.std(voiced)),
            "f0IqrHz": float(q75 - q25),
        }
    except Exception:
        return {"f0MedianHz": 0.0, "f0StdHz": 0.0, "f0IqrHz": 0.0}


def estimate_syllables_from_audio(audio, sr=16000) -> float:
    import numpy as np
    if len(audio) < int(0.25 * sr):
        return 0.0
    hop = 160  # 10ms
    win = 400  # 25ms
    frames = []
    for i in range(0, max(1, len(audio) - win), hop):
        seg = audio[i:i + win]
        frames.append(float(np.sqrt(np.mean(seg * seg) + 1e-12)))
    if len(frames) < 5:
        return 0.0
    env = np.array(frames, dtype=np.float32)
    # Smooth envelope ~50ms
    kernel = np.ones(5, dtype=np.float32) / 5.0
    env = np.convolve(env, kernel, mode="same")
    thresh = max(0.012, float(np.percentile(env, 65)) * 0.35)
    peaks = 0
    last_peak_idx = -12
    for idx in range(1, len(env) - 1):
        if env[idx] > thresh and env[idx] >= env[idx - 1] and env[idx] >= env[idx + 1]:
            if idx - last_peak_idx >= 10:  # >= 100ms apart
                peaks += 1
                last_peak_idx = idx
    dur = len(audio) / float(sr)
    return peaks / max(dur, 0.25)


def compute_high_freq_clarity_ratio(audio, sr=16000) -> float:
    import numpy as np
    if len(audio) < 512:
        return 1.0
    spec = np.abs(np.fft.rfft(audio * np.hanning(len(audio))))
    freqs = np.fft.rfftfreq(len(audio), 1.0 / sr)
    low_band = spec[(freqs >= 200.0) & (freqs <= 800.0)]
    high_band = spec[(freqs >= 2000.0) & (freqs <= 7500.0)]
    low_e = float(np.mean(low_band)) if len(low_band) else 1e-6
    high_e = float(np.mean(high_band)) if len(high_band) else 0.0
    return high_e / max(low_e, 1e-6)


def normalize_ru_text(text: str) -> str:
    return re.sub(r"[^а-яёa-z0-9\s\-+]", "", (text or "").lower()).strip()


def count_russian_syllables(text: str) -> int:
    return sum(1 for ch in (text or "") if ch in RU_VOWELS)


def find_vowel_positions(word: str):
    return [i for i, ch in enumerate(word) if ch in RU_VOWELS]


def format_word_with_upper_stress(word: str, vowel_char_idx: int) -> str:
    if vowel_char_idx < 0 or vowel_char_idx >= len(word):
        return word
    chars = list(word.lower())
    chars[vowel_char_idx] = chars[vowel_char_idx].upper()
    return "".join(chars)


def parse_plus_marked_word(marked_word: str):
    """
    Converts RUAccent '+слово' or dictionary 'САсуке' into (clean_word, stressed_vowel_ordinal, char_index).
    """
    if "+" in marked_word:
        plus_idx = marked_word.index("+")
        clean = marked_word.replace("+", "")
        vowels = find_vowel_positions(clean)
        # Find vowel right at or after plus_idx
        target_char_idx = plus_idx if plus_idx < len(clean) and clean[plus_idx] in RU_VOWELS else -1
        if target_char_idx == -1:
            for v_idx in vowels:
                if v_idx >= plus_idx - 1:
                    target_char_idx = v_idx
                    break
        if target_char_idx in vowels:
            return clean, vowels.index(target_char_idx), target_char_idx
    # Fallback uppercase vowel detection (excluding first char unless only uppercase vowel)
    vowels = find_vowel_positions(marked_word)
    upper_vowels = [v for v in vowels if marked_word[v].isupper()]
    if len(upper_vowels) == 1:
        v_char = upper_vowels[0]
        return marked_word, vowels.index(v_char), v_char
    return marked_word, -1, -1


def check_stutter_or_repeat(words: list):
    """
    Detects repeated adjacent words, syllable prefixes, or hesitation fillers in ASR output.
    """
    cleaned = [re.sub(r"[^а-яёa-z0-9]", "", w.get("word", "").lower()) for w in words]
    for i in range(len(cleaned)):
        w = cleaned[i]
        if not w:
            continue
        if w in DISFLUENCY_FILLERS:
            return "filler", f"слово-паразит «{w}»", float(words[i].get("start", 0.0)), float(words[i].get("end", 0.0))
        if i > 0 and w == cleaned[i - 1] and len(w) >= 2:
            return "repeat", f"повтор слова «{w}»", float(words[i - 1].get("start", 0.0)), float(words[i].get("end", 0.0))
        if i > 0 and len(cleaned[i - 1]) >= 1 and len(w) >= len(cleaned[i - 1]) + 2:
            prev = cleaned[i - 1]
            if len(prev) <= 4 and w.startswith(prev) and prev not in {"не", "на", "по", "за", "из", "от", "до", "в", "к", "с", "о", "и", "а", "у"}:
                return "stutter", f"запинка / недоговорённый слог «{prev}- {w}»", float(words[i - 1].get("start", 0.0)), float(words[i].get("end", 0.0))
    return None


def compute_cosine(vec_a, vec_b) -> float:
    import numpy as np
    a = np.asarray(vec_a, dtype=np.float32).flatten()
    b = np.asarray(vec_b, dtype=np.float32).flatten()
    if len(a) == 0 or len(b) == 0 or len(a) != len(b):
        return 0.0
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def run_stage1_asr_and_diction(lines: list, settings: dict, profile: str, issues: list, per_line_cache: dict):
    import numpy as np
    import torch

    scan_disfluency = bool(settings.get("scanSpeechDisfluencies", True))
    scan_diction = bool(settings.get("scanDictionClarity", True))
    scan_stress = bool(settings.get("scanStressErrors", True))
    max_pause = float(settings.get("disfluencyMaxPauseSec", 0.45))
    min_gop = float(settings.get("dictionMinGopScore", 0.55))
    max_rate_delta = float(settings.get("dictionMaxRateDeltaPercent", 35.0))

    emit_progress(10.0, "Этап 1/4: Анализ сбивок, пауз и разборчивости дикции (Whisper + Wav2Vec2 CTC)...")

    # 1A. Faster-Whisper word-level ASR for disfluencies & pauses
    whisper_model = None
    if scan_disfluency:
        try:
            from faster_whisper import WhisperModel
            whisper_size = str(settings.get("whisperModel", "small") or "small")
            if whisper_size not in ("tiny", "base", "small", "medium"):
                whisper_size = "small"
            whisper_model = WhisperModel(whisper_size, device="cpu", compute_type="int8")
        except Exception as e:
            print(f"LOG: Faster-Whisper unavailable in Stage 1: {e}", flush=True)

    for line in lines:
        lid = line["id"]
        dub_audio, sr = load_wav_16k(line.get("dubberWavPath"))
        orig_audio, _ = load_wav_16k(line.get("origWavPath"))
        per_line_cache[lid] = {
            "dub_audio": dub_audio,
            "orig_audio": orig_audio,
            "f0": compute_f0_stats(dub_audio, sr),
            "orig_f0": compute_f0_stats(orig_audio, sr) if len(orig_audio) > 0 else None,
            "words": [],
            "ctc_chars": [],
        }
        if len(dub_audio) < int(0.18 * sr):
            continue

        # Run Whisper word timestamps
        if whisper_model is not None:
            try:
                segments, _ = whisper_model.transcribe(
                    dub_audio,
                    language="ru",
                    word_timestamps=True,
                    vad_filter=False,
                    beam_size=2,
                )
                words = []
                for seg in segments:
                    if getattr(seg, "words", None):
                        for w in seg.words:
                            words.append({
                                "word": (w.word or "").strip(),
                                "start": float(w.start or 0.0),
                                "end": float(w.end or 0.0),
                                "prob": float(getattr(w, "probability", 1.0) or 1.0),
                            })
                per_line_cache[lid]["words"] = words

                # Check stutter / repeat
                stutter_hit = check_stutter_or_repeat(words)
                if stutter_hit:
                    subtype, desc, rel_s, rel_e = stutter_hit
                    issues.append({
                        "lineId": lid,
                        "type": "speech_disfluency",
                        "severity": "warning",
                        "title": "Оговорка или запинка в речи",
                        "description": f"Обнаружена {desc}.",
                        "disfluencySubtype": subtype,
                        "disfluencyDetails": desc,
                        "eventOffsetSec": rel_s,
                    })

                # Check mid-line hesitation pauses
                if len(words) >= 2:
                    longest_gap = 0.0
                    gap_at = 0.0
                    for idx in range(1, len(words)):
                        gap = words[idx]["start"] - words[idx - 1]["end"]
                        if gap > longest_gap:
                            longest_gap = gap
                            gap_at = words[idx - 1]["end"]
                    if longest_gap > max_pause:
                        # Check if original ALSO had a comparable pause there
                        orig_also_paused = False
                        if len(orig_audio) > int(0.3 * sr):
                            s_idx = max(0, int((gap_at + 0.05) * sr))
                            e_idx = min(len(orig_audio), int((gap_at + longest_gap - 0.05) * sr))
                            if e_idx > s_idx + 400:
                                orig_gap_db = compute_rms_db(orig_audio[s_idx:e_idx])
                                if orig_gap_db < -42.0:
                                    orig_also_paused = True
                        if not orig_also_paused:
                            issues.append({
                                "lineId": lid,
                                "type": "speech_disfluency",
                                "severity": "info",
                                "title": f"Неестественная пауза посреди реплики ({longest_gap:.2f}с)",
                                "description": f"Длинная запинка/пауза внутри реплики (порог {max_pause:.2f}с), отсутствующая в оригинале.",
                                "disfluencySubtype": "hesitation_pause",
                                "disfluencyDetails": f"Пауза {longest_gap:.2f}с на {gap_at:.1f}с от начала фразы",
                                "eventOffsetSec": gap_at,
                            })

                # Check abnormally low word probabilities (swallowed/mumbled)
                low_prob_words = [w for w in words if len(w["word"]) >= 4 and w["prob"] < 0.35]
                if len(words) >= 2 and (len(low_prob_words) / len(words)) >= 0.45:
                    per_line_cache[lid]["low_asr_conf"] = True
            except Exception as w_err:
                print(f"LOG: Whisper word pass failed for line {lid}: {w_err}", flush=True)

    if whisper_model is not None:
        del whisper_model
        gc.collect()

    emit_progress(24.0, "Этап 1/4: Проверка артикуляции, CTC-уверенности и темпа речи (Wav2Vec2 Russian)...")

    # 1B. Wav2Vec2 CTC GOP + char timing (for diction clarity AND Stage 2 stress nucleus energy alignment)
    if scan_diction or scan_stress:
        w2v_model = None
        w2v_processor = None
        try:
            from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
            repo_id = "jonatasgrosman/wav2vec2-large-xlsr-53-russian"
            w2v_processor = Wav2Vec2Processor.from_pretrained(repo_id)
            w2v_model = Wav2Vec2ForCTC.from_pretrained(repo_id)
            w2v_model.eval()
            vocab = w2v_processor.tokenizer.get_vocab()
            id_to_char = {v: k for k, v in vocab.items()}
            blank_id = w2v_processor.tokenizer.pad_token_id or 0
        except Exception as e:
            print(f"LOG: Wav2Vec2 RU CTC unavailable: {e}", flush=True)
            w2v_model = None

        if w2v_model is not None:
            for line in lines:
                lid = line["id"]
                dub_audio = per_line_cache[lid]["dub_audio"]
                orig_audio = per_line_cache[lid]["orig_audio"]
                text = line.get("text", "")
                if len(dub_audio) < 3200:
                    continue
                try:
                    inputs = w2v_processor(dub_audio, sampling_rate=16000, return_tensors="pt", padding=True)
                    with torch.no_grad():
                        logits = w2v_model(inputs.input_values).logits[0]  # [T, V]
                        probs = torch.softmax(logits, dim=-1)
                        max_probs, pred_ids = torch.max(probs, dim=-1)

                    non_blank_mask = pred_ids != blank_id
                    if torch.any(non_blank_mask):
                        gop_score = float(torch.mean(max_probs[non_blank_mask]).item())
                    else:
                        gop_score = 0.0

                    # Collapse CTC runs with frame timestamps for stress nucleus energy check
                    frame_sec = (len(dub_audio) / 16000.0) / max(1, logits.shape[0])
                    runs = []
                    prev_id = -1
                    cur_start = 0
                    pred_list = pred_ids.tolist()
                    for t_idx, tok_id in enumerate(pred_list):
                        if tok_id != prev_id:
                            if prev_id != -1 and prev_id != blank_id:
                                ch = id_to_char.get(prev_id, "")
                                if ch:
                                    runs.append({
                                        "char": ch,
                                        "startSec": cur_start * frame_sec,
                                        "endSec": t_idx * frame_sec,
                                    })
                            prev_id = tok_id
                            cur_start = t_idx
                    if prev_id != -1 and prev_id != blank_id:
                        ch = id_to_char.get(prev_id, "")
                        if ch:
                            runs.append({
                                "char": ch,
                                "startSec": cur_start * frame_sec,
                                "endSec": len(pred_list) * frame_sec,
                            })
                    per_line_cache[lid]["ctc_runs"] = runs
                    per_line_cache[lid]["gop_score"] = gop_score

                    if scan_diction:
                        hf_ratio = compute_high_freq_clarity_ratio(dub_audio, 16000)
                        dur_sec = max(len(dub_audio) / 16000.0, 0.25)
                        text_syllables = count_russian_syllables(text)
                        dub_rate = (text_syllables / dur_sec) if text_syllables >= 3 else estimate_syllables_from_audio(dub_audio, 16000)
                        orig_rate = estimate_syllables_from_audio(orig_audio, 16000) if len(orig_audio) > 4000 else 0.0

                        rate_delta_pct = 0.0
                        if orig_rate > 1.0 and dub_rate > 1.0:
                            rate_delta_pct = abs(dub_rate - orig_rate) / orig_rate * 100.0

                        clarity_bad = gop_score < min_gop
                        muffled_bad = gop_score < (min_gop + 0.08) and hf_ratio < 0.14
                        tempo_bad = orig_rate > 1.2 and rate_delta_pct > max_rate_delta and (text_syllables >= 5 or dur_sec >= 1.2)

                        if clarity_bad or muffled_bad:
                            issues.append({
                                "lineId": lid,
                                "type": "diction_clarity",
                                "severity": "warning" if gop_score < (min_gop - 0.1) else "info",
                                "title": "Нечёткая дикция / «комканье» речи",
                                "description": (
                                    f"Чёткость артикуляции (CTC GOP): {gop_score * 100:.0f}% (порог {min_gop * 100:.0f}%), "
                                    f"ВЧ-разборчивость: {hf_ratio:.2f}."
                                ),
                                "gopScore": round(gop_score, 3),
                                "speechRateSyllablesPerSec": round(dub_rate, 2),
                                "originalSpeechRateSyllablesPerSec": round(orig_rate, 2) if orig_rate > 0 else None,
                            })
                        elif tempo_bad:
                            direction = "быстрее" if dub_rate > orig_rate else "медленнее"
                            issues.append({
                                "lineId": lid,
                                "type": "diction_clarity",
                                "severity": "info",
                                "title": f"Сильное расхождение темпа речи ({direction} на {rate_delta_pct:.0f}%)",
                                "description": (
                                    f"Темп даббера: {dub_rate:.1f} слог/с, оригинал: {orig_rate:.1f} слог/с "
                                    f"(допустимое отклонение {max_rate_delta:.0f}%)."
                                ),
                                "gopScore": round(gop_score, 3),
                                "speechRateSyllablesPerSec": round(dub_rate, 2),
                                "originalSpeechRateSyllablesPerSec": round(orig_rate, 2),
                            })
                except Exception as ctc_err:
                    print(f"LOG: Wav2Vec2 CTC failed for line {lid}: {ctc_err}", flush=True)

            del w2v_model
            del w2v_processor
            gc.collect()


def run_stage2_stress(lines: list, stress_dict: list, settings: dict, issues: list, per_line_cache: dict):
    if not bool(settings.get("scanStressErrors", True)):
        return

    emit_progress(42.0, "Этап 2/4: Проверка ударений по словарю и тексту (RUAccent + энергетический анализ слогов)...")
    mode = str(settings.get("stressCheckMode", "dictionary_and_text") or "dictionary_and_text")
    contrast_thresh_db = float(settings.get("stressContrastThresholdDb", 2.5))

    # Build normalized dictionary lookup
    dict_map = {}
    for entry in (stress_dict or []):
        w = (entry.get("word") or "").strip().lower()
        marked = (entry.get("stressedForm") or "").strip()
        if not w or not marked:
            continue
        clean, vow_ord, char_idx = parse_plus_marked_word(marked)
        if vow_ord >= 0:
            dict_map[w] = {
                "word": clean,
                "vowelOrd": vow_ord,
                "charIdx": char_idx,
                "marked": format_word_with_upper_stress(clean, char_idx),
                "source": "dictionary",
            }

    accentizer = None
    if mode == "dictionary_and_text":
        try:
            from ruaccent import RUAccent
            accentizer = RUAccent()
            accentizer.load(omograph_model_size="turbo3.1", use_dictionary=True)
        except Exception as acc_err:
            print(f"LOG: RUAccent unavailable: {acc_err}", flush=True)

    for line in lines:
        lid = line["id"]
        dub_audio = per_line_cache[lid]["dub_audio"]
        ctc_runs = per_line_cache[lid].get("ctc_runs") or []
        text = line.get("text", "")
        if len(dub_audio) < 4000 or not ctc_runs or not text:
            continue

        # Extract multi-syllable Cyrillic words in the text
        raw_words = re.findall(r"[А-Яа-яЁё]{3,}", text)
        if not raw_words:
            continue

        # Build accented map from RUAccent once per line if needed
        ruaccent_words = []
        if accentizer is not None:
            try:
                accented_sentence = accentizer.process_all(text)
                ruaccent_words = re.findall(r"[А-Яа-яЁё+]{3,}", accented_sentence)
            except Exception:
                ruaccent_words = []

        # Reconstruct vowel CTC frames sequence
        ctc_vowel_runs = [r for r in ctc_runs if r["char"].lower() in RU_VOWELS]
        if not ctc_vowel_runs:
            continue

        # Align approximate word order across line vowels
        cursor = 0
        for w_idx, raw_w in enumerate(raw_words):
            low_w = raw_w.lower()
            v_positions = find_vowel_positions(low_w)
            if len(v_positions) < 2:
                cursor += len(v_positions)
                continue

            # Ignore words where text already has ё (unambiguous in Russian unless overridden)
            expected_info = dict_map.get(low_w)
            if not expected_info and mode == "dictionary_only":
                cursor += len(v_positions)
                continue

            if not expected_info and w_idx < len(ruaccent_words):
                _, ord_idx, char_idx = parse_plus_marked_word(ruaccent_words[w_idx])
                if ord_idx >= 0 and ord_idx < len(v_positions):
                    expected_info = {
                        "word": low_w,
                        "vowelOrd": ord_idx,
                        "charIdx": char_idx,
                        "marked": format_word_with_upper_stress(low_w, char_idx),
                        "source": "ruaccent",
                    }

            if not expected_info:
                cursor += len(v_positions)
                continue

            # Match CTC vowel slice if alignment stays consistent
            if cursor + len(v_positions) > len(ctc_vowel_runs):
                break
            word_v_runs = ctc_vowel_runs[cursor:cursor + len(v_positions)]
            cursor += len(v_positions)

            # Verify characters look close enough to avoid shifted-window false positives
            matches_chars = sum(
                1 for k, ch_pos in enumerate(v_positions)
                if word_v_runs[k]["char"].lower() == low_w[ch_pos].replace("ё", "е") or
                   word_v_runs[k]["char"].lower() == low_w[ch_pos]
            )
            if matches_chars < max(1, len(v_positions) - 1):
                continue

            # Measure vowel prominence (RMS dB + log duration bonus)
            prominences = []
            for r in word_v_runs:
                s_i = max(0, int(r["startSec"] * 16000))
                e_i = min(len(dub_audio), int((r["endSec"] + 0.03) * 16000))
                seg = dub_audio[s_i:e_i]
                rms_db = compute_rms_db(seg)
                dur_ms = max(15.0, (r["endSec"] - r["startSec"]) * 1000.0)
                prominences.append(rms_db + 1.8 * math.log10(dur_ms / 40.0))

            exp_ord = expected_info["vowelOrd"]
            if exp_ord >= len(prominences):
                continue

            actual_ord = max(range(len(prominences)), key=lambda idx: prominences[idx])
            if actual_ord != exp_ord:
                diff_db = prominences[actual_ord] - prominences[exp_ord]
                if diff_db >= contrast_thresh_db:
                    actual_char_idx = v_positions[actual_ord]
                    actual_marked = format_word_with_upper_stress(low_w, actual_char_idx)
                    expected_marked = expected_info["marked"]
                    issues.append({
                        "lineId": lid,
                        "type": "stress_error",
                        "severity": "warning" if expected_info["source"] == "dictionary" or diff_db >= (contrast_thresh_db + 2.0) else "info",
                        "title": f"Возможно неверное ударение: «{actual_marked}» вместо «{expected_marked}»",
                        "description": (
                            f"Слог в слове «{raw_w}» выделен сильнее на {diff_db:.1f} дБ "
                            f"(правило: {'Словарь ударений' if expected_info['source'] == 'dictionary' else 'RUAccent'})."
                        ),
                        "stressWord": low_w,
                        "stressExpectedIndex": exp_ord,
                        "stressActualIndex": actual_ord,
                        "stressExpectedMarked": expected_marked,
                        "stressActualMarked": actual_marked,
                        "stressRuleSource": expected_info["source"],
                        "eventOffsetSec": word_v_runs[actual_ord]["startSec"],
                    })
                    break

    if accentizer is not None:
        del accentizer
        gc.collect()


def run_stage3_events_and_emotion(lines: list, settings: dict, profile: str, issues: list, per_line_cache: dict):
    import numpy as np
    import torch

    scan_disfluency = bool(settings.get("scanSpeechDisfluencies", True))
    scan_emotion = bool(settings.get("scanEmotionMismatch", True))
    cross_check_orig = bool(settings.get("disfluencyCrossCheckOriginal", True))
    event_thresh = float(settings.get("disfluencyEventsThreshold", 0.45))
    max_arousal_delta = float(settings.get("emotionMaxArousalDelta", 0.32))
    max_monotony = float(settings.get("emotionMaxPitchMonotonyRatio", 0.55))

    if profile == "fast_diction":
        # Lightweight F0 monotony check only in fast mode
        if scan_emotion:
            for line in lines:
                lid = line["id"]
                f0 = per_line_cache[lid]["f0"]
                orig_f0 = per_line_cache[lid].get("orig_f0")
                if orig_f0 and orig_f0["f0StdHz"] > 20.0 and f0["f0StdHz"] > 1.0:
                    ratio = f0["f0StdHz"] / orig_f0["f0StdHz"]
                    if ratio < max_monotony:
                        issues.append({
                            "lineId": lid,
                            "type": "emotion_mismatch",
                            "severity": "info",
                            "title": "Монотонная интонация по сравнению с оригиналом",
                            "description": (
                                f"Разброс высоты тона (F0 std) даббера: {f0['f0StdHz']:.0f} Гц, "
                                f"оригинал: {orig_f0['f0StdHz']:.0f} Гц."
                            ),
                            "f0StdHz": round(f0["f0StdHz"], 1),
                        })
        return

    # 3A. AST AudioSet for coughs, throat clearing, sighs, laughter, lip smacks
    if scan_disfluency:
        emit_progress(58.0, "Этап 3/4: Поиск кашля, вздохов, смеха и причмокиваний (AST AudioSet)...")
        ast_model = None
        ast_feat = None
        try:
            from transformers import ASTForAudioClassification, ASTFeatureExtractor
            repo_id = "MIT/ast-finetuned-audioset-10-10-0.4593"
            ast_feat = ASTFeatureExtractor.from_pretrained(repo_id)
            ast_model = ASTForAudioClassification.from_pretrained(repo_id)
            ast_model.eval()
        except Exception as e:
            print(f"LOG: AST AudioSet unavailable: {e}", flush=True)

        if ast_model is not None:
            BAD_EVENT_MAP = {
                "cough": "Кашель / покашливание",
                "throat clearing": "Прочистка горла",
                "sneeze": "Чихание",
                "snort": "Шмыганье / хмыканье",
                "sigh": "Лишний вздох",
                "gasp": "Резкий вдох",
                "laughter": "Лишний смешок",
                "giggle": "Лишний смешок",
                "chuckle": "Лишний смешок",
            }
            for line in lines:
                lid = line["id"]
                dub_audio = per_line_cache[lid]["dub_audio"]
                orig_audio = per_line_cache[lid]["orig_audio"]
                if len(dub_audio) < 4000:
                    continue
                try:
                    inputs = ast_feat(dub_audio, sampling_rate=16000, return_tensors="pt")
                    with torch.no_grad():
                        probs = torch.softmax(ast_model(**inputs).logits[0], dim=-1)
                    top_p, top_i = torch.topk(probs, k=5)
                    matched_event = None
                    matched_score = 0.0
                    for score_t, idx_t in zip(top_p.tolist(), top_i.tolist()):
                        label = str(ast_model.config.id2label.get(idx_t, "")).lower()
                        for key, ru_label in BAD_EVENT_MAP.items():
                            if key in label and score_t >= event_thresh:
                                matched_event = (key, ru_label)
                                matched_score = score_t
                                break
                        if matched_event:
                            break

                    if matched_event:
                        # Cross-check with original_vocals if laugh/sigh/gasp is acted intentionally
                        if cross_check_orig and len(orig_audio) > 4000 and matched_event[0] in ("sigh", "gasp", "laughter", "giggle", "chuckle"):
                            o_inputs = ast_feat(orig_audio, sampling_rate=16000, return_tensors="pt")
                            with torch.no_grad():
                                o_probs = torch.softmax(ast_model(**o_inputs).logits[0], dim=-1)
                            o_top_p, o_top_i = torch.topk(o_probs, k=5)
                            orig_has_event = any(
                                any(k in str(ast_model.config.id2label.get(oi, "")).lower() for k in ("sigh", "gasp", "laugh", "giggle", "chuckle", "cry", "sob"))
                                and op >= (event_thresh * 0.65)
                                for op, oi in zip(o_top_p.tolist(), o_top_i.tolist())
                            )
                            if orig_has_event:
                                continue

                        issues.append({
                            "lineId": lid,
                            "type": "speech_disfluency",
                            "severity": "warning",
                            "title": matched_event[1],
                            "description": f"Детектор посторонних речевых звуков зафиксировал «{matched_event[1]}» (уверенность {matched_score * 100:.0f}%).",
                            "disfluencySubtype": matched_event[0],
                            "disfluencyDetails": f"{matched_event[1]} ({matched_score * 100:.0f}%)",
                        })
                except Exception as ast_err:
                    print(f"LOG: AST check failed for line {lid}: {ast_err}", flush=True)

            del ast_model
            del ast_feat
            gc.collect()

    # 3B. Cross-lingual Emotion & Energy matching (MSP-Dim Arousal/Dominance/Valence)
    if scan_emotion:
        emit_progress(72.0, "Этап 3/4: Сравнение эмоций и энергетики оригинал ↔ даббер (MSP-Dim + F0)...")
        emo_model = None
        emo_proc = None
        try:
            from transformers import AutoConfig, Wav2Vec2PreTrainedModel, Wav2Vec2Model, Wav2Vec2Processor
            import torch.nn as nn

            class RegressionHead(nn.Module):
                def __init__(self, config):
                    super().__init__()
                    self.dense = nn.Linear(config.hidden_size, config.hidden_size)
                    self.dropout = nn.Dropout(config.final_dropout)
                    self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

                def forward(self, features, **kwargs):
                    x = self.dropout(features)
                    x = self.dense(x)
                    x = torch.tanh(x)
                    x = self.dropout(x)
                    return self.out_proj(x)

            class EmotionModel(Wav2Vec2PreTrainedModel):
                def __init__(self, config):
                    super().__init__(config)
                    self.config = config
                    self.wav2vec2 = Wav2Vec2Model(config)
                    self.classifier = RegressionHead(config)
                    self.init_weights()

                def forward(self, input_values):
                    outputs = self.wav2vec2(input_values)
                    hidden = torch.mean(outputs[0], dim=1)
                    logits = self.classifier(hidden)
                    return hidden, logits

            repo_id = "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim"
            emo_proc = Wav2Vec2Processor.from_pretrained(repo_id)
            emo_model = EmotionModel.from_pretrained(repo_id)
            emo_model.eval()
        except Exception as e:
            print(f"LOG: MSP-Dim emotion model unavailable: {e}", flush=True)
            emo_model = None

        if emo_model is not None:
            for line in lines:
                lid = line["id"]
                dub_audio = per_line_cache[lid]["dub_audio"]
                orig_audio = per_line_cache[lid]["orig_audio"]
                f0 = per_line_cache[lid]["f0"]
                orig_f0 = per_line_cache[lid].get("orig_f0")

                if len(dub_audio) < 4000:
                    continue
                try:
                    d_in = emo_proc(dub_audio, sampling_rate=16000, return_tensors="pt", padding=True)
                    with torch.no_grad():
                        _, d_logits = emo_model(d_in.input_values)
                    # [arousal, dominance, valence] in ~[0, 1]
                    d_arousal = float(d_logits[0][0].item())
                    d_dom = float(d_logits[0][1].item())
                    d_val = float(d_logits[0][2].item())

                    if len(orig_audio) > 4000:
                        o_in = emo_proc(orig_audio, sampling_rate=16000, return_tensors="pt", padding=True)
                        with torch.no_grad():
                            _, o_logits = emo_model(o_in.input_values)
                        o_arousal = float(o_logits[0][0].item())
                        o_dom = float(o_logits[0][1].item())
                        o_val = float(o_logits[0][2].item())

                        arousal_delta = abs(d_arousal - o_arousal)
                        dom_delta = abs(d_dom - o_dom)
                        if arousal_delta >= max_arousal_delta or dom_delta >= (max_arousal_delta + 0.08):
                            if d_arousal < o_arousal:
                                desc_hint = "Недоигрывание: энергетика/экспрессия ниже оригинала."
                            else:
                                desc_hint = "Переигрывание / излишний напор по сравнению с оригиналом."
                            issues.append({
                                "lineId": lid,
                                "type": "emotion_mismatch",
                                "severity": "warning" if arousal_delta >= (max_arousal_delta + 0.12) else "info",
                                "title": "Расхождение энергетики/эмоций с оригиналом",
                                "description": (
                                    f"{desc_hint} Энергетика (Arousal): даббер {d_arousal:.2f} vs оригинал {o_arousal:.2f} "
                                    f"(порог разницы {max_arousal_delta:.2f})."
                                ),
                                "emotionDubberArousal": round(d_arousal, 2),
                                "emotionOrigArousal": round(o_arousal, 2),
                                "emotionDubberValence": round(d_val, 2),
                                "emotionOrigValence": round(o_val, 2),
                                "f0StdHz": round(f0["f0StdHz"], 1),
                            })
                            continue

                    # Secondary check: Pitch monotony vs original
                    if orig_f0 and orig_f0["f0StdHz"] > 22.0 and f0["f0StdHz"] > 1.0:
                        ratio = f0["f0StdHz"] / orig_f0["f0StdHz"]
                        if ratio < max_monotony:
                            issues.append({
                                "lineId": lid,
                                "type": "emotion_mismatch",
                                "severity": "info",
                                "title": "Сухое / монотонное интонирование",
                                "description": (
                                    f"Интонационный диапазон F0 в {ratio:.2f}x от оригинала "
                                    f"(даббер {f0['f0StdHz']:.0f} Гц, оригинал {orig_f0['f0StdHz']:.0f} Гц)."
                                ),
                                "emotionDubberArousal": round(d_arousal, 2),
                                "f0StdHz": round(f0["f0StdHz"], 1),
                            })
                except Exception as emo_err:
                    print(f"LOG: Emotion compare failed for line {lid}: {emo_err}", flush=True)

            del emo_model
            del emo_proc
            gc.collect()


def run_stage4_persona_and_voice_base(lines: list, profiles: list, voice_base_dir: str, settings: dict, profile: str, issues: list, per_line_cache: dict):
    import numpy as np
    import torch

    if profile == "fast_diction" or not bool(settings.get("scanPersonaMismatch", True)):
        return

    emit_progress(86.0, "Этап 4/4: Проверка возраста, тембра и стабильности голоса персонажа (Age/Gender + ECAPA)...")
    min_voice_sim = float(settings.get("personaMinVoiceSimilarity", 0.68))
    max_age_delta = float(settings.get("personaMaxAgeDeltaYears", 14.0))

    profile_map = {}
    for p in (profiles or []):
        cname = (p.get("characterName") or "").strip().lower()
        if cname:
            profile_map[cname] = p

    AGE_GROUP_CENTERS = {
        "child": 9.0,
        "teen": 16.0,
        "young_adult": 25.0,
        "adult": 36.0,
        "mature": 58.0,
    }

    # Load saved ECAPA embeddings from Voice Base v2 profiles
    saved_ecapa = {}
    if voice_base_dir and os.path.isdir(voice_base_dir):
        for fname in os.listdir(voice_base_dir):
            if fname.endswith(".voice.json") or fname.endswith(".json"):
                cname = fname.replace(".voice.json", "").replace(".json", "").strip().lower()
                try:
                    with open(os.path.join(voice_base_dir, fname), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict) and isinstance(data.get("ecapaEmbedding"), list):
                        saved_ecapa[cname] = data["ecapaEmbedding"]
                except Exception:
                    pass

    # 4A. Age & Gender classification
    ag_model = None
    ag_proc = None
    try:
        from transformers import AutoConfig, Wav2Vec2PreTrainedModel, Wav2Vec2Model, Wav2Vec2Processor
        import torch.nn as nn

        class AgeGenderHead(nn.Module):
            def __init__(self, config):
                super().__init__()
                self.dense = nn.Linear(config.hidden_size, config.hidden_size)
                self.dropout = nn.Dropout(config.final_dropout)
                self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

            def forward(self, features, **kwargs):
                x = self.dropout(features)
                x = self.dense(x)
                x = torch.tanh(x)
                x = self.dropout(x)
                return self.out_proj(x)

        class AgeGenderModel(Wav2Vec2PreTrainedModel):
            def __init__(self, config):
                super().__init__(config)
                self.config = config
                self.wav2vec2 = Wav2Vec2Model(config)
                self.age = AgeGenderHead(config)
                self.gender = AgeGenderHead(config)
                self.init_weights()

            def forward(self, input_values):
                outputs = self.wav2vec2(input_values)
                hidden = torch.mean(outputs[0], dim=1)
                logits_age = self.age(hidden)
                logits_gender = torch.softmax(self.gender(hidden), dim=1)
                return hidden, logits_age, logits_gender

        repo_id = "audeering/wav2vec2-large-robust-24-ft-age-gender"
        ag_proc = Wav2Vec2Processor.from_pretrained(repo_id)
        ag_model = AgeGenderModel.from_pretrained(repo_id)
        ag_model.eval()
    except Exception as e:
        print(f"LOG: Age/Gender model unavailable: {e}", flush=True)
        ag_model = None

    if ag_model is not None:
        for line in lines:
            lid = line["id"]
            char_name = (line.get("character") or "").strip().lower()
            p_cfg = profile_map.get(char_name)
            if not p_cfg:
                continue
            dub_audio = per_line_cache[lid]["dub_audio"]
            f0 = per_line_cache[lid]["f0"]
            if len(dub_audio) < 8000:
                continue
            try:
                inp = ag_proc(dub_audio, sampling_rate=16000, return_tensors="pt", padding=True)
                with torch.no_grad():
                    _, age_logits, gender_probs = ag_model(inp.input_values)
                # age output is scaled [0..1] * 100
                detected_age = max(5.0, min(95.0, float(age_logits[0][0].item()) * 100.0))
                # gender logits: [female, male, child]
                g_idx = int(torch.argmax(gender_probs[0]).item())
                g_labels = ["female", "male", "child"]
                detected_gender = g_labels[g_idx] if g_idx < len(g_labels) else "unknown"
                detected_gender_conf = float(gender_probs[0][g_idx].item())

                expected_age_group = p_cfg.get("ageGroup", "any")
                expected_gender = p_cfg.get("expectedGender", "any")
                f0_min = float(p_cfg.get("targetF0MinHz") or 0)
                f0_max = float(p_cfg.get("targetF0MaxHz") or 0)

                persona_reasons = []
                if expected_age_group in AGE_GROUP_CENTERS:
                    target_age = AGE_GROUP_CENTERS[expected_age_group]
                    if abs(detected_age - target_age) > max_age_delta:
                        persona_reasons.append(f"оценка возраста ~{detected_age:.0f} лет (ожидался профиль {expected_age_group}, ~{target_age:.0f})")

                if expected_gender in ("male", "female") and detected_gender in ("male", "female"):
                    if detected_gender != expected_gender and detected_gender_conf >= 0.72:
                        ru_exp = "мужской" if expected_gender == "male" else "женский"
                        ru_det = "мужской" if detected_gender == "male" else "женский"
                        persona_reasons.append(f"тембр ближе к «{ru_det}» вместо «{ru_exp}» ({detected_gender_conf * 100:.0f}%)")

                if f0_min > 0 and f0["f0MedianHz"] > 0 and f0["f0MedianHz"] < f0_min:
                    persona_reasons.append(f"F0 слишком низкий ({f0['f0MedianHz']:.0f} Гц < {f0_min:.0f} Гц)")
                elif f0_max > 0 and f0["f0MedianHz"] > 0 and f0["f0MedianHz"] > f0_max:
                    persona_reasons.append(f"F0 слишком высокий ({f0['f0MedianHz']:.0f} Гц > {f0_max:.0f} Гц)")

                if persona_reasons:
                    issues.append({
                        "lineId": lid,
                        "type": "persona_mismatch",
                        "severity": "info",
                        "title": "Непопадание в возраст / тембр образа персонажа",
                        "description": "; ".join(persona_reasons).capitalize() + ".",
                        "personaExpectedAgeGroup": expected_age_group,
                        "personaDetectedAgeYears": round(detected_age, 1),
                        "personaDetectedGender": detected_gender,
                    })
            except Exception as ag_err:
                print(f"LOG: Age/gender check failed for line {lid}: {ag_err}", flush=True)

        del ag_model
        del ag_proc
        gc.collect()

    # 4B. ECAPA Speaker Consistency across episode & vs Voice Base
    ecapa_cls = None
    try:
        from speechbrain.inference.speaker import EncoderClassifier
        sb_savedir = get_hf_cache_dir().parent / "speechbrain_ecapa"
        if sb_savedir.exists() and any(sb_savedir.glob("*.ckpt")):
            ecapa_cls = EncoderClassifier.from_hparams(source=str(sb_savedir), savedir=str(sb_savedir))
        else:
            sb_savedir.mkdir(parents=True, exist_ok=True)
            ecapa_cls = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=str(sb_savedir),
            )
    except Exception as e:
        print(f"LOG: SpeechBrain ECAPA unavailable: {e}", flush=True)
        ecapa_cls = None

    if ecapa_cls is not None:
        char_embeddings = {}
        line_embeddings = {}
        for line in lines:
            lid = line["id"]
            cname = (line.get("character") or "").strip().lower()
            dub_audio = per_line_cache[lid]["dub_audio"]
            if len(dub_audio) < 8000 or not cname:
                continue
            try:
                wav_tensor = torch.from_numpy(dub_audio).unsqueeze(0)
                with torch.no_grad():
                    emb = ecapa_cls.encode_batch(wav_tensor).squeeze().cpu().numpy().tolist()
                line_embeddings[lid] = (cname, emb)
                char_embeddings.setdefault(cname, []).append(emb)
            except Exception:
                pass

        # Mean centroid per character in current episode if not in saved Voice Base
        centroids = {}
        for cname, embs in char_embeddings.items():
            if len(embs) >= 2:
                arr = np.mean(np.array(embs, dtype=np.float32), axis=0)
                centroids[cname] = arr.tolist()

        for line in lines:
            lid = line["id"]
            if lid not in line_embeddings:
                continue
            cname, emb = line_embeddings[lid]
            ref_emb = saved_ecapa.get(cname) or centroids.get(cname)
            if not ref_emb:
                continue
            sim = compute_cosine(emb, ref_emb)
            if sim < min_voice_sim:
                src_label = "базой голосов проекта" if cname in saved_ecapa else "другими репликами роли в серии"
                issues.append({
                    "lineId": lid,
                    "type": "persona_mismatch",
                    "severity": "warning" if cname in saved_ecapa else "info",
                    "title": f"Голос «выпал» из образа ({sim * 100:.0f}%)",
                    "description": f"Сходство тембра с {src_label} составило {sim * 100:.0f}% (минимум {min_voice_sim * 100:.0f}%).",
                    "personaVoiceSimilarity": round(sim, 3),
                })

        del ecapa_cls
        gc.collect()


def cmd_analyze(manifest_path: str):
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    lines = manifest.get("lines") or []
    settings = manifest.get("settings") or {}
    stress_dict = manifest.get("stressDictionary") or []
    profiles = manifest.get("characterProfiles") or []
    voice_base_dir = manifest.get("voiceBaseDir") or ""
    profile = str(settings.get("actingResourceProfile", "full_acting") or "full_acting")

    issues = []
    per_line_cache = {}

    if not lines:
        emit_progress(100.0, "Нет реплик для локального актёрского анализа.")
        emit_result({"issues": [], "analyzedLines": 0})
        return

    run_stage1_asr_and_diction(lines, settings, profile, issues, per_line_cache)
    run_stage2_stress(lines, stress_dict, settings, issues, per_line_cache)
    run_stage3_events_and_emotion(lines, settings, profile, issues, per_line_cache)
    run_stage4_persona_and_voice_base(lines, profiles, voice_base_dir, settings, profile, issues, per_line_cache)

    emit_progress(100.0, f"Локальный актёрский анализ завершён ({len(issues)} замечаний).")
    emit_result({"issues": issues, "analyzedLines": len(lines)})


def main():
    parser = argparse.ArgumentParser(description="ADM Local Acting & Diction QA Sidecar")
    parser.add_argument("--mode", required=True, choices=["check_models", "download_models", "analyze"])
    parser.add_argument("--profile", default="full_acting", choices=["fast_diction", "full_acting"])
    parser.add_argument("--manifest", default="")
    args, _ = parser.parse_known_args()

    try:
        if args.mode == "check_models":
            cmd_check_models(args.profile)
        elif args.mode == "download_models":
            cmd_download_models(args.profile)
        elif args.mode == "analyze":
            if not args.manifest or not os.path.exists(args.manifest):
                raise FileNotFoundError(f"Manifest file not found: {args.manifest}")
            cmd_analyze(args.manifest)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
