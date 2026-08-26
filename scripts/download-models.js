import path from 'path';
import fs from 'fs';
import axios from 'axios';

const MODELS_DIR = path.resolve('assets/models');

async function downloadFile(url, destPath) {
  const dirName = path.dirname(destPath);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    console.log(`  [Already Exists] ${path.relative(MODELS_DIR, destPath)}`);
    return;
  }

  console.log(`  Downloading ${url} -> ${path.relative(MODELS_DIR, destPath)}`);
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloadedBytes = 0;
    
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalLength) {
          const percent = ((downloadedBytes / totalLength) * 100).toFixed(1);
          const MB = (downloadedBytes / (1024 * 1024)).toFixed(1);
          const totalMB = (totalLength / (1024 * 1024)).toFixed(1);
          process.stdout.write(`\r    Progress: ${percent}% (${MB} / ${totalMB} MB)`);
        } else {
          const KB = (downloadedBytes / 1024).toFixed(1);
          process.stdout.write(`\r    Downloaded: ${KB} KB`);
        }
      });

      writer.on('finish', () => {
        process.stdout.write('\n    Completed successfully.\n');
        resolve();
      });

      writer.on('error', (err) => {
        process.stdout.write('\n    Write Error!\n');
        reject(err);
      });
    });
  } catch (error) {
    console.error(`\n  Failed to download ${url}: ${error.message}`);
    throw error;
  }
}

async function downloadModels() {
  console.log(`Initializing automated download to ${MODELS_DIR}...`);
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const models = [
    {
      name: 'onnx-community/pyannote-segmentation-3.0',
      files: [
        'config.json',
        'preprocessor_config.json',
        'onnx/model_quantized.onnx',
        'onnx/model.onnx'
      ]
    },
    {
      name: 'Xenova/m2m100_418M',
      files: [
        'config.json',
        'generation_config.json',
        'tokenizer_config.json',
        'sentencepiece.bpe.model',
        'tokenizer.json',
        'onnx/encoder_model_quantized.onnx',
        'onnx/decoder_model_merged_quantized.onnx'
      ]
    }
  ];

  try {
    for (const model of models) {
      console.log(`\n----------------------------------------\nModel: ${model.name}`);
      for (const file of model.files) {
        const url = `https://huggingface.co/${model.name}/resolve/main/${file}`;
        const destPath = path.join(MODELS_DIR, model.name, file);
        try {
          await downloadFile(url, destPath);
        } catch (e) {
          console.warn(`  Warning: Skipped optional/failed file ${file}: ${e.message}`);
        }
      }
    }

    console.log('\n----------------------------------------\nModel: Whisper (Native GGML)');
    const whisperModelsDir = path.join(MODELS_DIR, 'whisper');
    fs.mkdirSync(whisperModelsDir, { recursive: true });
    const whisperDest = path.join(whisperModelsDir, 'ggml-tiny.bin');
    const whisperUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
    await downloadFile(whisperUrl, whisperDest);

    console.log('\nAll core AI models downloaded successfully and structured for offline use.');
    process.exit(0);
  } catch (err) {
    console.error('\nBuild compilation failed on model pre-loading steps:', err);
    process.exit(1);
  }
}

downloadModels();
