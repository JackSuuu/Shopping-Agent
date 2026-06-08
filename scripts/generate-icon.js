/**
 * scripts/generate-icon.js
 * Converts build/icon.svg → build/icon.icns (and build/icon.png)
 * Requires: sharp (npm install --save-dev sharp)
 * macOS only: uses the built-in `iconutil` command.
 */
import sharp from 'sharp';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '..');
const BUILD   = join(ROOT, 'build');
const ICONSET = join(BUILD, 'icon.iconset');

// All sizes required for a macOS .icns file
const SIZES = [
  { file: 'icon_16x16.png',      size: 16   },
  { file: 'icon_16x16@2x.png',   size: 32   },
  { file: 'icon_32x32.png',      size: 32   },
  { file: 'icon_32x32@2x.png',   size: 64   },
  { file: 'icon_128x128.png',    size: 128  },
  { file: 'icon_128x128@2x.png', size: 256  },
  { file: 'icon_256x256.png',    size: 256  },
  { file: 'icon_256x256@2x.png', size: 512  },
  { file: 'icon_512x512.png',    size: 512  },
  { file: 'icon_512x512@2x.png', size: 1024 },
];

async function main() {
  // Prepare directories
  mkdirSync(BUILD, { recursive: true });
  try { rmSync(ICONSET, { recursive: true }); } catch {}
  mkdirSync(ICONSET);

  const svgBuf = readFileSync(join(BUILD, 'icon.svg'));

  console.log('Generating icon sizes from build/icon.svg ...');
  for (const { file, size } of SIZES) {
    await sharp(svgBuf)
      .resize(size, size)
      .png()
      .toFile(join(ICONSET, file));
    console.log(`  ✓  ${size.toString().padStart(4)}px  →  ${file}`);
  }

  // Also write a flat 1024×1024 PNG for electron-builder's mac icon fallback
  await sharp(svgBuf).resize(1024, 1024).png().toFile(join(BUILD, 'icon.png'));
  console.log('  ✓  icon.png (1024×1024)');

  // Convert iconset directory → .icns using macOS built-in tool
  console.log('\nRunning iconutil ...');
  execSync(`iconutil -c icns "${ICONSET}" -o "${join(BUILD, 'icon.icns')}"`);
  console.log('✓  build/icon.icns created successfully!\n');

  // Clean up the temporary iconset directory
  rmSync(ICONSET, { recursive: true });
}

main().catch(err => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
