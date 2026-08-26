export interface DividerStyleItem {
  id: string;
  label: string;
}

export const FONTS: string[] = [
  'Inter', 'Roboto', 'Oswald', 'Montserrat', 'Playfair Display',
  'Russo One', 'Caveat', 'Creepster', 'Press Start 2P', 'Impact', 'Arial', 'Times New Roman'
];

export const DIVIDER_STYLES: DividerStyleItem[] = [
  { id: 'none', label: 'Нет (только линия)' },
  { id: 'barbed-wire', label: 'Колючая проволока' },
  { id: 'stars', label: 'Звёзды' },
  { id: 'floral', label: 'Лесной узор (цветы/листья)' },
  { id: 'runic', label: 'Рунные символы' },
  { id: 'scifi', label: 'Sci-Fi / Неон' },
  { id: 'hearts', label: 'Сердца' },
];

export interface CoverSettings {
  fontFamily: string;
  titleSize: number;
  episodeSize: number;
  titleColor: string;
  episodeColor: string;
  fontBold: boolean;
  fontItalic: boolean;
  textTransform: 'none' | 'uppercase';
  cutTopXPercent: number;
  cutBottomXPercent: number;
  cutColor: string;
  cutOpacity: number;
  dividerStyle: string;
  dividerColor: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoRotation: number;
  textX: number;
  textY: number;
  lineSpacing: number;
  savedCustomTitle?: string;
  customTitleLogoData?: string | null;
  hideTitleWhenLogoPresent?: boolean;
}

export const DEFAULT_COVER_SETTINGS: CoverSettings = {
  fontFamily: 'Russo One',
  titleSize: 140,
  episodeSize: 80,
  titleColor: '#ffffff',
  episodeColor: '#ffffff',
  fontBold: true,
  fontItalic: false,
  textTransform: 'uppercase',
  cutTopXPercent: 15,
  cutBottomXPercent: 55,
  cutColor: '#000000',
  cutOpacity: 0.85,
  dividerStyle: 'barbed-wire',
  dividerColor: '#00e5ff',
  strokeEnabled: true,
  strokeColor: '#000000',
  strokeWidth: 8,
  shadowColor: '#000000',
  shadowBlur: 15,
  shadowOffsetX: 4,
  shadowOffsetY: 4,
  logoX: 25,
  logoY: 75,
  logoWidth: 600,
  logoRotation: 0,
  textX: 80,
  textY: 756,
  lineSpacing: 1.25,
  customTitleLogoData: null,
  hideTitleWhenLogoPresent: true,
};
