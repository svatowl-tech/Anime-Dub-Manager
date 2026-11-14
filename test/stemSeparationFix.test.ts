import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

describe('Neural Stem Separation (HTDemucs & MDX-Net ONNX) & IPC Watchdog Fixes', () => {
  const rootDir = process.cwd();
  const servicePyPath = path.join(rootDir, 'electron', 'services', 'audio_ai_processor.py');
  const sidecarPyPath = path.join(rootDir, 'electron', 'sidecars', 'audio_ai_processor.py');
  const neuralServicePath = path.join(rootDir, 'electron', 'services', 'AudioNeuralService.cjs');
  const ipcSafePath = path.join(rootDir, 'src', 'lib', 'ipcSafe.ts');

  it('compiles both Python sidecar scripts without syntax errors and includes HTDEMUCS_SAFE_SEGMENT_V8', () => {
    const serviceCode = fs.readFileSync(servicePyPath, 'utf8');
    const sidecarCode = fs.readFileSync(sidecarPyPath, 'utf8');

    expect(serviceCode).toContain('HTDEMUCS_SAFE_SEGMENT_V8');
    expect(sidecarCode).toContain('HTDEMUCS_SAFE_SEGMENT_V8');
    expect(serviceCode).toContain('def _resolve_safe_demucs_segment(');
    expect(serviceCode).toContain('def _try_mdx_onnx_separation(');

    execSync(`python3 -m py_compile "${servicePyPath}" "${sidecarPyPath}"`, { stdio: 'pipe' });
  });

  it('_resolve_safe_demucs_segment returns None for HTDemucs and BagOfModels([HTDemucs]) so 343980 training_length is never violated', () => {
    const pyCheck = `
import ast

with open(r"${servicePyPath.replace(/\\/g, '\\\\')}", "r", encoding="utf-8") as f:
    src = f.read()

tree = ast.parse(src)
fn_node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_resolve_safe_demucs_segment")
mod = ast.Module(body=[fn_node], type_ignores=[])
ns = {}
exec(compile(mod, filename="<ast>", mode="exec"), ns)
resolve_fn = ns["_resolve_safe_demucs_segment"]

class HTDemucsMock:
    def __init__(self):
        self.segment = 7.8
        self.use_train_segment = True

class BagOfModelsMock:
    def __init__(self, models):
        self.models = models
        self.segment = 7.8

ht = HTDemucsMock()
bag = BagOfModelsMock([ht])
assert resolve_fn(ht, 14.0) is None, "Expected None for HTDemucs"
assert resolve_fn(bag, 14.0) is None, "Expected None for BagOfModels([HTDemucs])"
assert resolve_fn(bag, 26.0) is None, "Expected None for 26s adaptive chunk"
print("OK_SEGMENT_SAFE")
`;
    const out = execSync(`python3 -c '${pyCheck}'`, { encoding: 'utf8' });
    expect(out.trim()).toBe('OK_SEGMENT_SAFE');
  });

  it('AudioNeuralService._sanitizeSidecarScript overwrites stale cached scripts missing HTDEMUCS_SAFE_SEGMENT_V8', () => {
    const AudioNeuralService = require(neuralServicePath);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-sidecar-test-'));
    const staleScriptPath = path.join(tmpDir, 'audio_ai_processor.py');

    try {
      fs.writeFileSync(
        staleScriptPath,
        '# Stale script with VST3_WAVESHELL_V7 but old segment=adaptive_segment bug\n',
        'utf8'
      );
      AudioNeuralService._sanitizeSidecarScript(staleScriptPath);
      const updated = fs.readFileSync(staleScriptPath, 'utf8');
      expect(updated).toContain('HTDEMUCS_SAFE_SEGMENT_V8');
      expect(updated).toContain('def _resolve_safe_demucs_segment(');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('registers timing-separate-original-stems in HEAVY_CHANNELS in src/lib/ipcSafe.ts', () => {
    const ipcSafeCode = fs.readFileSync(ipcSafePath, 'utf8');
    expect(ipcSafeCode).toContain("'timing-separate-original-stems': 300000");
    expect(ipcSafeCode).toContain("'ai-separate-stems': 300000");
  });
});
