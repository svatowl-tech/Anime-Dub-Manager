import React, { useState, useRef } from 'react';
import { X, Image as ImageIcon, Download, Copy, Table } from 'lucide-react';
import { Project, Participant } from '../../types';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';

interface RolesGridModalProps {
  project: Project | null;
  participants: Participant[];
  onClose: () => void;
}

export default function RolesGridModal({ project, participants, onClose }: RolesGridModalProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!project) return null;

  let globalMapping: any[] = [];
  let nameStresses: Record<string, string> = {};
  try {
    globalMapping = JSON.parse(project.globalMapping || '[]');
    nameStresses = JSON.parse(project.nameStresses || '{}');
  } catch (e) {}

  // Group characters by dubberId
  const dubbersMap = new Map<string, any[]>();
  globalMapping.forEach(char => {
    if (char.dubberId) {
      if (!dubbersMap.has(char.dubberId)) {
        dubbersMap.set(char.dubberId, []);
      }
      dubbersMap.get(char.dubberId)?.push(char);
    }
  });

  const columns = Array.from(dubbersMap.entries()).map(([dubberId, chars]) => {
    const participant = participants.find(p => p.id === dubberId);
    return {
      dubber: participant?.nickname || 'Unknown',
      chars
    };
  });

  // Calculate max characters any dubber has to determine rows
  const maxChars = Math.max(0, ...columns.map(c => c.chars.length));
  
  const getProxiedImageUrl = (url: string | undefined): string => {
    if (!url) return '';
    let absoluteUrl = url.trim();
    
    // Convert relative URLs to absolute
    if (absoluteUrl.startsWith('/')) {
      absoluteUrl = `${window.location.origin}${absoluteUrl}`;
    } else if (!absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
      absoluteUrl = `${window.location.origin}/${absoluteUrl}`;
    }

    // Wrap external URLs in weserv.nl proxy to bypass hotlinking protection
    if (absoluteUrl.startsWith('http://') || absoluteUrl.startsWith('https://')) {
      const isLocal = absoluteUrl.includes('localhost') || absoluteUrl.includes(window.location.hostname);
      if (!isLocal) {
        return `https://images.weserv.nl/?url=${encodeURIComponent(absoluteUrl)}`;
      }
    }
    return absoluteUrl;
  };

  const generateTSV = () => {
    const rows: string[][] = [];
    const stressesArray = Object.values(nameStresses);
    
    // Header row (Dubbers + Spacer + Information + Name Stresses)
    const headerRow = columns.map(c => c.dubber);
    headerRow.push('', 'Информация', 'Ударения');
    rows.push(headerRow);

    for (let i = 0; i < maxChars; i++) {
      // 1. Images row
      const imageRow = columns.map(c => {
        const char = c.chars[i];
        return char && char.photoUrl ? `=IMAGE("${getProxiedImageUrl(char.photoUrl)}")` : '';
      });
      imageRow.push(''); // spacer

      // Column N+2: Информация
      if (i === 0 && project.posterUrl) {
        imageRow.push(`=IMAGE("${getProxiedImageUrl(project.posterUrl)}")`);
      } else if (i === 1) {
        imageRow.push(project.title);
      } else if (i === 2 && project.links) {
        try {
          const links = JSON.parse(project.links);
          if (links.shikimori) {
            imageRow.push(`=HYPERLINK("${links.shikimori}", "Shikimori")`);
          } else {
            imageRow.push('');
          }
        } catch(e) {
          imageRow.push('');
        }
      } else {
        imageRow.push('');
      }

      // Column N+3: Ударения (First stress for this character row)
      const stress1 = stressesArray[2 * i] || '';
      imageRow.push(stress1);

      rows.push(imageRow);

      // 2. Names row
      const nameRow = columns.map(c => {
        const char = c.chars[i];
        if (char) {
          return char.characterName ? (nameStresses[char.characterName] || char.characterName) : '-';
        }
        return '';
      });
      nameRow.push(''); // spacer

      // Column N+2: Информация
      if (i === 0) {
        nameRow.push(project.title);
      } else if (i === 1) {
        try {
          const links = project.links ? JSON.parse(project.links) : {};
          if (links.shikimori) {
            nameRow.push(`=HYPERLINK("${links.shikimori}", "Shikimori")`);
          } else {
            nameRow.push('');
          }
        } catch(e) {
          nameRow.push('');
        }
      } else {
        nameRow.push('');
      }

      // Column N+3: Ударения (Second stress for this character row)
      const stress2 = stressesArray[2 * i + 1] || '';
      nameRow.push(stress2);

      rows.push(nameRow);
    }

    // What if there are more stresses than 2 * maxChars? We can append them to the end!
    const processedStresses = 2 * maxChars;
    if (stressesArray.length > processedStresses) {
      for (let k = processedStresses; k < stressesArray.length; k += 2) {
        const extraRowImg = columns.map(() => '');
        extraRowImg.push('', '', stressesArray[k] || '');
        rows.push(extraRowImg);

        const extraRowName = columns.map(() => '');
        extraRowName.push('', '', stressesArray[k + 1] || '');
        rows.push(extraRowName);
      }
    }

    const tsv = rows.map(r => r.join('\t')).join('\n');
    return tsv;
  };

  const generateHTML = () => {
    const headerStyle = "background-color: #374151; color: #ffffff; font-weight: bold; text-align: center; vertical-align: middle; padding: 12px; border: 1px solid #1f2937; font-size: 14px; font-family: Arial, sans-serif;";
    const nameStyle = "background-color: #4b5563; color: #ffffff; text-align: center; vertical-align: middle; padding: 10px; border: 1px solid #1f2937; font-size: 13px; font-weight: bold; font-family: Arial, sans-serif;";
    const imageContainerStyle = "background-color: #111827; text-align: center; vertical-align: middle; border: 1px solid #1f2937; height: 160px; padding: 0;";
    const emptyStyle = "background-color: #111827; border: 1px solid #1f2937;";
    const spacerStyle = "width: 24px; background-color: transparent; border: none;";
    const stressStyle = "background-color: #1f2937; color: #f3f4f6; text-align: center; vertical-align: middle; padding: 10px; border: 1px solid #374151; font-size: 13px; font-weight: bold; font-family: Arial, sans-serif;";
    
    let html = '<table style="border-collapse: collapse;">';
    const stressesArray = Object.values(nameStresses);
    
    // Header Row
    html += '<tr>';
    columns.forEach(c => {
      html += `<td style="${headerStyle} width: 160px;">${c.dubber}</td>`;
    });
    html += `<td style="${spacerStyle}"></td>`;
    html += `<td style="${headerStyle} width: 200px;">Информация</td>`;
    html += `<td style="${headerStyle} width: 200px;">Ударения</td>`;
    html += '</tr>';

    for (let i = 0; i < maxChars; i++) {
      // --- 1. Images Row ---
      html += '<tr>';
      columns.forEach(c => {
        const char = c.chars[i];
        if (char && char.photoUrl) {
          html += `<td style="${imageContainerStyle}"><img src="${getProxiedImageUrl(char.photoUrl)}" height="150" style="object-fit: cover; border-radius: 4px;" /></td>`;
        } else {
          html += `<td style="${emptyStyle}"></td>`;
        }
      });
      html += `<td style="${spacerStyle}"></td>`;

      // Column N+2: Информация (Poster)
      if (i === 0) {
        if (project.posterUrl) {
          html += `<td style="${imageContainerStyle}"><img src="${getProxiedImageUrl(project.posterUrl)}" height="150" style="object-fit: cover; border-radius: 4px;" /></td>`;
        } else {
          html += `<td style="${emptyStyle}"></td>`;
        }
      } else if (i === 1) {
        html += `<td style="${nameStyle}">${project.title}</td>`;
      } else if (i === 2) {
        try {
          const links = project.links ? JSON.parse(project.links) : {};
          if (links.shikimori) {
            html += `<td style="${nameStyle}"><a href="${links.shikimori}" style="color: #93c5fd; text-decoration: none;">Shikimori</a></td>`;
          } else {
            html += `<td style="${emptyStyle}"></td>`;
          }
        } catch(e) {
          html += `<td style="${emptyStyle}"></td>`;
        }
      } else {
        html += `<td style="${emptyStyle}"></td>`;
      }

      // Column N+3: Ударения (First stress)
      const stress1 = stressesArray[2 * i];
      if (stress1) {
        html += `<td style="${stressStyle}">${stress1}</td>`;
      } else {
        html += `<td style="${emptyStyle}"></td>`;
      }

      html += '</tr>';

      // --- 2. Names Row ---
      html += '<tr>';
      columns.forEach(c => {
        const char = c.chars[i];
        if (char) {
          const name = char.characterName ? (nameStresses[char.characterName] || char.characterName) : '-';
          html += `<td style="${nameStyle}">${name}</td>`;
        } else {
          html += `<td style="${emptyStyle}"></td>`;
        }
      });
      html += `<td style="${spacerStyle}"></td>`;

      // Column N+2: Информация (Title / link / empty)
      if (i === 0) {
        html += `<td style="${nameStyle}">${project.title}</td>`;
      } else if (i === 1) {
        try {
          const links = project.links ? JSON.parse(project.links) : {};
          if (links.shikimori) {
            html += `<td style="${nameStyle}"><a href="${links.shikimori}" style="color: #93c5fd; text-decoration: none;">Shikimori</a></td>`;
          } else {
            html += `<td style="${emptyStyle}"></td>`;
          }
        } catch(e) {
          html += `<td style="${emptyStyle}"></td>`;
        }
      } else {
        html += `<td style="${emptyStyle}"></td>`;
      }

      // Column N+3: Ударения (Second stress)
      const stress2 = stressesArray[2 * i + 1];
      if (stress2) {
        html += `<td style="${stressStyle}">${stress2}</td>`;
      } else {
        html += `<td style="${emptyStyle}"></td>`;
      }

      html += '</tr>';
    }

    // Extra rows if there are more stresses than 2 * maxChars
    const processedStresses = 2 * maxChars;
    if (stressesArray.length > processedStresses) {
      for (let k = processedStresses; k < stressesArray.length; k += 2) {
        // Image row equivalent
        html += '<tr>';
        columns.forEach(() => {
          html += `<td style="${emptyStyle}"></td>`;
        });
        html += `<td style="${spacerStyle}"></td>`;
        html += `<td style="${emptyStyle}"></td>`; // info
        
        const extraStress1 = stressesArray[k];
        if (extraStress1) {
          html += `<td style="${stressStyle}">${extraStress1}</td>`;
        } else {
          html += `<td style="${emptyStyle}"></td>`;
        }
        html += '</tr>';

        // Name row equivalent
        html += '<tr>';
        columns.forEach(() => {
          html += `<td style="${emptyStyle}"></td>`;
        });
        html += `<td style="${spacerStyle}"></td>`;
        html += `<td style="${emptyStyle}"></td>`; // info
        
        const extraStress2 = stressesArray[k + 1];
        if (extraStress2) {
          html += `<td style="${stressStyle}">${extraStress2}</td>`;
        } else {
          html += `<td style="${emptyStyle}"></td>`;
        }
        html += '</tr>';
      }
    }

    html += '</table>';
    return html;
  };

  const handleCopyToSheets = async () => {
    try {
      const tsv = generateTSV();
      const html = generateHTML();
      
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      });
      await navigator.clipboard.write([clipboardItem]);
      
      toast.success('Скопировано! Теперь вставьте это в Google Таблицы (Ctrl+V)');
    } catch (err) {
      console.error(err);
      try {
        await navigator.clipboard.writeText(generateTSV());
        toast.success('Скопировано (только текст)! Вставьте в Google Таблицы');
      } catch (e) {
        toast.error('Не удалось скопировать в буфер обмена');
      }
    }
  };

  const handleExportPNG = async () => {
    if (!gridRef.current) return;
    setIsExporting(true);
    
    // Преобразование OKLCH в RGB для совместимости с html2canvas без глобального вмешательства в getComputedStyle
    const originalGetComputedStyle = window.getComputedStyle;
    
    const oklchToRgb = (oklchStr: string): string => {
      const match = oklchStr.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
      if (!match) return oklchStr;

      let L = match[1].endsWith('%') ? parseFloat(match[1]) / 100 : parseFloat(match[1]);
      const C = parseFloat(match[2]);
      const H = parseFloat(match[3]);
      const alpha = match[4] ? (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])) : 1;

      const hRad = (H * Math.PI) / 180;
      const l_a = C * Math.cos(hRad);
      const l_b = C * Math.sin(hRad);

      const l_ = L + 0.3963377774 * l_a + 0.2158037573 * l_b;
      const m_ = L - 0.1055613458 * l_a - 0.0638541728 * l_b;
      const s_ = L - 0.0894841775 * l_a - 1.2914855480 * l_b;

      const l = Math.pow(Math.max(0, l_), 3);
      const m = Math.pow(Math.max(0, m_), 3);
      const s = Math.pow(Math.max(0, s_), 3);

      let rL = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
      let gL = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
      let bL = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

      rL = Math.max(0, Math.min(1, rL));
      gL = Math.max(0, Math.min(1, gL));
      bL = Math.max(0, Math.min(1, bL));

      const f = (x: number) => (x > 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x);
      const red = Math.round(f(rL) * 255);
      const green = Math.round(f(gL) * 255);
      const blue = Math.round(f(bL) * 255);

      if (alpha === 1) {
        return `rgb(${red}, ${green}, ${blue})`;
      } else {
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
      }
    };

    const replaceOklchInString = (str: string): string => {
      if (typeof str !== 'string' || !str.includes('oklch')) return str;
      return str.replace(/oklch\([^)]+\)/gi, (match) => {
        try {
          return oklchToRgb(match);
        } catch (e) {
          return match;
        }
      });
    };

    // Временное применение инлайн-стилей RGB для экспорта
    const convertOklchStylesTemporarily = (root: HTMLElement) => {
      const savedStyles = new Map<HTMLElement, string>();
      const colorProps = [
        'backgroundColor',
        'color',
        'borderColor',
        'borderTopColor',
        'borderRightColor',
        'borderBottomColor',
        'borderLeftColor',
        'outlineColor'
      ];

      const traverse = (el: HTMLElement) => {
        const originalStyle = el.getAttribute('style') || '';
        savedStyles.set(el, originalStyle);

        const computed = originalGetComputedStyle(el);
        colorProps.forEach(prop => {
          const val = computed[prop as any];
          if (val && typeof val === 'string' && val.includes('oklch')) {
            const rgbVal = replaceOklchInString(val);
            el.style[prop as any] = rgbVal;
          }
        });

        Array.from(el.children).forEach(child => {
          traverse(child as HTMLElement);
        });
      };

      traverse(root);

      return () => {
        savedStyles.forEach((originalStyle, el) => {
          if (originalStyle) {
            el.setAttribute('style', originalStyle);
          } else {
            el.removeAttribute('style');
          }
        });
      };
    };

    // Безопасный глобальный перехват getComputedStyle во время генерации холста
    window.getComputedStyle = function(el, pseudoElt) {
      const style = originalGetComputedStyle(el, pseudoElt);
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'getPropertyValue') {
            return function(propertyName: string) {
              const val = target.getPropertyValue(propertyName);
              return replaceOklchInString(val);
            };
          }
          // Передаем 'target' в качестве receiver, чтобы нативные геттеры внутри CSSStyleDeclaration выполнялись на исходном объекте,
          // предотвращая "TypeError: Illegal invocation"
          const val = Reflect.get(target, prop, target);
          if (typeof val === 'function') {
            return val.bind(target);
          }
          if (typeof val === 'string') {
            return replaceOklchInString(val);
          }
          return val;
        }
      });
    };

    let restoreStyles: (() => void) | null = null;
    try {
      if (gridRef.current) {
        restoreStyles = convertOklchStylesTemporarily(gridRef.current);
      }

      const canvas = await html2canvas(gridRef.current, {
        backgroundColor: '#1f2937', // gray-800
        scale: 2, // Higher quality
        useCORS: true, // For images
      });
      
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Сетка_ролей_${project.title}.png`;
      link.href = url;
      link.click();
      toast.success('Экспорт завершен');
    } catch (err) {
      console.error('[Export Error Details]:', err);
      toast.error('Ошибка при экспорте изображения');
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
      if (restoreStyles) {
        restoreStyles();
      }
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-7xl max-h-[90vh] flex flex-col border border-gray-800">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Table className="w-5 h-5 text-indigo-400" />
            Сетка ролей: {project.title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1 bg-gray-950">
          <div 
            ref={gridRef} 
            className="bg-gray-800 p-6 rounded-lg min-w-max inline-block relative"
            style={{ minWidth: '100%' }}
          >
            <div className="flex gap-4">
              {/* Main Grid */}
              <div className="flex-1 flex gap-2">
                {columns.map((col, idx) => (
                  <div key={idx} className="flex flex-col gap-2 w-32 shrink-0">
                    <div className="bg-gray-700 text-white text-center py-2 rounded text-sm font-medium truncate px-2">
                      {col.dubber}
                    </div>
                    {Array.from({ length: maxChars }).map((_, charIdx) => {
                      const char = col.chars[charIdx];
                      return (
                        <div key={charIdx} className="bg-gray-700 rounded overflow-hidden flex flex-col">
                          <div className="aspect-[3/4] bg-gray-800 relative">
                            {char?.photoUrl ? (
                              <img src={char.photoUrl} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-600">
                                <ImageIcon className="w-8 h-8 opacity-50" />
                              </div>
                            )}
                          </div>
                          <div className="p-2 text-center bg-gray-600 flex items-center justify-center min-h-[40px]">
                            <div className="text-white text-xs break-words leading-tight w-full text-center" title={char?.characterName || ''}>
                              {char?.characterName ? char.characterName : '-'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                
                {columns.length === 0 && (
                  <div className="text-gray-400 p-4">Нет распределенных ролей</div>
                )}
              </div>

              {/* Side Panel (Poster & Info) */}
              <div className="w-48 shrink-0 flex flex-col gap-4">
                <div className="bg-gray-700 rounded overflow-hidden flex flex-col shadow-lg">
                  <div className="aspect-[2/3] bg-gray-800">
                    {project.posterUrl ? (
                      <img src={project.posterUrl} alt="Poster" className="w-full h-full object-cover" crossOrigin="anonymous" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <ImageIcon className="w-12 h-12 opacity-50" />
                      </div>
                    )}
                  </div>
                  <div className="p-3 bg-gray-600 text-center">
                    <div className="text-white font-medium text-sm line-clamp-3">
                      {project.title}
                    </div>
                  </div>
                </div>
                
                <div className="bg-gray-700 rounded overflow-hidden flex flex-col">
                  <div className="bg-gray-600 text-white text-center py-2 text-sm font-medium">
                    Ударения
                  </div>
                  <div className="p-2 min-h-[100px] text-xs text-gray-300 flex flex-col gap-1.5 break-words">
                    {Object.keys(nameStresses).length > 0 ? (
                      Object.entries(nameStresses).map(([name, stressedName], idx) => (
                        <div key={idx} className="flex flex-col border-b border-gray-600 pb-1 last:border-0 last:pb-0">
                          <span className="text-white font-medium text-[13px]">{stressedName}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-gray-500 italic text-center py-4">Словарь пуст</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 rounded-b-lg">
          <button 
            onClick={handleCopyToSheets}
            className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors flex items-center gap-2 text-sm"
          >
            <Copy className="w-4 h-4" />
            Копировать для Google Таблиц
          </button>
          <button 
            onClick={handleExportPNG}
            disabled={isExporting}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {isExporting ? <span className="animate-spin text-lg leading-none">⚙</span> : <ImageIcon className="w-4 h-4" />}
            {isExporting ? 'Экспорт...' : 'Экспорт в PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}

