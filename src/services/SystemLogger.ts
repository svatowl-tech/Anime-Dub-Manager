/**
 * ============================================================================
 * SYSTEM LOGGER FOR AUDIO AI & DAW DSP PIPELINE
 * ============================================================================
 */

import { appLogger, ProcessHandle, ProcessOptions } from '../lib/appLogger';

export class SystemLogger {
  private static instance: SystemLogger;

  public static getInstance(): SystemLogger {
    if (!SystemLogger.instance) {
      SystemLogger.instance = new SystemLogger();
    }
    return SystemLogger.instance;
  }

  public info(scope: string, message: string, ...args: any[]): void {
    appLogger.log(scope, 'info', message, args.length > 0 ? args : undefined);
  }

  public warn(scope: string, message: string, ...args: any[]): void {
    appLogger.log(scope, 'warn', message, args.length > 0 ? args : undefined);
  }

  public error(scope: string, message: string, ...args: any[]): void {
    appLogger.log(scope, 'error', message, args.length > 0 ? args : undefined);
  }

  public debug(scope: string, message: string, ...args: any[]): void {
    appLogger.log(scope, 'debug', message, args.length > 0 ? args : undefined);
  }

  public startProcess(scope: string, name: string, meta?: any, options?: ProcessOptions): ProcessHandle {
    return appLogger.startProcess(scope, name, meta, options);
  }
}

export const systemLogger = SystemLogger.getInstance();
