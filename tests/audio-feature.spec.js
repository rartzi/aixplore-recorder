/**
 * Audio-only recording feature tests
 * Uses Playwright's Electron integration to test UI flows.
 *
 * NOTE: Actual mic capture requires real hardware + permissions.
 * These tests cover UI state, mode switching, view transitions,
 * and the full audio recording flow with real mic if available.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

let app, page;

test.beforeAll(async () => {
  const electronPath = require('electron');
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '..')],
    env: { ...process.env }
  });
  page = await app.firstWindow();
  // Wait for app to initialize
  await page.waitForSelector('#navDashboard', { timeout: 10000 });
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── 1. Picker view loads correctly ───────────────────────────────────────
test('picker loads with Video+Audio mode active by default', async () => {
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });

  // Mode toggle: Video+Audio should be active
  const videoBtn = page.locator('#modeVideo');
  const audioBtn = page.locator('#modeAudio');
  await expect(videoBtn).toHaveClass(/active/);
  await expect(audioBtn).not.toHaveClass(/active/);

  // Source grid should be visible in video mode
  const grid = page.locator('#sourceGrid');
  await expect(grid).not.toHaveClass(/hidden/);

  // Start button should initially be disabled (no source selected)
  const btnStart = page.locator('#btnStart');
  await expect(btnStart).toBeDisabled();
  await expect(btnStart).toHaveText('Start Recording');

  console.log('✓ Picker loads in Video+Audio mode with correct initial state');
});

// ─── 2. Mode toggle switches to Audio Only ────────────────────────────────
test('switching to Audio Only hides source grid and video-only controls', async () => {
  await page.click('#modeAudio');
  await page.waitForTimeout(300);

  // Audio mode button is now active
  await expect(page.locator('#modeAudio')).toHaveClass(/active/);
  await expect(page.locator('#modeVideo')).not.toHaveClass(/active/);

  // Source grid is hidden
  await expect(page.locator('#sourceGrid')).toHaveClass(/hidden/);

  // Webcam and System Audio toggles are hidden
  await expect(page.locator('#camToggleGroup')).toHaveClass(/hidden/);
  await expect(page.locator('#sysToggleGroup')).toHaveClass(/hidden/);

  // Cursor FX is hidden
  await expect(page.locator('#cursorFxGroup')).toHaveClass(/hidden/);

  // Start button is ENABLED (audio needs no source selection) and has new label
  await expect(page.locator('#btnStart')).toBeEnabled();
  await expect(page.locator('#btnStart')).toHaveText('Start Audio Recording');

  // Title and subtitle updated
  await expect(page.locator('#pickerTitle')).toHaveText('Record Audio');

  console.log('✓ Audio Only mode hides source grid and video-only controls');
});

// ─── 3. Switching back to Video+Audio restores source grid ────────────────
test('switching back to Video+Audio restores normal picker state', async () => {
  await page.click('#modeVideo');
  await page.waitForTimeout(300);

  await expect(page.locator('#modeVideo')).toHaveClass(/active/);
  await expect(page.locator('#sourceGrid')).not.toHaveClass(/hidden/);
  await expect(page.locator('#camToggleGroup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#sysToggleGroup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#btnStart')).toHaveText('Start Recording');
  await expect(page.locator('#pickerTitle')).toHaveText('Choose a source to record');

  console.log('✓ Switching back to Video+Audio restores all picker controls');
});

// ─── 4. Preset selector contains Audio Recording preset ───────────────────
test('preset selector includes Audio Recording preset', async () => {
  // Make sure we are still on picker
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 3000 });

  const options = await page.locator('#presetSel option').allTextContents();
  console.log('  Presets available:', options);
  expect(options.some(o => o.includes('Audio Recording'))).toBe(true);

  console.log('✓ Audio Recording preset exists in selector');
});

// ─── 5. Applying Audio Recording preset switches to audio mode ────────────
test('applying Audio Recording preset switches mode to Audio Only', async () => {
  // Navigate to picker and ensure video mode
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });
  await page.click('#modeVideo');
  await page.waitForTimeout(200);

  // Select the Audio Recording preset
  const sel = page.locator('#presetSel');
  const options = await sel.locator('option').all();
  let audioPresetId = null;
  for (const opt of options) {
    const text = await opt.textContent();
    if (text && text.includes('Audio Recording')) {
      audioPresetId = await opt.getAttribute('value');
      break;
    }
  }

  if (!audioPresetId) {
    console.warn('  Audio Recording preset not found in selector, skipping');
    return;
  }

  await sel.selectOption(audioPresetId);
  await page.waitForTimeout(400);

  // Should have switched to audio mode
  await expect(page.locator('#modeAudio')).toHaveClass(/active/);
  await expect(page.locator('#sourceGrid')).toHaveClass(/hidden/);

  console.log('✓ Applying Audio Recording preset switches to Audio Only mode');
});

// ─── 6. Audio recording starts and waveform view appears ─────────────────
test('starting audio recording shows waveform view with timer', async () => {
  // Navigate to picker and switch to audio mode
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });
  await page.click('#modeAudio');
  await page.waitForTimeout(200);

  // Grant mic via page.context (Playwright handles this via launch options)
  // Click Start Audio Recording
  await page.click('#btnStart');

  // Wait for the audio recording view to appear (or an error if no mic)
  const result = await Promise.race([
    page.waitForSelector('#viewAudioRecording:not(.hidden)', { timeout: 8000 })
      .then(() => 'recording'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 8000 })
      .then(() => 'error')
  ]);

  if (result === 'error') {
    const errText = await page.locator('#errorBox').textContent();
    console.warn('  Mic not available or permission denied:', errText);
    // Not a test failure — just no hardware. Return to picker.
    await page.click('#navRecord');
    test.skip();
    return;
  }

  // Waveform bars were injected
  const bars = page.locator('#waveformBars .waveform-bar');
  await expect(bars).toHaveCount(30);

  // Timer is running (shows 00:00 or similar)
  const timer = page.locator('#audioTimer');
  await expect(timer).toBeVisible();
  const t0 = await timer.textContent();
  expect(t0).toMatch(/^\d{2}:\d{2}$/);

  // Recording dot is pulsing (has the class)
  await expect(page.locator('#audioRecDot')).toBeVisible();

  // Pause and stop buttons are visible
  await expect(page.locator('#btnAudioPause')).toBeVisible();
  await expect(page.locator('#btnAudioStop')).toBeVisible();

  console.log('✓ Audio recording view appears with 30 waveform bars and running timer');

  // Wait a couple seconds to verify timer advances
  await page.waitForTimeout(2500);
  const t1 = await timer.textContent();
  console.log('  Timer after 2.5s:', t1);
  // Should not still be 00:00
  expect(t1).not.toBe('00:00');

  console.log('✓ Timer advances during recording');
});

// ─── 7. Pause and resume work ─────────────────────────────────────────────
test('pause and resume during audio recording', async () => {
  const inRecording = await page.locator('#viewAudioRecording:not(.hidden)').count();
  if (inRecording === 0) { test.skip(); return; }

  await page.click('#btnAudioPause');
  await page.waitForTimeout(300);

  // Button text changes to RESUME
  await expect(page.locator('#btnAudioPause')).toHaveText('RESUME');
  // Dot gets paused class
  await expect(page.locator('#audioRecDot')).toHaveClass(/paused/);

  // Resume
  await page.click('#btnAudioPause');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnAudioPause')).toHaveText('PAUSE');
  await expect(page.locator('#audioRecDot')).not.toHaveClass(/paused/);

  console.log('✓ Pause/resume toggles correctly');
});

// ─── 8. Stopping shows audio trim view ───────────────────────────────────
test('stopping audio recording shows audio trim view', async () => {
  const inRecording = await page.locator('#viewAudioRecording:not(.hidden)').count();
  if (inRecording === 0) { test.skip(); return; }

  // Record for a moment then stop
  await page.waitForTimeout(1500);
  await page.click('#btnAudioStop');

  // Audio trim view should appear
  await page.waitForSelector('#viewAudioTrim:not(.hidden)', { timeout: 8000 });

  // Audio element is populated
  const audio = page.locator('#trimAudio');
  await expect(audio).toBeVisible();
  const src = await audio.getAttribute('src');
  expect(src).toBeTruthy();
  expect(src).toMatch(/^blob:/);

  // Sliders are present
  await expect(page.locator('#audioTrimStart')).toBeVisible();
  await expect(page.locator('#audioTrimEnd')).toBeVisible();

  // Save buttons present
  await expect(page.locator('#btnSaveAudioFull')).toBeVisible();
  await expect(page.locator('#btnSaveAudioTrim')).toBeVisible();
  await expect(page.locator('#btnSaveMp3')).toBeVisible();
  await expect(page.locator('#btnSaveM4a')).toBeVisible();

  console.log('✓ Audio trim view appears after stop with audio element and save buttons');
});

// ─── 9. Saving as WebM produces a file ───────────────────────────────────
test('saving full WebM audio produces a file with AIXplore-Audio- prefix', async () => {
  const inTrim = await page.locator('#viewAudioTrim:not(.hidden)').count();
  if (inTrim === 0) { test.skip(); return; }

  await page.click('#btnSaveAudioFull');

  // Wait for the save banner to appear
  await page.waitForSelector('#saveBanner:not(.hidden)', { timeout: 15000 });

  const savedPath = await page.locator('#savedPath').textContent();
  console.log('  Saved path:', savedPath);

  expect(savedPath).toMatch(/AIXplore-Audio-/);
  expect(savedPath).toMatch(/\.webm$/);

  // Verify file actually exists on disk
  expect(fs.existsSync(savedPath)).toBe(true);
  const size = fs.statSync(savedPath).size;
  expect(size).toBeGreaterThan(0);
  console.log('  File size:', size, 'bytes');

  // Dismiss banner
  await page.click('#btnDismiss').catch(() => {});

  console.log('✓ WebM audio file saved with correct prefix and non-zero size');
});

// ─── 10. History shows audio entry with mic icon ──────────────────────────
test('history shows audio recording entry with mic badge', async () => {
  await page.click('#navHistory');
  await page.waitForSelector('#viewHistory:not(.hidden)', { timeout: 3000 });
  await page.waitForTimeout(500);

  const rows = page.locator('.history-row');
  const count = await rows.count();

  if (count === 0) {
    console.warn('  No history entries (save may have skipped)');
    test.skip(); return;
  }

  // First row should have a badge — webm or webm-a
  const firstBadge = rows.first().locator('.hr-badge');
  const badgeText = await firstBadge.textContent();
  console.log('  First history entry badge:', badgeText);
  expect(['webm', 'webm-a', 'mp3', 'm4a']).toContain(badgeText.toLowerCase().trim());

  console.log('✓ History entry present with expected badge');
});

// ─── 11. Regression: existing video recording picker unaffected ───────────
test('video recording picker still works after audio mode changes', async () => {
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });

  // Switch to audio mode and then back
  await page.click('#modeAudio');
  await page.waitForTimeout(200);
  await page.click('#modeVideo');
  await page.waitForTimeout(300);

  // Source grid must be visible
  await expect(page.locator('#sourceGrid')).not.toHaveClass(/hidden/);
  // Webcam toggle visible
  await expect(page.locator('#camToggleGroup')).not.toHaveClass(/hidden/);
  // Start button still disabled (no source selected)
  await expect(page.locator('#btnStart')).toBeDisabled();
  await expect(page.locator('#btnStart')).toHaveText('Start Recording');
  // Refresh button visible
  await expect(page.locator('#btnRefresh')).not.toHaveClass(/hidden/);

  console.log('✓ Video recording picker fully intact after switching modes');
});

// ─── 12. Settings: Audio Recording preset appears in presets list ─────────
test('settings page shows Audio Recording preset with "Audio only" descriptor', async () => {
  await page.click('#navSettings');
  await page.waitForSelector('#viewSettings:not(.hidden)', { timeout: 3000 });
  await page.waitForTimeout(500);

  const presetsList = page.locator('#presetsList');
  const listText = await presetsList.textContent();
  console.log('  Presets list text (truncated):', listText.slice(0, 200));

  // "Audio Recording" is the preset name; "Audio only" is the descriptor line
  // Check for the preset name (rendered in bold) and the audio-only descriptor
  expect(listText).toContain('Audio Recording');
  // The descriptor for audioOnly presets says "Audio only" (rendered in preset desc)
  expect(listText.toLowerCase()).toContain('audio only');

  console.log('✓ Settings shows Audio Recording preset with "Audio only" descriptor');
});
