export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: string;
  time: string;
  scope: string;
  level: LogLevel;
  message: string;
  details?: any;
}

type LogListener = (entry: LogEntry) => void;

class AppLogger {
  private logs: Map<string, LogEntry[]> = new Map();
  private listeners: Map<string, Set<LogListener>> = new Map();
  private maxLogsPerScope = 100;

  public log(scope: string, level: LogLevel, message: string, details?: any) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: now.toISOString(),
      time,
      scope,
      level,
      message,
      details
    };

    // Format console output
    const prefix = `[${scope} ${time}]`;
    if (level === 'error') {
      console.error(`${prefix} ❌`, message, details !== undefined ? details : '');
    } else if (level === 'warn') {
      console.warn(`${prefix} ⚠️`, message, details !== undefined ? details : '');
    } else if (level === 'debug') {
      console.debug(`${prefix} 🔍`, message, details !== undefined ? details : '');
    } else {
      console.log(`${prefix} ℹ️`, message, details !== undefined ? details : '');
    }

    // Save to scope buffer
    if (!this.logs.has(scope)) {
      this.logs.set(scope, []);
    }
    const scopeLogs = this.logs.get(scope)!;
    scopeLogs.push(entry);
    if (scopeLogs.length > this.maxLogsPerScope) {
      scopeLogs.shift();
    }

    // Notify listeners
    const scopeListeners = this.listeners.get(scope);
    if (scopeListeners) {
      scopeListeners.forEach(listener => {
        try {
          listener(entry);
        } catch (err) {
          console.error('[AppLogger] Error in listener callback:', err);
        }
      });
    }
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

  public getLogs(scope: string): LogEntry[] {
    return this.logs.get(scope) || [];
  }

  public clearLogs(scope: string) {
    this.logs.set(scope, []);
    const scopeListeners = this.listeners.get(scope);
    if (scopeListeners) {
      // Send a dummy notification or clear signal if needed
    }
  }

  public subscribe(scope: string, listener: LogListener): () => void {
    if (!this.listeners.has(scope)) {
      this.listeners.set(scope, new Set());
    }
    this.listeners.get(scope)!.add(listener);

    return () => {
      const scopeListeners = this.listeners.get(scope);
      if (scopeListeners) {
        scopeListeners.delete(listener);
      }
    };
  }
}

export const appLogger = new AppLogger();
