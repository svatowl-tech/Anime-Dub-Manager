export interface VADOptions {
  threshold?: number;
  minSpeechDuration?: number;
  minSilenceDuration?: number;
}

export interface SpeechInterval {
  start: number;
  end: number;
}

export function detectSpeechIntervals(audioBuffer: AudioBuffer, options: VADOptions = {}): SpeechInterval[] {
  const threshold = options.threshold ?? 0.02;
  const minSpeech = options.minSpeechDuration ?? 0.1;
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  
  const intervals: SpeechInterval[] = [];
  let inSpeech = false;
  let startTime = 0;
  
  const chunkSize = Math.floor(sampleRate * 0.05); // 50ms
  for (let i = 0; i < channelData.length; i += chunkSize) {
    let max = 0;
    for (let j = 0; j < chunkSize && i + j < channelData.length; j++) {
      max = Math.max(max, Math.abs(channelData[i + j]));
    }
    const time = i / sampleRate;
    if (max >= threshold) {
      if (!inSpeech) {
        inSpeech = true;
        startTime = time;
      }
    } else {
      if (inSpeech) {
        inSpeech = false;
        if (time - startTime >= minSpeech) {
          intervals.push({ start: startTime, end: time });
        }
      }
    }
  }
  if (inSpeech) {
    intervals.push({ start: startTime, end: channelData.length / sampleRate });
  }
  return intervals;
}
