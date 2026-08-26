import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Download, LayoutTemplate, Image as ImageIcon, Sparkles, Palette, Type, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Episode } from '../types';
import { CoverSettings, DEFAULT_COVER_SETTINGS } from '../lib/cover/coverTypes';
import { renderCoverToCanvas } from '../lib/cover/coverDrawing';
import {
  fileToDataUrl,
  loadImageFromDataUrl,
  parseCoverSettings,
  saveProjectCoverSettings,
  getSavedWatermark,
  saveWatermark,
  removeSavedWatermark,
} from '../lib/cover/coverStorage';
import { CoverTabImages } from './cover/CoverTabImages';
import { CoverTabText } from './cover/CoverTabText';
import { CoverTabEffects } from './cover/CoverTabEffects';
import { CoverTabBacking } from './cover/CoverTabBacking';
import { CoverTabLogo } from './cover/CoverTabLogo';

interface CoverGeneratorProps {
  currentEpisode: Episode | null;
  onRefresh?: () => void;
}

export default function CoverGenerator({ currentEpisode, onRefresh }: CoverGeneratorProps) {
  // Active Tab
  const [activeTab, setActiveTab] = useState<'images' | 'text' | 'effects' | 'backing' | 'logo'>('images');

  // Images state
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [watermarkImage, setWatermarkImage] = useState<HTMLImageElement | null>(null);

  // Title and Episode texts
  const [title, setTitle] = useState(currentEpisode?.project?.title || 'ТАЙТЛ');
  const [episodeNumber, setEpisodeNumber] = useState(currentEpisode ? `${currentEpisode.number} серия` : '1 серия');

  // Typography Settings
  const [fontFamily, setFontFamily] = useState(DEFAULT_COVER_SETTINGS.fontFamily);
  const [titleSize, setTitleSize] = useState(DEFAULT_COVER_SETTINGS.titleSize);
  const [episodeSize, setEpisodeSize] = useState(DEFAULT_COVER_SETTINGS.episodeSize);
  const [titleColor, setTitleColor] = useState(DEFAULT_COVER_SETTINGS.titleColor);
  const [episodeColor, setEpisodeColor] = useState(DEFAULT_COVER_SETTINGS.episodeColor);
  const [fontBold, setFontBold] = useState(DEFAULT_COVER_SETTINGS.fontBold);
  const [fontItalic, setFontItalic] = useState(DEFAULT_COVER_SETTINGS.fontItalic);
  const [textTransform, setTextTransform] = useState<'none' | 'uppercase'>(DEFAULT_COVER_SETTINGS.textTransform);

  // Text Coordinates and Spacing
  const [textX, setTextX] = useState(DEFAULT_COVER_SETTINGS.textX);
  const [textY, setTextY] = useState(DEFAULT_COVER_SETTINGS.textY);
  const [lineSpacing, setLineSpacing] = useState(DEFAULT_COVER_SETTINGS.lineSpacing);

  // Diagonal Backing Cut
  const [cutTopXPercent, setCutTopXPercent] = useState(DEFAULT_COVER_SETTINGS.cutTopXPercent);
  const [cutBottomXPercent, setCutBottomXPercent] = useState(DEFAULT_COVER_SETTINGS.cutBottomXPercent);
  const [cutColor, setCutColor] = useState(DEFAULT_COVER_SETTINGS.cutColor);
  const [cutOpacity, setCutOpacity] = useState(DEFAULT_COVER_SETTINGS.cutOpacity);

  // Divider
  const [dividerStyle, setDividerStyle] = useState(DEFAULT_COVER_SETTINGS.dividerStyle);
  const [dividerColor, setDividerColor] = useState(DEFAULT_COVER_SETTINGS.dividerColor);

  // Text Stroke
  const [strokeEnabled, setStrokeEnabled] = useState(DEFAULT_COVER_SETTINGS.strokeEnabled);
  const [strokeColor, setStrokeColor] = useState(DEFAULT_COVER_SETTINGS.strokeColor);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_COVER_SETTINGS.strokeWidth);

  // Shadows
  const [shadowColor, setShadowColor] = useState(DEFAULT_COVER_SETTINGS.shadowColor);
  const [shadowBlur, setShadowBlur] = useState(DEFAULT_COVER_SETTINGS.shadowBlur);
  const [shadowOffsetX, setShadowOffsetX] = useState(DEFAULT_COVER_SETTINGS.shadowOffsetX);
  const [shadowOffsetY, setShadowOffsetY] = useState(DEFAULT_COVER_SETTINGS.shadowOffsetY);

  // Custom Logo State & Template Persistence
  const [customTitleLogo, setCustomTitleLogo] = useState<HTMLImageElement | null>(null);
  const [customTitleLogoData, setCustomTitleLogoData] = useState<string | null>(null);
  const [logoX, setLogoX] = useState(DEFAULT_COVER_SETTINGS.logoX);
  const [logoY, setLogoY] = useState(DEFAULT_COVER_SETTINGS.logoY);
  const [logoWidth, setLogoWidth] = useState(DEFAULT_COVER_SETTINGS.logoWidth);
  const [logoRotation, setLogoRotation] = useState(DEFAULT_COVER_SETTINGS.logoRotation);
  const [hideTitleWhenLogoPresent, setHideTitleWhenLogoPresent] = useState<boolean>(true);

  // Video Frame Extraction
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(120);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Load Saved Watermark from LocalStorage on mount
  useEffect(() => {
    const saved = getSavedWatermark();
    if (saved) {
      loadImageFromDataUrl(saved)
        .then((img) => setWatermarkImage(img))
        .catch((err) => console.warn('Could not load saved watermark', err));
    }
  }, []);

  // Load Project Cover Settings on project/episode change
  useEffect(() => {
    if (!currentEpisode) return;

    let baseTitle = currentEpisode.project?.title || 'ТАЙТЛ';

    // Parse and apply cover settings
    const { settings, loadedTitle } = parseCoverSettings(currentEpisode.project?.coverSettings);

    setFontFamily(settings.fontFamily);
    setTitleSize(settings.titleSize);
    setEpisodeSize(settings.episodeSize);
    setTitleColor(settings.titleColor);
    setEpisodeColor(settings.episodeColor);
    setFontBold(settings.fontBold);
    setFontItalic(settings.fontItalic);
    setTextTransform(settings.textTransform);
    setCutTopXPercent(settings.cutTopXPercent);
    setCutBottomXPercent(settings.cutBottomXPercent);
    setCutColor(settings.cutColor);
    setCutOpacity(settings.cutOpacity);
    setDividerStyle(settings.dividerStyle);
    setDividerColor(settings.dividerColor);
    setStrokeEnabled(settings.strokeEnabled);
    setStrokeColor(settings.strokeColor);
    setStrokeWidth(settings.strokeWidth);
    setShadowColor(settings.shadowColor);
    setShadowBlur(settings.shadowBlur);
    setShadowOffsetX(settings.shadowOffsetX);
    setShadowOffsetY(settings.shadowOffsetY);
    setLogoX(settings.logoX);
    setLogoY(settings.logoY);
    setLogoWidth(settings.logoWidth);
    setLogoRotation(settings.logoRotation);
    setTextX(settings.textX);
    setTextY(settings.textY);
    setLineSpacing(settings.lineSpacing);
    setHideTitleWhenLogoPresent(
      settings.hideTitleWhenLogoPresent !== undefined ? settings.hideTitleWhenLogoPresent : true
    );

    if (loadedTitle) {
      baseTitle = loadedTitle;
    }
    setTitle(baseTitle);
    setEpisodeNumber(`${currentEpisode.number} серия`);

    // Restore custom title logo if saved in project template
    if (settings.customTitleLogoData) {
      setCustomTitleLogoData(settings.customTitleLogoData);
      loadImageFromDataUrl(settings.customTitleLogoData)
        .then((img) => setCustomTitleLogo(img))
        .catch((err) => {
          console.warn('Failed to restore custom title logo from template', err);
          setCustomTitleLogo(null);
        });
    } else {
      setCustomTitleLogo(null);
      setCustomTitleLogoData(null);
    }

    if (currentEpisode.rawPath) {
      extractFrameFromVideo(currentEpisode.rawPath, videoTime);
    }
  }, [currentEpisode?.id, currentEpisode?.project?.id]);

  // Video Frame Extractor
  const extractFrameFromVideo = (videoPath: string, timeSec: number) => {
    if (!videoRef.current) {
      videoRef.current = document.createElement('video');
      videoRef.current.crossOrigin = 'anonymous';

      videoRef.current.onloadedmetadata = () => {
        setVideoDuration(videoRef.current?.duration || 0);
      };

      videoRef.current.onseeked = () => {
        const video = videoRef.current;
        if (!video) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          const img = new window.Image();
          img.src = dataUrl;
          img.onload = () => setBgImage(img);
        }
      };

      videoRef.current.onerror = () => {
        console.warn('Could not auto-extract frame from video path:', videoPath);
      };
    }

    if (!videoRef.current.src || videoRef.current.src === '') {
      (async () => {
        let src = videoPath;
        if (!window.electronAPI) {
          const cleanName = videoPath.replace(/\\/g, '/').split('/').pop() || videoPath;
          const cached = (window as any).getFileFromCache?.(cleanName);
          if (cached) {
            src = URL.createObjectURL(cached);
          } else {
            try {
              const { resolveLocalPath } = await import('../lib/webFileSystem');
              const resolved = await resolveLocalPath(videoPath);
              if (resolved) src = resolved;
            } catch (err) {}
          }
        } else {
          if (!src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('blob:')) {
            src = `file://${src}`;
          }
        }
        if (videoRef.current && videoRef.current.src !== src) {
          videoRef.current.src = src;
        }
      })();
    }
    videoRef.current.currentTime = timeSec;
  };

  const handleVideoTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setVideoTime(time);
    if (currentEpisode?.rawPath) {
      extractFrameFromVideo(currentEpisode.rawPath, time);
    }
  };

  // Google Fonts Loader
  useEffect(() => {
    const loadFont = async (font: string) => {
      try {
        const url = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;700&display=swap`;
        const link = document.createElement('link');
        link.href = url;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      } catch (e) {
        console.error('Font loading error:', e);
      }
    };
    if (fontFamily && !['Arial', 'Times New Roman', 'Impact'].includes(fontFamily)) {
      loadFont(fontFamily);
    }
  }, [fontFamily]);

  // Current compiled settings object
  const currentSettings: CoverSettings = {
    fontFamily,
    titleSize,
    episodeSize,
    titleColor,
    episodeColor,
    fontBold,
    fontItalic,
    textTransform,
    cutTopXPercent,
    cutBottomXPercent,
    cutColor,
    cutOpacity,
    dividerStyle,
    dividerColor,
    strokeEnabled,
    strokeColor,
    strokeWidth,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY,
    logoX,
    logoY,
    logoWidth,
    logoRotation,
    textX,
    textY,
    lineSpacing,
    customTitleLogoData,
    hideTitleWhenLogoPresent,
  };

  // Render Canvas Callback
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderCoverToCanvas({
      canvas,
      bgImage,
      watermarkImage,
      customTitleLogo,
      title,
      episodeNumber,
      settings: currentSettings,
    });
  }, [
    bgImage,
    watermarkImage,
    customTitleLogo,
    title,
    episodeNumber,
    fontFamily,
    titleSize,
    episodeSize,
    titleColor,
    episodeColor,
    cutColor,
    cutOpacity,
    dividerStyle,
    dividerColor,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY,
    cutTopXPercent,
    cutBottomXPercent,
    fontBold,
    fontItalic,
    textTransform,
    strokeEnabled,
    strokeColor,
    strokeWidth,
    logoX,
    logoY,
    logoWidth,
    logoRotation,
    textX,
    textY,
    lineSpacing,
    hideTitleWhenLogoPresent,
  ]);

  useEffect(() => {
    document.fonts.ready.then(() => {
      renderCanvas();
    });
    const t = setTimeout(renderCanvas, 150);
    return () => clearTimeout(t);
  }, [renderCanvas]);

  // Save Settings as Project Template
  const saveProjectSettings = async () => {
    if (!currentEpisode?.project) {
      toast.error('Проект не найден для сохранения шаблона');
      return;
    }

    try {
      await saveProjectCoverSettings(currentEpisode.project, currentSettings, title);
      onRefresh?.();
      toast.success(
        customTitleLogo
          ? '✓ Шаблон обложки и кастомный логотип сохранены для проекта!'
          : '✓ Шаблон обложки успешно сохранен для проекта!'
      );
    } catch (e: any) {
      console.error('Failed to save coverSettings', e);
      toast.error('Ошибка сохранения настроек шаблона: ' + (e.message || String(e)));
    }
  };

  // Background Image Upload
  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const img = await loadImageFromDataUrl(dataUrl);
        setBgImage(img);
        toast.success('Фоновое изображение успешно загружено');
      } catch (err) {
        toast.error('Ошибка загрузки фонового изображения');
      }
    }
  };

  // Watermark Upload and Removal
  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const img = await loadImageFromDataUrl(dataUrl);
        setWatermarkImage(img);
        saveWatermark(dataUrl);
        toast.success('Водяной знак сохранен в память приложения');
      } catch (err) {
        toast.error('Ошибка загрузки водяного знака');
      }
    }
  };

  const handleRemoveWatermark = () => {
    setWatermarkImage(null);
    removeSavedWatermark();
    toast.info('Водяной знак удален');
  };

  // Custom Logo Upload and Removal
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const img = await loadImageFromDataUrl(dataUrl);
        setCustomTitleLogo(img);
        setCustomTitleLogoData(dataUrl);
        toast.success(
          'Логотип тайтла загружен! Текстовое название автоматически скрыто с обложки.'
        );
      } catch (err) {
        toast.error('Ошибка загрузки файла логотипа');
      }
    }
  };

  const handleRemoveLogo = () => {
    setCustomTitleLogo(null);
    setCustomTitleLogoData(null);
    toast.info('Логотип удален. Текстовое название снова отображается на обложке.');
  };

  // Download Cover (PNG HD)
  const downloadImage = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const safeTitle = title.replace(/\n/g, '_').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_ -]/g, '');
    a.download = `Cover_${safeTitle || 'Anime'}_${episodeNumber.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '')}.png`;
    a.click();
    toast.success('Обложка экспортирована в формате PNG (1920x1080)');
  };

  return (
    <div className="p-4 md:p-6 h-full flex flex-col gap-4 md:gap-5 overflow-hidden" id="cover_generator_root">
      {/* Header */}
      <div className="flex justify-between items-center bg-neutral-900 px-4 py-3 rounded-xl border border-neutral-800 shrink-0" id="cover_head">
        <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-3">
          <ImageIcon className="w-5 h-5 md:w-6 md:h-6 text-pink-500" />
          <span>Генератор обложек серии</span>
        </h1>
        {currentEpisode?.project && (
          <span className="text-xs bg-neutral-800 text-neutral-300 px-3 py-1 rounded-full border border-neutral-700 font-medium">
            {currentEpisode.project.title}
          </span>
        )}
      </div>

      {/* Main Grid: Controls Left, Preview Right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 min-h-0 overflow-hidden" id="cover_body_grid">
        
        {/* Controls Panel */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col min-h-0 lg:col-span-1" id="cover_controls">
          
          {/* Navigation Tabs */}
          <div className="flex bg-neutral-950 p-1 rounded-lg border border-neutral-800 gap-1 shrink-0 mb-4" id="cover_tabs">
            <button
              type="button"
              id="tab_images"
              onClick={() => setActiveTab('images')}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                activeTab === 'images'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Фон/Вода</span>
            </button>
            <button
              type="button"
              id="tab_text"
              onClick={() => setActiveTab('text')}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                activeTab === 'text'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Текст</span>
            </button>
            <button
              type="button"
              id="tab_effects"
              onClick={() => setActiveTab('effects')}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                activeTab === 'effects'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Эффекты</span>
            </button>
            <button
              type="button"
              id="tab_backing"
              onClick={() => setActiveTab('backing')}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                activeTab === 'backing'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Срез</span>
            </button>
            <button
              type="button"
              id="tab_logo"
              onClick={() => setActiveTab('logo')}
              className={`flex-1 flex flex-col items-center gap-1 py-1.5 px-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                activeTab === 'logo'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              <LayoutTemplate className="w-3.5 h-3.5" />
              <span>Лого</span>
            </button>
          </div>

          {/* Tab Content (Scrollable Container) */}
          <div className="flex-1 overflow-y-auto pr-1 space-y-4" id="tab_content_wrapper">
            {activeTab === 'images' && (
              <CoverTabImages
                currentEpisode={currentEpisode}
                bgImage={bgImage}
                watermarkImage={watermarkImage}
                videoDuration={videoDuration}
                videoTime={videoTime}
                onBgUpload={handleBgUpload}
                onWatermarkUpload={handleWatermarkUpload}
                onRemoveWatermark={handleRemoveWatermark}
                onVideoTimeChange={handleVideoTimeChange}
              />
            )}

            {activeTab === 'text' && (
              <CoverTabText
                fontFamily={fontFamily}
                setFontFamily={setFontFamily}
                fontBold={fontBold}
                setFontBold={setFontBold}
                fontItalic={fontItalic}
                setFontItalic={setFontItalic}
                textTransform={textTransform}
                setTextTransform={setTextTransform}
                episodeNumber={episodeNumber}
                setEpisodeNumber={setEpisodeNumber}
                episodeSize={episodeSize}
                setEpisodeSize={setEpisodeSize}
                episodeColor={episodeColor}
                setEpisodeColor={setEpisodeColor}
                title={title}
                setTitle={setTitle}
                titleSize={titleSize}
                setTitleSize={setTitleSize}
                titleColor={titleColor}
                setTitleColor={setTitleColor}
                textX={textX}
                setTextX={setTextX}
                textY={textY}
                setTextY={setTextY}
                lineSpacing={lineSpacing}
                setLineSpacing={setLineSpacing}
                hasCustomLogo={Boolean(customTitleLogo)}
                hideTitleWhenLogoPresent={hideTitleWhenLogoPresent}
                setHideTitleWhenLogoPresent={setHideTitleWhenLogoPresent}
              />
            )}

            {activeTab === 'effects' && (
              <CoverTabEffects
                strokeEnabled={strokeEnabled}
                setStrokeEnabled={setStrokeEnabled}
                strokeWidth={strokeWidth}
                setStrokeWidth={setStrokeWidth}
                strokeColor={strokeColor}
                setStrokeColor={setStrokeColor}
                shadowBlur={shadowBlur}
                setShadowBlur={setShadowBlur}
                shadowOffsetX={shadowOffsetX}
                setShadowOffsetX={setShadowOffsetX}
                shadowOffsetY={shadowOffsetY}
                setShadowOffsetY={setShadowOffsetY}
                shadowColor={shadowColor}
                setShadowColor={setShadowColor}
              />
            )}

            {activeTab === 'backing' && (
              <CoverTabBacking
                dividerStyle={dividerStyle}
                setDividerStyle={setDividerStyle}
                cutTopXPercent={cutTopXPercent}
                setCutTopXPercent={setCutTopXPercent}
                cutBottomXPercent={cutBottomXPercent}
                setCutBottomXPercent={setCutBottomXPercent}
                dividerColor={dividerColor}
                setDividerColor={setDividerColor}
                cutColor={cutColor}
                setCutColor={setCutColor}
                cutOpacity={cutOpacity}
                setCutOpacity={setCutOpacity}
              />
            )}

            {activeTab === 'logo' && (
              <CoverTabLogo
                customTitleLogo={customTitleLogo}
                onLogoUpload={handleLogoUpload}
                onRemoveLogo={handleRemoveLogo}
                logoX={logoX}
                setLogoX={setLogoX}
                logoY={logoY}
                setLogoY={setLogoY}
                logoWidth={logoWidth}
                setLogoWidth={setLogoWidth}
                logoRotation={logoRotation}
                setLogoRotation={setLogoRotation}
                hideTitleWhenLogoPresent={hideTitleWhenLogoPresent}
                setHideTitleWhenLogoPresent={setHideTitleWhenLogoPresent}
              />
            )}
          </div>
        </div>

        {/* Preview and Actions Right Panel */}
        <div className="lg:col-span-2 xl:col-span-3 bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-5 flex flex-col gap-3 md:gap-4 min-h-0 overflow-hidden" id="cover_preview">
          <div className="flex justify-between items-center shrink-0" id="preview_header">
            <h2 className="text-sm md:text-base font-semibold text-white">
              Предпросмотр результатов
            </h2>
            <div className="flex items-center gap-2">
              {customTitleLogo && (
                <span className="text-[11px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2.5 py-0.5 rounded-full font-medium">
                  ✓ Логотип активен {hideTitleWhenLogoPresent ? '(текст скрыт)' : ''}
                </span>
              )}
              <span className="text-xs bg-neutral-800 text-neutral-400 px-2 py-1 rounded font-mono">
                1920x1080
              </span>
            </div>
          </div>

          {/* Canvas Viewport */}
          <div className="flex-1 bg-black rounded-lg border border-neutral-800 overflow-hidden flex items-center justify-center relative shadow-inner min-h-0" id="canvas_container">
            <canvas
              ref={canvasRef}
              width={1920}
              height={1080}
              className="max-w-full max-h-full object-contain shadow-2xl"
              id="generator_canvas"
            />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 shrink-0 pt-1" id="cover_actions">
            <button
              type="button"
              id="btn_save_settings"
              onClick={saveProjectSettings}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer text-sm"
              title="Сохранить эти настройки шрифтов, теней, разделителей и логотипа как шаблон для проекта"
            >
              <Save className="w-4 h-4" />
              <span>Сохранить шаблон для проекта</span>
            </button>
            <button
              type="button"
              id="btn_download_cover"
              onClick={downloadImage}
              className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer text-sm"
            >
              <Download className="w-4 h-4" />
              <span>Экспортировать (PNG, HD)</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
