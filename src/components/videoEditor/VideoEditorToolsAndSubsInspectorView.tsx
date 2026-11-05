import React from 'react';
import {
  Scissors,
  Film,
  Image as ImageIcon,
  Plus,
  Trash2,
  AlertCircle,
  Clock,
  Loader2,
  SkipBack,
  Maximize2
} from 'lucide-react';
import { Episode } from '../../types';
import {
  CutSegment,
  InsertedVideoItem,
  InsertedImageItem,
  OverlayImageItem,
  formatTimeSec,
  parseTimeInput
} from './useVideoEditorController';

export interface VideoEditorToolsAndSubsInspectorViewProps {
  currentEpisode: Episode;
  activeSection: 'trim-cut' | 'images' | 'videos' | 'subs';
  setActiveSection: React.Dispatch<React.SetStateAction<'trim-cut' | 'images' | 'videos' | 'subs'>>;
  trimStartSec: number;
  setTrimStartSec: React.Dispatch<React.SetStateAction<number>>;
  trimEndSec: number;
  setTrimEndSec: React.Dispatch<React.SetStateAction<number>>;
  trimStartInput: string;
  setTrimStartInput: React.Dispatch<React.SetStateAction<string>>;
  trimEndInput: string;
  setTrimEndInput: React.Dispatch<React.SetStateAction<string>>;
  sourceDuration: number;
  currentTime: number;
  cuts: CutSegment[];
  setCuts: React.Dispatch<React.SetStateAction<CutSegment[]>>;
  draftCutStart: number;
  setDraftCutStart: React.Dispatch<React.SetStateAction<number>>;
  draftCutEnd: number;
  setDraftCutEnd: React.Dispatch<React.SetStateAction<number>>;
  draftCutLabel: string;
  setDraftCutLabel: React.Dispatch<React.SetStateAction<string>>;
  startImages: InsertedImageItem[];
  setStartImages: React.Dispatch<React.SetStateAction<InsertedImageItem[]>>;
  midImages: InsertedImageItem[];
  setMidImages: React.Dispatch<React.SetStateAction<InsertedImageItem[]>>;
  endImages: InsertedImageItem[];
  setEndImages: React.Dispatch<React.SetStateAction<InsertedImageItem[]>>;
  overlayImages: OverlayImageItem[];
  setOverlayImages: React.Dispatch<React.SetStateAction<OverlayImageItem[]>>;
  introVideos: InsertedVideoItem[];
  setIntroVideos: React.Dispatch<React.SetStateAction<InsertedVideoItem[]>>;
  outroVideos: InsertedVideoItem[];
  setOutroVideos: React.Dispatch<React.SetStateAction<InsertedVideoItem[]>>;
  subPreview: any;
  isPreviewLoading: boolean;
  seekTo: (sec: number) => void;
  handleSetTrimStartFromPlayer: () => void;
  handleSetTrimEndFromPlayer: () => void;
  handleResetTrim: () => void;
  handleAddCutSegment: (presetStart?: number, presetEnd?: number, presetLabel?: string) => void;
  handlePickInsertedImage: (role: 'start' | 'middle' | 'end') => Promise<void>;
  handlePickOverlayImage: () => Promise<void>;
  handlePickExternalVideo: (role: 'intro' | 'outro') => Promise<void>;
  children?: React.ReactNode;
}

export function VideoEditorToolsAndSubsInspectorView({
  activeSection,
  setActiveSection,
  trimStartSec,
  setTrimStartSec,
  trimEndSec,
  setTrimEndSec,
  trimStartInput,
  setTrimStartInput,
  trimEndInput,
  setTrimEndInput,
  sourceDuration,
  currentTime,
  cuts,
  setCuts,
  draftCutStart,
  setDraftCutStart,
  draftCutEnd,
  setDraftCutEnd,
  draftCutLabel,
  setDraftCutLabel,
  startImages,
  setStartImages,
  midImages,
  setMidImages,
  endImages,
  setEndImages,
  overlayImages,
  setOverlayImages,
  introVideos,
  setIntroVideos,
  outroVideos,
  setOutroVideos,
  subPreview,
  seekTo,
  handleSetTrimStartFromPlayer,
  handleSetTrimEndFromPlayer,
  handleResetTrim,
  handleAddCutSegment,
  handlePickInsertedImage,
  handlePickOverlayImage,
  handlePickExternalVideo,
  children
}: VideoEditorToolsAndSubsInspectorViewProps) {
  return (
    <div className="xl:col-span-5 space-y-4">
      {/* Sub-navigation tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-neutral-900 p-1.5 rounded-2xl border border-neutral-800">
        <button
          onClick={() => setActiveSection('trim-cut')}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'trim-cut'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
          }`}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Подрезка</span>
          {(trimStartSec > 0.02 ||
            (trimEndSec > 0 && trimEndSec < sourceDuration - 0.02) ||
            cuts.length > 0) && (
            <span className="w-2 h-2 rounded-full bg-rose-400" />
          )}
        </button>

        <button
          onClick={() => setActiveSection('images')}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'images'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Картинки</span>
          {startImages.length + midImages.length + endImages.length + overlayImages.length > 0 && (
            <span className="px-1.5 rounded-full bg-cyan-500/30 text-cyan-200 text-[10px]">
              {startImages.length + midImages.length + endImages.length + overlayImages.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSection('videos')}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'videos'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Интро/Аутро</span>
          {introVideos.length + outroVideos.length > 0 && (
            <span className="px-1.5 rounded-full bg-amber-500/30 text-amber-200 text-[10px]">
              {introVideos.length + outroVideos.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSection('subs')}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'subs'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Субтитры</span>
          {subPreview?.shiftedLines > 0 && (
            <span className="px-1.5 rounded-full bg-emerald-500/30 text-emerald-200 text-[10px]">
              {subPreview.shiftedLines}
            </span>
          )}
        </button>
      </div>

      {/* SECTION 1: TRIM & CUT */}
      {activeSection === 'trim-cut' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
          {/* Trim Start and End */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <SkipBack className="w-4 h-4 text-amber-400" />
                Подрезать начало и конец видео
              </h3>
              {(trimStartSec > 0.02 || (trimEndSec > 0 && trimEndSec < sourceDuration - 0.02)) && (
                <button
                  onClick={handleResetTrim}
                  className="text-xs text-neutral-400 hover:text-white underline"
                >
                  Сбросить подрезку
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-400">
              Прямое копирование потоков (<code className="text-indigo-300">-c copy</code>) без перекодирования и потери качества.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Trim Start */}
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                <label className="text-xs font-medium text-neutral-300 block">
                  Начало видео (отрезать всё ДО):
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={trimStartInput}
                    onChange={(e) => setTrimStartInput(e.target.value)}
                    onBlur={() => {
                      const parsed = parseTimeInput(trimStartInput);
                      if (parsed !== null && parsed < (trimEndSec || sourceDuration)) {
                        setTrimStartSec(parsed);
                        setTrimStartInput(formatTimeSec(parsed));
                      } else {
                        setTrimStartInput(formatTimeSec(trimStartSec));
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                    placeholder="00:00.00"
                  />
                  <button
                    onClick={handleSetTrimStartFromPlayer}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs whitespace-nowrap"
                    title="Взять текущее время плеера"
                  >
                    Из плеера
                  </button>
                </div>
              </div>

              {/* Trim End */}
              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                <label className="text-xs font-medium text-neutral-300 block">
                  Конец видео (отрезать всё ПОСЛЕ):
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={trimEndInput}
                    onChange={(e) => setTrimEndInput(e.target.value)}
                    onBlur={() => {
                      const parsed = parseTimeInput(trimEndInput);
                      if (parsed !== null && parsed > trimStartSec && parsed <= sourceDuration) {
                        setTrimEndSec(parsed);
                        setTrimEndInput(formatTimeSec(parsed));
                      } else {
                        setTrimEndInput(formatTimeSec(trimEndSec || sourceDuration));
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                    placeholder="24:00.00"
                  />
                  <button
                    onClick={handleSetTrimEndFromPlayer}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs whitespace-nowrap"
                    title="Взять текущее время плеера"
                  >
                    Из плеера
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Cut Arbitrary Ranges */}
          <div className="space-y-3 pt-4 border-t border-neutral-800">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Scissors className="w-4 h-4 text-rose-400" />
              Вырезать фрагмент (из начала, середины или конца)
            </h3>
            <p className="text-xs text-neutral-400">
              Укажите интервал <span className="text-neutral-200">[От — До]</span>, который нужно вырезать. Все субтитры после вырезки автоматически сдвинутся назад на длительность вырезанного куска.
            </p>

            <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-neutral-400 block mb-1">Вырезать ОТ (сек / ММ:СС):</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max={sourceDuration || 36000}
                      value={draftCutStart}
                      onChange={(e) => setDraftCutStart(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => setDraftCutStart(Number(currentTime.toFixed(2)))}
                      className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 shrink-0"
                      title="Взять текущее время плеера"
                    >
                      Плеер
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-neutral-400 block mb-1">Вырезать ДО (сек / ММ:СС):</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max={sourceDuration || 36000}
                      value={draftCutEnd}
                      onChange={(e) => setDraftCutEnd(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => setDraftCutEnd(Number(currentTime.toFixed(2)))}
                      className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 shrink-0"
                      title="Взять текущее время плеера"
                    >
                      Плеер
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draftCutLabel}
                  onChange={(e) => setDraftCutLabel(e.target.value)}
                  placeholder="Название (напр. Реклама / Заставка / Повтор)"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                />
                <button
                  onClick={() => handleAddCutSegment()}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить вырезку</span>
                </button>
              </div>
            </div>

            {/* List of Cut Segments */}
            {cuts.length > 0 && (
              <div className="space-y-2">
                {cuts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-950/25 border border-rose-500/30 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        onChange={(e) =>
                          setCuts((prev) =>
                            prev.map((item) => (item.id === c.id ? { ...item, enabled: e.target.checked } : item))
                          )
                        }
                        className="rounded border-neutral-600"
                      />
                      <div>
                        <div className="font-semibold text-rose-200">{c.label}</div>
                        <div className="font-mono text-[11px] text-neutral-400">
                          {formatTimeSec(c.startSec)} — {formatTimeSec(c.endSec)} (минус {(c.endSec - c.startSec).toFixed(2)}с)
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => seekTo(c.startSec)}
                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px]"
                      >
                        Перейти
                      </button>
                      <button
                        onClick={() => setCuts((prev) => prev.filter((item) => item.id !== c.id))}
                        className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 2: IMAGES (START / MIDDLE / END / OVERLAY) */}
      {activeSection === 'images' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
          {/* Insert Image as Video Segment (Start / Middle / End) */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-cyan-400" />
              Вставка картинки как участка видео (раздвигает субтитры)
            </h3>
            <p className="text-xs text-neutral-400">
              Добавляет изображение в начало, в выбранную точку посередине или в конец видео. Субтитры после вставленной картинки автоматически сдвигаются вперед на её длительность.
            </p>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handlePickInsertedImage('start')}
                className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>В начало</span>
              </button>

              <button
                onClick={() => handlePickInsertedImage('middle')}
                className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>В середину ({formatTimeSec(currentTime)})</span>
              </button>

              <button
                onClick={() => handlePickInsertedImage('end')}
                className="px-3 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 text-xs font-semibold flex flex-col items-center gap-1 transition-colors"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>В конец</span>
              </button>
            </div>

            {/* List of Start / Middle / End Images */}
            {[...startImages, ...midImages, ...endImages].length > 0 && (
              <div className="space-y-2 pt-2">
                {[
                  ...startImages.map((x) => ({ ...x, listType: 'start' as const })),
                  ...midImages.map((x) => ({ ...x, listType: 'middle' as const })),
                  ...endImages.map((x) => ({ ...x, listType: 'end' as const }))
                ].map((img) => {
                  const updateItem = (patch: Partial<InsertedImageItem>) => {
                    const setter =
                      img.listType === 'start'
                        ? setStartImages
                        : img.listType === 'middle'
                        ? setMidImages
                        : setEndImages;
                    setter((prev) => prev.map((it) => (it.id === img.id ? { ...it, ...patch } : it)));
                  };
                  const removeItem = () => {
                    const setter =
                      img.listType === 'start'
                        ? setStartImages
                        : img.listType === 'middle'
                        ? setMidImages
                        : setEndImages;
                    setter((prev) => prev.filter((it) => it.id !== img.id));
                  };

                  return (
                    <div
                      key={img.id}
                      className="p-2.5 rounded-xl bg-neutral-950 border border-cyan-500/30 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {img.previewUrl && (
                          <img
                            src={img.previewUrl}
                            alt={img.name}
                            className="w-10 h-10 rounded object-cover border border-neutral-700 shrink-0"
                          />
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="font-semibold text-white truncate flex items-center gap-1.5">
                            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[10px] uppercase">
                              {img.listType === 'start'
                                ? 'В начале'
                                : img.listType === 'middle'
                                ? 'Посередине'
                                : 'В конце'}
                            </span>
                            <span className="truncate">{img.name}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="text-[11px] text-neutral-400 flex items-center gap-1">
                              Длит. (сек):
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="120"
                                value={img.durationSec}
                                onChange={(e) =>
                                  updateItem({ durationSec: Math.max(0.5, parseFloat(e.target.value) || 3) })
                                }
                                className="w-16 px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                              />
                            </label>
                            {img.listType === 'middle' && (
                              <label className="text-[11px] text-neutral-400 flex items-center gap-1">
                                Таймкод (сек):
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  max={sourceDuration || 36000}
                                  value={img.insertAtOriginalSec || 0}
                                  onChange={(e) =>
                                    updateItem({
                                      insertAtOriginalSec: Math.max(0, parseFloat(e.target.value) || 0)
                                    })
                                  }
                                  className="w-20 px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                                />
                                <button
                                  onClick={() => updateItem({ insertAtOriginalSec: Number(currentTime.toFixed(2)) })}
                                  className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] text-cyan-300"
                                >
                                  Плеер
                                </button>
                              </label>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={removeItem}
                        className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Overlay Image on Top of Video */}
          <div className="space-y-3 pt-4 border-t border-neutral-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-purple-400" />
                Наложить картинку ПОВЕРХ видео (Overlay)
              </h3>
              <button
                onClick={handlePickOverlayImage}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить поверх</span>
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              Накладывает картинку (плашку, логотип, мем, цензуру) поверх видео в заданном интервале времени без изменения длительности серии.
            </p>

            {overlayImages.length > 0 && (
              <div className="space-y-3">
                {overlayImages.map((ov) => {
                  const updateOv = (patch: Partial<OverlayImageItem>) => {
                    setOverlayImages((prev) =>
                      prev.map((item) => (item.id === ov.id ? { ...item, ...patch } : item))
                    );
                  };

                  return (
                    <div
                      key={ov.id}
                      className="p-3 rounded-xl bg-neutral-950 border border-purple-500/30 space-y-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {ov.previewUrl && (
                            <img
                              src={ov.previewUrl}
                              alt={ov.name}
                              className="w-9 h-9 rounded object-contain bg-black border border-neutral-700"
                            />
                          )}
                          <span className="font-semibold text-purple-200 truncate">{ov.name}</span>
                        </div>
                        <button
                          onClick={() => setOverlayImages((prev) => prev.filter((item) => item.id !== ov.id))}
                          className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-neutral-400">
                          Показать ОТ (сек):
                          <div className="flex items-center gap-1 mt-0.5">
                            <input
                              type="number"
                              step="0.2"
                              value={ov.startSec}
                              onChange={(e) => updateOv({ startSec: Math.max(0, parseFloat(e.target.value) || 0) })}
                              className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                            />
                            <button
                              onClick={() => updateOv({ startSec: Number(currentTime.toFixed(2)) })}
                              className="px-2 py-1 rounded bg-neutral-800 text-[10px] text-neutral-300"
                            >
                              Плеер
                            </button>
                          </div>
                        </label>

                        <label className="text-[11px] text-neutral-400">
                          Показать ДО (сек):
                          <div className="flex items-center gap-1 mt-0.5">
                            <input
                              type="number"
                              step="0.2"
                              value={ov.endSec}
                              onChange={(e) => updateOv({ endSec: Math.max(0, parseFloat(e.target.value) || 0) })}
                              className="w-full px-2 py-1 rounded bg-neutral-900 border border-neutral-700 font-mono text-white"
                            />
                            <button
                              onClick={() => updateOv({ endSec: Number(currentTime.toFixed(2)) })}
                              className="px-2 py-1 rounded bg-neutral-800 text-[10px] text-neutral-300"
                            >
                              Плеер
                            </button>
                          </div>
                        </label>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <label className="text-[11px] text-neutral-400">
                          Позиция X ({ov.xPercent}%):
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={ov.xPercent}
                            onChange={(e) => updateOv({ xPercent: Number(e.target.value) })}
                            className="w-full accent-purple-500 mt-1"
                          />
                        </label>
                        <label className="text-[11px] text-neutral-400">
                          Позиция Y ({ov.yPercent}%):
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={ov.yPercent}
                            onChange={(e) => updateOv({ yPercent: Number(e.target.value) })}
                            className="w-full accent-purple-500 mt-1"
                          />
                        </label>
                        <label className="text-[11px] text-neutral-400">
                          Размер ({ov.widthPercent}%):
                          <input
                            type="range"
                            min="5"
                            max="100"
                            value={ov.widthPercent}
                            onChange={(e) => updateOv({ widthPercent: Number(e.target.value) })}
                            className="w-full accent-purple-500 mt-1"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: EXTERNAL VIDEOS (INTRO / OUTRO) */}
      {activeSection === 'videos' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-5 shadow-lg">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Film className="w-4 h-4 text-amber-400" />
              Добавить стороннее видео в начало (Интро) или в конец (Аутро)
            </h3>
            <p className="text-xs text-neutral-400">
              Позволяет прикрепить интро студии или дисклеймер перед серией (автоматически сдвинет все субтитры вперед на длительность интро) и/или аутро в конец серии. Основное видео серии копируется напрямую (<code className="text-indigo-300">-c copy</code>).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => handlePickExternalVideo('intro')}
                className="p-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4 text-amber-400" />
                <span>Добавить видео в НАЧАЛО</span>
              </button>

              <button
                onClick={() => handlePickExternalVideo('outro')}
                className="p-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4 text-amber-400" />
                <span>Добавить видео в КОНЕЦ</span>
              </button>
            </div>

            {/* Intro Videos List */}
            {introVideos.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-amber-300">Видео в начале (сдвигают субтитры вперед):</div>
                {introVideos.map((v) => (
                  <div
                    key={v.id}
                    className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{v.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">
                        Длительность: +{v.durationSec.toFixed(2)}с {v.width ? `• ${v.width}×${v.height}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setIntroVideos((prev) => prev.filter((item) => item.id !== v.id))}
                      className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Outro Videos List */}
            {outroVideos.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-amber-300">Видео в конце (после завершения серии):</div>
                {outroVideos.map((v) => (
                  <div
                    key={v.id}
                    className="p-2.5 rounded-xl bg-neutral-950 border border-amber-500/30 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{v.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">
                        Длительность: +{v.durationSec.toFixed(2)}с {v.width ? `• ${v.width}×${v.height}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setOutroVideos((prev) => prev.filter((item) => item.id !== v.id))}
                      className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
