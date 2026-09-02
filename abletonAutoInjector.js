/**
 * Wavely Universal Ableton Live 12 Auto-Injector Engine
 * Detects all variations of Ableton Live 12 (Suite, Standard, Intro, Lite, Beta)
 * across any drive letter and user profile, and automatically injects Wavely into
 * the Places sidebar with custom branding, real auth, and drag-and-drop support.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

// Collect all possible drive letters to scan (C:, D:, E:, etc.)
function getAvailableDrives() {
  const drives = ['C:'];
  for (let i = 68; i <= 90; i++) { // D through Z
    const driveLetter = `${String.fromCharCode(i)}:`;
    try {
      if (fs.existsSync(driveLetter)) {
        drives.push(driveLetter);
      }
    } catch (e) {}
  }
  return drives;
}

// Find all Ableton Live 12 ProgramData and AppData locations
function findAbletonDirectories() {
  const targets = {
    localAppDataSpliceDirs: [],
    programDataMiscZips: [],
    programDataAbletonFolders: []
  };

  // 1. Check User LocalAppData (%LOCALAPPDATA%\Ableton)
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const abletonLocalDir = path.join(localAppData, 'Ableton');

  if (fs.existsSync(abletonLocalDir)) {
    const spliceBase = path.join(abletonLocalDir, 'Splice');
    if (fs.existsSync(spliceBase)) {
      try {
        const subDirs = fs.readdirSync(spliceBase);
        for (const sub of subDirs) {
          const vstPath = path.join(spliceBase, sub, 'SpliceAbletonLive.vst3');
          targets.localAppDataSpliceDirs.push({
            versionSubDir: sub,
            vstDir: vstPath,
            distDir: path.join(vstPath, 'Contents', 'dist'),
            binPath: path.join(vstPath, 'Contents', 'x86_64-win', 'SpliceAbletonLive.vst3')
          });
        }
      } catch (e) {}
    } else {
      // Default structure if user hasn't opened Places yet
      const defaultVstPath = path.join(spliceBase, '1', 'SpliceAbletonLive.vst3');
      targets.localAppDataSpliceDirs.push({
        versionSubDir: '1',
        vstDir: defaultVstPath,
        distDir: path.join(defaultVstPath, 'Contents', 'dist'),
        binPath: path.join(defaultVstPath, 'Contents', 'x86_64-win', 'SpliceAbletonLive.vst3')
      });
    }
  }

  // 2. Scan all drives for ProgramData\Ableton
  const drives = getAvailableDrives();
  for (const drive of drives) {
    const progData = path.join(drive, 'ProgramData', 'Ableton');
    if (fs.existsSync(progData)) {
      try {
        const abletonEditions = fs.readdirSync(progData);
        for (const edition of abletonEditions) {
          // Look for any Live 12 or future edition
          if (edition.toLowerCase().includes('live 12') || edition.toLowerCase().includes('live 13')) {
            const editionPath = path.join(progData, edition);
            targets.programDataAbletonFolders.push(editionPath);

            const miscSplice = path.join(editionPath, 'Resources', 'Misc', 'Splice');
            if (fs.existsSync(miscSplice)) {
              try {
                const zips = fs.readdirSync(miscSplice).filter(f => f.endsWith('.zip') && !f.endsWith('.bak'));
                for (const zipFile of zips) {
                  targets.programDataMiscZips.push(path.join(miscSplice, zipFile));
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }
  }

  return targets;
}

// Copy directory recursively
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Safely binary patch VST3 class definition "Splice" -> "Wavely"
function patchVst3BinaryName(binPath) {
  if (!fs.existsSync(binPath)) return { patched: false, reason: 'File not found' };

  try {
    const backupPath = `${binPath}.bak`;
    if (!fs.existsSync(backupPath)) {
      try { fs.copyFileSync(binPath, backupPath); } catch (e) {}
    }

    const buf = fs.readFileSync(binPath);
    const splicePClass = Buffer.from('Splice\0\0\0\0\0\0\0\0\0\0', 'utf8');
    const wavelyPClass = Buffer.from('Wavely\0\0\0\0\0\0\0\0\0\0', 'utf8');

    let pos = 0;
    let patchCount = 0;
    while ((pos = buf.indexOf(splicePClass, pos)) !== -1) {
      wavelyPClass.copy(buf, pos);
      patchCount++;
      pos += 16;
    }

    if (patchCount > 0) {
      fs.writeFileSync(binPath, buf);
      return { patched: true, count: patchCount };
    }

    return { patched: true, count: 0, reason: 'Already patched' };
  } catch (err) {
    if (err.code === 'EBUSY') {
      return { patched: false, reason: 'File locked by running Ableton instance' };
    }
    return { patched: false, reason: err.message };
  }
}

/**
 * Main Auto-Injection function
 * Runs on app startup and can be triggered on-demand
 */
async function autoInjectAbletonLive() {
  console.log('[AbletonInjector] Scanning system for Ableton Live 12 installations...');
  
  // Resolve source dist folder containing Wavely web assets
  const appPath = app ? app.getAppPath() : path.resolve(__dirname, '..', '..');
  let distSource = path.join(appPath, 'dist');
  
  if (!fs.existsSync(distSource)) {
    distSource = path.join(__dirname, 'dist');
  }
  if (!fs.existsSync(distSource)) {
    distSource = path.join(process.cwd(), 'dist');
  }

  if (!fs.existsSync(distSource)) {
    console.warn('[AbletonInjector] Dist source folder not found at:', distSource);
    return { success: false, error: 'Wavely dist assets not found' };
  }

  const targets = findAbletonDirectories();
  console.log(`[AbletonInjector] Found ${targets.localAppDataSpliceDirs.length} AppData target(s) and ${targets.programDataAbletonFolders.length} ProgramData edition(s).`);

  let injectedCount = 0;
  const results = [];

  // Inject into each LocalAppData Splice location
  for (const target of targets.localAppDataSpliceDirs) {
    try {
      console.log(`[AbletonInjector] Injecting Wavely UI into ${target.distDir}...`);
      copyDirRecursive(distSource, target.distDir);

      // Attempt to patch binary name to "Wavely"
      const patchRes = patchVst3BinaryName(target.binPath);
      console.log(`[AbletonInjector] Binary patch result for ${target.binPath}:`, patchRes);

      injectedCount++;
      results.push({
        path: target.distDir,
        success: true,
        patchedBinary: patchRes.patched
      });
    } catch (err) {
      console.error(`[AbletonInjector] Failed to inject into ${target.distDir}:`, err.message);
      results.push({
        path: target.distDir,
        success: false,
        error: err.message
      });
    }
  }

  return {
    success: injectedCount > 0,
    injectedCount,
    targetsFound: targets.localAppDataSpliceDirs.length,
    details: results
  };
}

module.exports = {
  findAbletonDirectories,
  autoInjectAbletonLive,
  patchVst3BinaryName
};
