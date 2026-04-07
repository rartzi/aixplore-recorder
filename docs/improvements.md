# AIXplore Recorder — Improvement Ideas & Prioritization

> Generated: 2026-03-28
> Based on: full source analysis of `src/main.js`, `src/index.html`, `src/preload.js`
> Purpose: reference document for feature planning and sprint prioritization

---

## Prioritization Framework

Ideas are ranked across three tiers based on:

- **Workflow impact** — does it affect every recording session or just edge cases?
- **User friction removed** — how painful is the current experience without it?
- **Implementation leverage** — does it multiply the value of existing features?
- **Competitive gap** — is this missing vs. comparable tools (Loom, Cleanshot, Screenflow)?

---

## Tier 1 — Must Build (Workflow Transformative)

These directly unblock the most common user workflows. Every recording session benefits.

### 1. Mouse Click Highlighting & Cursor Effects

**What:** Visually indicate mouse clicks with ripple/ring animations and optionally highlight or enlarge the cursor during recording.

**Problem solved:** Viewers of tutorials and demos cannot follow where the presenter is clicking. This is the most universal gap in screen recordings — without it, instructional content feels hard to follow.

**Value proposition:**
- Every tutorial or demo recording benefits immediately
- No comparable tool in the lightweight macOS space ships without this
- Loom, Cleanshot X, and Screenflow all include it

**Implementation notes:**
- Render click overlays on the composite canvas in the renderer alongside the webcam PiP
- Track `mousedown` events on the recording canvas; draw expanding ring at click coordinates
- Cursor size/highlight is a CSS cursor override or canvas overlay pass

**Recommendation:** Build first. Universal benefit, contained implementation.

---

### 2. Local Transcription of Spoken Audio

**What:** Near-real-time transcription of microphone audio during or after recording, using on-device models. Outputs live overlay, `.txt` transcript, and `.srt` subtitle file alongside the saved video.

**Problem solved:** Recordings with narration are unsearchable, inaccessible, and require manual transcription. Cloud-based alternatives (Loom's AI transcription) send audio to external servers — a blocker for enterprise and sensitive content.

**Value proposition:**
- Privacy-first: audio never leaves the machine
- Multiplies History value: recordings become full-text searchable
- Enables accessibility: SRT/VTT output for captions
- Enables auto-naming: derive filename from first spoken sentence
- Differentiates from competitors who rely on cloud transcription

**Two-tier implementation approach:**

| Tier | Engine | Install Cost | Quality | Latency | Integration |
|------|--------|-------------|---------|---------|-------------|
| **Default** | Apple Speech (`SFSpeechRecognizer`) | Zero — built into macOS 13+ | Good | Real-time (~200ms) | Swift helper binary in app bundle; stdout → IPC |
| **Power** | Whisper.cpp (opt-in download) | ~75–466 MB model download | Excellent | Near-real-time (1–3s) | `execFile` subprocess — same pattern as FFmpeg in `main.js` |

**Why Apple Speech as default:**
- macOS 13 is already the minimum supported version
- On-device for English + 50+ languages since macOS 13
- Zero model download required
- One new permission: Speech Recognition (Privacy & Security)

**Why Whisper.cpp as power option:**
- Better with technical jargon, accents, non-English, fast speech
- `tiny` model (75 MB) is fast even on Intel Macs
- `small` model (466 MB) matches human-level accuracy for most use cases
- Apple Silicon Core ML acceleration available

**Avoid:**
- Web Speech API (`webkitSpeechRecognition`) — uses Google's servers, defeats privacy goal
- MLX Whisper — requires Python + MLX environment, impractical to bundle
- OpenAI Whisper API — cloud, audio leaves device; could be offered as optional fallback only

**Suggested settings UI:**
```
Transcription:  [ Off  |  Apple Speech (built-in)  |  Whisper (download) ]
Language:       [ English ▾ ]
Output:         [ ☑ Show live overlay   ☑ Save .txt alongside video   ☑ Save .srt subtitles ]
```

**Recommendation:** Build second. The audio pipeline is already in place. Unlocks cascading features (search, captions, naming).

---

### 3. In-App Video Playback with Frame Scrubbing

**What:** Replace the external-player dependency in the trim view with a fully in-app player. Keyboard seek (arrow keys), frame-step, and scrub-by-dragging on a timeline.

**Problem solved:** The trim view currently uses only two range sliders for start/end points. Users cannot see exactly what frame their trim point lands on without blind-scrubbing. The Play button opens the system default video player, breaking the in-app workflow.

**Value proposition:**
- Trim becomes precise instead of approximate
- No context switch to external app mid-workflow
- Frame-accurate cuts save re-records

**Recommendation:** Build third. Directly improves the trim UX which every saved recording passes through.

---

### 4. One-Click Share: Clipboard, Link, or Service

**What:** After saving, expand the save banner to include: Copy Path, Copy File to Clipboard, and optionally share to a configured destination (Slack upload, AirDrop, Finder Quick Look).

**Problem solved:** After saving, users must manually find the file, navigate to Finder, and drag it into their destination. For async workflows (Slack threads, GitHub issues, Notion pages), this is the biggest post-record friction point.

**Value proposition:**
- Removes 3–5 manual steps after every save
- "Copy to Clipboard" alone covers 80% of paste-into-Slack use cases
- Minimal engineering cost for outsized UX improvement

**Recommendation:** High priority. 1–2 hour implementation, daily-use impact.

---

### 5. GIF Export for Short Clips

**What:** In the trim/save view, add a "Save as GIF" option for clips up to ~30 seconds. FFmpeg generates an optimized palette-based GIF.

**Problem solved:** The most common way developers share screen recordings in GitHub issues, Jira tickets, and Slack is as GIFs. Currently users must export to MP4 or WebM and then use a separate tool to convert.

**Value proposition:**
- FFmpeg is already bundled — this is a new set of arguments, not a new dependency
- Directly serves the developer-audience use case
- Captures a workflow that competitors like Cleanshot X charge premium for

**Implementation notes:**
```bash
# Two-pass FFmpeg GIF with optimized palette
ffmpeg -ss {start} -t {duration} -i input.webm \
  -vf "fps=15,scale=800:-1:flags=lanczos,palettegen" palette.png
ffmpeg -ss {start} -t {duration} -i input.webm -i palette.png \
  -lavfi "fps=15,scale=800:-1:flags=lanczos [x]; [x][1:v] paletteuse" output.gif
```

**Recommendation:** High priority. ~1 day of work; FFmpeg already present.

---

## Tier 2 — Should Build (High Daily-Use Value)

These improve the experience for recurring tasks. Most are 1-day implementations.

### 6. Custom File Naming Templates

**What:** Add a filename field or template system (e.g. `{project}-{date}`, `{spoken-title}`) that applies at save time.

**Problem solved:** Auto-generated names like `AIXplore-2026-03-28_10h00m00s.webm` are meaningless in Finder and history. Users who record multiple takes of the same feature demo cannot distinguish them.

**Recommendation:** Medium priority. Simple to implement; high impact on discoverability.

---

### 7. Quick Record from Menu Bar (Without Opening Main Window) ✅ DONE

**What:** Add Start Recording / Stop Recording actions to the tray context menu so users can trigger recordings without bringing the app window to the foreground.

**Problem solved:** Power users recording many short clips have to show the window, configure, start, hide it — repeated every time. Tray-based recording is the fastest possible workflow for quick screen captures.

**Implementation notes:**
- Tray and context menu already exist in `createTray()` in `main.js`
- Add IPC round-trip: `tray.setContextMenu` with record/stop items that call `mainWindow.webContents.send('shortcut-toggle-record')`
- Show current state in tray label ("Start Recording" vs "Stop Recording")

**Recommendation:** Medium priority. Tray infrastructure exists; mostly wiring.

---

### 8. Recording Presets / Profiles ✅ DONE

**What:** Named setting bundles (e.g. "Tutorial — 1080p + cam + mic", "Quick Demo — no cam, 720p") stored in `settings.json`, selectable from a dropdown in the source picker or settings view.

**Problem solved:** Re-configuring quality, FPS, countdown, webcam, and audio device every session for different recording contexts wastes time and leads to mismatched outputs (e.g., recording a quick demo at the high-quality 6Mbps preset by accident).

**Recommendation:** Medium priority. Settings persistence already works; UX design is the main effort.

---

### 9. Persist PiP Position & Size Between Sessions

**What:** Save the webcam overlay's position (x/y as percentage) and size (S/M/L) to `settings.json` and restore on next recording.

**Problem solved:** The PiP resets to bottom-right at 160px on every recording. Users with a preferred position (e.g. top-left Small) manually reposition it every session.

**Implementation notes:**
- `pipPosPercent` and `pipSize` are already tracked in the renderer
- On stop/save, send these values to main via IPC and persist with `savePersistedSettings()`
- On load, apply from settings before recording starts

**Recommendation:** Quick win. ~30 minutes. Already has all the plumbing.

---

### 10. macOS Native Save Notification

**What:** Fire a macOS notification (`new Notification()` or Electron's `Notification` API) when a file is saved or export completes.

**Problem solved:** MP4 conversion via FFmpeg takes 10–60 seconds. Users who switch to another app during conversion have no signal when it's done — they return to the app to check.

**Recommendation:** Quick win. ~1 hour. Single API call after the `save-as-mp4` handler resolves.

---

## Tier 3 — QoL Polish (Batch in a Polish Sprint)

These are meaningful but non-blocking. Best addressed together in a single polish sprint.

### 11. Thumbnail Previews in History & Dashboard

**What:** Extract and display the first frame of each recording as a thumbnail in the History list and Dashboard recent recordings.

**Problem solved:** All recordings show the same video-file icon. Filenames are date-based and indistinguishable. Thumbnails make scanning instant.

**Implementation notes:**
- FFmpeg frame extraction: `ffmpeg -i input.webm -vframes 1 -ss 0 thumb.jpg`
- Cache thumbnails in `userData/thumbnails/` keyed by filename
- Render as `<img>` in history/dashboard rows

---

### 12. Sort & Filter in History

**What:** Add sort options (newest/oldest, duration, file size) and a format filter (WebM / MP4 / All) to the History toolbar.

**Problem solved:** Text search only works if you know the filename. Format and size-based sorting helps identify files to clean up or find the "long recording from last week."

---

### 13. PiP Corner Snap Keyboard Shortcuts

**What:** During recording, press `1`/`2`/`3`/`4` to snap the webcam overlay to the four corners of the preview area.

**Problem solved:** Repositioning the webcam overlay by dragging under time pressure is imprecise. Snap shortcuts make repositioning a single keypress.

---

### 14. Re-record Action in History

**What:** Add a "Re-record" button to history entries that restores the source and settings used for that recording and starts a new one.

**Problem solved:** Redoing a failed or outdated recording currently requires going through the source picker, reconfiguring inputs, and starting again. History entries should be actionable.

**Implementation notes:**
- Store `sourceId`, `webcam`, `mic`, `systemAudio`, `quality`, `fps` alongside the history entry
- "Re-record" restores these and navigates to the recording view

---

### 15. Waveform Visualization in Trim View

**What:** Display audio amplitude over time as a visual waveform on the trim timeline, replacing or augmenting the plain range sliders.

**Problem solved:** Finding speech/silence boundaries for precise trimming currently requires scrubbing the video. A waveform makes cut points visually obvious.

**Implementation notes:**
- FFmpeg: `ffmpeg -i input.webm -ac 1 -filter:a aresample=8000 -map 0:a -c:a pcm_s16le -f data pipe:1`
- Draw on a `<canvas>` element above the trim sliders

---

### 16. Batch Delete in History

**What:** Add checkboxes to history rows and a "Delete Selected (N)" action button.

**Problem solved:** Cleaning up a large history requires confirming each deletion individually. Batch selection allows clearing a whole session's test recordings at once.

---

## Avoided / Deprioritized Options

| Idea | Reason Deprioritized |
|------|---------------------|
| Web Speech API (`webkitSpeechRecognition`) | Routes audio through Google servers — defeats local/privacy goal |
| MLX Whisper | Requires Python + MLX runtime — impractical to bundle in Electron |
| OpenAI Whisper API | Cloud service — audio leaves device; may be optional future fallback |
| Scheduled Recording | Niche use case; adds significant UX complexity for low return |
| Multi-monitor indicators | Source picker already shows thumbnails; labels add minimal value |

---

## Summary View

| # | Feature | Tier | Effort Est. | Depends On | Status |
|---|---------|------|-------------|------------|--------|
| — | Audio-Only Recording Mode | 1 | 1 day | Mic permission (exists), FFmpeg (exists) | ✅ Done |
| 1 | Mouse Click Highlighting | 1 | 1–2 days | — | ✅ Done |
| 2 | Local Transcription (Apple Speech + Whisper) | 1 | 3–5 days | Microphone permission (exists) | |
| 3 | In-App Playback + Frame Scrubbing | 1 | 2–3 days | — | |
| 4 | One-Click Share / Clipboard | 1 | 1 day | — | |
| 5 | GIF Export | 1 | 1 day | FFmpeg (exists) | |
| 6 | Custom File Naming Templates | 2 | 0.5 days | — | |
| 7 | Quick Record from Tray | 2 | 0.5 days | Tray (exists) | ✅ Done |
| 8 | Recording Presets / Profiles | 2 | 1–2 days | Settings (exists) | ✅ Done |
| 9 | Persist PiP Position & Size | 2 | 0.5 days | Settings (exists) | |
| 10 | macOS Save Notification | 2 | 0.5 days | — | |
| 11 | Thumbnail Previews | 3 | 1 day | FFmpeg (exists), History (exists) | |
| 12 | Sort & Filter in History | 3 | 0.5 days | History (exists) | |
| 13 | PiP Corner Snap Shortcuts | 3 | 0.5 days | PiP drag (exists) | |
| 14 | Re-record from History | 3 | 0.5 days | History (exists) | |
| 15 | Waveform in Trim View | 3 | 1–2 days | FFmpeg (exists) | ✅ Done (audio trim) |
| 16 | Batch Delete in History | 3 | 0.5 days | History (exists) | |

**Total Tier 1 estimate:** ~8–11 days
**Total Tier 2 estimate:** ~3–4 days
**Total Tier 3 estimate:** ~5–7 days
