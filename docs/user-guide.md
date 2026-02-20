# AIXplore Recorder — User Guide

This guide covers everything you need to know to record, edit, and export screen recordings with AIXplore Recorder.

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation](#installation)
- [First Launch & Permissions](#first-launch--permissions)
- [Recording a Screen or Window](#recording-a-screen-or-window)
- [Using the Webcam Overlay](#using-the-webcam-overlay)
- [Audio Configuration](#audio-configuration)
- [Recording Controls](#recording-controls)
- [Trimming Your Recording](#trimming-your-recording)
- [Exporting & Saving](#exporting--saving)
- [Settings](#settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

| Requirement | Minimum |
|---|---|
| Operating System | macOS 12 (Monterey) or later |
| Node.js | v18 or later |
| Disk Space | ~200 MB (including dependencies) |
| RAM | 4 GB recommended |

## Installation

### Running from Source (Development)

```bash
git clone https://github.com/rartzi/aixplore-recorder.git
cd aixplore-recorder
npm install
npm start
```

### Building for Distribution

To build a distributable macOS application:

```bash
npm run build
```

This uses `electron-builder` to produce the following artifacts in the `dist/` directory:

| File | Description |
|---|---|
| `dist/mac-arm64/AIXplore Recorder.app` | Standalone application bundle |
| `dist/AIXplore Recorder-<version>-arm64.dmg` | Disk image for distribution |
| `dist/AIXplore Recorder-<version>-arm64-mac.zip` | Zipped app for direct sharing |

To install the built app, open the `.dmg` and drag **AIXplore Recorder** to your Applications folder, or run the `.app` directly.

### Code Signing & Notarization

By default, the build produces an **ad-hoc signed** application. macOS Gatekeeper will show a warning when opening it for the first time. To bypass this, right-click the app and select **Open**.

For proper distribution (no Gatekeeper warnings), you need:

1. An **Apple Developer ID** certificate — configure it in the `build.mac` section of `package.json` or via the `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables
2. **Notarization** — add `notarize` options to the `build.mac` config or use `electron-builder`'s `afterSign` hook with `@electron/notarize`

See the [electron-builder code signing docs](https://www.electron.build/code-signing) for full details.

## First Launch & Permissions

On first launch, macOS will prompt you to grant three permissions:

1. **Screen Recording** — Required to capture your screen or application windows
2. **Camera** — Required for the webcam overlay feature
3. **Microphone** — Required for audio recording

If you miss a prompt, go to **System Settings > Privacy & Security** and enable each permission for AIXplore Recorder manually. You may need to restart the app after granting permissions.

> **Tip:** The app will retry loading screen sources up to 3 times automatically while waiting for the Screen Recording permission to take effect.

## Recording a Screen or Window

### Step 1: Select a Source

When the app launches, you see the **Source Picker** view. It displays thumbnails of all available screens and windows.

![Source Picker — Select a screen or window to record](screenshots/app-screenshot.png)

- Click on any thumbnail to select it as your recording source
- The selected source is highlighted with a purple border
- Click **Refresh** if a window you opened recently doesn't appear

### Step 2: Configure Inputs

Below the source grid, you'll find toggle switches:

| Toggle | Default | Description |
|---|---|---|
| **Webcam** | On | Adds a circular picture-in-picture webcam overlay |
| **Mic** | On | Captures audio from your microphone |
| **System Audio** | Off | Captures audio output from your system |
| **Countdown** | 3s | Countdown delay before recording starts (None / 3s / 5s) |

### Step 3: Start Recording

Click the **Start Recording** button (or press `Ctrl+Shift+R`). If a countdown is set, you'll see a large countdown number overlay before recording begins.

## Using the Webcam Overlay

When the Webcam toggle is enabled, a circular picture-in-picture window appears in the bottom-right corner of the preview during recording.

### Moving the Overlay

Click and drag the webcam circle to reposition it anywhere within the preview area. The position is preserved in the final recording.

### Resizing the Overlay

Use the size buttons in the control bar:

| Button | Size |
|---|---|
| **S** | 100px — Small, unobtrusive |
| **M** | 160px — Medium (default) |
| **L** | 220px — Large, prominent |

The webcam feed is automatically mirrored horizontally for a natural appearance and rendered as a circle with a purple border.

## Audio Configuration

### Microphone Audio

When the **Mic** toggle is on, the app captures audio from your default microphone. The audio level meter in the control bar shows real-time input levels.

### System Audio

When the **System Audio** toggle is on, the app captures desktop audio output (what you hear through your speakers). This is useful for recording presentations with sound, video playback, or software demos.

Both audio sources are mixed together in the final recording when both are enabled.

## Recording Controls

![Recording Session — Live preview with webcam overlay and control bar](screenshots/recording-view.png)

During an active recording, the control bar provides:

| Control | Description |
|---|---|
| **Red dot** | Pulsing indicator — recording is active. Turns yellow when paused. |
| **Timer** | Elapsed recording time in `MM:SS` format |
| **Audio meter** | Green bar showing current audio input level |
| **PiP size buttons** | Resize the webcam overlay (S / M / L) |
| **PAUSE** | Pause the recording. Click again (RESUME) to continue. |
| **STOP** | Stop recording and open the trim editor |

## Trimming Your Recording

After stopping a recording, you are taken to the **Trim View**:

1. A video player shows your full recording with playback controls
2. Two sliders let you set the **Start** and **End** trim points
3. Time labels update in real-time as you drag the sliders

### Trim Workflow

1. Play the video to identify the sections you want to keep
2. Drag the **Start** slider to skip unwanted footage at the beginning
3. Drag the **End** slider to cut unwanted footage at the end
4. Choose your save option (see below)

## Exporting & Saving

The trim view offers five actions:

| Button | Description |
|---|---|
| **Discard** | Delete the recording and return to the source picker |
| **Re-record** | Discard and immediately start a new recording with the same source |
| **Save Full (instant)** | Save the entire recording as WebM without re-encoding |
| **Save Trimmed** | Save only the trimmed portion as WebM using FFmpeg |
| **Save as MP4** | Convert to MP4 (H.264 + AAC) using FFmpeg. Applies trim if set. |

### File Naming

All recordings are saved with an automatic filename:

```
AIXplore-YYYY-MM-DD_HHhMMmSSs.webm
AIXplore-YYYY-MM-DD_HHhMMmSSs.mp4
```

### After Saving

A banner appears at the bottom of the window showing the saved file path with two options:

- **Show in Finder** — Opens the containing folder in Finder
- **Play** — Opens the file in your default video player

## Settings

### Output Directory

Click the **Change** button next to the save path to select a custom output directory. The default is:

```
~/Videos/AIXplore Recordings/
```

The directory is created automatically if it doesn't exist.

### Auto-Save

When enabled in settings, recordings are saved automatically without showing the trim view.

## Keyboard Shortcuts

These shortcuts work globally while the app is running:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+R` | Start recording / toggle record |
| `Ctrl+Shift+P` | Pause / resume recording |
| `Esc` | Stop recording |

## Troubleshooting

### No screens appear in the source picker

1. Open **System Settings > Privacy & Security > Screen Recording**
2. Find AIXplore Recorder in the list and enable it
3. Restart the application
4. Click **Refresh** in the source picker

### Webcam not working

1. Open **System Settings > Privacy & Security > Camera**
2. Ensure AIXplore Recorder has camera access enabled
3. Close other applications that may be using the camera
4. Restart the application

### No audio in recording

1. Check that the **Mic** and/or **System Audio** toggles are enabled
2. Open **System Settings > Privacy & Security > Microphone**
3. Ensure AIXplore Recorder has microphone access
4. Check that the audio level meter shows activity during recording

### MP4 conversion fails

MP4 conversion uses FFmpeg bundled with the app. If conversion fails:

1. Check that you have sufficient disk space
2. Try saving as WebM first (instant save, no conversion needed)
3. Check the terminal output for FFmpeg error messages

### Recording is choppy or laggy

- Close unnecessary applications to free system resources
- Record at the native screen resolution rather than a scaled window
- Ensure your Mac isn't in low-power mode
