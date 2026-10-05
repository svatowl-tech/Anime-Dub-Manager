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
   * Обязательно передает PATH с папкой интерпретатора для загрузки зависимых DLL (python310.dll, vcruntime140.dll).
   */
  _isPythonExecutableWorking(executablePath) {
    if (!executablePath) return false;
    try {
      if (!fs.existsSync(executablePath)) return false;
      const { spawnSync } = require('child_process');
      const dir = path.dirname(executablePath);
      const parentDir = path.dirname(dir);
      const delimiter = process.platform === 'win32' ? ';' : ':';
      const customPath = `${dir}${delimiter}${parentDir}${delimiter}${process.env.PATH || ''}`;

      const test = spawnSync(executablePath, ['-c', 'import sys; sys.exit(0)'], {
        timeout: 4000,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PATH: customPath
        }
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
      // 1. Поиск через where.exe для python.exe и python3.exe
      try {
        const whereRes = spawnSync('where.exe', ['python.exe'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
        if (whereRes.status === 0 && whereRes.stdout) {
          const lines = whereRes.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            systemCandidates.push(line);
          }
        }
      } catch (e) {}

      try {
        const whereRes3 = spawnSync('where.exe', ['python3.exe'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
        if (whereRes3.status === 0 && whereRes3.stdout) {
          const lines = whereRes3.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            systemCandidates.push(line);
          }
        }
      } catch (e) {}

      // 2. Проверка стандартного Python Launcher (py.exe)
      try {
        const pyLauncher = 'C:\\Windows\\py.exe';
        if (fs.existsSync(pyLauncher)) {
          const pyRes = spawnSync(pyLauncher, ['-3', '-c', 'import sys; print(sys.executable)'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
          if (pyRes.status === 0 && pyRes.stdout) {
            const detected = pyRes.stdout.trim();
            if (detected && fs.existsSync(detected)) systemCandidates.push(detected);
          }
        }
      } catch (e) {}

      // 3. Стандартные папки установки Python на Windows
      const userProfile = process.env.USERPROFILE || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const systemDrive = process.env.SystemDrive || 'C:';

      const pythonVersions = ['Python310', 'Python311', 'Python312', 'Python313', 'Python39', 'Python38'];
      for (const ver of pythonVersions) {
        if (localAppData) systemCandidates.push(path.join(localAppData, 'Programs', 'Python', ver, 'python.exe'));
        if (progFiles) systemCandidates.push(path.join(progFiles, ver, 'python.exe'));
        if (progFilesX86) systemCandidates.push(path.join(progFilesX86, ver, 'python.exe'));
        systemCandidates.push(path.join(systemDrive, ver, 'python.exe'));
        systemCandidates.push(path.join(systemDrive, 'Program Files', ver, 'python.exe'));
      }

      // 4. WindowsApps / Microsoft Store
      if (localAppData) {
        systemCandidates.push(path.join(localAppData, 'Microsoft', 'WindowsApps', 'python.exe'));
        systemCandidates.push(path.join(localAppData, 'Microsoft', 'WindowsApps', 'python3.exe'));
      }

      // 5. Scoop / Chocolatey / Pyenv
      if (userProfile) {
        systemCandidates.push(path.join(userProfile, 'scoop', 'apps', 'python', 'current', 'python.exe'));
        systemCandidates.push(path.join(userProfile, '.pyenv', 'pyenv-win', 'shims', 'python.exe'));
        systemCandidates.push(path.join(userProfile, 'anaconda3', 'python.exe'));
        systemCandidates.push(path.join(userProfile, 'miniconda3', 'python.exe'));
      }
      const programData = process.env.ProgramData || 'C:\\ProgramData';
      systemCandidates.push(path.join(programData, 'chocolatey', 'bin', 'python.exe'));
    } else {
      systemCandidates.push('/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3', 'python3', 'python');
    }

    for (const cand of systemCandidates) {
      if (cand && this._isPythonExecutableWorking(cand)) {
        log.info(`[EnvironmentManager] Найден рабочий системный Python: ${cand}`);
        return cand;
      }
    }
    return null;
  }

  /**
   * Автоматически восстанавливает pyvenv.cfg и синхронизирует бинарники, 
   * если home указывает на несуществующую папку CI-билда (например C:\hostedtoolcache).
   */
  _autoRepairPyvenvCfg(envDir, workingPythonPath = null) {
    if (!envDir || !fs.existsSync(envDir)) return;
    const isWin = process.platform === 'win32';
    const cfgPath = path.join(envDir, 'pyvenv.cfg');

    try {
      // 1. На Windows: если в корне envDir есть рабочий python.exe, но в Scripts/python.exe битый стаб venvlauncher,
      // синхронизируем файлы из корня в Scripts/
      if (isWin) {
        const rootPy = path.join(envDir, 'python.exe');
        const scriptsPy = path.join(envDir, 'Scripts', 'python.exe');
        if (fs.existsSync(rootPy) && fs.existsSync(scriptsPy)) {
          try {
            // Копируем все dll и python.exe из корня в Scripts/
            const entries = fs.readdirSync(envDir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.isFile() && (ent.name.toLowerCase().endsWith('.dll') || ent.name.toLowerCase() === 'python.exe')) {
                fs.copyFileSync(path.join(envDir, ent.name), path.join(envDir, 'Scripts', ent.name));
              }
            }
          } catch (e) {}
        }
      }

      // 2. Проверяем и восстанавливаем pyvenv.cfg
      if (fs.existsSync(cfgPath)) {
        const content = fs.readFileSync(cfgPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let modified = false;

        const newLines = lines.map(line => {
          if (line.trim().startsWith('home =')) {
            const oldHome = line.split('=')[1]?.trim();
            // Если oldHome не существует или указывает на папку hostedtoolcache / CI
            if (!oldHome || !fs.existsSync(oldHome) || oldHome.includes('hostedtoolcache') || oldHome === '.') {
              let targetHome = workingPythonPath ? path.dirname(workingPythonPath) : envDir;
              log.info(`[EnvironmentManager] Авто-ремонт pyvenv.cfg: ${oldHome} -> ${targetHome}`);
              modified = true;
              return `home = ${targetHome}`;
            }
          }
          return line;
        });

        if (modified) {
          fs.writeFileSync(cfgPath, newLines.join('\n'), 'utf8');
        }
      }

      // 3. Проверяем и восстанавливаем целостность torch/testing/_internal/common_dtype.py
      this._ensureTorchTestingIntegrity(envDir);
    } catch (e) {
      log.warn('[EnvironmentManager] Не удалось обновить pyvenv.cfg:', e);
    }
  }

  /**
   * Гарантирует наличие highest_precision_float в torch/testing/_internal/common_dtype.py
   * для стабильной работы PyTorch 2.x без повреждения inspect.py.
   */
  _ensureTorchTestingIntegrity(envDir) {
    if (!envDir || !fs.existsSync(envDir)) return;
    try {
      const siteCandidates = [
        path.join(envDir, 'Lib', 'site-packages'),
        path.join(envDir, 'lib', 'site-packages'),
        path.join(envDir, 'lib', 'python3.10', 'site-packages')
      ];
      const snippet = `\n# Auto-injected highest_precision_float compatibility shim for PyTorch 2.x
def highest_precision_float(device=None):
    import torch
    if device is None:
        try:
            device = torch.get_default_device()
        except Exception:
            device = "cpu"
    try:
        if hasattr(torch, "device") and torch.device(device).type == "mps":
            return torch.float32
    except Exception:
        pass
    return getattr(torch, "float64", float)
\n`;

      for (const siteDir of siteCandidates) {
        if (!fs.existsSync(siteDir)) continue;
        const torchDir = path.join(siteDir, 'torch');
        if (fs.existsSync(torchDir)) {
          const testingDir = path.join(torchDir, 'testing');
          const internalDir = path.join(testingDir, '_internal');
          if (!fs.existsSync(internalDir)) {
            fs.mkdirSync(internalDir, { recursive: true });
          }
          const testingInit = path.join(testingDir, '__init__.py');
          if (!fs.existsSync(testingInit)) {
            fs.writeFileSync(testingInit, '# torch testing init\n', 'utf8');
          }
          const internalInit = path.join(internalDir, '__init__.py');
          if (!fs.existsSync(internalInit)) {
            fs.writeFileSync(internalInit, '# torch testing internal init\n', 'utf8');
          }
          const commonDtype = path.join(internalDir, 'common_dtype.py');
          if (fs.existsSync(commonDtype)) {
            const content = fs.readFileSync(commonDtype, 'utf8');
            if (!content.includes('highest_precision_float')) {
              fs.appendFileSync(commonDtype, snippet, 'utf8');
              log.info(`[EnvironmentManager] Восстановлен highest_precision_float в ${commonDtype}`);
            }
          } else {
            fs.writeFileSync(commonDtype, snippet, 'utf8');
            log.info(`[EnvironmentManager] Создан ${commonDtype} с highest_precision_float`);
          }
        }
      }
    } catch (err) {
      log.warn('[EnvironmentManager] Предупреждение при проверке целостности torch:', err);
    }
  }

  /**
   * Возвращает папки site-packages внутри ai_env для проброса через PYTHONPATH.
   */
  getPythonSitePackagesDirs(customPythonPath = null) {
    const dirs = [];
    const roots = [];
    if (typeof app !== 'undefined' && app.getPath) {
      try { roots.push(app.getPath('userData')); } catch (e) {}
    }
    roots.push(process.cwd());

    // 1. Проверяем папки относительно переданного пути к Python
    if (customPythonPath) {
      const pyDir = path.dirname(customPythonPath);
      const pyParent = path.dirname(pyDir);
      const pyCandidates = [
        path.join(pyDir, 'Lib', 'site-packages'),
        path.join(pyDir, 'lib', 'site-packages'),
        path.join(pyDir, 'lib', 'python3.10', 'site-packages'),
        path.join(pyParent, 'Lib', 'site-packages'),
        path.join(pyParent, 'lib', 'site-packages'),
        path.join(pyParent, 'lib', 'python3.10', 'site-packages'),
        path.join(pyParent, 'python_env', 'Lib', 'site-packages'),
        path.join(pyParent, 'python_env', 'lib', 'site-packages')
      ];
      for (const c of pyCandidates) {
        if (fs.existsSync(c)) dirs.push(c);
      }
    }

    // 2. Проверяем стандартные корни userData и cwd
    for (const r of roots) {
      const aiEnv = path.join(r, 'ai_env');
      const candidates = [
        path.join(aiEnv, 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'site-packages'),
        path.join(aiEnv, 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'Lib', 'site-packages'),
        path.join(aiEnv, 'lib', 'site-packages'),
        path.join(aiEnv, 'lib', 'python3.10', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'Lib', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'site-packages'),
        path.join(aiEnv, 'ai_env', 'python_env', 'lib', 'python3.10', 'site-packages'),
        path.join(r, 'whisperlivekit', 'venv', 'Lib', 'site-packages'),
        path.join(r, 'whisperlivekit', 'venv', 'lib', 'site-packages')
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
          // Исполняемые файлы в портативной ai_env
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'ai_env', 'python_env', 'Scripts', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'python.exe'));
          candidatePaths.push(path.join(userData, 'ai_env', 'Scripts', 'python.exe'));
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
      candidatePaths.push(path.join(cwd, 'ai_env', 'python_env', 'python.exe'));
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

    // 1. Выполняем превентивный ремонт pyvenv.cfg для всех найденных окружений
    const envDirsToRepair = new Set();
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand) && cand.includes('python_env')) {
        const eDir = cand.includes('Scripts') || cand.includes('bin')
          ? path.dirname(path.dirname(cand))
          : path.dirname(cand);
        envDirsToRepair.add(eDir);
      }
    }
    for (const eDir of envDirsToRepair) {
      this._autoRepairPyvenvCfg(eDir);
    }

    // 2. Проверяем кандидатов и тестируем их реальный запуск
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        if (this._isPythonExecutableWorking(cand)) {
          return cand;
        }
      }
    }

    // 3. Если бинарники в ai_env не запустились напрямую, ищем системный Python
    const systemPy = this._findSystemPython();
    if (systemPy) {
      // Повторно ремонтируем ai_env с привязкой к рабочему системному Python
      for (const eDir of envDirsToRepair) {
        this._autoRepairPyvenvCfg(eDir, systemPy);
      }
      return systemPy;
    }

    // 4. Последняя попытка - стандартное имя в PATH
    const fallbackName = isWin ? 'python' : 'python3';
    if (this._isPythonExecutableWorking(fallbackName)) {
      return fallbackName;
    }

    // Если ни один вариант не работает, возвращаем лучший найденный существующий файл
    for (const cand of candidatePaths) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
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
