const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  computeAiEnvDepsHash,
  computePackageLockHash,
  computeFileSha256,
} = require('./compute-ai-env-hash.cjs');

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : null;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const outDir = path.resolve(rootDir, getArgValue('--out-dir') || path.join('out', 'server-bundle'));
  const aiEnvManifestPath = getArgValue('--ai-env-manifest');

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('dist/ directory is missing. Run "npm run build" before packaging the server bundle.');
  }

  let commitHash = 'unknown';
  try {
    commitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {}

  fs.mkdirSync(outDir, { recursive: true });
  const stageDir = path.join(outDir, '_stage');
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const entriesToCopy = [
    'dist',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'server.ts',
    'server',
    'electron',
    'docs',
  ];

  for (const rel of entriesToCopy) {
    const src = path.join(rootDir, rel);
    const dst = path.join(stageDir, rel);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, dst, { recursive: true });
  }

  // Copy essential runtime scripts without bundling heavy dev/icon assets
  const scriptsToCopy = [
    path.join('scripts', 'bootstrap.mjs'),
    path.join('scripts', 'compute-ai-env-hash.cjs'),
    path.join('scripts', 'generate-metadata.js'),
  ];
  for (const rel of scriptsToCopy) {
    const src = path.join(rootDir, rel);
    const dst = path.join(stageDir, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  const buildMetaSrc = path.join(rootDir, 'src', 'build-metadata.json');
  if (fs.existsSync(buildMetaSrc)) {
    const buildMetaDst = path.join(stageDir, 'src', 'build-metadata.json');
    fs.mkdirSync(path.dirname(buildMetaDst), { recursive: true });
    fs.copyFileSync(buildMetaSrc, buildMetaDst);
  }

  const bundleFilename = 'adm-server-bundle.tar.gz';
  const bundlePath = path.join(outDir, bundleFilename);
  fs.rmSync(bundlePath, { force: true });

  execFileSync('tar', ['-czf', bundlePath, '-C', stageDir, '.'], {
    stdio: 'inherit',
  });
  fs.rmSync(stageDir, { recursive: true, force: true });

  const bundleSha256 = computeFileSha256(bundlePath);
  const bundleSize = fs.statSync(bundlePath).size;
  fs.writeFileSync(path.join(outDir, `${bundleFilename}.sha256`), `${bundleSha256}  ${bundleFilename}\n`, 'utf8');

  let aiEnvManifest = null;
  if (aiEnvManifestPath && fs.existsSync(aiEnvManifestPath)) {
    try {
      aiEnvManifest = JSON.parse(fs.readFileSync(aiEnvManifestPath, 'utf8'));
    } catch (err) {
      console.warn(`[package-server-bundle] Failed to parse ai-env-manifest at ${aiEnvManifestPath}:`, err.message);
    }
  }

  const aiEnvDepsHash = computeAiEnvDepsHash(rootDir);
  const packageLockHash = computePackageLockHash(rootDir);
  const version = pkg.version || '1.2.0';
  const tagName = getArgValue('--tag') || `v${version}`;

  const manifest = {
    schemaVersion: 1,
    version,
    tagName,
    commitHash,
    releasedAt: new Date().toISOString(),
    packageLockHash,
    aiEnvDepsHash,
    serverBundle: {
      filename: bundleFilename,
      sha256: bundleSha256,
      size: bundleSize,
    },
    aiEnv: aiEnvManifest || {
      aiEnvDepsHash,
      releaseTag: 'ai-env-runtime',
      assets: {},
    },
  };

  const manifestPath = path.join(outDir, 'adm-release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`[package-server-bundle] Built ${bundlePath} (${bundleSize} bytes, sha256=${bundleSha256.slice(0, 12)}...)`);
  console.log(`[package-server-bundle] Manifest written to ${manifestPath}`);
}

main();
