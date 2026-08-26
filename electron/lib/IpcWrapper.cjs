const log = require('electron-log');

/**
 * Wraps an IPC handler to provide standardized error handling and response formatting.
 * @param {Function} handler - The actual handler function.
 * @param {Function} [validator] - Optional validation function that throws an error if invalid.
 * @returns {Function} Wrapped IPC handler.
 */
function wrapIpcHandler(handler, validator) {
  return async (event, ...args) => {
    const channel = event.sender ? "unknown" : "internal"; // We can't easily get the channel name from the event here without searching ipcMain
    // It's better to pass the channel name to wrapIpcHandler if we really want it, 
    // but we can at least log the function execution if we want.
    // However, I'll stick to logging errors and key actions.
    try {
      if (validator) {
        await validator(...args);
      }
      const result = await handler(event, ...args);
      return { success: true, data: result };
    } catch (error) {
      log.error(`IPC Error:`, error);
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
