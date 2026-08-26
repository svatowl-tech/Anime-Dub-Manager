import { CoverSettings } from './coverTypes';

export const hexToRgb = (hex: string): string => {
  let r = 0, g = 0, b = 0;
  if (hex.startsWith('#')) {
    if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    } else if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    }
  }
  return `${r},${g},${b}`;
};

export const drawStar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerRadius: number,
  innerRadius: number
) => {
  let rot = (Math.PI / 2) * 3;
  let currentX = cx;
  let currentY = cy;
  const stepRotation = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let j = 0; j < spikes; j++) {
    currentX = cx + Math.cos(rot) * outerRadius;
    currentY = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(currentX, currentY);
    rot += stepRotation;
    currentX = cx + Math.cos(rot) * innerRadius;
    currentY = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(currentX, currentY);
    rot += stepRotation;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
};

export const drawDividerPattern = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: string,
  color: string
) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;

  // Draw base line
  if (style !== 'none') {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, 0);
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  const step = 60; // spacing between pattern elements
  const count = Math.floor(length / step);

  for (let i = 1; i < count; i++) {
    const x = i * step;
    ctx.save();
    ctx.translate(x, 0);

    switch (style) {
      case 'barbed-wire':
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(10, 10);
        ctx.moveTo(10, -10);
        ctx.lineTo(-10, 10);
        ctx.stroke();
        // Center ring
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'stars':
        drawStar(ctx, 0, 0, 4, 15, 4);
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        drawStar(ctx, 0, 0, 4, 10, 2);
        ctx.shadowBlur = 0;
        break;

      case 'floral':
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(10, -20, 20, -5);
        ctx.quadraticCurveTo(5, -10, 0, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(10, 20, 20, 5);
        ctx.quadraticCurveTo(5, 10, 0, 0);
        ctx.fill();
        break;

      case 'runic':
        ctx.beginPath();
        ctx.moveTo(-5, -15);
        ctx.lineTo(5, -5);
        ctx.lineTo(-5, 5);
        ctx.lineTo(5, 15);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = '20px sans-serif';
        ctx.fillText(['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ'][i % 7], -10, 0);
        break;

      case 'scifi':
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.fillRect(-15, -4, 30, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-10, -2, 20, 4);
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        break;

      case 'hearts':
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(0, -5, -5, -15, -15, -15);
        ctx.bezierCurveTo(-25, -15, -25, -2.5, -25, -2.5);
        ctx.bezierCurveTo(-25, 10, -10, 15, 0, 25);
        ctx.bezierCurveTo(10, 15, 25, 10, 25, -2.5);
        ctx.bezierCurveTo(25, -2.5, 25, -15, 15, -15);
        ctx.bezierCurveTo(5, -15, 0, -5, 0, 0);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  ctx.restore();
};

export interface RenderCoverParams {
  canvas: HTMLCanvasElement;
  bgImage: HTMLImageElement | null;
  watermarkImage: HTMLImageElement | null;
  customTitleLogo: HTMLImageElement | null;
  title: string;
  episodeNumber: string;
  settings: CoverSettings;
}

export const renderCoverToCanvas = ({
  canvas,
  bgImage,
  watermarkImage,
  customTitleLogo,
  title,
  episodeNumber,
  settings,
}: RenderCoverParams) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Background Image
  if (bgImage) {
    const scale = Math.max(canvas.width / bgImage.width, canvas.height / bgImage.height);
    const w = bgImage.width * scale;
    const h = bgImage.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.drawImage(bgImage, x, y, w, h);
  } else {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '50px Inter, sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.textAlign = 'center';
    ctx.fillText('Загрузите фон или выберите кадр', canvas.width / 2, canvas.height / 2);
  }

  // 2. Diagonal polygon backing cut
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const topX = canvas.width * (settings.cutTopXPercent / 100);
  const bottomX = canvas.width * (settings.cutBottomXPercent / 100);
  ctx.lineTo(topX, 0);
  ctx.lineTo(bottomX, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();
  ctx.fillStyle = `rgba(${hexToRgb(settings.cutColor)}, ${settings.cutOpacity})`;
  ctx.fill();

  // 3. Divider Pattern
  drawDividerPattern(
    ctx,
    topX,
    0,
    bottomX,
    canvas.height,
    settings.dividerStyle,
    settings.dividerColor
  );

  // 4. Text and shadow preparation
  const textCenterY = settings.textY;
  const textCenterX = settings.textX;
  const fontModifier = `${settings.fontItalic ? 'italic ' : ''}${settings.fontBold ? 'bold ' : ''}`;

  ctx.shadowColor = settings.shadowColor;
  ctx.shadowBlur = settings.shadowBlur;
  ctx.shadowOffsetX = settings.shadowOffsetX;
  ctx.shadowOffsetY = settings.shadowOffsetY;

  // 5. Draw Episode Number
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.font = `${fontModifier}${settings.episodeSize}px "${settings.fontFamily}", sans-serif`;
  ctx.fillStyle = settings.episodeColor;

  const formattedEpisode =
    settings.textTransform === 'uppercase' ? episodeNumber.toUpperCase() : episodeNumber;
  ctx.fillText(formattedEpisode, textCenterX, textCenterY - 20);

  if (settings.strokeEnabled) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = settings.strokeColor;
    ctx.lineWidth = settings.strokeWidth;
    ctx.strokeText(formattedEpisode, textCenterX, textCenterY - 20);
    ctx.restore();
  }

  // 6. Draw Text Title (Omitted if custom logo is present and hideTitleWhenLogoPresent is true)
  const shouldRenderTextTitle = !customTitleLogo || !settings.hideTitleWhenLogoPresent;

  if (shouldRenderTextTitle && title.trim()) {
    ctx.textBaseline = 'top';
    ctx.font = `${fontModifier}${settings.titleSize}px "${settings.fontFamily}", sans-serif`;
    ctx.fillStyle = settings.titleColor;

    const rawTitle = settings.textTransform === 'uppercase' ? title.toUpperCase() : title;
    const titleLines = rawTitle.split('\n');
    let currentY = textCenterY + 15;

    titleLines.forEach((line) => {
      ctx.fillText(line, textCenterX, currentY);
      if (settings.strokeEnabled) {
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = settings.strokeColor;
        ctx.lineWidth = settings.strokeWidth;
        ctx.strokeText(line, textCenterX, currentY);
        ctx.restore();
      }
      currentY += settings.titleSize * settings.lineSpacing;
    });
  }

  // Reset shadow before drawing images
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 7. Draw Custom Title Logo if uploaded
  if (customTitleLogo) {
    ctx.save();
    const lx = canvas.width * (settings.logoX / 100);
    const ly = canvas.height * (settings.logoY / 100);
    ctx.translate(lx, ly);
    ctx.rotate((settings.logoRotation * Math.PI) / 180);

    const w = settings.logoWidth;
    const h = settings.logoWidth * (customTitleLogo.height / customTitleLogo.width);

    ctx.drawImage(customTitleLogo, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // 8. Draw Studio Watermark
  if (watermarkImage) {
    const maxW = 350;
    const maxH = 250;
    const scale = Math.min(maxW / watermarkImage.width, maxH / watermarkImage.height);
    const w = watermarkImage.width * scale;
    const h = watermarkImage.height * scale;
    const p = 50;
    ctx.drawImage(watermarkImage, canvas.width - w - p, p, w, h);
  }
};
