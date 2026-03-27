const { app, BrowserWindow, ipcMain, desktopCapturer, dialog,
        globalShortcut, Tray, Menu, shell, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

let mainWindow, tray, blinkInterval, selectedSourceId = null;
let settings = {
  outputDir: path.join(app.getPath('videos'), 'AIXplore Recordings'),
  autoSave: false,
  quality: 'high',    // high=6Mbps, medium=3Mbps, low=1.5Mbps
  fps: 30,
  countdown: 3,
  audioDeviceId: null,
  theme: 'system'
};

// ─── Persistence paths (set in whenReady) ───
let userData = null;
function getHistoryPath() { return path.join(userData, 'history.json'); }
function getSettingsPath() { return path.join(userData, 'settings.json'); }

function loadPersistedSettings() {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const saved = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
      Object.assign(settings, saved);
    }
  } catch (e) { console.log('[main] settings load error:', e.message); }
}

function savePersistedSettings() {
  try { fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2)); } catch (e) {}
}

function ts(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `AIXplore-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s.${ext}`;
}
function ensureDir() { if (!fs.existsSync(settings.outputDir)) fs.mkdirSync(settings.outputDir, { recursive: true }); }

// ─── Security: path validation ───
function isValidTempPath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  return resolved.startsWith(os.tmpdir()) && path.basename(resolved).startsWith('aixplore-rec-');
}

function isValidOutputPath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  return resolved.startsWith(settings.outputDir);
}

// Validate a history file path: must be a known AIXplore recording filename
function isValidHistoryFilePath(p) {
  if (!p || typeof p !== 'string') return false;
  const base = path.basename(p);
  return /^AIXplore-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}s\.(webm|mp4)$/.test(base);
}

function sanitizeNumber(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

async function createWindow() {
  // Request camera/mic BEFORE window loads
  if (process.platform === 'darwin') {
    try {
      const sp = require('electron').systemPreferences;
      if (sp.askForMediaAccess) {
        const camOk = await sp.askForMediaAccess('camera').catch(() => false);
        const micOk = await sp.askForMediaAccess('microphone').catch(() => false);
        console.log('[main] camera permission:', camOk);
        console.log('[main] microphone permission:', micOk);
      }
    } catch (e) { console.log('[main] permission check error:', e.message); }
  }
  // Trigger screen recording permission prompt early
  try {
    const early = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    console.log('[main] Early screen check: ' + early.length + ' screens');
  } catch (e) { console.log('[main] Screen check note:', e.message); }

  mainWindow = new BrowserWindow({
    width: 960, height: 700, minWidth: 800, minHeight: 600,
    titleBarStyle: 'hiddenInset', backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false  // CRITICAL: allow Node.js in preload for fs access
    }
  });

  // Content Security Policy: restrict to self, inline styles, and blob/mediastream for video
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob: mediastream:; img-src 'self' data: blob:;"
        ]
      }
    });
  });

  // ─── Display Media Handler: enables system audio via loopback on macOS ───
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const source = (selectedSourceId && sources.find(s => s.id === selectedSourceId)) || sources[0];
      console.log('[main] displayMedia handler: source=' + source.name + ', audio=loopback');
      callback({ video: source, audio: 'loopback' });
    } catch (err) {
      console.error('[main] displayMedia handler error:', err);
      callback({});
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVR42mP8/5+hHgAHggJ/TDnlFQAAAABJRU5ErkJggg==');
  tray = new Tray(icon);
  tray.setToolTip('AIXplore Recorder');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

function setTrayRec(on) {
  if (!tray) return;
  if (on) { let b = true; blinkInterval = setInterval(() => { tray.setToolTip(b ? '● REC' : '  REC'); b = !b; }, 600); }
  else { if (blinkInterval) { clearInterval(blinkInterval); blinkInterval = null; } tray.setToolTip('AIXplore Recorder'); }
}

// ─── Sources ───
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 480, height: 270 } });
    console.log('[main] Found ' + sources.length + ' sources');
    return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  } catch (err) { console.error('[main] getSources error:', err); return []; }
});

ipcMain.on('set-recording-state', (_, on) => setTrayRec(on));
ipcMain.on('set-selected-source', (_, id) => { selectedSourceId = id; console.log('[main] selected source:', id); });

// ─── Settings ───
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (_, s) => {
  if (s && typeof s.outputDir === 'string') settings.outputDir = s.outputDir;
  if (s && typeof s.autoSave === 'boolean') settings.autoSave = s.autoSave;
  if (s && typeof s.quality === 'string') settings.quality = s.quality;
  if (s && typeof s.fps === 'number') settings.fps = s.fps;
  if (s && typeof s.countdown === 'number') settings.countdown = s.countdown;
  if (s && (typeof s.audioDeviceId === 'string' || s.audioDeviceId === null)) settings.audioDeviceId = s.audioDeviceId;
  if (s && typeof s.theme === 'string') settings.theme = s.theme;
  savePersistedSettings();
  return settings;
});
ipcMain.handle('choose-output-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
  if (!r.canceled && r.filePaths[0]) {
    settings.outputDir = r.filePaths[0];
    savePersistedSettings();
    mainWindow?.webContents.send('settings-updated', settings);
    return settings.outputDir;
  }
  return null;
});

// ─── Save: instant WebM ───
ipcMain.handle('save-webm-instant', async (_, tempPath) => {
  if (!isValidTempPath(tempPath)) throw new Error('Invalid temp file path');
  ensureDir(); const out = path.join(settings.outputDir, ts('webm'));
  fs.copyFileSync(tempPath, out); try { fs.unlinkSync(tempPath); } catch(e) {}
  console.log('[main] saved:', out); return out;
});

// ─── Save: trimmed WebM ───
ipcMain.handle('save-webm-trimmed', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const duration = sanitizeNumber(opts.endSec) - startSec;
  if (duration <= 0) throw new Error('Invalid trim range');
  ensureDir(); const out = path.join(settings.outputDir, ts('webm'));
  return new Promise((resolve, reject) => {
    mainWindow?.webContents.send('conversion-status', { status: 'trimming' });
    execFile(ffmpegPath, ['-y', '-i', opts.tempPath, '-ss', String(startSec), '-t', String(duration), '-c', 'copy', out],
      { timeout: 120000 }, (err) => {
        try { fs.unlinkSync(opts.tempPath); } catch(e) {}
        if (err) { mainWindow?.webContents.send('conversion-status', { status: 'error', error: err.message }); reject(err); }
        else { mainWindow?.webContents.send('conversion-status', { status: 'done' }); resolve(out); }
      });
  });
});

// ─── Save: MP4 ───
ipcMain.handle('save-as-mp4', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const endSec = sanitizeNumber(opts.endSec);
  ensureDir(); const out = path.join(settings.outputDir, ts('mp4'));
  const args = ['-y', '-i', opts.tempPath];
  if (opts.trimmed) {
    const duration = endSec - startSec;
    if (duration <= 0) throw new Error('Invalid trim range');
    args.push('-ss', String(startSec), '-t', String(duration));
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  return new Promise((resolve, reject) => {
    mainWindow?.webContents.send('conversion-status', { status: 'converting' });
    const proc = execFile(ffmpegPath, args, { timeout: 300000 }, (err) => {
      try { fs.unlinkSync(opts.tempPath); } catch(e) {}
      if (err) { mainWindow?.webContents.send('conversion-status', { status: 'error', error: err.message }); reject(err); }
      else { mainWindow?.webContents.send('conversion-status', { status: 'done' }); resolve(out); }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) mainWindow?.webContents.send('conversion-status', { status: 'converting', progress: +m[1]*3600 + +m[2]*60 + +m[3] });
    });
  });
});

ipcMain.handle('show-in-finder', (_, p) => {
  if (!isValidOutputPath(p)) throw new Error('Invalid file path');
  shell.showItemInFolder(p);
});
ipcMain.handle('open-file', (_, p) => {
  if (!isValidOutputPath(p)) throw new Error('Invalid file path');
  return shell.openPath(p);
});

// ─── History ───
ipcMain.handle('get-history', () => {
  try { return JSON.parse(fs.readFileSync(getHistoryPath(), 'utf8')); } catch (e) { return []; }
});

ipcMain.handle('add-history-entry', (_, entry) => {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(getHistoryPath(), 'utf8')); } catch (e) {}
  // Get file size server-side
  let fileSize = 0;
  try { fileSize = fs.statSync(entry.filePath).size; } catch (e) {}
  const full = { ...entry, fileSize, savedAt: entry.savedAt || new Date().toISOString() };
  history.unshift(full);
  try { fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2)); } catch (e) {}
  return history;
});

ipcMain.handle('delete-history-entry', (_, filePath) => {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(getHistoryPath(), 'utf8')); } catch (e) {}
  history = history.filter(e => e.filePath !== filePath);
  try { fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2)); } catch (e) {}
  // Attempt to delete file if it's a valid AIXplore recording
  if (isValidHistoryFilePath(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  return history;
});

ipcMain.handle('open-system-pref', (_, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-file-size', (_, filePath) => {
  try { return fs.statSync(filePath).size; } catch (e) { return 0; }
});

// ─── History file access (relaxed path validation: only AIXplore-named files) ───
ipcMain.handle('history-show-in-finder', (_, p) => {
  if (!isValidHistoryFilePath(p)) throw new Error('Invalid file path');
  shell.showItemInFolder(p);
});
ipcMain.handle('history-open-file', (_, p) => {
  if (!isValidHistoryFilePath(p)) throw new Error('Invalid file path');
  return shell.openPath(p);
});

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => mainWindow?.webContents.send('shortcut-toggle-record'));
  globalShortcut.register('CommandOrControl+Shift+P', () => mainWindow?.webContents.send('shortcut-toggle-pause'));
  globalShortcut.register('Escape', () => mainWindow?.webContents.send('shortcut-stop'));
}

app.whenReady().then(() => {
  userData = app.getPath('userData');
  loadPersistedSettings();
  createWindow();
  createTray();
  registerShortcuts();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
