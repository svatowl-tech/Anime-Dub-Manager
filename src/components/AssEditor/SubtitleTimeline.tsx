import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ZoomIn, ZoomOut, Play, Pause, AlertCircle, ArrowLeftRight, Loader2, Edit3 } from 'lucide-react';
import { ipcSafe } from '../../lib/ipcSafe';

interface RawSubtitleLine {
  id?: number;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  style: string;
  name: string;
  text: string;
  rawLineIndex: number;
}

interface SubtitleTimelineProps {
  rawPath?: string;
  lines: RawSubtitleLine[];
  updates: Record<number, { name?: string; text?: string; start?: string; end?: string; }>;
  activeLineIndex: number | null;
  currentTime: number;
  totalDuration: number;
  onUpdateLine: (rawLineIndex: number, update: { start?: string; end?: string; }) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  isPlaying: boolean;
  onSelectLine: (rawLineIndex: number) => void;
  onDrawLine?: (startSec: number, endSec: number) => void;
  secondsToAssTime: (secs: number) => string;
  parseAssTimeToSeconds: (timeStr: string) => number;
}

export default function SubtitleTimeline({
  rawPath,
  lines,
  updates,
  activeLineIndex,
  currentTime,
  totalDuration,
  onUpdateLine,
  onSeek,
  onPlayPause,
  isPlaying,
  onSelectLine,
  onDrawLine,
  secondsToAssTime,
  parseAssTimeToSeconds
}: SubtitleTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom factor: pixels per second
  const [zoom, setZoom] = useState<number>(60);
  
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [drawStartSec, setDrawStartSec] = useState<number | null>(null);
  const [drawCurrentSec, setDrawCurrentSec] = useState<number | null>(null);
  
  const [activeDrag, setActiveDrag] = useState<{
    rawLineIndex: number;
    type: 'move' | 'resize-left' | 'resize-right';
    initialStartSec: number;
    initialEndSec: number;
    startX: number;
  } | null>(null);

  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null);

  // Compute actual timing for all lines (applying current unsaved updates)
  const resolvedLines = useMemo(() => {
    return lines.map(line => {
      const u = updates[line.rawLineIndex] || {};
      const start = u.start !== undefined ? parseAssTimeToSeconds(u.start) : line.startSec;
      const end = u.end !== undefined ? parseAssTimeToSeconds(u.end) : line.endSec;
      return {
        ...line,
        currentStartSec: start,
        currentEndSec: end,
        duration: end - start
      };
    });
  }, [lines, updates, parseAssTimeToSeconds]);

  // Width of the timeline canvas based on duration and zoom
  const timelineWidth = useMemo(() => {
    return Math.max(1200, totalDuration * zoom);
  }, [totalDuration, zoom]);

  // Track scroll position and visible container width to render only the active window (supports infinite limits)
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(1200);

  // Render only lines that overlap with the visible viewport + extra cushion buffer (massively boost scroll & slide FPS)
  const visibleLines = useMemo(() => {
    const minSec = scrollLeft / zoom;
    const maxSec = (scrollLeft + containerWidth) / zoom;
    const buffer = 45; // seconds cushion
    
    return resolvedLines.filter(line => {
      // Always show active line, dragged line to preserve interactions perfectly
      if (line.rawLineIndex === activeLineIndex || (activeDrag && line.rawLineIndex === activeDrag.rawLineIndex)) {
        return true;
      }
      const start = line.currentStartSec;
      const end = line.currentEndSec;
      return (end >= minSec - buffer) && (start <= maxSec + buffer);
    });
  }, [resolvedLines, scrollLeft, containerWidth, zoom, activeLineIndex, activeDrag]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      setScrollLeft(scroller.scrollLeft);
    };

    const handleResize = () => {
      setContainerWidth(scroller.clientWidth);
    };

    setScrollLeft(scroller.scrollLeft);
    setContainerWidth(scroller.clientWidth);

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width || scroller.clientWidth);
      }
    });
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  const [audioPeaksData, setAudioPeaksData] = useState<{ peaks: number[], duration: number, isExtracting: boolean }>({ peaks: [], duration: 0, isExtracting: false });

  // Fetch real audio peaks
  useEffect(() => {
    if (!rawPath) return;

    let isMounted = true;
    const fetchPeaks = async () => {
      setAudioPeaksData(prev => ({ ...prev, isExtracting: true }));
      try {
        const pps = 10;
        const cleanPath = rawPath.startsWith('file://') ? rawPath.substring(7) : rawPath;
        const result = await ipcSafe.invoke('extract-audio-peaks', { videoPath: cleanPath, pointsPerSecond: pps });
        if (isMounted && result && result.length) {
          const duration = result.length / pps;
          setAudioPeaksData({ peaks: result, duration, isExtracting: false });
        } else if (isMounted) {
           setAudioPeaksData(prev => ({ ...prev, isExtracting: false }));
        }
      } catch (err) {
        console.error('Failed to extract audio peaks:', err);
        if (isMounted) setAudioPeaksData(prev => ({ ...prev, isExtracting: false }));
      }
    };

    fetchPeaks();

    return () => { isMounted = false; };
  }, [rawPath]);

  // Handle timeline ruler and waveform painting for only the visible window
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Direct pixel ratios for crisp canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = 70 * dpr;
    ctx.scale(dpr, dpr);

    const width = containerWidth;
    const height = 70;

    // Clear background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Draw secondary grid lines (every 1 second) and main ruler labels (every 5 or 10 seconds)
    const gridStepSec = zoom < 25 ? 10 : zoom < 60 ? 5 : 1;
    ctx.lineWidth = 1;

    // Determine min and max seconds currently visible
    const minSec = Math.floor(scrollLeft / zoom);
    const maxSec = Math.ceil((scrollLeft + containerWidth) / zoom);

    // Align grid starting point to step
    const startGridSec = Math.floor(minSec / gridStepSec) * gridStepSec;

    for (let xSec = startGridSec; xSec <= Math.min(totalDuration || maxSec, maxSec); xSec += gridStepSec) {
      const absoluteX = xSec * zoom;
      const xPos = absoluteX - scrollLeft; // Relative to the canvas viewport!

      if (xPos < -20 || xPos > width + 20) continue;

      const isMajor = xSec % (gridStepSec * 5) === 0 || gridStepSec === 1 && xSec % 5 === 0;

      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(xPos, 0);
      ctx.lineTo(xPos, height);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#737373';
        ctx.font = '9px monospace';
        const label = `${Math.floor(xSec / 60).toString().padStart(2, '0')}:${Math.floor(xSec % 60).toString().padStart(2, '0')}${zoom > 100 ? "." + Math.floor((xSec % 1) * 10) : ''}`;
        ctx.fillText(label, xPos + 4, 12);
      }
    }

    // Draw Waveform peaks
    if (audioPeaksData && audioPeaksData.peaks.length > 0) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'; // blue-500 equivalent color
      const peaks = audioPeaksData.peaks;
      const duration = audioPeaksData.duration;
      const numPoints = peaks.length;
      
      const startIdx = Math.max(0, Math.floor((minSec / duration) * numPoints));
      const endIdx = Math.min(numPoints - 1, Math.ceil((maxSec / duration) * numPoints));
      
      const peakHeight = 55; // Fit within the wave container area height
      const bottomY = height;
      
      for (let i = startIdx; i <= endIdx; i++) {
        const timeAtPeak = (i / numPoints) * duration;
        const xPos = (timeAtPeak * zoom) - scrollLeft;
        
        if (xPos < -5 || xPos > width + 5) continue;
        
        const peakValue = peaks[i] * peakHeight;
        
        ctx.fillRect(xPos - 1, bottomY - peakValue, 2, peakValue);
      }
    }
  }, [containerWidth, scrollLeft, totalDuration, zoom, audioPeaksData]);

  // Center scroll container on current video playhead
  const scrollToPlayhead = useCallback(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const playheadX = currentTime * zoom;
    const viewWidth = scroller.clientWidth;
    const halfView = viewWidth / 2;

    scroller.scrollTo({
      left: playheadX - halfView,
      behavior: 'smooth'
    });
  }, [currentTime, zoom]);

  // Auto scroll to active line
  useEffect(() => {
    if (activeLineIndex !== null) {
      const activeLine = resolvedLines.find(l => l.rawLineIndex === activeLineIndex);
      if (activeLine) {
        const scroller = scrollContainerRef.current;
        if (scroller) {
          const startX = activeLine.currentStartSec * zoom;
          const endX = activeLine.currentEndSec * zoom;
          const leftBound = scroller.scrollLeft;
          const rightBound = leftBound + scroller.clientWidth;

          // If active subtitle box is partially or fully out of current visibility, scroll to it
          if (startX < leftBound || endX > rightBound) {
            scroller.scrollTo({
              left: startX - 80,
              behavior: 'smooth'
            });
          }
        }
      }
    }
  }, [activeLineIndex, resolvedLines, zoom]);

  // Handle zooming via buttons
  const handleZoomIn = () => setZoom(z => Math.min(250, z + 15));
  const handleZoomOut = () => setZoom(z => Math.max(20, z - 15));

  // Click on Timeline background to Seek
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Avoid triggering seek if dragging dialog boxes or resizing
    if (activeDrag) return;
    
    // Target might be an existing subtitle box; ensure we only draw on the background
    if ((e.target as HTMLElement).closest('.subtitle-block')) return;

    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    const rect = scroller.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scroller.scrollLeft;
    const targetTimeSec = Math.max(0, Math.min(totalDuration, clickX / zoom));

    if (isDrawingMode) {
      setDrawStartSec(targetTimeSec);
      setDrawCurrentSec(targetTimeSec);
    } else {
      onSeek(targetTimeSec);
    }
  };

  // Mouse Move Drag Listener (document level to safeguard sliding outside components)
  useEffect(() => {
    if (!activeDrag && drawStartSec === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (activeDrag) {
        const dx = e.clientX - activeDrag.startX;
        const dt = dx / zoom;

        let newStart = activeDrag.initialStartSec;
        let newEnd = activeDrag.initialEndSec;

        if (activeDrag.type === 'move') {
          newStart = Math.max(0, activeDrag.initialStartSec + dt);
          const duration = activeDrag.initialEndSec - activeDrag.initialStartSec;
          newEnd = newStart + duration;
        } else if (activeDrag.type === 'resize-left') {
          newStart = Math.max(0, Math.min(activeDrag.initialEndSec - 0.05, activeDrag.initialStartSec + dt));
        } else if (activeDrag.type === 'resize-right') {
          newEnd = Math.max(activeDrag.initialStartSec + 0.05, activeDrag.initialEndSec + dt);
        }

        onUpdateLine(activeDrag.rawLineIndex, {
          start: secondsToAssTime(newStart),
          end: secondsToAssTime(newEnd)
        });
      } else if (drawStartSec !== null) {
        const scroller = scrollContainerRef.current;
        if (!scroller) return;
        const rect = scroller.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scroller.scrollLeft;
        const targetTimeSec = Math.max(0, Math.min(totalDuration, mouseX / zoom));
        setDrawCurrentSec(targetTimeSec);
      }
    };

    const handleMouseUp = () => {
      if (activeDrag) {
        setActiveDrag(null);
      } else if (drawStartSec !== null && drawCurrentSec !== null) {
        if (Math.abs(drawCurrentSec - drawStartSec) > 0.1 && onDrawLine) {
          const start = Math.min(drawStartSec, drawCurrentSec);
          const end = Math.max(drawStartSec, drawCurrentSec);
          onDrawLine(start, end);
        }
        setDrawStartSec(null);
        setDrawCurrentSec(null);
        setIsDrawingMode(false);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, zoom, onUpdateLine, secondsToAssTime, drawStartSec, drawCurrentSec, onDrawLine, totalDuration]);

  // Initiate dragging handle
  const startDrag = (
    e: React.MouseEvent,
    rowId: number,
    type: 'move' | 'resize-left' | 'resize-right',
    startSec: number,
    endSec: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveDrag({
      rawLineIndex: rowId,
      type,
      initialStartSec: startSec,
      initialEndSec: endSec,
      startX: e.clientX
    });
    onSelectLine(rowId);
  };

  return (
    <div className="w-full bg-neutral-950 border-t border-neutral-800 p-2 shrink-0 flex flex-col select-none">
      {/* Top Slider and Controls HUD */}
      <div className="flex items-center justify-between px-2 pb-1.5 border-b border-neutral-900 mb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onPlayPause}
            className="p-1 px-3 bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 border border-neutral-700 hover:border-neutral-600 rounded-lg text-xs text-white transition-all flex items-center gap-1.5 shadow"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5 text-blue-400" />
                <span className="font-medium">Пауза</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium">Воспроизвести</span>
              </>
            )}
          </button>

          <div className="text-xs text-neutral-400 font-mono flex items-center gap-1">
            <span className="text-neutral-500">Время:</span>
            <span className="text-blue-400 font-bold bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
              {currentTime.toFixed(2)}s
            </span>
            <span className="text-neutral-600">/</span>
            <span className="text-neutral-500 bg-neutral-900/50 px-1.5 py-0.5 rounded">
              {totalDuration.toFixed(2)}s
            </span>
          </div>
        </div>

        {/* Tip */}
        <div className="hidden lg:flex items-center gap-1 text-[10px] text-neutral-500">
          <ArrowLeftRight className="w-3 h-3 text-indigo-400" />
          <span>Перетащите края блока для подгона секунд, или тело блока целиком</span>
        </div>

        {/* Zoom Controls Slider & Buttons */}
        <div className="flex items-center gap-4">
          {onDrawLine && (
            <button
              onClick={() => setIsDrawingMode(prev => !prev)}
              className={`text-[10px] px-2 py-1 flex items-center gap-1 border rounded transition-colors ${
                isDrawingMode
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800'
              }`}
              title="Режим рисования новой реплики прямо на таймлайне"
            >
              <Edit3 className="w-3 h-3" />
              Рисовать реплику
            </button>
          )}

          <div className="flex items-center gap-1 text-xs text-neutral-400">
            <span className="text-neutral-500 text-[10px]">Масштаб:</span>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 20}
              className="p-1 hover:bg-neutral-800 border border-transparent hover:border-neutral-700 disabled:opacity-30 rounded text-neutral-300"
              title="Отдалить"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min="20"
              max="250"
              value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value, 10))}
              className="w-20 md:w-32 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 250}
              className="p-1 hover:bg-neutral-800 border border-transparent hover:border-neutral-700 disabled:opacity-30 rounded text-neutral-300"
              title="Приблизить"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={scrollToPlayhead}
            className="text-[10px] bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800 text-neutral-400 px-2 py-1 rounded transition-colors"
            title="Отцентрировать таймлайн на текущей позиции воспроизведения"
          >
            В центp
          </button>
        </div>
      </div>

      {/* Main Horizontal Scrollable Timeline Workspace */}
      <div
        ref={scrollContainerRef}
        className="scroll-container w-full overflow-x-auto relative rounded-lg border border-neutral-900"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#262626 #030303'
        }}
        onMouseDown={handleTimelineMouseDown}
      >
        <div
          className={`relative select-none ${isDrawingMode ? 'cursor-crosshair' : ''}`}
          style={{ width: `${timelineWidth}px`, height: '145px' }}
        >
          {/* Waveform track with secondary grid (Ruler built-in) */}
          <div className="w-full h-[70px] relative overflow-hidden bg-[#0a0a0a]">
            {audioPeaksData.isExtracting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 text-xs text-neutral-400 gap-2 pointer-events-none">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Извлечение аудиоволны...
              </div>
            )}
            {/* Grid markings & Ruler labels on top */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 bottom-0 h-full block z-10 pointer-events-none"
              style={{ left: `${scrollLeft}px`, width: `${containerWidth}px` }}
            />
          </div>

          {/* Subtitles Track (layers parallel under waves) */}
          <div className="w-full h-[75px] bg-[#070707] relative border-t border-neutral-900 p-1.5 overflow-hidden">
            {drawStartSec !== null && drawCurrentSec !== null && (
              <div
                className="absolute h-[24px] rounded-md border border-emerald-500 bg-emerald-500/30 text-white z-30 flex items-center px-2 shadow-[0_0_10px_rgba(16,185,129,0.3)] pointer-events-none transition-none"
                style={{
                  left: `${Math.min(drawStartSec, drawCurrentSec) * zoom}px`,
                  width: `${Math.max(1, Math.abs(drawCurrentSec - drawStartSec) * zoom)}px`,
                  top: '6px'
                }}
              >
                <span className="text-[9px] font-mono whitespace-nowrap">
                  Новая реплика ({Math.abs(drawCurrentSec - drawStartSec).toFixed(2)}s)
                </span>
              </div>
            )}
            {visibleLines.map((line) => {
              const isSelected = activeLineIndex === line.rawLineIndex;
              const isHovered = hoveredLineId === line.rawLineIndex;
              
              const startX = line.currentStartSec * zoom;
              const width = Math.max(8, line.duration * zoom);
              
              // Keep row placement stable using index in full list
              const globalIdx = resolvedLines.indexOf(line);

              // If block is off-screen entirely during layout, do paint it to support drags but style lightweight
              return (
                <div
                  key={line.rawLineIndex}
                  onMouseEnter={() => setHoveredLineId(line.rawLineIndex)}
                  onMouseLeave={() => setHoveredLineId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLine(line.rawLineIndex);
                  }}
                  className={`subtitle-block absolute h-[24px] rounded-md border text-[10px] font-sans flex items-center justify-between transition-colors select-none overflow-visible group ${
                    isSelected
                      ? 'bg-indigo-600/30 border-indigo-500 shadow-lg shadow-indigo-500/10 text-white z-20 font-medium'
                      : isHovered
                      ? 'bg-neutral-800/80 border-neutral-600 text-neutral-100 z-10 cursor-grab'
                      : 'bg-neutral-900/90 border-[#1f1f1f] text-neutral-300'
                  }`}
                  style={{
                    left: `${startX}px`,
                    width: `${width}px`,
                    // Cascade overlapping subtitles visually by odd/even row height placement
                    top: `${(globalIdx % 2) * 28 + 6}px`,
                    boxShadow: isSelected ? '0 0 10px rgba(99, 102, 241, 0.4)' : undefined
                  }}
                >
                  {/* Left Resize Handle (Col-Resize Cursor) */}
                  <div
                    onMouseDown={(e) =>
                      startDrag(
                        e,
                        line.rawLineIndex,
                        'resize-left',
                        line.currentStartSec,
                        line.currentEndSec
                      )
                    }
                    className="absolute left-0 top-0 bottom-0 w-2 hover:bg-neutral-400/50 cursor-col-resize rounded-l-md transition-colors"
                  />

                  {/* Text Label Container */}
                  <div
                    onMouseDown={(e) =>
                      startDrag(
                        e,
                        line.rawLineIndex,
                        'move',
                        line.currentStartSec,
                        line.currentEndSec
                      )
                    }
                    className="flex-1 h-full flex items-center px-2.5 truncate cursor-grab active:cursor-grabbing select-none"
                  >
                    <span className="font-mono text-[9px] font-bold text-indigo-400 mr-1 shrink-0">
                      [{line.name || '?'}]
                    </span>
                    <span className="truncate">{line.text || '(Пустая реплика)'}</span>
                  </div>

                  {/* Hover Realtime Timings Tip */}
                  {(isHovered || isSelected || activeDrag?.rawLineIndex === line.rawLineIndex) && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-black text-[9px] text-neutral-200 px-1.5 py-0.5 rounded border border-neutral-800 shadow pointer-events-none z-30 font-mono whitespace-nowrap flex gap-1">
                      <span className="text-emerald-400">{line.currentStartSec.toFixed(2)}s</span>
                      <span className="text-neutral-500">-</span>
                      <span className="text-red-400">{line.currentEndSec.toFixed(2)}s</span>
                      <span className="text-neutral-400">({line.duration.toFixed(2)}s)</span>
                    </div>
                  )}

                  {/* Right Resize Handle (Col-Resize Cursor) */}
                  <div
                    onMouseDown={(e) =>
                      startDrag(
                        e,
                        line.rawLineIndex,
                        'resize-right',
                        line.currentStartSec,
                        line.currentEndSec
                      )
                    }
                    className="absolute right-0 top-0 bottom-0 w-2 hover:bg-neutral-400/50 cursor-col-resize rounded-r-md transition-colors"
                  />
                </div>
              );
            })}
          </div>

          {/* Time Sync Playhead cursor line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_#ef4444] pointer-events-none z-30 flex items-center justify-center"
            style={{ left: `${currentTime * zoom}px` }}
          >
            {/* Tiny playhead triangle handle on ruler level */}
            <div className="absolute top-0 w-3 h-3 bg-red-500 rotate-45 -translate-y-1.5 rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
