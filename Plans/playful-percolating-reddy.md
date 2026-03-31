# Audio-Only Recording Mode

## Context

AIXplore Recorder is currently a screen + audio recorder. The request is to extend it to support **audio-only recording** — useful for capturing meetings and discussions without needing to share or record a screen. This is a distinct mode: no `getDisplayMedia`, no canvas compositor, no click highlighting. Just microphone input → WebM/Opus → optional MP3/M4A export.

This fits naturally into the existing architecture: the preset system, tray quick-record, audio device selection, trim UI, and ffmpeg pipeline are all already in place. The main new work is a parallel recording code path and two new views.

---

## Critical Files

| File | Role |
|---|---|
| `src/main.js` | IPC handlers, settings, FFmpeg, tray menu |
| `src/preload.js` | contextBridge IPC bridge to renderer |
| `src/index.html` | All UI views + recording state machine |

---

## Existing Patterns to Reuse

- **AudioContext merge** — `createMediaStreamDestination()` + `AnalyserNode` already wired at `index.html:1482–1490`
- **Microphone constraints** — `getAudioDeviceId()` + `echoCancellation:false` pattern at `index.html:1462`
- **Temp file streaming** — `initTempFile / writeChunk / finalizeTempFile / discardTemp` in `preload.js:22–46` work unchanged
- **Waveform AnalyserNode** — `analyser.getByteFrequencyData()` already driving the meter; group into 30 bars for waveform
- **Preset schema** — just add `audioOnly: boolean` field; all CRUD unchanged
- **FFmpeg IPC** — `execFile(ffmpegPath, args)` pattern from `save-as-mp4` at `main.js:416` is the template for mp3/m4a handlers
- **Trim sliders** — reuse HTML/CSS pattern; swap `<video>` for `<audio>` with new element IDs

---

## Implementation Plan

### Phase 1 — Main Process Foundations (`src/main.js`)

1. **Add `tsAudio(ext)` filename generator** alongside existing `ts()` at line 150
   - Returns `AIXplore-Audio-YYYY-MM-DD_HHhMMmSSs.{ext}`

2. **Widen `isValidHistoryFilePath` regex** at line 171
   - Change to: `/^AIXplore(-Audio)?-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}s\.(webm|mp4|mp3|m4a)$/`
   - Backward-compatible; existing entries still validate

3. **Add 4 new `ipcMain.handle` blocks:**
   - `save-audio-instant` — mirrors `save-webm-instant` but calls `tsAudio('webm')`
   - `save-audio-trimmed` — mirrors `save-webm-trimmed` but calls `tsAudio('webm')`
   - `convert-to-mp3` — ffmpeg args: `-vn -acodec libmp3lame -ab 192k -ar 44100`
   - `convert-to-m4a` — ffmpeg args: `-vn -acodec aac -b:a 192k -movflags +faststart`
   - Both transcode handlers accept `{ tempPath, startSec, endSec, trimmed }` and send `conversion-status` progress events

4. **Add default "Audio Recording" preset** to `settings.presets` initializer:
   ```js
   { id: 'default-audio', name: 'Audio Recording', quality: 'medium', fps: 30,
     countdown: 0, cam: false, mic: true, sysAudio: false, audioOnly: true }
   ```

5. **Extend `set-recording-state` IPC handler** to accept optional `audioOnly` second arg:
   - `(_, on, audioOnly)` — skip click capture and cursor poll when `audioOnly === true`

6. **Update `updateTrayMenu()`** — prefix audio-only presets with `🎙` in the submenu label

---

### Phase 2 — Preload Bridge (`src/preload.js`)

Add 4 new methods to `contextBridge.exposeInMainWorld('electronAPI', {...})`, following identical patterns:

```js
saveAudioInstant:  () => ipcRenderer.invoke('save-audio-instant', _tempPath),
saveAudioTrimmed:  (opts) => ipcRenderer.invoke('save-audio-trimmed', { tempPath: _tempPath, ...opts }),
saveAsMp3:         (opts) => ipcRenderer.invoke('convert-to-mp3',     { tempPath: _tempPath, ...opts }),
saveAsM4a:         (opts) => ipcRenderer.invoke('convert-to-m4a',     { tempPath: _tempPath, ...opts }),
```

---

### Phase 3 — HTML Views & CSS (`src/index.html`)

**CSS additions** (after existing `.audio-meter` rules):
- `.waveform-area` — full-height black area for the bars
- `.waveform-bars` / `.waveform-bar` — 30-bar flex layout, accent-colored, animated height
- `.hr-badge.mp3`, `.hr-badge.m4a` — new badge colors in history

**New HTML blocks:**
- `viewAudioRecording` — `.waveform-area` (title + 30-bar `#waveformBars` + meta) + existing `.control-bar` pattern with `#audioTimer`, `#btnAudioPause`, `#btnAudioStop`
- `viewAudioTrim` — `<audio id="trimAudio" controls>` + existing trim slider pattern with new IDs (`audioTrimStart`, `audioTrimEnd`) + save buttons: WebM, Trimmed WebM, MP3, M4A

**Source Picker addition:** "🎙 Start Audio Recording" button below the output path row in `viewPicker`

---

### Phase 4 — JavaScript Logic (`src/index.html` script section)

**New state variables:**
```js
var audioOnlyMode = false;
var audioOnlyStream = null;
```

**Extend view arrays:**
```js
ALL_VIEWS: add 'viewAudioRecording', 'viewAudioTrim'
RECORDING_VIEWS: add 'viewAudioRecording', 'viewAudioTrim'
```

**New functions:**
| Function | Description |
|---|---|
| `startAudioRecording()` | Skip `getDisplayMedia`; `getUserMedia({ audio })` only; `MediaRecorder({ mimeType: 'audio/webm;codecs=opus' })`; countdown reuse |
| `initWaveformBars()` | Inject 30 `<div class="waveform-bar">` elements into `#waveformBars` |
| `startWaveformAnimation()` | `requestAnimationFrame` loop; `getByteFrequencyData` → 30 bar heights + existing meter fill |
| `cleanupAudioRecording()` | Stop stream tracks, close AudioContext, clear timer |
| `toggleAudioPause()` | Mirrors existing `togglePause()` but refs audio DOM elements |
| `stopAudioRecording()` | `mediaRecorder.stop()` → `onstop` → `showAudioTrimView()` |
| `updateAudioTimer()` | Same logic as existing timer, updates `#audioTimer` |
| `showAudioTrimView()` | Set `<audio>.src = recordedBlobUrl`; wire `loadedmetadata` → sliders |
| `saveAudioInstant()` | `writeBlobToTemp()` → `saveAudioInstant` IPC → history entry |
| `saveAudioTrimmed()` | Trim range → `saveAudioTrimmed` IPC |
| `saveAsMp3()` | Detect trim needed → `saveAsMp3` IPC |
| `saveAsM4a()` | Detect trim needed → `saveAsM4a` IPC |
| `discardAudioRecording()` | Cleanup + `discardTemp()` + `navTo('viewPicker')` |

**Modifications to existing functions:**
- `applyPreset(p)` — if `p.audioOnly`, skip screen toggle updates; return early (caller routes to audio path)
- `onStop` / `onTogglePause` tray handlers — route to audio variants when `audioOnlyMode === true`
- `saveCurrentAsPreset()` — include `audioOnly: audioOnlyMode` in saved object
- `renderPresetsSettings()` — show `audioOnly` in description; add checkbox to edit form; gray out quality/fps/cam when checked
- `makeHistoryRow()` — microphone SVG icon for audio entries; `webm-a` badge label for audio WebM
- `renderFormatBreakdown()` — add mp3/m4a buckets to donut chart

---

### Phase 5 — UX: Mode Switch and Tray Flow

**Mode switch on the Picker view:**
Replace the subtle "Start Audio Recording" button with a prominent two-segment toggle at the top of `viewPicker`:

```
[ 🎥 Video + Audio ]  [ 🎙 Audio Only ]
```

- Default: Video+Audio (existing behavior, unchanged)
- When "Audio Only" is selected:
  - Source grid is hidden (no screen picker needed)
  - Camera toggle is hidden/disabled
  - System audio toggle is hidden/disabled with note: _"System audio requires screen capture"_
  - The "Start Recording" button changes to "Start Audio Recording"
  - Clicking it calls `startAudioRecording()` directly — no source selection required

**Tray quick-record for audio-only:**
When an `audioOnly` preset is activated from the tray:
- **Skip the picker entirely** — call `startAudioRecording()` directly (with countdown if set)
- The window does not need to open at all (same UX as existing quick-record behavior)
- `onTrayApplyPreset` checks `preset.audioOnly` → if true, calls `startAudioRecording()` directly instead of `navTo('viewPicker')`

**System Audio disable for Audio-Only Mode:**
Hide/disable `toggleSys` when audio-only mode is active. Loopback requires `getDisplayMedia` (macOS constraint) — not available without screen capture.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **System audio unavailable** in audio-only mode — loopback requires `getDisplayMedia`, which can't be called without a screen source | Disable + hide `toggleSys` in audio-only mode; add explanatory tooltip |
| **`isValidHistoryFilePath` rejects new file types** — breaks Finder/open IPC for mp3/m4a | Fixed in Phase 1.2 before any audio saves are wired |
| **`MediaRecorder` `audio/webm;codecs=opus` support** | Runtime `isTypeSupported` guard with `audio/webm` fallback; both work with FFmpeg trim |
| **Trim view assumes `<video>` element** | Parallel DOM with new IDs — existing `showTrimView()` / `viewTrim` untouched |
| **`set-recording-state` second arg ignored** | Backward-compatible: `audioOnly` is `undefined` (falsy) on existing calls |

---

## Verification

1. Audio-only record flow: picker → "Start Audio Recording" → waveform animates → STOP → trim view → Save MP3 → file in output dir with `AIXplore-Audio-` prefix
2. "Meeting Recording" preset from tray → audio recording starts, no screen picker shown
3. Trim: move start to 5s, end to 30s → Save Trimmed WebM → correct duration
4. Pause/resume: timer holds, waveform stops/starts
5. History page: audio entries show mic icon, correct badge (mp3/m4a/webm-a)
6. `isValidHistoryFilePath` accepts `.mp3` / `.m4a` paths — no "Invalid file path" errors in Finder open
7. Existing screen recording: **completely unaffected** — run a full screen record → MP4 export regression check
