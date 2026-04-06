const { app, BrowserWindow, ipcMain, desktopCapturer, dialog,
        globalShortcut, Tray, Menu, shell, nativeImage, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

app.setName('AIXplore Recorder');

let mainWindow, tray, blinkInterval, selectedSourceId = null;
let isRecording = false;
let isPausedRecording = false;
let clickCaptureProc = null;
let cursorPollInterval = null;
let recordingSourceBounds = null; // {x,y,w,h} in logical coords — set when recording starts

// Query CGWindowListCopyWindowInfo for a window source's logical bounds.
// Returns a Promise that resolves to {x,y,w,h} or null if unavailable.
function queryWindowBounds(windowId) {
  return new Promise((resolve) => {
    const binPath = getClickCapturePath();
    if (!fs.existsSync(binPath)) return resolve(null);
    execFile(binPath, ['--window-id', String(windowId)], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      try {
        const info = JSON.parse(stdout.trim());
        if (info.type === 'window_bounds' && info.w > 0)
          resolve({ x: info.x, y: info.y, w: info.w, h: info.h });
        else resolve(null);
      } catch (e) { resolve(null); }
    });
  });
}

function normalizeCursorPos(pos) {
  if (recordingSourceBounds) {
    // Window source: normalize relative to the captured window's bounds
    const b = recordingSourceBounds;
    return {
      normX: Math.max(0, Math.min(1, (pos.x - b.x) / b.w)),
      normY: Math.max(0, Math.min(1, (pos.y - b.y) / b.h))
    };
  }
  // Screen source: normalize relative to the display the cursor is on
  const displays = screen.getAllDisplays();
  const d = displays.find(d =>
    pos.x >= d.bounds.x && pos.x < d.bounds.x + d.bounds.width &&
    pos.y >= d.bounds.y && pos.y < d.bounds.y + d.bounds.height
  ) || screen.getPrimaryDisplay();
  return {
    normX: (pos.x - d.bounds.x) / d.bounds.width,
    normY: (pos.y - d.bounds.y) / d.bounds.height
  };
}

function startCursorPoll() {
  if (cursorPollInterval) return;
  cursorPollInterval = setInterval(() => {
    const pos = screen.getCursorScreenPoint();
    const { normX, normY } = normalizeCursorPos(pos);
    sendToWindow('cursor-pos', { normX, normY });
  }, 33); // ~30fps
}

function stopCursorPoll() {
  if (cursorPollInterval) { clearInterval(cursorPollInterval); cursorPollInterval = null; }
  recordingSourceBounds = null;
}

function getClickCapturePath() {
  // In packaged app, binary lives in Resources/ (extraResources).
  // In dev, it sits alongside main.js in src/.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'click-capture')
    : path.join(__dirname, 'click-capture');
}

function startClickCapture() {
  if (clickCaptureProc) return;
  const binPath = getClickCapturePath();
  if (!fs.existsSync(binPath)) { console.log('[click-capture] binary missing'); return; }
  try {
    clickCaptureProc = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'ignore'] });
    clickCaptureProc.unref(); // don't block Electron exit waiting for this subprocess
    let buf = '';
    clickCaptureProc.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const click = JSON.parse(line);
          const displays = screen.getAllDisplays();
          const d = displays.find(d =>
            click.x >= d.bounds.x && click.x < d.bounds.x + d.bounds.width &&
            click.y >= d.bounds.y && click.y < d.bounds.y + d.bounds.height
          ) || screen.getPrimaryDisplay();
          const normX = (click.x - d.bounds.x) / d.bounds.width;
          const normY = (click.y - d.bounds.y) / d.bounds.height;
          sendToWindow('global-click', { normX, normY });
        } catch (e) {}
      }
    });
    clickCaptureProc.on('exit', () => { clickCaptureProc = null; });
    console.log('[click-capture] started pid:', clickCaptureProc.pid);
  } catch (e) { console.log('[click-capture] error:', e.message); clickCaptureProc = null; }
}

function stopClickCapture() {
  if (clickCaptureProc) { clickCaptureProc.kill('SIGKILL'); clickCaptureProc = null; }
}
let settings = {
  outputDir: path.join(app.getPath('videos'), 'AIXplore Recordings'),
  autoSave: false,
  quality: 'high',    // high=6Mbps, medium=3Mbps, low=1.5Mbps
  fps: 30,
  countdown: 3,
  audioDeviceId: null,
  theme: 'system',
  clickHighlight: true,
  cursorFxSize: 'medium',  // small | medium | large
  cursorFxColor: 'yellow', // yellow | white | cyan | red
  defaultPresetId: '',     // preset ID to auto-apply on picker open
  presets: [
    { id: 'default-tutorial',      name: 'Tutorial',         quality: 'high',   fps: 30, countdown: 3, cam: true,  mic: true,  sysAudio: false, audioOnly: false },
    { id: 'default-demo',          name: 'Quick Demo',       quality: 'medium', fps: 30, countdown: 0, cam: false, mic: true,  sysAudio: false, audioOnly: false },
    { id: 'default-presentation',  name: 'Presentation',     quality: 'high',   fps: 30, countdown: 5, cam: false, mic: true,  sysAudio: true,  audioOnly: false },
    { id: 'default-audio',         name: 'Audio Recording',  quality: 'medium', fps: 30, countdown: 0, cam: false, mic: true,  sysAudio: false, audioOnly: true  }
  ]
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
  // Migration: ensure built-in default presets that may be missing from older settings.json
  const builtins = [
    { id: 'default-audio', name: 'Audio Recording', quality: 'medium', fps: 30, countdown: 0, cam: false, mic: true, sysAudio: false, audioOnly: true }
  ];
  if (!settings.presets) settings.presets = [];
  let changed = false;
  builtins.forEach(function(bp) {
    if (!settings.presets.find(function(p) { return p.id === bp.id; })) {
      settings.presets.push(bp); changed = true;
      console.log('[main] migrated default preset:', bp.name);
    }
  });
  if (changed) savePersistedSettings();
}

function savePersistedSettings() {
  try { fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2)); } catch (e) {}
}

function ts(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `AIXplore-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s.${ext}`;
}
function tsAudio(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `AIXplore-Audio-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s.${ext}`;
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

// Validate a history file path: must be within outputDir with a known extension
function isValidHistoryFilePath(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(settings.outputDir))) return false;
  return /\.(webm|mp4|mp3|m4a)$/.test(path.basename(resolved));
}

// Validate a new filename stem for rename (no slashes, no null bytes, non-empty)
function isValidRenameStem(stem) {
  if (!stem || typeof stem !== 'string') return false;
  const trimmed = stem.trim();
  return trimmed.length > 0 && !/[/\0]/.test(trimmed);
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

// Recreate window if destroyed (user closed it), then show+focus.
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// Safe IPC send — skips if window gone or destroyed.
function sendToWindow(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const template = [];

  if (isRecording) {
    template.push({ label: '■  Stop Recording',   click: () => sendToWindow('shortcut-stop') });
    template.push({ label: isPausedRecording ? '▶  Resume Recording' : '⏸  Pause Recording',
                    click: () => sendToWindow('shortcut-toggle-pause') });
  } else {
    template.push({ label: '🎥  Video + Audio',
                    click: () => { showMainWindow(); sendToWindow('tray-start-recording'); } });
    template.push({ label: '🎙  Audio Only',
                    click: () => {
                      showMainWindow();
                      sendToWindow('tray-apply-preset', (settings.presets || []).find(p => p.audioOnly) || {
                        id: 'default-audio', name: 'Audio Recording', quality: 'medium',
                        fps: 30, countdown: 0, cam: false, mic: true, sysAudio: false, audioOnly: true
                      });
                    } });
    // Presets submenu
    const presets = settings.presets || [];
    if (presets.length > 0) {
      template.push({ type: 'separator' });
      template.push({
        label: 'Presets',
        submenu: presets.map(p => ({
          label: (p.audioOnly ? '🎙 ' : '🎥 ') + p.name,
          click: () => { showMainWindow(); sendToWindow('tray-apply-preset', p); }
        }))
      });
    }
  }

  template.push({ type: 'separator' });
  template.push({
    label: 'Cursor FX',
    type: 'checkbox',
    checked: settings.clickHighlight !== false,
    click: (item) => {
      settings.clickHighlight = item.checked;
      savePersistedSettings();
      sendToWindow('settings-updated', settings);
    }
  });

  if (!isRecording) {
    template.push({ type: 'separator' });
    template.push({ label: 'Settings…',
                    click: () => { showMainWindow(); sendToWindow('tray-navigate-to', 'viewSettings'); } });
  }

  template.push({ type: 'separator' });
  template.push({ label: 'Show AIXplore Recorder', click: () => showMainWindow() });
  template.push({ type: 'separator' });
  template.push({ label: 'Quit', click: () => {
    stopClickCapture(); stopCursorPoll(); app.quit();
  } });

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  // 22x22 colored PNG: white screen outline + red record dot
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAABd0lEQVR4nO2Uv0oDQRDGkxATSERBhCA2FhGEgIVFmhF8Cwv5wNYnsLGzsLf1HQRT2QqWKtooNgFBc0kuf0RRNCa5T/ZuE8zlLt5dZeHAxw23s7+d2Z3dWOzf3EYyT/KEpBFBal7eDxwVOoT7gQcBhZCVFgZzJ4LDQAPNDQOmIEFBkoKUrV7PYN+KDqYgTsEUBRkKZimYs/X6VuXHZ1WPxUOBNVRlOENBjoIlCpZtPdXrbD7X9FhqBB4ArEqfpmCBgnUKjim4pqDE86sWy4+mHlMxyUBgnW2agnkKVigoU8Chtna7vLxt6gpUTDooOKH3VWWEEehAN/cNClZ1TGYM7NXHGpylYJGC7QngNR2T/Qn2v3l9y7BP3WzVeFdu2KW7t6LbLfll7P9WWJbBzleV7ZcaHyomzy7aPDh6585+x/5WzFPuHW567vFv5uoKdYBFCja0ivrfeFcEAPv3sePnPPs4BHz85jl+xvPmhVxg9K1w/ERk4J+wb13LTacdh/auAAAAAElFTkSuQmCC');
  // No setTemplateImage — keeps colors on both light and dark menu bars
  tray = new Tray(icon);
  tray.setToolTip('AIXplore Recorder');
  updateTrayMenu();
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

// Returns the first physical screen source ID — used by audio-only mode to
// force loopback on Screen 1 instead of a stale window selectedSourceId
ipcMain.handle('get-primary-screen-id', async () => {
  try {
    const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    console.log('[main] get-primary-screen-id: found', screens.length, 'screen(s):', screens.map(s => s.name));
    return screens.length > 0 ? screens[0].id : null;
  } catch (err) {
    console.error('[main] get-primary-screen-id error:', err);
    return null;
  }
});

ipcMain.on('set-recording-state', (_, on, audioOnly) => {
  isRecording = on;
  if (!on) isPausedRecording = false;
  setTrayRec(on);
  updateTrayMenu();
  if (on && !audioOnly) {
    const windowMatch = selectedSourceId && selectedSourceId.match(/^window:(\d+)/);
    if (windowMatch) {
      queryWindowBounds(parseInt(windowMatch[1])).then(bounds => {
        recordingSourceBounds = bounds;
        console.log('[cursor] source bounds:', bounds);
        startClickCapture(); startCursorPoll();
      });
    } else {
      recordingSourceBounds = null;
      startClickCapture(); startCursorPoll();
    }
  } else if (!on) {
    stopClickCapture(); stopCursorPoll();
  }
});

ipcMain.on('set-pause-state', (_, paused) => { isPausedRecording = paused; updateTrayMenu(); });
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
  if (s && typeof s.clickHighlight === 'boolean') settings.clickHighlight = s.clickHighlight;
  if (s && typeof s.cursorFxSize === 'string') settings.cursorFxSize = s.cursorFxSize;
  if (s && typeof s.cursorFxColor === 'string') settings.cursorFxColor = s.cursorFxColor;
  if (s && typeof s.defaultPresetId === 'string') settings.defaultPresetId = s.defaultPresetId;
  if (s && (typeof s.secondaryOutputDir === 'string' || s.secondaryOutputDir === null)) settings.secondaryOutputDir = s.secondaryOutputDir;
  savePersistedSettings();
  return settings;
});
ipcMain.handle('choose-output-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outputDir });
  if (!r.canceled && r.filePaths[0]) {
    settings.outputDir = r.filePaths[0];
    savePersistedSettings();
    sendToWindow('settings-updated', settings);
    startDirWatcher();
    return settings.outputDir;
  }
  return null;
});

// ─── Secondary output copy ───
function copyToSecondaryDir(savedPath) {
  try {
    const dir = settings.secondaryOutputDir;
    if (!dir || typeof dir !== 'string') return;
    if (!fs.existsSync(dir)) return;
    const dest = path.join(dir, path.basename(savedPath));
    if (fs.existsSync(dest)) return;
    fs.copyFileSync(savedPath, dest);
    console.log('[main] secondary copy:', dest);
  } catch (e) { console.warn('[main] secondary copy failed:', e.message); }
}

ipcMain.handle('choose-secondary-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) {
    settings.secondaryOutputDir = r.filePaths[0];
    savePersistedSettings();
    sendToWindow('settings-updated', settings);
    return r.filePaths[0];
  }
  return null;
});

ipcMain.handle('clear-secondary-dir', () => {
  settings.secondaryOutputDir = null;
  savePersistedSettings();
  sendToWindow('settings-updated', settings);
  return null;
});

// ─── Save: instant WebM ───
ipcMain.handle('save-webm-instant', async (_, tempPath) => {
  if (!isValidTempPath(tempPath)) throw new Error('Invalid temp file path');
  ensureDir(); const out = path.join(settings.outputDir, ts('webm'));
  fs.copyFileSync(tempPath, out); try { fs.unlinkSync(tempPath); } catch(e) {}
  console.log('[main] saved:', out); copyToSecondaryDir(out); return out;
});

// ─── Save: trimmed WebM ───
ipcMain.handle('save-webm-trimmed', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const duration = sanitizeNumber(opts.endSec) - startSec;
  if (duration <= 0) throw new Error('Invalid trim range');
  ensureDir(); const out = path.join(settings.outputDir, ts('webm'));
  return new Promise((resolve, reject) => {
    sendToWindow('conversion-status', { status: 'trimming' });
    execFile(ffmpegPath, ['-y', '-i', opts.tempPath, '-ss', String(startSec), '-t', String(duration), '-c', 'copy', out],
      { timeout: 120000 }, (err) => {
        try { fs.unlinkSync(opts.tempPath); } catch(e) {}
        if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); }
        else { sendToWindow('conversion-status', { status: 'done' }); copyToSecondaryDir(out); resolve(out); }
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
    sendToWindow('conversion-status', { status: 'converting' });
    const proc = execFile(ffmpegPath, args, { timeout: 300000 }, (err) => {
      try { fs.unlinkSync(opts.tempPath); } catch(e) {}
      if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); }
      else { sendToWindow('conversion-status', { status: 'done' }); copyToSecondaryDir(out); resolve(out); }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) sendToWindow('conversion-status', { status: 'converting', progress: +m[1]*3600 + +m[2]*60 + +m[3] });
    });
  });
});

// ─── Save: audio-only instant WebM ───
ipcMain.handle('save-audio-instant', async (_, tempPath) => {
  if (!isValidTempPath(tempPath)) throw new Error('Invalid temp file path');
  ensureDir(); const out = path.join(settings.outputDir, tsAudio('webm'));
  fs.copyFileSync(tempPath, out); try { fs.unlinkSync(tempPath); } catch(e) {}
  console.log('[main] saved audio:', out); copyToSecondaryDir(out); return out;
});

// ─── Save: audio-only trimmed WebM ───
ipcMain.handle('save-audio-trimmed', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const duration = sanitizeNumber(opts.endSec) - startSec;
  if (duration <= 0) throw new Error('Invalid trim range');
  ensureDir(); const out = path.join(settings.outputDir, tsAudio('webm'));
  return new Promise((resolve, reject) => {
    sendToWindow('conversion-status', { status: 'trimming' });
    execFile(ffmpegPath, ['-y', '-i', opts.tempPath, '-ss', String(startSec), '-t', String(duration), '-c', 'copy', out],
      { timeout: 120000 }, (err) => {
        try { fs.unlinkSync(opts.tempPath); } catch(e) {}
        if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); }
        else { sendToWindow('conversion-status', { status: 'done' }); copyToSecondaryDir(out); resolve(out); }
      });
  });
});

// ─── Save: MP3 ───
ipcMain.handle('convert-to-mp3', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const endSec   = sanitizeNumber(opts.endSec);
  ensureDir(); const out = path.join(settings.outputDir, tsAudio('mp3'));
  const args = ['-y', '-i', opts.tempPath];
  if (opts.trimmed) {
    const duration = endSec - startSec;
    if (duration <= 0) throw new Error('Invalid trim range');
    args.push('-ss', String(startSec), '-t', String(duration));
  }
  args.push('-vn', '-acodec', 'libmp3lame', '-ab', '192k', '-ar', '44100', out);
  return new Promise((resolve, reject) => {
    sendToWindow('conversion-status', { status: 'converting' });
    const proc = execFile(ffmpegPath, args, { timeout: 300000 }, (err) => {
      try { fs.unlinkSync(opts.tempPath); } catch(e) {}
      if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); }
      else { sendToWindow('conversion-status', { status: 'done' }); copyToSecondaryDir(out); resolve(out); }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) sendToWindow('conversion-status', { status: 'converting', progress: +m[1]*3600 + +m[2]*60 + +m[3] });
    });
  });
});

// ─── Save: M4A ───
ipcMain.handle('convert-to-m4a', async (_, opts) => {
  if (!isValidTempPath(opts.tempPath)) throw new Error('Invalid temp file path');
  const startSec = sanitizeNumber(opts.startSec);
  const endSec   = sanitizeNumber(opts.endSec);
  ensureDir(); const out = path.join(settings.outputDir, tsAudio('m4a'));
  const args = ['-y', '-i', opts.tempPath];
  if (opts.trimmed) {
    const duration = endSec - startSec;
    if (duration <= 0) throw new Error('Invalid trim range');
    args.push('-ss', String(startSec), '-t', String(duration));
  }
  args.push('-vn', '-acodec', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
  return new Promise((resolve, reject) => {
    sendToWindow('conversion-status', { status: 'converting' });
    const proc = execFile(ffmpegPath, args, { timeout: 300000 }, (err) => {
      try { fs.unlinkSync(opts.tempPath); } catch(e) {}
      if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); }
      else { sendToWindow('conversion-status', { status: 'done' }); copyToSecondaryDir(out); resolve(out); }
    });
    if (proc.stderr) proc.stderr.on('data', (d) => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) sendToWindow('conversion-status', { status: 'converting', progress: +m[1]*3600 + +m[2]*60 + +m[3] });
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

// ─── Convert existing history file (WebM → MP4 / MP3 / M4A) ───
ipcMain.handle('convert-history-file', async (_, opts) => {
  if (!isValidHistoryFilePath(opts.filePath)) throw new Error('Invalid file path');
  const format = ['mp4', 'mp3', 'm4a'].includes(opts.format) ? opts.format : null;
  if (!format) throw new Error('Invalid format');

  const dir = path.dirname(opts.filePath);
  const base = path.basename(opts.filePath, path.extname(opts.filePath));
  const out = path.join(dir, base + '.' + format);

  const args = ['-y', '-i', opts.filePath];
  if (format === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  } else if (format === 'mp3') {
    args.push('-vn', '-acodec', 'libmp3lame', '-ab', '192k', '-ar', '44100', out);
  } else if (format === 'm4a') {
    args.push('-vn', '-acodec', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
  }

  return new Promise((resolve, reject) => {
    sendToWindow('conversion-status', { status: 'converting' });
    const proc = execFile(ffmpegPath, args, { timeout: 300000 }, (err) => {
      if (err) { sendToWindow('conversion-status', { status: 'error', error: err.message }); reject(err); return; }
      sendToWindow('conversion-status', { status: 'done' });
      if (opts.mode === 'replace') { try { fs.unlinkSync(opts.filePath); } catch(e) {} }
      copyToSecondaryDir(out);
      resolve({ outPath: out, replaced: opts.mode === 'replace' });
    });
    if (proc.stderr) proc.stderr.on('data', (d) => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) sendToWindow('conversion-status', { status: 'converting', progress: +m[1]*3600 + +m[2]*60 + +m[3] });
    });
  });
});

// ─── History helpers ───
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(getHistoryPath(), 'utf8')); } catch (e) { return []; }
}
function saveHistory(history) {
  try { fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2)); } catch (e) {}
}

ipcMain.handle('get-history', () => loadHistory());

ipcMain.handle('add-history-entry', (_, entry) => {
  const history = loadHistory();
  let fileSize = 0;
  try { fileSize = fs.statSync(entry.filePath).size; } catch (e) {}
  history.unshift({ ...entry, fileSize, savedAt: entry.savedAt || new Date().toISOString() });
  saveHistory(history);
  return history;
});

ipcMain.handle('delete-history-entry', (_, filePath) => {
  const history = loadHistory().filter(e => e.filePath !== filePath);
  saveHistory(history);
  if (isValidHistoryFilePath(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  return history;
});

ipcMain.handle('delete-history-entries', (_, filePaths) => {
  if (!Array.isArray(filePaths)) throw new Error('Expected array of file paths');
  const pathSet = new Set(filePaths);
  const history = loadHistory().filter(e => !pathSet.has(e.filePath));
  saveHistory(history);
  filePaths.forEach(fp => { if (isValidHistoryFilePath(fp)) { try { fs.unlinkSync(fp); } catch (e) {} } });
  return history;
});

ipcMain.handle('choose-export-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (!r.canceled && r.filePaths[0]) return r.filePaths[0];
  return null;
});

ipcMain.handle('export-recordings', (_, opts) => {
  if (!opts || !Array.isArray(opts.filePaths) || !opts.destDir) throw new Error('Invalid export options');
  const destDir = opts.destDir;
  if (!fs.existsSync(destDir)) throw new Error('Destination folder does not exist');
  let exported = 0, skipped = 0, errors = 0;
  opts.filePaths.forEach(fp => {
    if (!isValidHistoryFilePath(fp)) { errors++; return; }
    const dest = path.join(destDir, path.basename(fp));
    if (fs.existsSync(dest)) { skipped++; return; }
    try { fs.copyFileSync(fp, dest); exported++; } catch (e) { errors++; }
  });
  return { exported, skipped, errors };
});

// ─── Rename history file ───
ipcMain.handle('rename-history-file', (_, { oldPath, newStem }) => {
  if (!isValidHistoryFilePath(oldPath)) throw new Error('Invalid file path');
  if (!isValidRenameStem(newStem)) throw new Error('Invalid file name');
  const newPath = path.join(path.dirname(oldPath), newStem.trim() + path.extname(oldPath));
  if (newPath === oldPath) return oldPath;
  if (fs.existsSync(newPath)) throw new Error('A file with that name already exists');
  fs.renameSync(oldPath, newPath);
  const history = loadHistory();
  const idx = history.findIndex(e => e.filePath === oldPath);
  if (idx !== -1) { history[idx] = { ...history[idx], filePath: newPath }; saveHistory(history); }
  return newPath;
});

ipcMain.handle('open-system-pref', (_, url) => {
  shell.openExternal(url);
});

// ─── Presets ───
ipcMain.handle('get-presets', () => settings.presets || []);

ipcMain.handle('save-preset', (_, preset) => {
  if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) throw new Error('Invalid preset name');
  if (!settings.presets) settings.presets = [];
  settings.presets.push({ ...preset, name: preset.name.trim(), id: 'preset-' + Date.now() });
  savePersistedSettings();
  return settings.presets;
});

ipcMain.handle('delete-preset', (_, id) => {
  if (!id || typeof id !== 'string') throw new Error('Invalid preset id');
  settings.presets = (settings.presets || []).filter(p => p.id !== id);
  if (settings.defaultPresetId === id) settings.defaultPresetId = '';
  savePersistedSettings();
  return settings.presets;
});

ipcMain.handle('update-preset', (_, updated) => {
  if (!updated || typeof updated.id !== 'string') throw new Error('Invalid preset');
  const idx = (settings.presets || []).findIndex(p => p.id === updated.id);
  if (idx === -1) throw new Error('Preset not found');
  settings.presets[idx] = { ...settings.presets[idx], ...updated };
  savePersistedSettings();
  return settings.presets;
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

// ─── Output directory watcher (detects on-disk renames) ───
let dirWatcher = null;
let watcherDebounce = null;
function startDirWatcher() {
  if (dirWatcher) { try { dirWatcher.close(); } catch (e) {} dirWatcher = null; }
  const watchDir = settings.outputDir;
  if (!watchDir || !fs.existsSync(watchDir)) return;
  try {
    dirWatcher = fs.watch(watchDir, (eventType, filename) => {
      if (eventType !== 'rename' || !filename) return;
      clearTimeout(watcherDebounce);
      watcherDebounce = setTimeout(() => {
        const history = loadHistory();
        const missing = history.filter(e =>
          path.dirname(e.filePath) === watchDir && !fs.existsSync(e.filePath)
        );
        if (missing.length === 0) return;
        let diskFiles;
        try { diskFiles = fs.readdirSync(watchDir); } catch (e) { return; }
        const historyPaths = new Set(history.map(e => e.filePath));
        const newFiles = diskFiles
          .map(f => path.join(watchDir, f))
          .filter(fp => !historyPaths.has(fp) && /\.(webm|mp4|mp3|m4a)$/.test(fp));
        let changed = false;
        for (const entry of missing) {
          const ext = path.extname(entry.filePath);
          const matchIdx = newFiles.findIndex(fp => path.extname(fp) === ext);
          if (matchIdx !== -1) {
            const idx = history.findIndex(e => e.filePath === entry.filePath);
            if (idx !== -1) { history[idx] = { ...history[idx], filePath: newFiles[matchIdx] }; changed = true; }
            newFiles.splice(matchIdx, 1);
          }
        }
        if (changed) { saveHistory(history); sendToWindow('history-changed', history); }
      }, 150);
    });
  } catch (e) { console.log('[watcher] failed to watch', watchDir, e.message); }
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => sendToWindow('shortcut-toggle-record'));
  globalShortcut.register('CommandOrControl+Shift+P', () => sendToWindow('shortcut-toggle-pause'));
  globalShortcut.register('Escape', () => sendToWindow('shortcut-stop'));
}

app.whenReady().then(() => {
  userData = app.getPath('userData');
  loadPersistedSettings();
  startDirWatcher();
  // Set dock icon (applies in dev mode; packaged builds use the .icns automatically)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon-1024.png');
    if (fs.existsSync(iconPath)) app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
  createWindow();
  createTray();
  registerShortcuts();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopClickCapture();
  stopCursorPoll();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
