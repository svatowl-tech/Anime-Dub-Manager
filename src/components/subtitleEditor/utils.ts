import { SIGN_KEYWORDS } from "../../constants";
import { RawSubtitleLine } from "./types";

export const SHORTCUT_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p',
  'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l',
  'z', 'x', 'c', 'v', 'b', 'n', 'm'
];

export const SHORTCUT_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM'
];

export function parseAssTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return (hours * 3600) + (minutes * 60) + seconds;
  }
  return 0;
}

export function secondsToAssTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function isSignSubtitleLine(line: RawSubtitleLine): boolean {
  const name = (line.name || "").toLowerCase();
  const style = (line.style || "").toLowerCase();
  
  const signs = ["sign", "signs", "title", "op", "ed", "song", "note", "music", "logo", "staff", "credit", "credits", "надпись", "титры", "инфо", "info"];
  
  const isSign = signs.some(s => {
    if (s === 'op' || s === 'ed') {
      const regex = new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i');
      return regex.test(name) || regex.test(style);
    }
    return name.includes(s) || style.includes(s);
  }) || SIGN_KEYWORDS.some(k => name.includes(k.toLowerCase()) || style.includes(k.toLowerCase()));

  return isSign;
}

export function applyStressToText(text: string, stresses: Record<string, string>): { text: string; modified: boolean } {
  if (!text || Object.keys(stresses).length === 0) return { text, modified: false };
  let currentText = text;
  let modified = false;

  const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const [name, stressedName] of Object.entries(stresses)) {
    if (!name || !stressedName) continue;
    
    const nameParts = name.split(/[\s-]+/);
    const stressedParts = stressedName.split(/[\s-]+/);
    const pairs: { plain: string; stressed: string }[] = [];

    if (nameParts.length !== stressedParts.length) {
      for (const sPart of stressedParts) {
        const cleanSPart = sPart.replace(/[\u0301'+]/g, '').toLowerCase();
        const matchingNamePart = nameParts.find(nPart => nPart.toLowerCase() === cleanSPart);
        if (matchingNamePart) {
          pairs.push({ plain: matchingNamePart, stressed: sPart });
        } else {
          pairs.push({ plain: sPart.replace(/[\u0301'+]/g, ''), stressed: sPart });
        }
      }
    } else {
      for (let i = 0; i < nameParts.length; i++) {
        pairs.push({ plain: nameParts[i], stressed: stressedParts[i] });
      }
    }
    
    for (const { plain, stressed } of pairs) {
      let stem = plain;
      const vowels = "аяоеиыуюэёАЯОЕИЫУЮЭЁйЙьЬ"; 
      if (plain.length > 2 && vowels.includes(plain.slice(-1))) {
        stem = plain.slice(0, -1);
      }
      
      const endings = [
        '', 'а', 'я', 'о', 'е', 'и', 'ы', 'у', 'ю', 'й', 'ь', 'э',
        'ом', 'ем', 'ой', 'ей', 'ою', 'ею', 'ью', 
        'ам', 'ям', 'ами', 'ями', 'ах', 'ях', 
        'ов', 'ев', 
        'ий', 'ого', 'ому', 'им', 'ие', 'их', 'ими', 'ая', 'ую'
      ].sort((a, b) => b.length - a.length);
      const suffixRegex = `(?:${endings.join('|')})`;
      const regex = new RegExp(`(^|[^а-яёА-ЯЁa-zA-Z0-9_])(${escapeRegExp(stem)}${suffixRegex})(?=[^а-яёА-ЯЁa-zA-Z0-9_]|$)`, 'gi');
      
      let stressChar = '\u0301';
      let stressIndex = stressed.indexOf('\u0301');
      let uppercaseStress = false;
      if (stressIndex === -1) {
        stressIndex = stressed.indexOf("'");
        if (stressIndex !== -1) stressChar = "'";
      }
      if (stressIndex === -1) {
        stressIndex = stressed.indexOf("+");
        if (stressIndex !== -1) stressChar = "+";
      }
      if (stressIndex === -1) {
        for (let i = 0; i < stressed.length; i++) {
          const pChar = plain[i] || '';
          const sChar = stressed[i];
          if (sChar !== pChar && sChar === sChar.toUpperCase() && /[АЕЁИОУЫЭЮЯаеёиоуыэюя]/i.test(sChar)) {
            stressIndex = i + 1; 
            uppercaseStress = true;
            break;
          }
        }
      }
      const prevText = currentText;
      currentText = currentText.replace(regex, (match, prefix, matchedName) => {
        const cleanMatchedName = matchedName.replace(/[\u0301'+]/g, '');
        let replacement = cleanMatchedName;
        if (stressIndex !== -1) {
          let targetIndex = stressIndex;
          if (!uppercaseStress) {
            if (targetIndex > cleanMatchedName.length) targetIndex = cleanMatchedName.length;
            replacement = cleanMatchedName.slice(0, targetIndex) + stressChar + cleanMatchedName.slice(targetIndex);
          } else {
            const charIdx = targetIndex - 1;
            if (charIdx < cleanMatchedName.length) {
              replacement = cleanMatchedName.slice(0, charIdx) + cleanMatchedName.charAt(charIdx).toUpperCase() + cleanMatchedName.slice(charIdx + 1);
            }
          }
        }
        if (cleanMatchedName[0] === cleanMatchedName[0].toUpperCase()) { 
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        } else {
          replacement = replacement.charAt(0).toLowerCase() + replacement.slice(1);
        }
        return prefix + replacement;
      });
      
      if (currentText !== prevText) {
        modified = true;
      }
    }
  }

  return { text: currentText, modified };
}
