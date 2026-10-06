/**
 * ============================================================================
 * NATIVE DAW BRIDGE & HIGH-PERFORMANCE DSP ENGINE
 * ============================================================================
 * Предоставляет высокопроизводительный тракт аудио-обработки:
 * - Управление динамической памятью Float32Array / WASM Heap Arena
 * - Нативный NoiseGate In-Place с мягкой огибающей атаки и спада
 * - Нативный De-Esser In-Place с разделением полос сибилянтов и динамическим VCA
 */

export class NativeDAWBridge {
  private static instance: NativeDAWBridge;

  private heapCapacity = 16 * 1024 * 1024; // 16M Float32 elements = 64 MB Arena
  private heapBuffer: ArrayBuffer;
  private heapF32: Float32Array;
  private allocatedBlocks: Map<number, number> = new Map(); // ptr -> byteLength
  private nextFreeOffset = 8; // align offset

  private constructor() {
    this.heapBuffer = new ArrayBuffer(this.heapCapacity * Float32Array.BYTES_PER_ELEMENT);
    this.heapF32 = new Float32Array(this.heapBuffer);
  }

  public static getInstance(): NativeDAWBridge {
    if (!NativeDAWBridge.instance) {
      NativeDAWBridge.instance = new NativeDAWBridge();
    }
    return NativeDAWBridge.instance;
  }

  public getModule(): { HEAPF32: Float32Array } {
    return { HEAPF32: this.heapF32 };
  }

  /**
   * Выделение блока памяти в Float32 Heap Arena
   */
  public allocateFloats(count: number): number {
    const bytesNeeded = count * Float32Array.BYTES_PER_ELEMENT;
    if (this.nextFreeOffset + count >= this.heapCapacity) {
      // Re-allocate or reset arena if exhausted
      this.nextFreeOffset = 8;
    }

    const elementOffset = this.nextFreeOffset;
    const ptr = elementOffset * Float32Array.BYTES_PER_ELEMENT;
    this.nextFreeOffset += count;
    this.allocatedBlocks.set(ptr, bytesNeeded);
    return ptr;
  }

  /**
   * Запись Float32 данных напрямую в память
   */
  public writeFloat32Direct(buffer: Float32Array): number {
    const ptr = this.allocateFloats(buffer.length);
    const elementOffset = ptr >> 2;
    this.heapF32.set(buffer, elementOffset);
    return ptr;
  }

  /**
   * Чтение Float32 данных из памяти
   */
  public readFloat32Direct(ptr: number, length: number): Float32Array {
    const elementOffset = ptr >> 2;
    return new Float32Array(this.heapF32.subarray(elementOffset, elementOffset + length));
  }

  /**
   * Освобождение выделенного блока памяти
   */
  public freeFloats(ptr: number): void {
    if (this.allocatedBlocks.has(ptr)) {
      this.allocatedBlocks.delete(ptr);
    }
    if (this.allocatedBlocks.size === 0) {
      this.nextFreeOffset = 8;
    }
  }

  /**
   * Высокоскоростной NoiseGate In-Place DSP фильтр
   */
  public applyNoiseGateInPlace(
    pcm: Float32Array,
    thresholdDb: number,
    floorDb: number,
    attackMs: number,
    releaseMs: number,
    sampleRate: number
  ): void {
    const len = pcm.length;
    if (len === 0) return;

    const thresholdLinear = Math.pow(10, thresholdDb / 20);
    const floorLinear = Math.pow(10, floorDb / 20);

    const attackCoeff = Math.exp(-1.0 / (Math.max(0.5, attackMs) * 0.001 * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (Math.max(5.0, releaseMs) * 0.001 * sampleRate));

    let envelope = 0.0;
    let gain = 1.0;

    for (let i = 0; i < len; i++) {
      const input = pcm[i];
      const absIn = Math.abs(input);

      if (absIn > envelope) {
        envelope = attackCoeff * envelope + (1.0 - attackCoeff) * absIn;
      } else {
        envelope = releaseCoeff * envelope + (1.0 - releaseCoeff) * absIn;
      }

      let targetGain = 1.0;
      if (envelope < thresholdLinear) {
        const ratio = envelope / (thresholdLinear + 1e-6);
        targetGain = floorLinear + (1.0 - floorLinear) * (ratio * ratio);
      }

      if (targetGain > gain) {
        gain = attackCoeff * gain + (1.0 - attackCoeff) * targetGain;
      } else {
        gain = releaseCoeff * gain + (1.0 - releaseCoeff) * targetGain;
      }

      pcm[i] = input * gain;
    }
  }

  /**
   * Высокоскоростной De-Esser In-Place DSP фильтр
   */
  public applyDeEsserInPlace(
    pcm: Float32Array,
    thresholdDb: number,
    frequencyHz: number,
    ratio: number,
    attackMs: number,
    releaseMs: number,
    sampleRate: number
  ): void {
    const len = pcm.length;
    if (len === 0) return;

    const thresholdLinear = Math.pow(10, thresholdDb / 20);
    const attackCoeff = Math.exp(-1.0 / (Math.max(0.2, attackMs) * 0.001 * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (Math.max(2.0, releaseMs) * 0.001 * sampleRate));

    // Biquad Bandpass фильтр для изоляции сибилянтов (5.5 - 9.5 кГц)
    const omega = (2.0 * Math.PI * Math.min(frequencyHz, sampleRate * 0.45)) / sampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2.0 * 2.0); // Q = 2.0
    const a0 = 1.0 + alpha;
    const invA0 = 1.0 / a0;

    const b0 = (sinOmega * 0.5) * invA0;
    const b2 = -(sinOmega * 0.5) * invA0;
    const a1 = (-2.0 * cosOmega) * invA0;
    const a2 = (1.0 - alpha) * invA0;

    let z1 = 0;
    let z2 = 0;
    let sibilanceEnvelope = 0.0;
    let compressionGain = 1.0;

    for (let i = 0; i < len; i++) {
      const inSample = pcm[i];

      // Выделение полосы сибилянтов
      const sibilance = b0 * inSample + z1;
      z1 = -a1 * sibilance + z2;
      z2 = b2 * inSample - a2 * sibilance;

      const absSib = Math.abs(sibilance);
      if (absSib > sibilanceEnvelope) {
        sibilanceEnvelope = attackCoeff * sibilanceEnvelope + (1.0 - attackCoeff) * absSib;
      } else {
        sibilanceEnvelope = releaseCoeff * sibilanceEnvelope + (1.0 - releaseCoeff) * absSib;
      }

      let targetGain = 1.0;
      if (sibilanceEnvelope > thresholdLinear) {
        const excessDb = 20.0 * Math.log10(sibilanceEnvelope / thresholdLinear);
        const reductionDb = excessDb * (1.0 - 1.0 / Math.max(1.0, ratio));
        targetGain = Math.pow(10.0, -reductionDb / 20.0);
      }

      if (targetGain < compressionGain) {
        compressionGain = attackCoeff * compressionGain + (1.0 - attackCoeff) * targetGain;
      } else {
        compressionGain = releaseCoeff * compressionGain + (1.0 - releaseCoeff) * targetGain;
      }

      // Применяем компрессию динамически к сибилянтной составляющей
      const attenuatedSibilance = sibilance * compressionGain;
      pcm[i] = inSample - sibilance + attenuatedSibilance;
    }
  }
}

export const globalNativeDAWBridge = NativeDAWBridge.getInstance();
