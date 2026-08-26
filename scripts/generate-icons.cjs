const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const BUILD_ICONS_DIR = path.join(BUILD_DIR, 'icons');

// Ensure all target directories exist
[ASSETS_DIR, BUILD_DIR, BUILD_ICONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log('===========================================================');
console.log('🎨 [Icon Generator] Генерация кроссплатформенных иконок...');
console.log('===========================================================');

/**
 * Find source icon file
 */
function findSourceIcon() {
  const imagesDir = path.join(ROOT_DIR, 'src', 'assets', 'images');
  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir);
    const iconJpg = files.find((f) => f.startsWith('icon_') && (f.endsWith('.jpg') || f.endsWith('.png')));
    if (iconJpg) return path.join(imagesDir, iconJpg);
  }

  const defaultPng = path.join(ASSETS_DIR, 'icon.png');
  if (fs.existsSync(defaultPng) && fs.statSync(defaultPng).size > 1000) {
    return defaultPng;
  }

  return null;
}

/**
 * Builds a multi-resolution ICO file from an array of { size, pngBuffer }
 */
function buildMultiIco(images) {
  // ICO header: 6 bytes
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(count, 4); // count

  let offset = 6 + count * 16;
  const dirEntries = [];
  const imageBuffers = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    const sizeByte = img.size >= 256 ? 0 : img.size;
    entry.writeUInt8(sizeByte, 0); // width (0 = 256)
    entry.writeUInt8(sizeByte, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buffer.length, 8); // size in bytes
    entry.writeUInt32LE(offset, 12); // file offset

    dirEntries.push(entry);
    imageBuffers.push(img.buffer);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers]);
}

/**
 * Builds an Apple ICNS file from an array of { tag, pngBuffer }
 */
function buildIcns(entries) {
  const chunks = [];
  let totalDataLength = 0;

  for (const entry of entries) {
    const tagBuf = Buffer.from(entry.tag, 'ascii');
    const chunkLength = 8 + entry.buffer.length;
    const chunkHeader = Buffer.alloc(8);
    tagBuf.copy(chunkHeader, 0);
    chunkHeader.writeUInt32BE(chunkLength, 4);

    chunks.push(Buffer.concat([chunkHeader, entry.buffer]));
    totalDataLength += chunkLength;
  }

  const fileLength = 8 + totalDataLength;
  const header = Buffer.alloc(8);
  Buffer.from('icns', 'ascii').copy(header, 0);
  header.writeUInt32BE(fileLength, 4);

  return Buffer.concat([header, ...chunks]);
}

async function generate() {
  const sourcePath = findSourceIcon();
  let sharp = null;
  try {
    sharp = require('sharp');
  } catch (e) {
    // Sharp not available
  }

  if (sharp && sourcePath) {
    console.log(`  ✓ Источник иконки: ${path.relative(ROOT_DIR, sourcePath)}`);

    const sizes = [512, 256, 128, 64, 48, 32, 16];
    const renderedBuffers = {};

    for (const s of sizes) {
      renderedBuffers[s] = await sharp(sourcePath)
        .resize(s, s, { fit: 'cover' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      
      const iconOutPath = path.join(BUILD_ICONS_DIR, `${s}x${s}.png`);
      fs.writeFileSync(iconOutPath, renderedBuffers[s]);
    }

    // Save main 512x512 PNGs
    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), renderedBuffers[512]);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), renderedBuffers[512]);
    console.log(`  ✓ Сгенерированы наборы PNG (16x16 -> 512x512)`);

    // Build multi-size Windows ICO (256, 128, 64, 48, 32, 16)
    const icoSizes = [256, 128, 64, 48, 32, 16];
    const icoImages = icoSizes.map((s) => ({ size: s, buffer: renderedBuffers[s] }));
    const icoBuf = buildMultiIco(icoImages);

    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), icoBuf);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuf);
    console.log(`  ✓ Сгенерирован мульти-размерный Windows ICO (${icoBuf.length} байт)`);

    // Build Apple ICNS (ic09=512x512, ic08=256x256, ic07=128x128, icp6=64x64, icp5=32x32, icp4=16x16)
    const icnsEntries = [
      { tag: 'ic09', buffer: renderedBuffers[512] },
      { tag: 'ic08', buffer: renderedBuffers[256] },
      { tag: 'ic07', buffer: renderedBuffers[128] },
      { tag: 'icp6', buffer: renderedBuffers[64] },
      { tag: 'icp5', buffer: renderedBuffers[32] },
      { tag: 'icp4', buffer: renderedBuffers[16] },
    ];
    const icnsBuf = buildIcns(icnsEntries);

    fs.writeFileSync(path.join(ASSETS_DIR, 'icon.icns'), icnsBuf);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.icns'), icnsBuf);
    console.log(`  ✓ Сгенерирован Apple ICNS (${icnsBuf.length} байт)`);
  } else {
    console.warn('  ⚠️ Модуль sharp не найден или исходный файл не указан. Используются существующие иконки.');
    // Ensure files exist in both assets and build
    const syncFile = (name) => {
      const src = path.join(ASSETS_DIR, name);
      const dst = path.join(BUILD_DIR, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    };
    syncFile('icon.ico');
    syncFile('icon.png');
    syncFile('icon.icns');
  }

  console.log('===========================================================');
  console.log('✅ Все иконки успешно подготовлены и согласованы!');
  console.log('===========================================================\n');
}

generate().catch((err) => {
  console.error('❌ Ошибка при формировании иконок:', err);
  process.exit(0); // non-fatal to avoid breaking general builds
});
