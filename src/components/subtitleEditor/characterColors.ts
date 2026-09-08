export interface CharacterColorInfo {
  name: string;
  hex: string;
  bgRgba: string;
  borderSolid: string;
  borderRgba: string;
  textHex: string;
  badgeBg: string;
  badgeBorder: string;
  timelineBg: string;
  timelineBorder: string;
  isUnassigned?: boolean;
  isSign?: boolean;
}

const PALETTE: { hex: string; rgb: [number, number, number] }[] = [
  { hex: '#38bdf8', rgb: [56, 189, 248] },   // Sky / Голубой
  { hex: '#fbbf24', rgb: [251, 191, 36] },   // Amber / Янтарный
  { hex: '#34d399', rgb: [52, 211, 153] },   // Emerald / Изумрудный
  { hex: '#fb7185', rgb: [251, 113, 133] },  // Rose / Кораллово-розовый
  { hex: '#a78bfa', rgb: [167, 139, 250] },  // Violet / Фиолетовый
  { hex: '#fb923c', rgb: [251, 146, 60] },   // Orange / Оранжевый
  { hex: '#2dd4bf', rgb: [45, 212, 191] },   // Teal / Бирюзовый
  { hex: '#f472b6', rgb: [244, 114, 182] },  // Pink / Розовый
  { hex: '#a3e635', rgb: [163, 230, 53] },   // Lime / Лаймовый
  { hex: '#818cf8', rgb: [129, 140, 248] },  // Indigo / Индиго
  { hex: '#22d3ee', rgb: [34, 211, 238] },   // Cyan / Лазурный
  { hex: '#e879f9', rgb: [232, 121, 249] },  // Fuchsia / Фуксия
  { hex: '#facc15', rgb: [250, 204, 21] },   // Yellow / Золотистый
  { hex: '#4ade80', rgb: [74, 222, 128] },   // Green / Светло-зеленый
  { hex: '#c084fc', rgb: [192, 132, 252] },  // Purple / Сиреневый
  { hex: '#60a5fa', rgb: [96, 165, 250] },   // Blue / Синий
  { hex: '#f87171', rgb: [248, 113, 113] },  // Coral / Коралловый
  { hex: '#5eead4', rgb: [94, 234, 212] },   // Mint / Мятный
  { hex: '#eab308', rgb: [234, 179, 8] },    // Gold / Охра
  { hex: '#c4b5fd', rgb: [196, 181, 253] },  // Lavender / Лавандовый
  { hex: '#6ee7b7', rgb: [110, 231, 183] },  // Seafoam / Морская пена
  { hex: '#fda4af', rgb: [253, 164, 175] },  // Peach / Персиковый
  { hex: '#93c5fd', rgb: [147, 197, 253] },  // Ice / Ледяной
  { hex: '#d8b4fe', rgb: [216, 180, 254] },  // Lilac / Нежно-сиреневый
];

const SIGN_KEYWORDS = [
  'sign', 'signs', 'title', 'op', 'ed', 'song', 'note', 'music', 'logo',
  'staff', 'credit', 'credits', 'надпись', 'титры', 'инфо', 'info'
];

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function isSignCharacter(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  return SIGN_KEYWORDS.some(s => {
    if (s === 'op' || s === 'ed') {
      const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
      return regex.test(lower);
    }
    return lower === s || lower.includes(s);
  });
}

/**
 * Returns deterministic high-contrast visual color settings for any character name
 */
export function getCharacterColor(
  rawName: string | undefined | null,
  knownNames?: string[]
): CharacterColorInfo {
  const name = (rawName || '').trim();

  // Unassigned / empty name
  if (!name) {
    return {
      name: 'Не указан',
      hex: '#ef4444',
      bgRgba: 'rgba(239, 68, 68, 0.08)',
      borderSolid: '#ef4444',
      borderRgba: 'rgba(239, 68, 68, 0.45)',
      textHex: '#f87171',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeBorder: 'rgba(239, 68, 68, 0.35)',
      timelineBg: 'rgba(239, 68, 68, 0.22)',
      timelineBorder: 'rgba(239, 68, 68, 0.7)',
      isUnassigned: true
    };
  }

  // Technical subtitle / sign
  if (isSignCharacter(name)) {
    return {
      name,
      hex: '#9ca3af',
      bgRgba: 'rgba(156, 163, 175, 0.06)',
      borderSolid: '#6b7280',
      borderRgba: 'rgba(156, 163, 175, 0.35)',
      textHex: '#d1d5db',
      badgeBg: 'rgba(107, 114, 128, 0.2)',
      badgeBorder: 'rgba(107, 114, 128, 0.4)',
      timelineBg: 'rgba(107, 114, 128, 0.2)',
      timelineBorder: 'rgba(107, 114, 128, 0.6)',
      isSign: true
    };
  }

  // Pick index from known list if available, otherwise deterministic hash
  let colorIndex: number;
  if (knownNames && knownNames.length > 0) {
    const idx = knownNames.findIndex(n => n.toLowerCase().trim() === name.toLowerCase());
    if (idx !== -1) {
      colorIndex = idx % PALETTE.length;
    } else {
      colorIndex = stringHash(name.toLowerCase()) % PALETTE.length;
    }
  } else {
    colorIndex = stringHash(name.toLowerCase()) % PALETTE.length;
  }

  const item = PALETTE[colorIndex];
  const [r, g, b] = item.rgb;

  return {
    name,
    hex: item.hex,
    bgRgba: `rgba(${r}, ${g}, ${b}, 0.12)`,
    borderSolid: item.hex,
    borderRgba: `rgba(${r}, ${g}, ${b}, 0.45)`,
    textHex: item.hex,
    badgeBg: `rgba(${r}, ${g}, ${b}, 0.18)`,
    badgeBorder: `rgba(${r}, ${g}, ${b}, 0.38)`,
    timelineBg: `rgba(${r}, ${g}, ${b}, 0.28)`,
    timelineBorder: `rgba(${r}, ${g}, ${b}, 0.8)`,
    isUnassigned: false,
    isSign: false
  };
}
