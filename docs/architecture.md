# AIXplore Recorder — Architecture

This document describes the technical architecture, data flow, and design decisions behind AIXplore Recorder.

## Overview

AIXplore Recorder is a single-window Electron application built with three source files and no external UI frameworks. The architecture follows Electron's recommended security model with strict process isolation.

![Electron Process Architecture](images/architecture-overview.png)

## Process Model

### Main Process (`src/main.js`)

Responsibilities:
- Window creation and lifecycle management
- System tray icon with recording status (blinking indicator)
- Global keyboard shortcut registration
- File system operations (save, delete temp files)
- FFmpeg execution for trimming and MP4 conversion
- IPC handler registration for all renderer requests
- macOS permission requests (camera, microphone, screen capture)

### Preload Script (`src/preload.js`)

Acts as a secure bridge using Electron's `contextBridge` API. Exposes a `window.electronAPI` object with methods that map to IPC handlers. This ensures the renderer process never has direct access to Node.js APIs.

### Renderer Process (`src/index.html`)

A single HTML file containing all UI markup, CSS styles, and JavaScript logic. Manages six recording-related views plus navigation:

1. **Source Picker** — Mode toggle (Video / Audio Only), source grid, input toggles, preset selector
2. **Recording View** — Live screen preview with canvas compositor and control bar
3. **Audio Recording View** — Waveform visualizer (30 frequency bars via `AnalyserNode`) and control bar
4. **Trim View** — Video playback with trim sliders and export buttons
5. **Audio Trim View** — Audio player with trim sliders; export to WebM, MP3, or M4A
6. **Dashboard / History / Settings / Permissions / About** — Navigation views

## Recording Pipelines

### Video + Audio pipeline

The canvas compositor runs at the configured FPS (24/30/60), drawing the screen capture as the base layer and overlaying the webcam feed as a circular PiP. The webcam is rendered with:
- Circular clipping mask
- Horizontal mirror transform
- Purple border stroke
- Position based on drag coordinates

Both audio sources (screen loopback and microphone) feed into an `AudioContext` destination node. An `AnalyserNode` taps the combined signal to drive the real-time audio level meter. The final `MediaRecorder` input is a composite stream of the canvas video tracks and the merged audio destination tracks. Format: `video/webm;codecs=vp9,opus`.

### Audio-only pipeline

When Audio Only mode is active, `getDisplayMedia` is skipped entirely. A single `getUserMedia({ audio })` call captures the selected microphone. The audio stream connects to an `AudioContext` destination node and an `AnalyserNode` whose `getByteFrequencyData` output drives the waveform visualizer (30 bars grouped across frequency bins). The `MediaRecorder` records the audio destination stream directly. Format: `audio/webm;codecs=opus` (falls back to `audio/webm`).

System audio loopback is not available in audio-only mode — macOS loopback requires a `getDisplayMedia` session.

## Export Pipeline

Five export paths are available across video and audio modes:

| Path | IPC handler | FFmpeg | Output |
|---|---|---|---|
| WebM Instant (video) | `save-webm-instant` | No — file copy | `AIXplore-…webm` |
| WebM Trimmed (video) | `save-webm-trimmed` | `-c copy` | `AIXplore-…webm` |
| MP4 | `save-as-mp4` | `libx264` + `aac` | `AIXplore-…mp4` |
| Audio WebM Instant | `save-audio-instant` | No — file copy | `AIXplore-Audio-…webm` |
| Audio WebM Trimmed | `save-audio-trimmed` | `-c copy` | `AIXplore-Audio-…webm` |
| MP3 | `convert-to-mp3` | `libmp3lame` 192k | `AIXplore-Audio-…mp3` |
| M4A | `convert-to-m4a` | `aac` 192k + `+faststart` | `AIXplore-Audio-…m4a` |

All paths stream the recorded blob to a cryptographically-named temp file first (`preload.js: initTempFile / writeChunk / finalizeTempFile`), then invoke the appropriate main-process IPC handler. Conversion progress is reported back to the renderer via `conversion-status` IPC events.

All seven save handlers call `copyToSecondaryDir(out)` after a successful save. If `settings.secondaryOutputDir` is configured and the folder exists, the saved file is copied there. Failures are silently logged.

## History Management

| IPC handler | Description |
|---|---|
| `get-history` | Returns the full history array from `history.json` |
| `add-history-entry` | Prepends a new entry (with server-side `fileSize` lookup) |
| `delete-history-entry` | Removes a single entry and deletes the file from disk |
| `delete-history-entries` | Bulk delete — accepts an array of file paths, removes all matching entries and files in one write |
| `choose-export-dir` | Opens a folder picker and returns the selected directory path |
| `export-recordings` | Copies an array of recording files to a destination folder (skips existing, never overwrites) |
| `choose-secondary-dir` | Opens a folder picker, saves the selected path as `secondaryOutputDir` in settings |
| `clear-secondary-dir` | Sets `secondaryOutputDir` to null in settings |
| `convert-history-file` | Converts an existing WebM history file to MP4/MP3/M4A using FFmpeg. Accepts `{ filePath, format, mode }` where `mode` is `duplicate` (keep original) or `replace` (delete original after conversion). Auto-copies result to secondary folder. |

## Security Model

- `contextIsolation: true` — Renderer cannot access Node.js globals
- `nodeIntegration: false` — No `require()` in renderer
- `sandbox: false` — Required for preload script to access Node.js `fs` module for temp file streaming
- **Content Security Policy** — Restricts resource loading to `self`, `blob:`, and `mediastream:` origins
- **Path validation** — All IPC handlers validate temp file paths (must originate from `os.tmpdir()` with `aixplore-rec-` prefix)
- **Output path restriction** — `show-in-finder` and `open-file` only accept paths within the configured output directory
- **Input sanitization** — FFmpeg trim parameters are validated as finite positive numbers
- **Settings whitelist** — Only `outputDir` (string) and `autoSave` (boolean) are accepted via `set-settings`
- **Unpredictable temp files** — Temp filenames use `crypto.randomBytes` instead of timestamps
- All file I/O runs in the main process behind IPC handlers
- macOS entitlements are declared in `entitlements.mac.plist` for camera, microphone, and screen capture

## File Naming Convention

```
AIXplore-YYYY-MM-DD_HHhMMmSSs.{webm|mp4}        ← video recordings
AIXplore-Audio-YYYY-MM-DD_HHhMMmSSs.{webm|mp3|m4a} ← audio-only recordings
```

Generated in the main process (`ts()` / `tsAudio()`) using the local system clock at save time. The `AIXplore-Audio-` prefix distinguishes audio-only files in Finder, history, and `isValidHistoryFilePath` path validation.

## Dependencies

| Package | Purpose |
|---|---|
| `electron` | Desktop application framework |
| `electron-builder` | Build and package for macOS distribution |
| `@ffmpeg-installer/ffmpeg` | Bundled FFmpeg binary for trimming and all audio/video conversion |
| `@playwright/test` | Automated UI tests (dev dependency) |

No runtime UI frameworks or libraries. The entire UI is vanilla HTML/CSS/JS.
