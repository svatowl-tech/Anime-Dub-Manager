/**
 * Subtitle Frame Extraction & Caching Service
 * Efficiently extracts small thumbnail snapshots of video frames at exact subtitle timings.
 * Features serialized queueing, memory caching, and priority seeking for instant hover previews.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { resolveVideoUrl } from '../../lib/characterPreview/characterMediaManager';

interface FrameTask {
  key: string;
  timeSec: number;
  priority: boolean;
  resolve: (url: string) => void;
  reject: (err: any) => void;
}

class SubtitleFrameService {
  private cache = new Map<string, string>();
  private queue: FrameTask[] = [];
  private isProcessing = false;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private currentVideoPath = '';
  private currentResolvedSrc = '';
  private isReady = false;
  private listeners = new Map<string, Set<(url: string) => void>>();

  // Quantize time to 0.2s for optimal cache hits between overlapping/close subtitles
  public getCacheKey(videoPath: string, timeSec: number): string {
    const quantized = (Math.round(Math.max(0, timeSec) * 5) / 5).toFixed(1);
    return `${videoPath}__t${quantized}`;
  }

  public getCached(videoPath: string, timeSec: number): string | null {
    if (!videoPath) return null;
    const key = this.getCacheKey(videoPath, timeSec);
    return this.cache.get(key) || null;
  }

  private async ensureVideo(videoPath: string): Promise<HTMLVideoElement | null> {
    if (typeof document === 'undefined') return null;

    if (!this.canvasEl) {
      this.canvasEl = document.createElement('canvas');
    }

    if (this.currentVideoPath !== videoPath) {
      this.currentVideoPath = videoPath;
      this.isReady = false;

      if (!this.videoEl) {
        this.videoEl = document.createElement('video');
        this.videoEl.crossOrigin = 'anonymous';
        this.videoEl.muted = true;
        this.videoEl.playsInline = true;
        this.videoEl.preload = 'auto';
        this.videoEl.style.position = 'fixed';
        this.videoEl.style.left = '-9999px';
        this.videoEl.style.top = '-9999px';
        this.videoEl.style.width = '1px';
        this.videoEl.style.height = '1px';
        this.videoEl.style.opacity = '0';
        this.videoEl.style.pointerEvents = 'none';
        document.body.appendChild(this.videoEl);
      }

      try {
        const resolved = await resolveVideoUrl(videoPath);
        this.currentResolvedSrc = resolved;
        this.videoEl.src = resolved;
        this.videoEl.load();

        await new Promise<void>((res) => {
          if (!this.videoEl) return res();
          if (this.videoEl.readyState >= 1) return res();

          const onLoaded = () => {
            this.videoEl?.removeEventListener('loadedmetadata', onLoaded);
            this.videoEl?.removeEventListener('error', onError);
            res();
          };
          const onError = () => {
            this.videoEl?.removeEventListener('loadedmetadata', onLoaded);
            this.videoEl?.removeEventListener('error', onError);
            res();
          };

          this.videoEl.addEventListener('loadedmetadata', onLoaded, { once: true });
          this.videoEl.addEventListener('error', onError, { once: true });
          // Timeout fallback
          setTimeout(res, 3000);
        });

        this.isReady = true;
      } catch (e) {
        console.warn('SubtitleFrameService: Failed to resolve video URL:', e);
      }
    }

    return this.videoEl;
  }

  public async requestFrame(videoPath: string, timeSec: number, priority = false): Promise<string> {
    if (!videoPath) return '';
    const key = this.getCacheKey(videoPath, timeSec);

    // 1. Check memory cache
    const cached = this.cache.get(key);
    if (cached) return cached;

    return new Promise<string>((resolve, reject) => {
      const task: FrameTask = {
        key,
        timeSec: Math.max(0, timeSec),
        priority,
        resolve: (url) => {
          // Notify any subscribers waiting for this exact frame
          const subs = this.listeners.get(key);
          if (subs) {
            subs.forEach((cb) => cb(url));
            this.listeners.delete(key);
          }
          resolve(url);
        },
        reject,
      };

      if (priority) {
        // High priority (e.g. user hover) jumps to the top of the queue
        this.queue.unshift(task);
      } else {
        // Normal priority for table rows
        this.queue.push(task);
      }

      this.processQueue(videoPath);
    });
  }

  public subscribe(key: string, callback: (url: string) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  private async processQueue(videoPath: string) {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;

    try {
      const video = await this.ensureVideo(videoPath);
      if (!video || !this.canvasEl) {
        this.isProcessing = false;
        return;
      }

      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) break;

        // Double check cache before seeking
        if (this.cache.has(task.key)) {
          task.resolve(this.cache.get(task.key)!);
          continue;
        }

        try {
          const snapshot = await this.captureFrameAtTime(video, task.timeSec);
          if (snapshot) {
            this.cache.set(task.key, snapshot);
            task.resolve(snapshot);
          } else {
            task.resolve('');
          }
        } catch (err) {
          task.resolve('');
        }

        // Brief delay (15ms) to give browser rendering room and prevent frame locking
        await new Promise((r) => setTimeout(r, 15));
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.processQueue(videoPath);
      }
    }
  }

  private captureFrameAtTime(video: HTMLVideoElement, timeSec: number): Promise<string> {
    return new Promise<string>((resolve) => {
      if (!this.canvasEl) return resolve('');

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve('');
      }, 1500);

      const handleSeeked = () => {
        cleanup();
        try {
          const canvas = this.canvasEl!;
          // 240x135 gives crisp 16:9 thumbnail quality at only ~8-12 KB payload
          const thumbWidth = 240;
          const thumbHeight = 135;
          canvas.width = thumbWidth;
          canvas.height = thumbHeight;

          const ctx = canvas.getContext('2d', { alpha: false });
          if (ctx && video.videoWidth > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'medium';
            ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            resolve(dataUrl);
          } else {
            resolve('');
          }
        } catch (e) {
          console.warn('captureFrameAtTime canvas error:', e);
          resolve('');
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('seeked', handleSeeked);
      };

      video.addEventListener('seeked', handleSeeked, { once: true });

      try {
        video.currentTime = timeSec;
      } catch (err) {
        cleanup();
        resolve('');
      }
    });
  }

  public clearQueue() {
    this.queue = [];
  }

  public clearCache() {
    this.cache.clear();
    this.queue = [];
  }
}

export const subtitleFrameService = new SubtitleFrameService();

/**
 * React hook for consuming a subtitle line frame.
 * Checks cache first, lazy fetches if missing, and reacts to videoPath changes.
 */
export function useSubtitleFrame(
  videoPath: string | undefined,
  timeSec: number,
  enabled: boolean
) {
  const [frameUrl, setFrameUrl] = useState<string | null>(() => {
    if (!videoPath || !enabled) return null;
    return subtitleFrameService.getCached(videoPath, timeSec);
  });
  const [loading, setLoading] = useState<boolean>(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchFrame = useCallback(
    (priority = false) => {
      if (!videoPath || !enabled || isNaN(timeSec) || timeSec < 0) return;

      const cached = subtitleFrameService.getCached(videoPath, timeSec);
      if (cached) {
        setFrameUrl(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      subtitleFrameService
        .requestFrame(videoPath, timeSec, priority)
        .then((url) => {
          if (isMountedRef.current) {
            setFrameUrl(url || null);
            setLoading(false);
          }
        })
        .catch(() => {
          if (isMountedRef.current) {
            setLoading(false);
          }
        });
    },
    [videoPath, timeSec, enabled]
  );

  useEffect(() => {
    if (!enabled || !videoPath) {
      return;
    }

    const cached = subtitleFrameService.getCached(videoPath, timeSec);
    if (cached) {
      setFrameUrl(cached);
      setLoading(false);
      return;
    }

    fetchFrame(false);
  }, [videoPath, timeSec, enabled, fetchFrame]);

  return {
    frameUrl,
    loading,
    requestPriority: () => fetchFrame(true),
  };
}
