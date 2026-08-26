const stresses = {
  "Дайсукэ Арамаки": "Да́йсукэ Арама́ки",
  "Бато": "Бато́"
};

const texts = [
  "Привет, Дайсукэ-тян! Бато, как дела?",
  "Арамаки здесь нет."
];

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let currentTexts = [...texts];

for (const [name, stressedName] of Object.entries(stresses)) {
  if (!name || !stressedName) continue;

  const nameParts = name.split(/[\s-]+/);
  const stressedParts = stressedName.split(/[\s-]+/);

  let pairs = [];
  if (nameParts.length > 1 && nameParts.length === stressedParts.length) {
      for (let i = 0; i < nameParts.length; i++) {
          pairs.push({ plain: nameParts[i], stressed: stressedParts[i] });
      }
  } else {
      pairs.push({ plain: name, stressed: stressedName });
  }

  for (const { plain, stressed } of pairs) {
      let stem = plain;
      const vowels = "аяоеиыуюэёАЯОЕИЫУЮЭЁйЙьЬ"; 
      if (plain.length > 2 && vowels.includes(plain.slice(-1))) {
          stem = plain.slice(0, -1);
      }
      
      const endings = [
          '', 'а', 'я', 'о', 'е', 'и', 'ы', 'у', 'ю', 'й', 'ь',
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
          for (let i = 0; i < plain.length; i++) {
              if (plain[i] !== stressed[i] && plain[i].toLowerCase() === stressed[i].toLowerCase()) {
                  if (stressed[i] === stressed[i].toUpperCase()) {
                      stressIndex = i + 1; 
                      uppercaseStress = true;
                  }
                  break;
              }
          }
      }

      currentTexts = currentTexts.map(currentText => {
          return currentText.replace(regex, (match, prefix, matchedName) => {
              let cleanMatchedName = matchedName.replace(/[\u0301'\+]/g, '');
              let replacement = cleanMatchedName;

              if (stressIndex !== -1) {
                  let targetIndex = stressIndex;
                  if (!uppercaseStress) {
                      if (targetIndex > cleanMatchedName.length) targetIndex = cleanMatchedName.length;
                      replacement = cleanMatchedName.slice(0, targetIndex) + stressChar + cleanMatchedName.slice(targetIndex);
                  } else {
                      let charIdx = targetIndex - 1;
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
      });
  }
}

console.log(currentTexts);
