try {
  const { contextBridge, ipcRenderer } = require('electron');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const crypto = require('crypto');

  console.log('[preload] Node.js available, fs:', typeof fs.createWriteStream);

  var _tempPath = null;
  var _stream = null;

  contextBridge.exposeInMainWorld('electronAPI', {
    getSources: function() { return ipcRenderer.invoke('get-sources'); },
    setRecordingState: function(on) { ipcRenderer.send('set-recording-state', on); },
    getSettings: function() { return ipcRenderer.invoke('get-settings'); },
    setSettings: function(s) { return ipcRenderer.invoke('set-settings', s); },
    chooseOutputDir: function() { return ipcRenderer.invoke('choose-output-dir'); },
    onSettingsUpdated: function(cb) { ipcRenderer.on('settings-updated', function(_, s) { cb(s); }); },

    initTempFile: function() {
      _tempPath = path.join(os.tmpdir(), 'aixplore-rec-' + crypto.randomBytes(16).toString('hex') + '.webm');
      _stream = fs.createWriteStream(_tempPath);
      console.log('[preload] temp file:', _tempPath);
      return _tempPath;
    },
    writeChunk: function(data) {
      return new Promise(function(resolve, reject) {
        if (!_stream) return reject(new Error('No write stream'));
        var buf = Buffer.from(data);
        _stream.write(buf, function(err) { if (err) reject(err); else resolve(true); });
      });
    },
    finalizeTempFile: function() {
      return new Promise(function(resolve) {
        if (!_stream) return resolve(_tempPath);
        var ws = _stream; _stream = null;
        ws.end(function() { console.log('[preload] finalized:', _tempPath); resolve(_tempPath); });
      });
    },
    discardTemp: function() {
      if (_stream) { try { _stream.end(); } catch(e) {} _stream = null; }
      if (_tempPath && fs.existsSync(_tempPath)) { try { fs.unlinkSync(_tempPath); } catch(e) {} }
      _tempPath = null;
    },

    saveWebmInstant: function() { return ipcRenderer.invoke('save-webm-instant', _tempPath); },
    saveWebmTrimmed: function(opts) { return ipcRenderer.invoke('save-webm-trimmed', { tempPath: _tempPath, startSec: opts.startSec, endSec: opts.endSec }); },
    saveAsMp4: function(opts) { return ipcRenderer.invoke('save-as-mp4', { tempPath: _tempPath, startSec: opts.startSec, endSec: opts.endSec, trimmed: opts.trimmed }); },

    showInFinder: function(p) { return ipcRenderer.invoke('show-in-finder', p); },
    openFile: function(p) { return ipcRenderer.invoke('open-file', p); },
    onConversionStatus: function(cb) { ipcRenderer.on('conversion-status', function(_, s) { cb(s); }); },
    onToggleRecord: function(cb) { ipcRenderer.on('shortcut-toggle-record', function() { cb(); }); },
    onTogglePause: function(cb) { ipcRenderer.on('shortcut-toggle-pause', function() { cb(); }); },
    onStop: function(cb) { ipcRenderer.on('shortcut-stop', function() { cb(); }); }
  });

  console.log('[preload] electronAPI exposed OK');
} catch (err) {
  console.error('[preload] FATAL:', err);
}
