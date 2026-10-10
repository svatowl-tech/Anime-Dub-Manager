import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, Copy, RefreshCw, Home, Terminal, ShieldAlert } from 'lucide-react';
import { appLogger } from '../../lib/appLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    // Detailed console banner for DevTools
    console.group('%c🚨 [КРИТИЧЕСКИЙ СБОЙ REACT] Перехвачена фатальная ошибка компонента!', 'background: #dc2626; color: #ffffff; font-weight: bold; font-size: 14px; padding: 4px 8px; border-radius: 4px;');
    console.error('Ошибка:', error);
    console.error('Стек компонента:', errorInfo.componentStack);
    console.groupEnd();

    // Log to appLogger with stack and diagnostics
    appLogger.log(
      'CRASH',
      'error',
      `🚨 Фатальный сбой рендеринга React: ${error.message || String(error)}`,
      {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack,
        componentStack: errorInfo.componentStack
      }
    );
  }

  handleCopyDiagnostics = async () => {
    const success = await appLogger.copyToClipboard();
    if (success) {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    }
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleResetToHome = () => {
    try {
      if (typeof window !== 'undefined') {
        window.location.hash = '';
      }
    } catch (e) {}
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, copied } = this.state;
      const inFlight = appLogger.getInFlightProcesses();

      return (
        <div className="min-h-screen bg-[#07090e] text-neutral-100 flex flex-col items-center justify-center p-6 select-text font-sans">
          <div className="w-full max-w-4xl bg-neutral-900/90 border border-red-900/60 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-neutral-800 pb-5">
              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-red-950/80 border border-red-700/50 rounded-xl text-red-400">
                  <AlertOctagon className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-red-100 flex items-center gap-2">
                    <span>Сбой работы приложения</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800/60 font-mono">
                      React Crash Caught
                    </span>
                  </h1>
                  <p className="text-xs text-neutral-400 mt-1">
                    Произошла непредвиденная ошибка в интерфейсе. Все логи процессов сохранены в буфере.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={this.handleCopyDiagnostics}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition shadow-lg ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 hover:bg-red-500 text-white'
                  }`}
                  title="Скопировать детальный лог всех процессов для передачи разработчику"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copied ? '✓ Скопировано в буфер!' : '📋 Скопировать лог для отчета'}</span>
                </button>
              </div>
            </div>

            {/* Error Message Display */}
            <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-4 font-mono text-xs text-red-200 space-y-2">
              <div className="text-neutral-400 text-[11px] font-semibold flex items-center gap-1.5 uppercase tracking-wider">
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span>Исключение:</span>
              </div>
              <div className="text-sm font-bold text-red-300 break-words">
                {error?.name}: {error?.message}
              </div>
              {error?.stack && (
                <div className="text-[11px] text-red-300/70 max-h-40 overflow-y-auto whitespace-pre-wrap pt-2 border-t border-red-900/30">
                  {error.stack}
                </div>
              )}
            </div>

            {/* In-Flight hanging tasks if any */}
            {inFlight.length > 0 && (
              <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-4 text-xs space-y-2">
                <div className="text-amber-300 font-bold flex items-center gap-2">
                  <span>⏳ Незавершенные фоновые процессы на момент сбоя ({inFlight.length}):</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-amber-200/90 max-h-32 overflow-y-auto">
                  {inFlight.map((p: any) => (
                    <div key={p.id} className="truncate">
                      • [{p.scope}] {p.name} — выполняется {p.elapsedMs}ms
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Component Stack Trace */}
            {errorInfo?.componentStack && (
              <div className="space-y-2">
                <div className="text-xs text-neutral-400 font-semibold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Иерархия компонентов (Component Stack):</span>
                </div>
                <div className="bg-black/60 border border-neutral-800 rounded-xl p-3 font-mono text-[11px] text-neutral-400 max-h-36 overflow-y-auto whitespace-pre">
                  {errorInfo.componentStack}
                </div>
              </div>
            )}

            {/* Recovery actions footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-800">
              <div className="text-xs text-neutral-400">
                Совет: Вы можете также открыть DevTools (<kbd className="px-1.5 py-0.5 bg-neutral-800 rounded border border-neutral-700 font-mono text-[10px]">F12</kbd>) и вызвать <code className="text-sky-300 font-mono">copyAppLogs()</code>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={this.handleResetToHome}
                  className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Home className="w-4 h-4 text-neutral-400" />
                  <span>Вернуться на Главную</span>
                </button>

                <button
                  onClick={this.handleReload}
                  className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Перезагрузить страницу</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
