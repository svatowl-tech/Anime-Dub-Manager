const { spawn } = require('child_process');
const axios = require('axios');
const log = require('electron-log');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

class OllamaService {
  constructor() {
    this.ollamaUrl = 'http://127.0.0.1:11434';
    this.ollamaProcess = null;
  }

  /**
   * Checks if Ollama is running, if not tries to auto-start it.
   */
  async ensureOllamaRunning() {
    log.info('[OllamaService] Checking if Ollama is running...');
    try {
      await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 2000 });
      log.info('[OllamaService] Ollama is already running.');
      return true;
    } catch (e) {
      log.warn('[OllamaService] Ollama is not responding, attempting to auto-start...');
      return await this.startOllama();
    }
  }

  /**
   * Search and launch the Ollama daemon.
   */
  async startOllama() {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    let pathsToTry = [];

    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      pathsToTry = [
        path.join(localAppData, 'Ollama', 'ollama.exe'),
        path.join(programFiles, 'Ollama', 'ollama.exe'),
        'ollama.exe'
      ];
    } else if (isMac) {
      pathsToTry = [
        '/Applications/Ollama.app/Contents/Resources/ollama',
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        'ollama'
      ];
    } else {
      // Linux
      pathsToTry = [
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        'ollama'
      ];
    }

    let launched = false;
    for (const binPath of pathsToTry) {
      try {
        log.info(`[OllamaService] Trying to start Ollama with binary: ${binPath}`);
        const proc = spawn(binPath, ['serve'], {
          detached: true,
          stdio: 'ignore'
        });
        proc.unref();
        this.ollamaProcess = proc;
        launched = true;
        break;
      } catch (err) {
        log.warn(`[OllamaService] Failed to start Ollama using ${binPath}:`, err.message);
      }
    }

    if (!launched) {
      // Try spawning generic "ollama serve"
      try {
        const proc = spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        });
        proc.unref();
        this.ollamaProcess = proc;
        launched = true;
      } catch (err) {
        log.error('[OllamaService] Failed to start Ollama with default path:', err.message);
      }
    }

    // Wait and poll for Ollama to become ready
    log.info('[OllamaService] Waiting for Ollama to initialize...');
    for (let i = 0; i < 15; i++) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 1000 });
        log.info('[OllamaService] Ollama successfully started and responded.');
        return true;
      } catch (e) {
        log.info(`[OllamaService] Waiting for response... (${i + 1}/15)`);
      }
    }

    throw new Error('Не удалось запустить Ollama автоматически. Пожалуйста, запустите Ollama вручную.');
  }

  /**
   * Fetches installed models from Ollama
   */
  async getInstalledModels() {
    try {
      await this.ensureOllamaRunning();
      const response = await axios.get(`${this.ollamaUrl}/api/tags`);
      const models = response.data?.models || [];
      return models.map(m => m.name);
    } catch (e) {
      log.error('[OllamaService] Error fetching models:', e.message);
      return [];
    }
  }

  /**
   * Context analysis of dialogue using LLM with batching (quantization of requests)
   */
  async analyzeDialogueContext(projectDetails, episodeDetails, subtitleLines, modelName, onProgress) {
    await this.ensureOllamaRunning();
    
    // 1. Prepare characters list and project summary
    const characters = projectDetails.characters ? JSON.parse(projectDetails.characters) : [];
    const charactersListStr = characters.length > 0 ? characters.join(', ') : 'Не указаны';
    const projectSummary = `Аниме: "${projectDetails.title}"
Оригинальное название: "${projectDetails.originalTitle || 'Неизвестно'}"
Синопсис: ${projectDetails.synopsis || 'Не указан'}
Персонажи проекта: ${charactersListStr}
Серия №${episodeDetails.number}`;

    log.info(`[OllamaService] Analyzing dialogue using model: ${modelName}`);
    log.info(`[OllamaService] Project metadata:\n${projectSummary}`);

    // Group lines by contiguous dialogue batches
    // Batch size of 20 lines is ideal for context quantization
    const batchSize = 20;
    const batches = [];
    for (let i = 0; i < subtitleLines.length; i += batchSize) {
      batches.push(subtitleLines.slice(i, i + batchSize));
    }

    log.info(`[OllamaService] Split ${subtitleLines.length} lines into ${batches.length} batches.`);

    const mappingsPerBatch = [];
    
    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      if (onProgress) {
        onProgress({
          current: bIdx + 1,
          total: batches.length,
          message: `Анализ контекста диалогов через Ollama (Батч ${bIdx + 1} из ${batches.length})...`
        });
      }

      // Format dialogue for LLM
      const dialogueText = batch.map((line, idx) => {
        return `[Line ID: ${line.id}] ${line.name || 'Speaker_Unknown'}: "${line.text}"`;
      }).join('\n');

      const systemPrompt = `Ты — эксперт-режиссер дубляжа аниме. Твоя задача — проанализировать контекст диалога и понять, кто из оригинальных персонажей говорит за временными именами Speaker 1, Speaker 2, Speaker 3 и т.д.
Информация о релизе:
${projectSummary}

Доступные персонажи: ${charactersListStr}

Инструкции:
1. Изучи реплики внимательно. Например, если "Speaker 1" обращается к кому-то "Братик!", а в списке персонажей есть младшая сестра, значит Speaker 1 — эта сестра.
2. Сопоставь каждого Speaker X, упомянутого в батче, с ОДНИМ персонажем из списка доступных. Если персонажа нет в списке, но контекст указывает на конкретное имя (например, зовут по имени в диалоге), используй это имя.
3. Верни ответ СТРОГО в формате JSON объекта, где ключ — временное имя (например, "Speaker 1"), а значение — реальное имя персонажа. Не пиши никакого лишнего текста, только JSON.

Пример ответа:
{
  "Speaker 1": "Незуко",
  "Speaker 2": "Танджиро"
}`;

      try {
        const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
          model: modelName,
          prompt: `${systemPrompt}\n\nВот диалог для анализа:\n${dialogueText}\n\nОтвет в формате JSON:`,
          stream: false,
          options: {
            temperature: 0.1, // Low temp for factual and consistent output
            num_predict: 256
          },
          format: 'json'
        });

        const textResponse = response.data?.response;
        log.info(`[OllamaService] Batch ${bIdx + 1} raw response:`, textResponse);

        try {
          const parsed = JSON.parse(textResponse);
          mappingsPerBatch.push(parsed);
        } catch (parseErr) {
          log.warn(`[OllamaService] Failed to parse JSON from batch ${bIdx + 1}:`, parseErr.message);
          // Try to extract JSON using regex
          const match = textResponse.match(/\{[\s\S]*?\}/);
          if (match) {
            try {
              const parsedFallback = JSON.parse(match[0]);
              mappingsPerBatch.push(parsedFallback);
            } catch (e) {}
          }
        }
      } catch (err) {
        log.error(`[OllamaService] Error in Ollama request for batch ${bIdx + 1}:`, err.message);
      }
    }

    // Compile and resolve mappings globally (Majority Voting)
    const speakerVotes = {}; // Speaker X -> { Character A: 5, Character B: 2 }
    
    for (const mapping of mappingsPerBatch) {
      for (const [speaker, character] of Object.entries(mapping)) {
        if (!speaker.startsWith('Speaker')) continue;
        if (!character || typeof character !== 'string' || character.toLowerCase() === 'unknown') continue;
        
        const cleanSpeaker = speaker.trim();
        const cleanChar = character.trim();

        if (!speakerVotes[cleanSpeaker]) {
          speakerVotes[cleanSpeaker] = {};
        }
        speakerVotes[cleanSpeaker][cleanChar] = (speakerVotes[cleanSpeaker][cleanChar] || 0) + 1;
      }
    }

    const finalMapping = {};
    for (const [speaker, votes] of Object.entries(speakerVotes)) {
      let maxVotes = 0;
      let winningCharacter = '';
      for (const [char, count] of Object.entries(votes)) {
        if (count > maxVotes) {
          maxVotes = count;
          winningCharacter = char;
        }
      }
      if (winningCharacter) {
        finalMapping[speaker] = winningCharacter;
      }
    }

    log.info('[OllamaService] Final resolved mappings from LLM context analysis:', finalMapping);
    return finalMapping;
  }

  /**
   * Translates a batch of subtitle lines using an Ollama model, preserving context and extracting character names.
   */
  async translateBatch(modelName, linesBatch, sourceLang, destLang) {
    await this.ensureOllamaRunning();

    const systemPrompt = `Ты — эксперт-переводчик субтитров для дубляжа. Переведи следующие субтитры с языка "${sourceLang}" на язык "${destLang}".
Сделай перевод живым, естественным, без технического буквализма – так, как говорят в жизни.

Инструкции:
1. Имена и термины: Все имена собственные транскрибируй. Общепринятую терминологию (например, ИИ, а не АИ, аббревиатуры) переводи корректно.
2. Имена и обращения: Именные суффиксы (-сан, -кун, -тян, -сама и т.д.) убирай, заменяя их естественными для языка перевода обращениями (по имени, "господин", "шеф", "малыш" и т.п.), либо опускай, если это не нарушает смысл.
3. Парсинг имен: Если в тексте в скобках прописан говорящий (например, (Мотоко) текст, [Солдат] текст или (公安9課)), извлеки имя персонажа в поле "name", а в "translatedText" оставь ТОЛЬКО произносимый текст. Если имя уже передано во входных данных, сохрани его. Для массовых сцен (операторы, солдаты) можно нумеровать: "Оператор 1", "Солдат 1", указывая пол, если понятно по контексту. Следи за половой принадлежностью в обращениях и роде глаголов.
4. Адаптация для дубляжа: Слоговая длина переведенной фразы должна быть как можно ближе к длительности оригинала. Не укорачивай текст чрезмерно, если это не продиктовано таймингом. Не раздувай конструкции, говори просто и прямо.
5. Живая речь: Язык должен быть естественным, разговорным. Герои не должны звучать как роботы. Допускаются маты, просторечия, пацанские и жизненные конструкции, если они уместны по характеру персонажа.
6. Восстановление контекста: Если в оригинале опущены подлежащие или местоимения, восстанови их для ясности, ориентируясь на контекст. Междометия адаптируй естественно («Aah!» → «А!», «Eeh?» → «А?»).
7. Очистка и форматирование: Удали все примечания в скобках, описания звуков (например, (шум вертолета)) и обозначения опенингов/эндингов (♪). Строки только с музыкой удаляй (оставляй пустыми). Обязательно СОХРАНЯЙ все коды форматирования (например, {\\an8}, {\\i1}) в тексте.
8. Верни ответ СТРОГО в виде валидного JSON-объекта с ключом "translations", содержащим массив объектов. Каждый объект массива соответствует переведенной реплике в том же порядке. Никакого лишнего текста до или после JSON.

Формат JSON:
{
  "translations": [
    { "id": "line_id", "translatedText": "переведенный текст", "name": "имя_персонажа_или_пусто" }
  ]
}`;

    const dialogueInput = linesBatch.map(line => ({
      id: line.id,
      text: line.text,
      name: line.name || ''
    }));

    try {
      const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
        model: modelName,
        prompt: `${systemPrompt}\n\nDialogue to translate:\n${JSON.stringify(dialogueInput, null, 2)}\n\nResult JSON:`,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 2048
        },
        format: 'json'
      });

      const textResponse = response.data?.response;
      let parsed = null;
      try {
        parsed = JSON.parse(textResponse);
      } catch (parseErr) {
        const match = textResponse.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch (e) {
            throw new Error(`Could not parse JSON from Ollama response. Raw: ${textResponse.substring(0, 200)}...`);
          }
        } else {
          throw new Error(`Could not parse JSON from Ollama response. Raw: ${textResponse.substring(0, 200)}...`);
        }
      }
      return parsed.translations || [];
    } catch (err) {
      log.error(`[OllamaService] Translation error for batch:`, err.message);
      throw err;
    }
  }
}

module.exports = new OllamaService();
