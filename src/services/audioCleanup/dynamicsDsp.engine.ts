import {
  DePlosiveOptions,
  VocalThickenerOptions,
  HeadroomRecoveryOptions,
  SpeechLevelerOptions
} from './spectralDsp.engine';

/**
 * Профессиональное подавление задувов микрофона и взрывных согласных «п»/«б» (De-Plosive Pro)
 * Реализует Linkwitz-Riley LR4 кроссовер, детекцию асимметрии импульса и динамический VCA аттенюатор.
 */
export async function processDePlosiveDsp(
  inputInterleavedOrMono: Float32Array,
  options: DePlosiveOptions = {},
  onProgress?: (progressPercent: number, statusMessage: string) => void
): Promise<Float32Array> {
  if (!inputInterleavedOrMono || inputInterleavedOrMono.length === 0) {
    return new Float32Array(0);
  }

  const sampleRate = options.sampleRate || 48000;
  const thresholdDb = options.thresholdDb ?? -24;
  const frequencyLimit = Math.max(40, Math.min(350, options.frequencyLimitHz ?? 120));
  const suppressionDepthDb = options.suppressionDepthDb ?? -18;
  const recoveryMs = Math.max(5, options.recoveryMs ?? 35);
  const wetDry = Math.max(0, Math.min(1, (options.wetDryPercent ?? 100) / 100));

  onProgress?.(15, '[De-Plosive Pro] Настройка Linkwitz-Riley кроссовера...');

  const thresholdLinear = Math.pow(10, thresholdDb / 20);
  const maxSuppressionLinear = Math.pow(10, suppressionDepthDb / 20);

  const attackMs = 1.5;
  const attackCoeff = Math.exp(-1.0 / (attackMs * 0.001 * sampleRate));
  const releaseCoeff = Math.exp(-1.0 / (recoveryMs * 0.001 * sampleRate));
  const asymmetryCoeff = Math.exp(-1.0 / (3.0 * 0.001 * sampleRate));

  // Butterworth 2nd order lowpass & highpass coefficients (cascaded = LR4)
  const omega = (2.0 * Math.PI * frequencyLimit) / sampleRate;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const alpha = sinOmega / (2.0 * (1.0 / Math.SQRT2));

  const a0Lp = 1.0 + alpha;
  const invA0Lp = 1.0 / a0Lp;
  const b0Lp = ((1.0 - cosOmega) * 0.5) * invA0Lp;
  const b1Lp = (1.0 - cosOmega) * invA0Lp;
  const b2Lp = b0Lp;
  const a1Lp = (-2.0 * cosOmega) * invA0Lp;
  const a2Lp = (1.0 - alpha) * invA0Lp;

  const a0Hp = 1.0 + alpha;
  const invA0Hp = 1.0 / a0Hp;
  const b0Hp = ((1.0 + cosOmega) * 0.5) * invA0Hp;
  const b1Hp = -(1.0 + cosOmega) * invA0Hp;
  const b2Hp = b0Hp;
  const a1Hp = (-2.0 * cosOmega) * invA0Hp;
  const a2Hp = (1.0 - alpha) * invA0Hp;

  const len = inputInterleavedOrMono.length;
  const out = new Float32Array(len);

  let lpZ1a = 0, lpZ2a = 0, lpZ1b = 0, lpZ2b = 0;
  let hpZ1a = 0, hpZ2a = 0, hpZ1b = 0, hpZ2b = 0;

  let envelopeLow = 0;
  let envelopePos = 0;
  let envelopeNeg = 0;
  let currentAtten = 1.0;

  const reportChunk = Math.max(48000, Math.floor(len / 10));

  for (let i = 0; i < len; i++) {
    const inSample = inputInterleavedOrMono[i];

    // LR4 Lowpass: 2 cascaded Butterworth filters
    const low1 = b0Lp * inSample + lpZ1a;
    lpZ1a = b1Lp * inSample - a1Lp * low1 + lpZ2a;
    lpZ2a = b2Lp * inSample - a2Lp * low1;

    const low = b0Lp * low1 + lpZ1b;
    lpZ1b = b1Lp * low1 - a1Lp * low + lpZ2b;
    lpZ2b = b2Lp * low1 - a2Lp * low;

    // LR4 Highpass: 2 cascaded Butterworth filters
    const high1 = b0Hp * inSample + hpZ1a;
    hpZ1a = b1Hp * inSample - a1Hp * high1 + hpZ2a;
    hpZ2a = b2Hp * inSample - a2Hp * high1;

    const high = b0Hp * high1 + hpZ1b;
    hpZ1b = b1Hp * high1 - a1Hp * high + hpZ2b;
    hpZ2b = b2Hp * high1 - a2Hp * high;

    // Envelope detection on low band
    const absLow = Math.abs(low);
    if (absLow > envelopeLow) {
      envelopeLow = attackCoeff * envelopeLow + (1.0 - attackCoeff) * absLow;
    } else {
      envelopeLow = releaseCoeff * envelopeLow + (1.0 - releaseCoeff) * absLow;
    }

    const posPart = low > 0 ? low : 0;
    const negPart = low < 0 ? -low : 0;
    envelopePos = asymmetryCoeff * envelopePos + (1.0 - asymmetryCoeff) * posPart;
    envelopeNeg = asymmetryCoeff * envelopeNeg + (1.0 - asymmetryCoeff) * negPart;

    const denom = Math.max(envelopePos + envelopeNeg, 1e-6);
    const asymmetry = Math.abs(envelopePos - envelopeNeg) / denom;

    const excess = envelopeLow - thresholdLinear;
    let targetAtten = 1.0;
    if (excess > 0) {
      const asymmetryWeight = 1.0 + 0.5 * asymmetry;
      let ratio = (excess / (envelopeLow + 1e-5)) * asymmetryWeight;
      ratio = Math.max(0, Math.min(1, ratio));
      targetAtten = 1.0 - ratio * (1.0 - maxSuppressionLinear);
    }

    if (targetAtten < currentAtten) {
      currentAtten = attackCoeff * currentAtten + (1.0 - attackCoeff) * targetAtten;
    } else {
      currentAtten = releaseCoeff * currentAtten + (1.0 - releaseCoeff) * targetAtten;
    }

    currentAtten = Math.max(maxSuppressionLinear, Math.min(1.0, currentAtten));

    const wetSignal = low * currentAtten + high;
    out[i] = inSample * (1.0 - wetDry) + wetSignal * wetDry;

    if (i % reportChunk === 0 && onProgress) {
      const pct = 15 + Math.round((i / len) * 80);
      onProgress(pct, `[De-Plosive Pro] Обработка сэмпла ${i}/${len}...`);
    }
  }

  onProgress?.(100, '[De-Plosive Pro] Завершено успешно');
  return out;
}

/**
 * Профессиональное уплотнение и добавление теплоты речи (Vocal Thickener & Tape Sat)
 * Генерация четных субгармоник Чебышёва (120-250 Гц), ВЧ эксайтер (3-6 кГц) и ленточная сатурация с Auto-Gain Match.
 */
export async function processVocalThickenerDsp(
  inputInterleavedOrMono: Float32Array,
  options: VocalThickenerOptions = {},
  onProgress?: (progressPercent: number, statusMessage: string) => void
): Promise<Float32Array> {
  if (!inputInterleavedOrMono || inputInterleavedOrMono.length === 0) {
    return new Float32Array(0);
  }

  const sampleRate = options.sampleRate || 48000;
  const bodyDrive = Math.max(0, Math.min(1, (options.bodyDrivePercent ?? 50) / 100));
  const presenceClarity = Math.max(0, Math.min(1, (options.presenceClarityPercent ?? 40) / 100));
  const tapeDensity = Math.max(0, Math.min(1, (options.tapeDensityPercent ?? 45) / 100));
  const mix = Math.max(0, Math.min(1, (options.mixPercent ?? 100) / 100));

  onProgress?.(15, '[Vocal Thickener] Синтез субгармоник Чебышёва и ленточной сатурации...');

  // 1. Highpass 110 Hz & Lowpass 280 Hz for body extraction
  const omegaHp = (2.0 * Math.PI * 110.0) / sampleRate;
  const sinHp = Math.sin(omegaHp);
  const cosHp = Math.cos(omegaHp);
  const alphaHp = sinHp / (2.0 * (1.0 / Math.SQRT2));
  const a0Hp = 1.0 + alphaHp;
  const invA0Hp = 1.0 / a0Hp;
  const b0Hp = ((1.0 + cosHp) * 0.5) * invA0Hp;
  const b1Hp = -(1.0 + cosHp) * invA0Hp;
  const b2Hp = b0Hp;
  const a1Hp = (-2.0 * cosHp) * invA0Hp;
  const a2Hp = (1.0 - alphaHp) * invA0Hp;

  const omegaLp = (2.0 * Math.PI * 280.0) / sampleRate;
  const sinLp = Math.sin(omegaLp);
  const cosLp = Math.cos(omegaLp);
  const alphaLp = sinLp / (2.0 * (1.0 / Math.SQRT2));
  const a0Lp = 1.0 + alphaLp;
  const invA0Lp = 1.0 / a0Lp;
  const b0Lp = ((1.0 - cosLp) * 0.5) * invA0Lp;
  const b1Lp = (1.0 - cosLp) * invA0Lp;
  const b2Lp = b0Lp;
  const a1Lp = (-2.0 * cosLp) * invA0Lp;
  const a2Lp = (1.0 - alphaLp) * invA0Lp;

  // 2. Highpass 3800 Hz for presence exciter
  const omegaPres = (2.0 * Math.PI * 3800.0) / sampleRate;
  const sinPres = Math.sin(omegaPres);
  const cosPres = Math.cos(omegaPres);
  const alphaPres = sinPres / (2.0 * (1.0 / Math.SQRT2));
  const a0Pres = 1.0 + alphaPres;
  const invA0Pres = 1.0 / a0Pres;
  const b0Pres = ((1.0 + cosPres) * 0.5) * invA0Pres;
  const b1Pres = -(1.0 + cosPres) * invA0Pres;
  const b2Pres = b0Pres;
  const a1Pres = (-2.0 * cosPres) * invA0Pres;
  const a2Pres = (1.0 - alphaPres) * invA0Pres;

  // 3. DC Blocker Highpass 25 Hz
  const omegaDc = (2.0 * Math.PI * 25.0) / sampleRate;
  const sinDc = Math.sin(omegaDc);
  const cosDc = Math.cos(omegaDc);
  const alphaDc = sinDc / (2.0 * (1.0 / Math.SQRT2));
  const a0Dc = 1.0 + alphaDc;
  const invA0Dc = 1.0 / a0Dc;
  const b0Dc = ((1.0 + cosDc) * 0.5) * invA0Dc;
  const b1Dc = -(1.0 + cosDc) * invA0Dc;
  const b2Dc = b0Dc;
  const a1Dc = (-2.0 * cosDc) * invA0Dc;
  const a2Dc = (1.0 - alphaDc) * invA0Dc;

  let z1Hp = 0, z2Hp = 0, z1Lp = 0, z2Lp = 0;
  let z1Pres = 0, z2Pres = 0;
  let z1Dc = 0, z2Dc = 0;

  let rmsIn = 0.01;
  let rmsOut = 0.01;
  let autoGain = 1.0;

  const len = inputInterleavedOrMono.length;
  const out = new Float32Array(len);
  const reportChunk = Math.max(48000, Math.floor(len / 10));

  for (let i = 0; i < len; i++) {
    const inSample = inputInterleavedOrMono[i];

    // Body band extraction
    const hpOut = b0Hp * inSample + z1Hp;
    z1Hp = b1Hp * inSample - a1Hp * hpOut + z2Hp;
    z2Hp = b2Hp * inSample - a2Hp * hpOut;

    const bodyBand = b0Lp * hpOut + z1Lp;
    z1Lp = b1Lp * hpOut - a1Lp * bodyBand + z2Lp;
    z2Lp = b2Lp * hpOut - a2Lp * bodyBand;

    // Chebyshev harmonics: T2(x) = 2x^2 - 1, T3(x) = 4x^3 - 3x
    const x = Math.max(-1.0, Math.min(1.0, bodyBand * 2.5));
    const t2 = 2.0 * x * x - 1.0;
    const t3 = 4.0 * x * x * x - 3.0 * x;
    const rawGen = 0.75 * t2 + 0.25 * t3;

    // DC blocking
    const bodyGen = b0Dc * rawGen + z1Dc;
    z1Dc = b1Dc * rawGen - a1Dc * bodyGen + z2Dc;
    z2Dc = b2Dc * rawGen - a2Dc * bodyGen;

    // Presence exciter
    const presHp = b0Pres * inSample + z1Pres;
    z1Pres = b1Pres * inSample - a1Pres * presHp + z2Pres;
    z2Pres = b2Pres * inSample - a2Pres * presHp;

    const presX = Math.max(-2.0, Math.min(2.0, presHp * 2.0));
    const presGen = Math.tanh(1.6 * presX) + 0.2 * (presX * presX);

    // Summation
    const thickened = inSample + bodyGen * (bodyDrive * 0.45) + presGen * (presenceClarity * 0.35);

    // Tape saturation
    const tapeGain = 1.0 + tapeDensity * 3.5;
    const tapeX = thickened * tapeGain;
    const sat = tapeX >= 0 ? Math.tanh(tapeX) : Math.tanh(1.1 * tapeX) * 0.909;

    // Auto-gain matching
    const inAbs = Math.abs(inSample) + 1e-5;
    const outAbs = Math.abs(sat) + 1e-5;
    rmsIn = 0.999 * rmsIn + 0.001 * inAbs;
    rmsOut = 0.999 * rmsOut + 0.001 * outAbs;
    const targetGain = Math.max(0.35, Math.min(1.0, rmsIn / Math.max(rmsOut, 1e-5)));
    autoGain = 0.998 * autoGain + 0.002 * targetGain;

    const levelMatched = sat * autoGain;
    out[i] = inSample * (1.0 - mix) + levelMatched * mix;

    if (i % reportChunk === 0 && onProgress) {
      const pct = 15 + Math.round((i / len) * 80);
      onProgress(pct, `[Vocal Thickener] Обработка сэмпла ${i}/${len}...`);
    }
  }

  onProgress?.(100, '[Vocal Thickener] Завершено успешно');
  return out;
}

/**
 * Безопасный разгон тихих записей и восстановление запаса громкости (Headroom Recovery & Gain)
 * Быстрое сканирование True Peak и RMS, расчет безопасного гейна до targetPeakDb с защитой maxBoostDb.
 */
export async function processHeadroomRecoveryDsp(
  inputInterleavedOrMono: Float32Array,
  options: HeadroomRecoveryOptions = {},
  onProgress?: (progressPercent: number, statusMessage: string) => void
): Promise<Float32Array> {
  if (!inputInterleavedOrMono || inputInterleavedOrMono.length === 0) {
    return new Float32Array(0);
  }

  const sampleRate = options.sampleRate || 48000;
  const targetPeakDb = options.targetPeakDb ?? -6.0;
  const maxBoostDb = options.maxBoostDb ?? 36.0;
  const manualGainDb = options.manualGainDb ?? 0.0;
  const autoHeadroom = options.autoHeadroom !== false;
  const lookaheadMs = options.lookaheadMs ?? 3.0;
  const mix = Math.max(0, Math.min(1, (options.mixPercent ?? 100) / 100));

  onProgress?.(15, '[Headroom Recovery] Анализ пиковых уровней True Peak и RMS...');

  const len = inputInterleavedOrMono.length;
  let peakAbs = 0.0;
  let sumSq = 0.0;

  for (let i = 0; i < len; i++) {
    const absVal = Math.abs(inputInterleavedOrMono[i]);
    if (absVal > peakAbs) peakAbs = absVal;
    sumSq += absVal * absVal;
  }

  const rmsLinear = Math.sqrt(sumSq / Math.max(1, len));
  const peakDb = peakAbs > 1e-6 ? 20.0 * Math.log10(peakAbs) : -120.0;
  const rmsDb = rmsLinear > 1e-6 ? 20.0 * Math.log10(rmsLinear) : -120.0;

  let targetGainDb = 0.0;
  if (autoHeadroom) {
    if (peakAbs > 1e-5) {
      const diffDb = targetPeakDb - peakDb;
      targetGainDb = Math.min(diffDb, maxBoostDb);
      if (targetGainDb < 0.0) targetGainDb = 0.0; // Не ослабляем автоматически, только разгоняем
    } else {
      targetGainDb = 0.0; // Тишина / пустой шум
    }
  }

  targetGainDb += manualGainDb;
  const finalGainLinear = Math.pow(10.0, targetGainDb / 20.0);

  onProgress?.(
    45,
    `[Headroom Recovery] Peak: ${peakDb.toFixed(1)} dBFS, RMS: ${rmsDb.toFixed(1)} dBFS → Усиление: +${targetGainDb.toFixed(1)} dB`
  );

  // Lookahead Ring Buffer для предотвращения клиппинга
  const lookaheadSamples = Math.max(1, Math.min(1024, Math.round((lookaheadMs * 0.001) * sampleRate)));
  const delayBuffer = new Float32Array(lookaheadSamples);
  let delayIdx = 0;

  const out = new Float32Array(len);
  const attackCoeff = Math.exp(-1.0 / (0.5 * 0.001 * sampleRate));
  const releaseCoeff = Math.exp(-1.0 / (50.0 * 0.001 * sampleRate));
  let limiterGain = 1.0;
  const ceilingLinear = Math.pow(10.0, -0.1 / 20.0); // -0.1 dBFS brickwall ceiling

  const reportChunk = Math.max(48000, Math.floor(len / 10));

  for (let i = 0; i < len; i++) {
    const inSample = inputInterleavedOrMono[i];
    const boostedSample = inSample * finalGainLinear;

    // Оценка опережающего пика
    const absBoosted = Math.abs(boostedSample);
    let targetLimGain = 1.0;
    if (absBoosted > ceilingLinear) {
      targetLimGain = ceilingLinear / absBoosted;
    }

    if (targetLimGain < limiterGain) {
      limiterGain = attackCoeff * limiterGain + (1.0 - attackCoeff) * targetLimGain;
    } else {
      limiterGain = releaseCoeff * limiterGain + (1.0 - releaseCoeff) * targetLimGain;
    }

    // Считываем из линии задержки
    const delayed = delayBuffer[delayIdx];
    delayBuffer[delayIdx] = boostedSample;
    delayIdx = (delayIdx + 1) % lookaheadSamples;

    const processed = delayed * limiterGain;
    out[i] = inSample * (1.0 - mix) + processed * mix;

    if (i % reportChunk === 0 && onProgress) {
      const pct = 45 + Math.round((i / len) * 50);
      onProgress(pct, `[Headroom Recovery] Обработка кадра ${i}/${len}...`);
    }
  }

  onProgress?.(100, `[Headroom Recovery] Завершено. Разгон: +${targetGainDb.toFixed(1)} dB.`);
  return out;
}

/**
 * Автоматическое двухступенчатое выравнивание громкости речи (Speech Dynamic Leveler)
 * Ступень 1: Медленный RMS авто-фейдер (250-500 мс) с Gate Freeze в паузах.
 * Ступень 2: Быстрый Soft-Knee пиковый лимитер выкриков и всплесков.
 */
export async function processSpeechLevelerDsp(
  inputInterleavedOrMono: Float32Array,
  options: SpeechLevelerOptions = {},
  onProgress?: (progressPercent: number, statusMessage: string) => void
): Promise<Float32Array> {
  if (!inputInterleavedOrMono || inputInterleavedOrMono.length === 0) {
    return new Float32Array(0);
  }

  const sampleRate = options.sampleRate || 48000;
  const targetLevelDb = options.targetLevelDb ?? -18.0;
  const levelingSpeedMs = options.levelingSpeedMs ?? 300.0;
  const maxBoostDb = options.maxBoostDb ?? 12.0;
  const maxCutDb = options.maxCutDb ?? -18.0;
  const silenceGateDb = options.silenceGateDb ?? -45.0;
  const peakCeilingDb = options.peakCeilingDb ?? -2.0;
  const mix = Math.max(0, Math.min(1, (options.mixPercent ?? 100) / 100));

  onProgress?.(15, '[Speech Leveler] Инициализация RMS детектора и авто-фейдера...');

  const len = inputInterleavedOrMono.length;
  const out = new Float32Array(len);

  const rmsWindowSec = 0.080;
  const rmsSmoothCoeff = Math.exp(-1.0 / (rmsWindowSec * sampleRate));
  const speedSec = Math.max(0.020, levelingSpeedMs * 0.001);
  const levelerSpeedCoeff = Math.exp(-1.0 / (speedSec * sampleRate));

  const limiterAttackCoeff = Math.exp(-1.0 / (0.0010 * sampleRate));
  const limiterReleaseCoeff = Math.exp(-1.0 / (0.0450 * sampleRate));
  const ceilingLinear = Math.pow(10.0, peakCeilingDb / 20.0);

  let rmsDetector = 0.0001;
  let currentLevelerGainLinear = 1.0;
  let currentLevelerGainDb = 0.0;
  let limiterEnvelope = 0.0;

  const reportChunk = Math.max(48000, Math.floor(len / 10));

  for (let i = 0; i < len; i++) {
    const inSample = inputInterleavedOrMono[i];
    const inSq = inSample * inSample;

    // 1. RMS сглаживание
    rmsDetector = rmsSmoothCoeff * rmsDetector + (1.0 - rmsSmoothCoeff) * inSq;
    const currentRms = Math.sqrt(Math.max(rmsDetector, 1e-12));
    const rmsDb = 20.0 * Math.log10(currentRms);

    // Ступень 1: Авто-фейдер со скользящей заморозкой
    let targetGainDb = 0.0;
    if (rmsDb >= silenceGateDb) {
      const diffDb = targetLevelDb - rmsDb;
      targetGainDb = Math.max(maxCutDb, Math.min(maxBoostDb, diffDb));
    } else {
      // Пауза: заморозка
      targetGainDb = currentLevelerGainDb * 0.9999;
    }

    const targetGainLinear = Math.pow(10.0, targetGainDb / 20.0);
    currentLevelerGainLinear = levelerSpeedCoeff * currentLevelerGainLinear + (1.0 - levelerSpeedCoeff) * targetGainLinear;
    currentLevelerGainDb = 20.0 * Math.log10(Math.max(currentLevelerGainLinear, 1e-4));

    const leveledSample = inSample * currentLevelerGainLinear;

    // Ступень 2: Fast Peak Limiter
    const absLeveled = Math.abs(leveledSample);
    if (absLeveled > limiterEnvelope) {
      limiterEnvelope = limiterAttackCoeff * limiterEnvelope + (1.0 - limiterAttackCoeff) * absLeveled;
    } else {
      limiterEnvelope = limiterReleaseCoeff * limiterEnvelope + (1.0 - limiterReleaseCoeff) * absLeveled;
    }

    let limGain = 1.0;
    if (limiterEnvelope > ceilingLinear) {
      const overDb = 20.0 * Math.log10(limiterEnvelope / ceilingLinear);
      const compressedOverDb = overDb / (1.0 + overDb * 0.25);
      const compressedLinear = ceilingLinear * Math.pow(10.0, compressedOverDb / 20.0);
      limGain = Math.min(1.0, compressedLinear / (limiterEnvelope + 1e-6));
    }

    const wet = leveledSample * limGain;
    out[i] = inSample * (1.0 - mix) + wet * mix;

    if (i % reportChunk === 0 && onProgress) {
      const pct = 15 + Math.round((i / len) * 80);
      onProgress(pct, `[Speech Leveler] Выравнивание сэмпла ${i}/${len} (RMS: ${rmsDb.toFixed(1)} dBFS)...`);
    }
  }

  onProgress?.(100, '[Speech Leveler] Выравнивание громкости речи успешно завершено.');
  return out;
}
