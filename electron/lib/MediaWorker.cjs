const log = require('electron-log');

/**
 * MediaWorker handles the execution of FFmpeg processes.
 */
class MediaWorker {
  /**
   * Execute an FFmpeg task
   * @param {Function} taskFn - The FFmpeg service function (bakeSubtitles, etc.)
   * @param {Array} args - Arguments for the function
   * @param {Function} onProgress - Callback for progress updates
   * @param {Function} onCommand - Callback to register the process
   */
  static async execute(taskFn, args, onProgress, onCommand) {
    return await taskFn(...args, onProgress, onCommand);
  }
}

module.exports = MediaWorker;
