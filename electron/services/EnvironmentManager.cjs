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
   * Проверяет, действительно ли исполняемый файл Python запускается в системе (не битый симлинк/shim).
   */
  _isPythonExecutableWorking(executablePath) {
    if (!executablePath) return false;
    try {
      const { spawnSync } = require('child_process');
      const test = spawnSync(executablePath, ['-c', 'import sys; sys.exit(0)'], {
        timeout: 4000,
        windowsHide: true,
        stdio: 'ignore'
      });
      return test.status === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Ищет установленный системный Python на Windows/macOS/Linux.
   */
  _findSystemPython() {
    const isWin = process.platform === 'win32';
    const { spawnSync } = require('child_process');
    const systemCandidates = [];

    if (isWin) {
      // 1. Поиск через where.exe
      try {
        const whereRes = spawnSync('where.exe', ['python.exe'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
        if (whereRes.status === 0 && whereRes.stdout) {
          const lines = whereRes.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            // Исключаем заглушки WindowsApps (0 байт alias к магазину Windows)
            if (!line.toLowerCase().includes('windowsapps')) {
              systemCandidates.push(line);
            }
          }
        }
      } catch (e) {}

      // 2. Стандартные папки установки Python на Windows
      const userProfile = process.env.USERPROFILE || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const systemDrive = process.env.SystemDrive || 'C:';

      const pythonVersions = ['Python310', 'Python311', 'Python312', 'Python39', 'Python38', 'Python313'];
      for (const ver of pythonVersions) {
        if (localAppData) systemCandidates.push(path.join(localAppData, 'Programs', 'Python', ver, 'python.exe'));
        if (progFiles) systemCandidates.push(path.join(progFiles, ver, 'python.exe'));
        if (progFilesX86) systemCandidates.push(path.join(progFilesX86, ver, 'python.exe'));
        systemCandidates.push(path.join(systemDrive, ver, 'python.exe'));
      }

      // Conda / Miniconda
      if (userProfile) {
        systemCandidates.push(path.join(userProfile, 'anaconda3', 'python.exe'));
        systemCandidates.push(path.join(userProfile, 'miniconda3', 'python.exe'));
      }
    } else {
      systemCandidates.push('/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3', 'python3', 'python');
    }

    for (const cand of systemCandidates) {
      if (this._isPythonExecutableWorking(cand)) {
        log.info(`[EnvironmentManager] Найден рабочий системный Python: ${cand}`);
        return cand;
      }
    }
    return null;
  }

  /**
   * Автоматически восстанавливает pyvenv.cfg, если home указывает на несуществующую папку CI-билда.
   */
  _autoRepairPyvenvCfg(envDir, workingPythonPath) {
    if (!envDir || !workingPythonPath) return;
    const cfgPath = path.join(envDir, 'pyvenv.cfg');
    try {
      if (!fs.existsSync(cfgPath)) return;
      const content = fs.readFileSync(cfgPath, 'utf8');
      const lines = content.split(/\r?\n/);
      let modified = false;
      const newLines = lines.map(line => {
        if (line.trim().startsWith('home =')) {
          const oldHome = line.split('=')[1]?.trim();
          if (oldHome && !fs.existsSync(oldHome)) {
            const newHome = path.dirname(workingPythonPath);
            log.info(`[EnvironmentManager] Восстановление pyvenv.cfg: ${oldHome} -> ${newHome}`);
            modified = true;
            return `home = ${newHome}`;
          }
        }
        return line;
      });
      if (modified) {
        fs.writeFileSync(cfgPath, newLines.join('\n'), 'utf8');
      }
    } catch (e) {
      log.warn('[EnvironmentManager] Не удалось обновить pyvenv.cfg:', e);
    }
  }

  /**
   * Возвращает папки site-packages внутри ai_env для проброса через PYTHONPATH.
   */
  getPythonSitePackagesDirs() {
    const isWin = process.platform === 'win32';
    const dirs = [];
    const roots = [];
    if (typeof app !== 'undefined' && app.getPath) {
      try { roots.push(app.getPath('userData')); } catch (e) {}
    }
    roots.push(process.cwd());

    for (const r of roots) {
      const aiEnv = path.join(r, 'ai_env');
      const candidates = [
        path.join(aiEnv, 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'Lib', 'site-packages'),
        path.join(aiEnv, 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'python3.10', 'site-packages')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) dirs.push(c);
      }
    }
    return [...new Set(dirs)];
  }

  /**
   * Возвращает валидный, протестированный путь к исполняемому файлу Python.
   */
  getPythonPath() {
    const isWin = process.platform === 'win32';
    const candidatePaths = [];
    let userData = null;

    if (typeof app !== 'undefined' && app.getPath) {
      try {
        userData = app.getPath('userData');
        if (isWin) {
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'whisperlivekit', 'venv', 'Scripts', 'python.exe'));
        } else {
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'bin', 'python'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'bin', 'python3'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'bin', 'python'));
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

    // 1. Сначала проверяем существующие файлы и тестируем их реальный запуск
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        if (this._isPythonExecutableWorking(cand)) {
          return cand;
        }
        // Если файл существует, но падает (типично для перенесенного Windows venv)
        if (isWin && cand.includes('python_env')) {
          log.warn(`[EnvironmentManager] Файл ${cand} существует, но не запускается. Пробуем авто-ремонт pyvenv.cfg...`);
          const envDir = path.dirname(path.dirname(cand));
          const sysPy = this._findSystemPython();
          if (sysPy) {
            this._autoRepairPyvenvCfg(envDir, sysPy);
            if (this._isPythonExecutableWorking(cand)) {
              log.info(`[EnvironmentManager] ✓ pyvenv.cfg успешно восстановлен. Запуск ${cand} подтвержден!`);
              return cand;
            }
          }
        }
      }
    }

    // 2. Если в ai_env бинарник не запустился, ищем системный Python
    const systemPy = this._findSystemPython();
    if (systemPy) {
      return systemPy;
    }

    // 3. Последняя попытка - стандартное имя в PATH
    const fallbackName = isWin ? 'python' : 'python3';
    if (this._isPythonExecutableWorking(fallbackName)) {
      return fallbackName;
    }

    // Если ни один вариант не работает, возвращаем путь к предполагаемому файлу
    // (он выдаст понятную диагностическую ошибку при запуске)
    if (candidatePaths.length > 0 && candidatePaths[0]) {
      return candidatePaths[0];
    }
    return fallbackName;
  }

  async isEnvironmentReady() {
    const pythonPath = this.getPythonPath();
    return this._isPythonExecutableWorking(pythonPath);
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
