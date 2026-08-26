import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const metadataPath = path.join(process.cwd(), 'src', 'build-metadata.json');

let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  console.warn('Could not get commit hash, using "unknown"');
}

const metadata = {
  buildDate: new Date().toISOString(),
  commitHash: commitHash,
  version: process.env.npm_package_version || '1.2.0'
};

fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
console.log(`Generated build metadata: ${metadataPath}`);

// Icon generation and conversion helper
async function prepareIcons() {
  const assetsDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const pngPath = path.join(assetsDir, 'icon.png');
  
  // If we already have a valid PNG icon, do not risk corrupting it or running slow conversions on CI
  if (fs.existsSync(pngPath)) {
    try {
      const header = fs.readFileSync(pngPath).subarray(0, 4);
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
        console.log(`Valid assets/icon.png already exists. Skipping dynamic rebuild to avoid build-time dependencies.`);
        return;
      }
    } catch (e) {
      console.warn('Failed to verify existing icon.png format:', e.message);
    }
  }

  const icoPath = path.join(assetsDir, 'icon.ico');

  // Try to extract high-quality PNG from icon.ico first (Zero-dependency, perfectly accurate)
  if (fs.existsSync(icoPath)) {
    try {
      const buf = fs.readFileSync(icoPath);
      // Read ICO header
      const reserved = buf.readUInt16LE(0);
      const type = buf.readUInt16LE(2);
      const numImages = buf.readUInt16LE(4);
      
      if (reserved === 0 && type === 1 && numImages > 0) {
        console.log(`Analyzing icon.ico: found ${numImages} sub-images.`);
        let bestIndex = -1;
        let maxWidth = 0;
        let maxEntry = null;

        for (let i = 0; i < numImages; i++) {
          const entryOffset = 6 + i * 16;
          let width = buf[entryOffset];
          let height = buf[entryOffset + 1];
          if (width === 0) width = 256;
          if (height === 0) height = 256;
          
          const size = buf.readUInt32LE(entryOffset + 8);
          const offset = buf.readUInt32LE(entryOffset + 12);

          console.log(`  - Sub-image ${i}: ${width}x${height} (size: ${size} bytes, offset: ${offset})`);
          if (width >= maxWidth) {
            maxWidth = width;
            bestIndex = i;
            maxEntry = { offset, size, width };
          }
        }

        if (maxEntry) {
          const imgData = buf.subarray(maxEntry.offset, maxEntry.offset + maxEntry.size);
          // Check if it's a valid PNG (starts with 0x89 0x50 0x4e 0x47)
          if (imgData[0] === 0x89 && imgData[1] === 0x50 && imgData[2] === 0x4e && imgData[3] === 0x47) {
            fs.writeFileSync(pngPath, imgData);
            console.log(`Successfully extracted high-quality ${maxEntry.width}x${maxEntry.width} PNG from assets/icon.ico to: ${pngPath}`);
            return;
          } else {
            console.warn(`Sub-image ${bestIndex} is not in PNG format (starts with ${imgData.subarray(0, 4).toString('hex')}).`);
          }
        }
      }
    } catch (icoErr) {
      console.warn('Failed to extract PNG from icon.ico:', icoErr.message);
    }
  }

  const imagesDir = path.join(process.cwd(), 'src', 'assets', 'images');
  
  // Find any icon_*.jpg
  let sourceJpg = null;
  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir);
    const iconFile = files.find(f => f.startsWith('icon_') && f.endsWith('.jpg'));
    if (iconFile) {
      sourceJpg = path.join(imagesDir, iconFile);
    }
  }

  if (sourceJpg) {
    console.log(`Found source icon image: ${sourceJpg}`);
    try {
      const { default: sharp } = await import('sharp');
      await sharp(sourceJpg)
        .resize(512, 512)
        .png()
        .toFile(pngPath);
      console.log(`Successfully converted and resized icon to square PNG at: ${pngPath}`);
    } catch (err) {
      console.warn('Could not use sharp for high-quality PNG conversion. Using direct copy fallback:', err.message);
      try {
        fs.copyFileSync(sourceJpg, pngPath);
        console.log(`Fallback: Copied source icon directly to: ${pngPath}`);
      } catch (cpErr) {
        console.error('Failed to copy fallback icon:', cpErr);
      }
    }
  } else {
    console.warn(`Source icon image not found in ${imagesDir}. Creating default empty fallback image.`);
  }
}

// Ensure and guarantee that empty assets/bin and assets/models directories exist.
// This prevents electron-builder from failing on clean CI environments.
function prepareRequiredDirectories() {
  const assetsDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const binDir = path.join(assetsDir, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    // Write an optional placeholder
    fs.writeFileSync(path.join(binDir, '.gitkeep'), '');
    console.log(`Created assets/bin fallback folder.`);
  }

  const modelsDir = path.join(assetsDir, 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
    // Write an optional placeholder
    fs.writeFileSync(path.join(modelsDir, '.gitkeep'), '');
    console.log(`Created assets/models fallback folder.`);
  }
}

prepareRequiredDirectories();
prepareIcons().catch(e => console.error('Error during icon preparation:', e));
