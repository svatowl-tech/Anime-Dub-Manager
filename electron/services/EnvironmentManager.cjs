const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const log = require('electron-log');

class EnvironmentManager {
  /**
   * Запускает процесс скачивания и установки портативной среды (Python + DeepFilterNet3 + Demucs v4 + WhisperX).
   * 
   * @param {string} url URL-адрес для скачивания архива
   * @param {Object} window Объект окна Electron (BrowserWindow), содержащий webContents
   */
  async downloadAndInstall(url, window) {
    let axios;
    let extract;
    try {
      axios = require('axios');
      extract = require('extract-zip');
    } catch (reqErr) {
      log.error('[EnvironmentManager] Не удалось загрузить зависимости axios или extract-zip. Выполните npm install.', reqErr);
      this._sendProgress(window, { status: 'error', percent: 0, message: 'Отсутствуют зависимости (axios/extract-zip). Пожалуйста, выполните npm install.' });
      throw reqErr;
    }

    // Получаем защищенную директорию пользователя и определяем целевую папку
    const userDataPath = typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd();
    const targetDir = path.join(userDataPath, 'ai_env');
    const zipPath = path.join(userDataPath, 'ai_env_temp.zip');

    try {
      // Отправляем начальный статус
      this._sendProgress(window, { status: 'downloading', percent: 0, message: 'Инициализация загрузки AI среды...' });

      // Очищаем предыдущие неудачные попытки скачивания (если файл остался)
      if (fs.existsSync(zipPath)) {
        await fsPromises.rm(zipPath, { force: true });
      }

      // Создаем целевую директорию, если она не существует
      await fsPromises.mkdir(targetDir, { recursive: true });

      log.info(`[EnvironmentManager] Начинаем скачивание из ${url} в ${zipPath}`);

      // Запрашиваем файл в виде потока (stream), чтобы не загружать весь файл в RAM
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'AnimeDubManager-Desktop'
        }
      });

      // Пытаемся получить общий размер файла из заголовков ответа для расчета процентов
      const totalLength = parseInt(response.headers['content-length'], 10);
      let downloadedLength = 0;

      // Создаем поток записи на диск
      const writer = fs.createWriteStream(zipPath);

      // Оборачиваем скачивание в Promise для удобного отслеживания завершения
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;

          // Рассчитываем процент, если общий размер известен
          if (totalLength && totalLength > 0) {
            const percent = Math.min(100, Math.round((downloadedLength / totalLength) * 100));
            this._sendProgress(window, { 
              status: 'downloading', 
              percent, 
              message: `Скачивание нейросетевой среды: ${percent}%` 
            });
          } else {
            // Если сервер не отдал content-length, просто показываем объем скачанного
            const mb = (downloadedLength / (1024 * 1024)).toFixed(1);
            this._sendProgress(window, { 
              status: 'downloading', 
              percent: 0, 
              message: `Скачивание: ${mb} MB` 
            });
          }
        });

        // Перенаправляем (pipe) получаемые данные прямо в файловый поток записи
        response.data.pipe(writer);

        writer.on('finish', () => resolve());
        writer.on('error', (err) => reject(err));
        response.data.on('error', (err) => reject(err));
      });

      log.info(`[EnvironmentManager] Скачивание завершено. Начинаем распаковку в ${targetDir}`);
      this._sendProgress(window, { status: 'extracting', percent: 0, message: 'Распаковка и настройка нейросетевой среды...' });

      // Распаковываем архив
      try {
        await extract(zipPath, { dir: targetDir });
      } catch (extractError) {
        log.error('[EnvironmentManager] Ошибка при распаковке:', extractError);
        if (fs.existsSync(targetDir)) {
          await fsPromises.rm(targetDir, { recursive: true, force: true });
        }
        throw new Error(`Ошибка распаковки: ${extractError.message}`);
      }

      // Настройка прав исполнения на Unix (Linux / macOS)
      if (process.platform !== 'win32') {
        this._fixPosixPermissions(targetDir);
      }

      log.info(`[EnvironmentManager] Среда AI_env успешно установлена в ${targetDir}`);
      this._sendProgress(window, { status: 'ready', percent: 100, message: 'Среда AI_env готова к работе' });

    } catch (error) {
      log.error('[EnvironmentManager] Ошибка загрузки/установки среды:', error);
      this._sendProgress(window, { status: 'error', percent: 0, message: error.message || 'Неизвестная ошибка' });

      // Очистка частично скачанного архива при сбое
      if (fs.existsSync(zipPath)) {
         try {
           await fsPromises.rm(zipPath, { force: true });
         } catch (rmError) {
           log.error('[EnvironmentManager] Не удалось удалить временный архив:', rmError);
         }
      }
    } finally {
      if (fs.existsSync(zipPath)) {
        try {
          await fsPromises.rm(zipPath, { force: true });
        } catch (rmError) {
          log.error('[EnvironmentManager] Не удалось удалить временный архив после установки:', rmError);
        }
      }
    }
  }

  /**
   * Назначает флаг исполняемости для Python-бинарников на POSIX системах.
   */
  _fixPosixPermissions(dir) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
          this._fixPosixPermissions(fullPath);
        } else if (
          file.name === 'python' || 
          file.name === 'python3' || 
          file.name.startsWith('python3.') || 
          fullPath.includes('/bin/')
        ) {
          try {
            fs.chmodSync(fullPath, 0o755);
          } catch (e) {}
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при назначении прав POSIX:', err);
    }
  }

  /**
   * Возвращает валидный путь к исполняемому файлу Python (из ai_env, whisperlivekit, venv или системы).
   */
  getPythonPath() {
    const isWin = process.platform === 'win32';
    const candidatePaths = [];

    if (typeof app !== 'undefined' && app.getPath) {
      try {
        const userData = app.getPath('userData');
        if (isWin) {
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'Scripts', 'python.exe'));
        } else {
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'bin', 'python'));
        }
      } catch (e) {}
    }

    // Check application folder and cwd
    const cwd = process.cwd();
    if (isWin) {
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python.exe'));
      candidatePaths.push(path.join(cwd, 'venv', 'Scripts', 'python.exe'));
      candidatePaths.push(path.join(cwd, '.venv', 'Scripts', 'python.exe'));
    } else {
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'bin', 'python3'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'bin', 'python3'));
      candidatePaths.push(path.join(cwd, 'ai_env', 'python'));
      candidatePaths.push(path.join(cwd, 'venv', 'bin', 'python'));
      candidatePaths.push(path.join(cwd, '.venv', 'bin', 'python'));
    }

    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    }

    // Fallback to system Python
    return isWin ? 'python' : 'python3';
  }

  async isEnvironmentReady() {
    const pythonPath = this.getPythonPath();
    if (pythonPath === 'python' || pythonPath === 'python3') {
      const userDataPath = typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : process.cwd();
      const targetDir = path.join(userDataPath, 'ai_env');
      try {
        const stats = await fsPromises.stat(targetDir);
        return stats.isDirectory();
      } catch (e) {
        return false;
      }
    }
    return fs.existsSync(pythonPath);
  }

  /**
   * Вспомогательный метод для отправки событий в Renderer-процесс
   */
  _sendProgress(window, payload) {
    if (window && window.webContents) {
      window.webContents.send('env-download-progress', payload);
    }
  }
}

module.exports = new EnvironmentManager();
