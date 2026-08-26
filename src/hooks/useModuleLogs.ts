import { useState, useEffect, useCallback } from 'react';
import { appLogger, LogEntry } from '../lib/appLogger';

export function useModuleLogs(scope: string) {
  const [logs, setLogs] = useState<LogEntry[]>(() => appLogger.getLogs(scope));

  useEffect(() => {
    setLogs(appLogger.getLogs(scope));
    const unsubscribe = appLogger.subscribe(scope, (entry) => {
      setLogs(prev => [...prev.slice(-99), entry]);
    });
    return unsubscribe;
  }, [scope]);

  const clearLogs = useCallback(() => {
    appLogger.clearLogs(scope);
    setLogs([]);
  }, [scope]);

  return { logs, clearLogs };
}
