/**
 * Utility for transliterating Latin to Russian Cyrillic.
 * Follows common transcription rules (Latin -> Cyrillic).
 */

const multiCharMapping: Record<string, string> = {
  'shch': 'щ',
  'sh': 'ш',
  'ch': 'ч',
  'zh': 'ж',
  'kh': 'х',
  'ts': 'ц',
  'yu': 'ю',
  'ya': 'я',
  'yo': 'ё',
  'ye': 'е',
};

const singleCharMapping: Record<string, string> = {
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 'z': 'з', 'i': 'и',
  'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р', 's': 'с',
  't': 'т', 'u': 'у', 'f': 'ф', 'h': 'х', 'j': 'й', 'x': 'кс', 'w': 'в', 'q': 'к', 'c': 'к'
};

/**
 * Transliterates Latin text to Cyrillic based on common Russian transcription rules.
 */
export function latinToCyrillic(text: string): string {
  let result = '';
  let i = 0;
  
  while (i < text.length) {
    const char = text[i];
    const lowerChar = char.toLowerCase();
    const isUpper = char !== lowerChar;
    
    // Try to match multi-character sequences first (greedy)
    let matched = false;
    
    // Check for 4-char sequences (shch)
    if (i + 3 < text.length) {
      const fourChars = text.substring(i, i + 4).toLowerCase();
      if (multiCharMapping[fourChars]) {
        const replacement = multiCharMapping[fourChars];
        result += isUpper ? replacement.toUpperCase() : replacement;
        i += 4;
        matched = true;
      }
    }
    
    // Check for 2-char sequences (sh, ch, zh, kh, ts, yu, ya, yo, ye)
    if (!matched && i + 1 < text.length) {
      const twoChars = text.substring(i, i + 2).toLowerCase();
      if (multiCharMapping[twoChars]) {
        const replacement = multiCharMapping[twoChars];
        result += isUpper ? replacement.toUpperCase() : replacement;
        i += 2;
        matched = true;
      }
    }
    
    if (!matched) {
      // Special rule for 'y'
      if (lowerChar === 'y') {
        const prevChar = i > 0 ? text[i - 1].toLowerCase() : '';
        const nextChar = i + 1 < text.length ? text[i + 1].toLowerCase() : '';
        
        // 'y' at the end of word or after vowel is usually 'й'
        const isEndOfWord = nextChar === '' || ' \n\t\r.,!?;:()[]{}'.includes(nextChar);
        const isAfterVowel = 'aeiouy'.includes(prevChar);
        
        if (isEndOfWord || isAfterVowel) {
          result += isUpper ? 'Й' : 'й';
        } else {
          result += isUpper ? 'Ы' : 'ы';
        }
        i++;
        matched = true;
      }
    }
    
    if (!matched) {
      const replacement = singleCharMapping[lowerChar];
      if (replacement !== undefined) {
        result += isUpper ? replacement.toUpperCase() : replacement;
        i++;
        matched = true;
      }
    }
    
    if (!matched) {
      result += char;
      i++;
    }
  }
  
  return result;
}

/**
 * Converts Japanese names and terms from Polivanov system (Russian Cyrillic) 
 * to Hepburn system (Russian Cyrillic).
 * Handles labials (m -> n before b, p, m), gemination, and common declined forms.
 */
export function polivanovToHepburn(text: string): string {
  const mapping: [string, string][] = [
    // 1. Gemination (Double consonants) - must be before single ones
    ['сси', 'шши'], ['сся', 'шша'], ['ссю', 'шшу'], ['ссё', 'шшо'],
    ['тти', 'тчи'], ['ття', 'тча'], ['ттю', 'тчу'], ['ттё', 'тчо'],
    ['ддзи', 'дджи'], ['ддзя', 'дджа'], ['ддзю', 'дджу'], ['ддзё', 'дджо'],
    ['Сси', 'Шши'], ['Сся', 'Шша'], ['Ссю', 'Шшу'], ['Ссё', 'Шшо'],
    ['Тти', 'Тчи'], ['Ття', 'Тча'], ['Ттю', 'Тчу'], ['Ттё', 'Тчо'],
    ['Ддзи', 'Дджи'], ['Ддзя', 'Дджа'], ['Ддзю', 'Дджу'], ['Ддзё', 'Дджо'],

    // 2. Labials (m -> n before b, p, m) - generalized for all vowels and cases
    ['мб', 'нб'], ['мп', 'нп'], ['мм', 'нм'],
    ['Мб', 'Нб'], ['Мп', 'Нп'], ['Мм', 'Нм'],
    ['МБ', 'НБ'], ['МП', 'НП'], ['ММ', 'НМ'],

    // 3. Sibilants and Affricates (The core of Polivanov vs Hepburn)
    ['дзи', 'джи'], ['дзя', 'джа'], ['дзю', 'джу'], ['дзё', 'джо'],
    ['си', 'ши'], ['ся', 'ша'], ['сю', 'шу'], ['сё', 'шо'],
    ['ти', 'чи'], ['тя', 'ча'], ['тю', 'чу'], ['тё', 'чо'],
    
    // 4. Ts sound (Polivanov 'ц' -> Hepburn 'ts')
    ['цу', 'тсу'], ['ца', 'тса'], ['це', 'тсе'], ['цо', 'тсо'], ['ци', 'тси'],
    ['Цу', 'Тсу'], ['Ца', 'Тса'], ['Це', 'Тсе'], ['Цо', 'Тсо'], ['Ци', 'Тси'],
    ['ЦУ', 'ТСУ'], ['ЦА', 'ТСА'], ['ЦЕ', 'ТСЕ'], ['ЦО', 'ТСО'], ['ЦИ', 'ТСИ'],

    // 5. Separator (Polivanov 'нъ' -> Hepburn 'n\'')
    ['нъ', "н'"], ['Нъ', "Н'"], ['НЪ', "Н'"],

    // 6. Uppercase variants for sibilants
    ['Дзи', 'Джи'], ['Дзя', 'Джа'], ['Дзю', 'Джу'], ['Дзё', 'Джо'],
    ['Си', 'Ши'], ['Ся', 'Ша'], ['Сю', 'Шу'], ['Сё', 'Шо'],
    ['Ти', 'Чи'], ['Тя', 'Ча'], ['Тю', 'Чу'], ['Тё', 'Чо'],

    // 7. ALL CAPS variants for sibilants
    ['ДЗИ', 'ДЖИ'], ['ДЗЯ', 'ДЖА'], ['ДЗЮ', 'ДЖУ'], ['ДЗЁ', 'ДЖО'],
    ['СИ', 'ШИ'], ['СЯ', 'ША'], ['СЮ', 'ШУ'], ['СЁ', 'ШО'],
    ['ТИ', 'ЧИ'], ['ТЯ', 'ЧА'], ['ТЮ', 'ЧУ'], ['ТЁ', 'ЧО'],

    // 8. Final touches (Yo)
    ['ё', 'йо'], ['Ё', 'Йо']
  ];

  let result = text;
  // Replace sequences in order
  for (const [pol, hep] of mapping) {
    result = result.split(pol).join(hep);
  }
  
  return result;
}
