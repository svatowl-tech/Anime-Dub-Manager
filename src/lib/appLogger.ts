/**
 * ============================================================================
 * ANIME DUB MANAGER — COMPREHENSIVE APPLICATION LOGGER & PROCESS TRACKER
 * ============================================================================
 * Централизованная система непрерывного логирования всех внутренних процессов:
 * 1. Отслеживание жизненного цикла асинхронных операций (IPC, рендеринг, DSP, сеть)
 * 2. Детектор зависаний (Hang / Long-Running Task Detector) с алертами на 3с и 10с
 * 3. Красивое цветное оформление в DevTools консоли браузера с таймстемпами .SSS
 * 4. Хранение кольцевого буфера таймлайна (1500 записей) и breadcrumbs в sessionStorage
 * 5. Глобальные утилиты: window.copyAppLogs(), window.getAppDiagnostics(), window.dumpAppLogs()
 * 6. Полная защита от циклических ссылок и крашей при сериализации
 * ============================================================================
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'process';

export interface LogEntry {
  id: string;
  seq: number;
  timestamp: string;      // ISO
  time: string;           // HH:mm:ss.SSS
  scope: string;          // e.g. IPC, AUDIO_AI, MIXING, NAV, REACT, SYSTEM
  level: LogLevel;
  message: string;
  processId?: string;
  durationMs?: number;
  details?: any;
  stack?: string;
}

export interface InFlightProcess {
  id: string;
  scope: string;
  name: string;
  startedAt: number;     // performance.now()
  startTimeStr: string;  // HH:mm:ss.SSS
  meta?: any;
  hangTimerWarn?: any;
  hangTimerError?: any;
  hangWarnFired?: boolean;
}

export interface ProcessOptions {
  expectedDurationMs?: number; // e.g. 60000ms for AI stem separation
  silentPolling?: boolean;     // don't log routine start/finish unless slow or error
  customWarnMs?: number;       // override warning delay
  customErrorMs?: number;      // override error delay
}

export interface ProcessHandle {
  id: string;
  scope: string;
  name: string;
  success: (details?: any) => void;
  fail: (err: any, details?: any) => void;
  warn: (message: string, details?: any) => void;
}

type LogListener = (entry: LogEntry) => void;

// Safe deep clone / sanitizer to prevent circular reference crashes and memory leaks
function safeSerialize(obj: any, maxDepth = 3, currentDepth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    if (typeof obj === 'function') return `[Function: ${obj.name || 'anonymous'}]`;
    if (typeof obj === 'string' && obj.length > 600) {
      return obj.slice(0, 600) + `... [длина ${obj.length} симв.]`;
    }
    return obj;
  }
  if (currentDepth >= maxDepth) return '[Object / Max Depth Exceeded]';

  // Handle errors
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
      ...(obj as any)
    };
  }

  // Handle TypedArrays & Buffers
  if (ArrayBuffer.isView(obj)) {
    return `[${obj.constructor.name}: length ${obj.byteLength} bytes]`;
  }
  if (obj instanceof ArrayBuffer) {
    return `[ArrayBuffer: ${obj.byteLength} bytes]`;
  }
  if (typeof Blob !== 'undefined' && obj instanceof Blob) {
    return `[Blob: ${obj.size} bytes, type ${obj.type}]`;
  }

  if (Array.isArray(obj)) {
    if (obj.length > 20) {
      return [...obj.slice(0, 20).map(item => safeSerialize(item, maxDepth, currentDepth + 1)), `... (${obj.length - 20} more items)`];
    }
    return obj.map(item => safeSerialize(item, maxDepth, currentDepth + 1));
  }

  const seen = new Set();
  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        copy[key] = '[Circular]';
        continue;
      }
      seen.add(value);
    }
    copy[key] = safeSerialize(value, maxDepth, currentDepth + 1);
  }
  return copy;
}

class AppLogger {
  private timeline: LogEntry[] = [];
  private maxTimelineSize = 1500;
  private seqCounter = 0;
  private processCounter = 0;
  private inFlightProcesses: Map<string, InFlightProcess> = new Map();
  private listeners: Map<string, Set<LogListener>> = new Map();
  private globalListeners: Set<LogListener> = new Set();

  constructor() {
    this.restoreBreadcrumbs();
    this.exposeGlobalHelpers();
  }

  /**
   * Восстановление логов предыдущей сессии при аварийной перезагрузке
   */
  private restoreBreadcrumbs() {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const raw = sessionStorage.getItem('anime_dub_prev_crash_breadcrumbs');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.warn(
              `%c[AppLogger] Восстановлено ${parsed.length} записей из лога предыдущей сессии до перезагрузки:`,
              'background: #78350f; color: #fde68a; font-weight: bold; padding: 2px 6px; border-radius: 4px;'
            );
          }
        }
      }
    } catch (e) {}
  }

  private persistBreadcrumb(entry: LogEntry) {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const raw = sessionStorage.getItem('anime_dub_breadcrumbs') || '[]';
        const arr: LogEntry[] = JSON.parse(raw);
        arr.push(entry);
        if (arr.length > 100) arr.shift();
        sessionStorage.setItem('anime_dub_breadcrumbs', JSON.stringify(arr));
        sessionStorage.setItem('anime_dub_prev_crash_breadcrumbs', JSON.stringify(arr));
      }
    } catch (e) {}
  }

  /**
   * Подключение глобальных хелперов в DevTools консоль браузера
   */
  private exposeGlobalHelpers() {
    if (typeof window === 'undefined') return;

    (window as any).__APP_LOGGER__ = this;
    (window as any).copyAppLogs = () => {
      return this.copyToClipboard();
    };
    (window as any).getAppDiagnostics = () => {
      return this.getDiagnostics();
    };
    (window as any).dumpAppLogs = (filterScope?: string) => {
      this.dumpToConsole(filterScope);
    };

    // Приветственный баннер в DevTools для максимальной прозрачности
    setTimeout(() => {
      console.log(
        `%c╔══════════════════════════════════════════════════════════════════════════════════════════╗\n` +
        `║ 🎬 ANIME DUB MANAGER — ДИАГНОСТИЧЕСКОЕ ЛОГИРОВАНИЕ ВСЕХ ПРОЦЕССОВ АКТИВИРОВАНО          ║\n` +
        `║ • Скопировать весь лог в буфер:  copyAppLogs() или кнопка "📋 Логи" в меню               ║\n` +
        `║ • Получить статус зависаний:     getAppDiagnostics()                                     ║\n` +
        `║ • Вывести таймлайн процессов:    dumpAppLogs()                                           ║\n` +
        `╚══════════════════════════════════════════════════════════════════════════════════════════╝`,
        'color: #38bdf8; font-weight: bold; font-family: monospace;'
      );
    }, 500);
  }

  /**
   * Базовый метод логирования произвольного события
   */
  public log(scope: string, level: LogLevel, message: string, details?: any, processId?: string, durationMs?: number): LogEntry {
    const now = new Date();
    const time = now.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    this.seqCounter++;

    const entry: LogEntry = {
      id: `log_${this.seqCounter}_${Date.now()}`,
      seq: this.seqCounter,
      timestamp: now.toISOString(),
      time,
      scope: scope.toUpperCase(),
      level,
      message,
      processId,
      durationMs,
      details: safeSerialize(details),
      stack: (details instanceof Error && details.stack) ? details.stack : undefined
    };

    // Сохраняем в кольцевой буфер
    this.timeline.push(entry);
    if (this.timeline.length > this.maxTimelineSize) {
      this.timeline.shift();
    }

    if (level === 'error' || level === 'warn') {
      this.persistBreadcrumb(entry);
    }

    // Красивое цветное оформление в DevTools
    this.printToDevTools(entry);

    // Уведомление слушателей
    this.notifyListeners(entry);

    return entry;
  }

  /**
   * Стилизованный вывод в браузерную консоль
   */
  private printToDevTools(entry: LogEntry) {
    const { time, scope, level, message, details, durationMs } = entry;

    const timeStyle = 'color: #94a3b8; font-weight: 500; font-family: monospace; font-size: 11px;';
    
    // Цветовая палитра по скоупам
    const scopeColors: Record<string, { bg: string; text: string }> = {
      IPC: { bg: 'rgba(6, 182, 212, 0.18)', text: '#22d3ee' },
      AUDIO_AI: { bg: 'rgba(168, 85, 247, 0.18)', text: '#c084fc' },
      MIXING: { bg: 'rgba(245, 158, 11, 0.18)', text: '#fbbf24' },
      TIMING: { bg: 'rgba(16, 185, 129, 0.18)', text: '#34d399' },
      DATABASE: { bg: 'rgba(59, 130, 246, 0.18)', text: '#60a5fa' },
      TELEGRAM: { bg: 'rgba(14, 165, 233, 0.18)', text: '#38bdf8' },
      NAV: { bg: 'rgba(236, 72, 153, 0.18)', text: '#f472b6' },
      REACT: { bg: 'rgba(99, 102, 241, 0.18)', text: '#818cf8' },
      CRASH: { bg: '#dc2626', text: '#ffffff' },
      HANG: { bg: '#b45309', text: '#fef3c7' }
    };

    const sc = scopeColors[scope] || { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1' };
    const scopeStyle = `background: ${sc.bg}; color: ${sc.text}; font-weight: 700; padding: 1px 6px; border-radius: 4px;`;

    let levelIcon = 'ℹ️';
    let msgStyle = 'color: #f1f5f9; font-weight: 500;';

    if (level === 'error') {
      levelIcon = '❌';
      msgStyle = 'color: #f87171; font-weight: 800; font-size: 12px;';
    } else if (level === 'warn') {
      levelIcon = '⚠️';
      msgStyle = 'color: #facc15; font-weight: 700;';
    } else if (level === 'debug') {
      levelIcon = '🔍';
      msgStyle = 'color: #94a3b8; font-style: italic;';
    } else if (level === 'process') {
      levelIcon = durationMs !== undefined ? '✓' : '▶';
      msgStyle = durationMs !== undefined ? 'color: #4ade80; font-weight: 600;' : 'color: #38bdf8; font-weight: 600;';
    }

    const durText = durationMs !== undefined ? `%c(${durationMs}ms)` : '';
    const durStyle = 'color: #a3e635; font-weight: 600; font-family: monospace; font-size: 11px;';

    const header = `%c[${time}]%c %c[${scope}]%c ${levelIcon} %c${message} ${durText}`;
    const headerArgs = [
      timeStyle,
      '',
      scopeStyle,
      '',
      msgStyle
    ];

    if (durationMs !== undefined) {
      headerArgs.push(durStyle);
    }

    if (level === 'error') {
      if (details !== undefined) {
        console.error(header, ...headerArgs, details);
      } else {
        console.error(header, ...headerArgs);
      }
    } else if (level === 'warn') {
      if (details !== undefined) {
        console.warn(header, ...headerArgs, details);
      } else {
        console.warn(header, ...headerArgs);
      }
    } else if (level === 'debug') {
      if (details !== undefined) {
        console.debug(header, ...headerArgs, details);
      } else {
        console.debug(header, ...headerArgs);
      }
    } else {
      if (details !== undefined) {
        console.log(header, ...headerArgs, details);
      } else {
        console.log(header, ...headerArgs);
      }
    }
  }

  /**
   * =========================================================================
   * ДЕТЕКТОР ЗАВИСАНИЙ И УПРАВЛЕНИЕ ЖИЗНЕННЫМ ЦИКЛОМ ПРОЦЕССОВ (Process Tracker)
   * =========================================================================
   */
  public startProcess(scope: string, name: string, meta?: any, options?: ProcessOptions): ProcessHandle {
    this.processCounter++;
    const procId = `p#${this.processCounter}-${name}`;
    const startedAt = performance.now();
    const now = new Date();
    const startTimeStr = now.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const isSilent = Boolean(options?.silentPolling);
    const expectedMs = options?.expectedDurationMs;

    // Вычисляем адаптивные пороги задержки
    let warnDelay = 6000;   // Базовый порог предупреждения: 6 сек (вместо 3)
    let errorDelay = 25000; // Базовый порог зависания: 25 сек (вместо 10)

    if (options?.customWarnMs) {
      warnDelay = options.customWarnMs;
    } else if (expectedMs && expectedMs > 0) {
      // Для тяжелых задач (AI, рендеринг, транскодирование, загрузки)
      warnDelay = Math.max(15000, Math.round(expectedMs * 0.8));
    } else if (isSilent) {
      // Для фонового опроса
      warnDelay = 10000;
    }

    if (options?.customErrorMs) {
      errorDelay = options.customErrorMs;
    } else if (expectedMs && expectedMs > 0) {
      // Подозрение на сбой для тяжелых задач ставим с запасом в 2.5x от расчетного
      errorDelay = Math.max(50000, Math.round(expectedMs * 2.5));
    } else if (isSilent) {
      errorDelay = 30000;
    }

    // Логируем старт (если не тихий режим опроса)
    if (!isSilent) {
      const startNote = expectedMs ? ` (расчетное время ~${Math.round(expectedMs / 1000)}с)` : '';
      this.log(scope, 'process', `▶ Запуск: «${name}»${startNote}`, meta, procId);
    }

    let hangWarnFired = false;

    // Устанавливаем адаптивные таймеры контроля зависания
    const hangTimerWarn = setTimeout(() => {
      hangWarnFired = true;
      const elapsed = Math.round(performance.now() - startedAt);
      
      if (expectedMs && expectedMs > 0) {
        // Для тяжелых задач выводим информационное подтверждение продолжения работы (НЕ как ошибку)
        this.log(
          scope,
          'info',
          `⏳ [ПРОЦЕСС ВЫПОЛНЯЕТСЯ] «${name}» (${procId}) выполняется уже ${elapsed}ms (тяжелая фоновая задача, ожидание в пределах нормы ~${Math.round(expectedMs / 1000)}с)...`,
          { scope, name, elapsedMs: elapsed, meta },
          procId
        );
      } else if (isSilent) {
        // Фоновый опрос задержался дольше обычного
        this.log(
          'HANG',
          'warn',
          `⏳ [ЗАДЕРЖКА ФОНОВОГО ОПРОСА] Фоновый вызов «${name}» (${procId}) выполняется уже ${elapsed}ms...`,
          { scope, name, elapsedMs: elapsed, meta },
          procId
        );
      } else {
        this.log(
          'HANG',
          'warn',
          `⏳ [ВНИМАНИЕ / ЗАДЕРЖКА] Процесс «${name}» (${procId}) выполняется уже ${elapsed}ms без ответа...`,
          { scope, name, elapsedMs: elapsed, meta },
          procId
        );
      }
    }, warnDelay);

    const hangTimerError = setTimeout(() => {
      const elapsed = Math.round(performance.now() - startedAt);
      if (expectedMs && expectedMs > 0) {
        this.log(
          'HANG',
          'warn',
          `⚠️ [ПРЕВЫШЕН ЛИМИТ ВРЕМЕНИ] Длительная операция «${name}» (${procId}) выполняется уже ${elapsed}ms (превышение расчетных ~${Math.round(expectedMs / 1000)}с). Проверьте системные ресурсы.`,
          { scope, name, elapsedMs: elapsed, meta },
          procId
        );
      } else {
        this.log(
          'HANG',
          'error',
          `🚨 [КРИТИЧЕСКОЕ ЗАВИСАНИЕ] Процесс «${name}» (${procId}) не отвечает более ${elapsed}ms! Возможен краш или бесконечный цикл.`,
          { scope, name, elapsedMs: elapsed, meta },
          procId
        );
      }
    }, errorDelay);

    const inFlight: InFlightProcess = {
      id: procId,
      scope,
      name,
      startedAt,
      startTimeStr,
      meta: safeSerialize(meta),
      hangTimerWarn,
      hangTimerError,
      hangWarnFired: false
    };

    this.inFlightProcesses.set(procId, inFlight);

    const clearTimers = () => {
      if (inFlight.hangTimerWarn) clearTimeout(inFlight.hangTimerWarn);
      if (inFlight.hangTimerError) clearTimeout(inFlight.hangTimerError);
      this.inFlightProcesses.delete(procId);
    };

    return {
      id: procId,
      scope,
      name,
      success: (details?: any) => {
        clearTimers();
        const durationMs = Math.round(performance.now() - startedAt);
        
        if (hangWarnFired) {
          // Если ранее сработал алерт о задержке, информируем об успешном выходе из задержки
          this.log(
            scope,
            'process',
            `✓ [ВОССТАНОВЛЕНО / ЗАВЕРШЕНО] «${name}» успешно выполнен за ${durationMs}ms (система отработала штатно)`,
            details,
            procId,
            durationMs
          );
        } else if (!isSilent) {
          this.log(scope, 'process', `✓ Завершен: «${name}»`, details, procId, durationMs);
        }
      },
      fail: (err: any, details?: any) => {
        clearTimers();
        const durationMs = Math.round(performance.now() - startedAt);
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(
          scope,
          'error',
          `❌ Сбой процесса: «${name}» (${durationMs}ms): ${errMsg}`,
          { error: safeSerialize(err), ...(details ? { details: safeSerialize(details) } : {}) },
          procId,
          durationMs
        );
      },
      warn: (message: string, details?: any) => {
        const elapsed = Math.round(performance.now() - startedAt);
        this.log(scope, 'warn', `⚠️ «${name}» [${elapsed}ms]: ${message}`, details, procId);
      }
    };
  }

  public info(scope: string, message: string, details?: any) {
    this.log(scope, 'info', message, details);
  }

  public warn(scope: string, message: string, details?: any) {
    this.log(scope, 'warn', message, details);
  }

  public error(scope: string, message: string, details?: any) {
    this.log(scope, 'error', message, details);
  }

  public debug(scope: string, message: string, details?: any) {
    this.log(scope, 'debug', message, details);
  }

  public getInFlightProcesses(): InFlightProcess[] {
    return Array.from(this.inFlightProcesses.values()).map(p => ({
      ...p,
      elapsedMs: Math.round(performance.now() - p.startedAt)
    })) as any;
  }

  public getTimeline(): LogEntry[] {
    return [...this.timeline];
  }

  public getLogs(scope: string): LogEntry[] {
    const upper = scope.toUpperCase();
    return this.timeline.filter(e => e.scope === upper);
  }

  public clearLogs(scope?: string) {
    if (scope) {
      const upper = scope.toUpperCase();
      this.timeline = this.timeline.filter(e => e.scope !== upper);
    } else {
      this.timeline = [];
    }
  }

  /**
   * Подписка на поток логов
   */
  public subscribe(scopeOrAll: string | 'all', listener: LogListener): () => void {
    if (scopeOrAll === 'all') {
      this.globalListeners.add(listener);
      return () => { this.globalListeners.delete(listener); };
    }

    const key = scopeOrAll.toUpperCase();
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);

    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(listener);
      }
    };
  }

  private notifyListeners(entry: LogEntry) {
    this.globalListeners.forEach(fn => {
      try { fn(entry); } catch (e) {}
    });

    const scoped = this.listeners.get(entry.scope);
    if (scoped) {
      scoped.forEach(fn => {
        try { fn(entry); } catch (e) {}
      });
    }
  }

  /**
   * =========================================================================
   * ДИАГНОСТИЧЕСКИЙ ОТЧЕТ И СКОПИРОВАТЬ В БУФЕР ОБМЕНА (One-Click Copy Logs)
   * =========================================================================
   */
  public getDiagnostics() {
    const memory = (performance as any).memory ? {
      usedJSHeapMB: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
      totalJSHeapMB: Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024),
      limitMB: Math.round((performance as any).memory.jsHeapSizeLimit / 1024 / 1024)
    } : null;

    const inFlight = this.getInFlightProcesses();

    return {
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      isElectron: typeof window !== 'undefined' && Boolean((window as any).electronAPI),
      memory,
      inFlightCount: inFlight.length,
      inFlight,
      totalLogsRecorded: this.timeline.length,
      recentErrorsCount: this.timeline.filter(e => e.level === 'error').length,
      recentWarnsCount: this.timeline.filter(e => e.level === 'warn').length
    };
  }

  public formatReportText(): string {
    const diag = this.getDiagnostics();
    const lines: string[] = [];

    lines.push('================================================================================');
    lines.push('          ANIME DUB MANAGER — ПОЛНЫЙ ДИАГНОСТИЧЕСКИЙ ЛОГ ПРОЦЕССОВ');
    lines.push('================================================================================');
    lines.push(`Время генерации:  ${diag.timestamp}`);
    lines.push(`Платформа:        ${diag.isElectron ? 'Electron Desktop' : 'Web Browser Preview'}`);
    lines.push(`Браузер / Агент:  ${diag.userAgent}`);
    if (diag.memory) {
      lines.push(`Память JS Heap:   ${diag.memory.usedJSHeapMB} MB / ${diag.memory.totalJSHeapMB} MB (Лимит: ${diag.memory.limitMB} MB)`);
    }
    lines.push(`Всего событий:    ${diag.totalLogsRecorded} | Ошибок: ${diag.recentErrorsCount} | Предупреждений: ${diag.recentWarnsCount}`);
    
    if (diag.inFlightCount > 0) {
      lines.push('--------------------------------------------------------------------------------');
      lines.push(`⚠️ АКТИВНЫЕ / НЕЗАВЕРШЕННЫЕ ПРОЦЕССЫ НА МОМЕНТ ОТЧЕТА (${diag.inFlightCount}):`);
      diag.inFlight.forEach((p: any) => {
        lines.push(`  • [${p.scope}] «${p.name}» (ID: ${p.id}) — выполняется уже ${p.elapsedMs}ms (старт: ${p.startTimeStr})`);
        if (p.meta) {
          lines.push(`    Параметры: ${JSON.stringify(p.meta)}`);
        }
      });
    } else {
      lines.push('Активные процессы: Нет зависших процессов.');
    }

    lines.push('================================================================================');
    lines.push('                     ХРОНОЛОГИЧЕСКИЙ ТАЙМЛАЙН СОБЫТИЙ:');
    lines.push('================================================================================');

    for (const item of this.timeline) {
      const dur = item.durationMs !== undefined ? ` [${item.durationMs}ms]` : '';
      const lvl = item.level.toUpperCase().padEnd(7, ' ');
      lines.push(`[${item.time}] [${lvl}] [${item.scope.padEnd(8, ' ')}] ${item.message}${dur}`);
      if (item.details !== undefined && item.details !== null) {
        try {
          const detStr = typeof item.details === 'string' ? item.details : JSON.stringify(item.details, null, 2);
          if (detStr && detStr !== '{}' && detStr !== '""') {
            lines.push(`    Детали: ${detStr.replace(/\n/g, '\n    ')}`);
          }
        } catch (e) {}
      }
      if (item.stack) {
        lines.push(`    Стек ошибки:\n    ${item.stack.replace(/\n/g, '\n    ')}`);
      }
    }

    lines.push('================================================================================');
    lines.push('                      КОНЕЦ ДИАГНОСТИЧЕСКОГО ОТЧЕТА');
    lines.push('================================================================================');

    return lines.join('\n');
  }

  public async copyToClipboard(): Promise<boolean> {
    const report = this.formatReportText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(report);
        console.log(
          '%c✓ Полный лог всех процессов приложения успешно скопирован в буфер обмена!',
          'background: #065f46; color: #a7f3d0; font-weight: bold; font-size: 13px; padding: 4px 10px; border-radius: 4px;'
        );
        return true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        console.log(
          '%c✓ Полный лог всех процессов приложения успешно скопирован в буфер обмена (fallback)!',
          'background: #065f46; color: #a7f3d0; font-weight: bold; font-size: 13px; padding: 4px 10px; border-radius: 4px;'
        );
        return true;
      }
    } catch (err) {
      console.error('Не удалось скопировать лог в буфер обмена:', err);
      return false;
    }
  }

  public dumpToConsole(filterScope?: string) {
    const filter = filterScope ? filterScope.toUpperCase() : null;
    const entries = filter ? this.timeline.filter(e => e.scope === filter) : this.timeline;
    console.group(`📋 [AppLogger Dump] Всего записей: ${entries.length}${filter ? ` (Scope: ${filter})` : ''}`);
    entries.forEach(e => this.printToDevTools(e));
    console.groupEnd();
  }
}

export const appLogger = new AppLogger();
