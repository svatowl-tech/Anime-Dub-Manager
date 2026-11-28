const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');

function normalizeTextForHash(content) {
  return content.replace(/\r\n/g, '\n');
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Deterministic SHA-256 fingerprint strictly for the Python AI_env runtime definition.
 * Excludes frontend/server JS and sidecar scripts (which update via the lightweight app bundle).
 */
function computeAiEnvDepsHash(rootDir = ROOT_DIR) {
  const hash = crypto.createHash('sha256');
  const inputRelPaths = [
    path.join('scripts', 'build-ai-env.py'),
    'requirements-ai.txt',
  ];

  for (const rel of inputRelPaths) {
    const abs = path.join(rootDir, rel);
    hash.update(`FILE:${rel.replace(/\\/g, '/')}\n`);
    if (fs.existsSync(abs)) {
      const text = normalizeTextForHash(fs.readFileSync(abs, 'utf8'));
      hash.update(text, 'utf8');
    } else {
      hash.update('MISSING');
    }
    hash.update('\n');
  }

  return hash.digest('hex');
}

function computePackageLockHash(rootDir = ROOT_DIR) {
  const lockPath = path.join(rootDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return 'none';
  const normalized = normalizeTextForHash(fs.readFileSync(lockPath, 'utf8'));
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          aiEnvDepsHash: computeAiEnvDepsHash(),
          packageLockHash: computePackageLockHash(),
        },
        null,
        2
      )
    );
  } else if (args.includes('--lock')) {
    console.log(computePackageLockHash());
  } else {
    console.log(computeAiEnvDepsHash());
  }
}

module.exports = {
  computeAiEnvDepsHash,
  computePackageLockHash,
  computeFileSha256,
};
