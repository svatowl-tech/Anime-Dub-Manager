const log = require('electron-log');

let ipcCounter = 0;

/**
 * Wraps an IPC handler to provide standardized error handling and response formatting.
 * @param {Function} handler - The actual handler function.
 * @param {Function} [validator] - Optional validation function that throws an error if invalid.
 * @returns {Function} Wrapped IPC handler.
 */
function wrapIpcHandler(handler, validator) {
  return async (event, ...args) => {
    ipcCounter++;
    const callId = `#${ipcCounter}`;
    const startTime = Date.now();
    const handlerName = handler.name || 'anonymous_handler';

    try {
      if (validator) {
        await validator(...args);
      }
      const result = await handler(event, ...args);
      const elapsed = Date.now() - startTime;
      if (elapsed > 2000) {
        log.warn(`[IPC Main Slow] ${callId} ${handlerName} completed after ${elapsed}ms`);
      }
      return { success: true, data: result };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      log.error(`[IPC Main Error] ${callId} ${handlerName} failed after ${elapsed}ms:`, error);
      return { 
        success: false, 
        error: error.message || String(error),
        stack: error.stack || null,
        stderr: error.stderr || null,
        stdout: error.stdout || null,
        code: error.code || null
      };
    }
  };
}

module.exports = { wrapIpcHandler };
