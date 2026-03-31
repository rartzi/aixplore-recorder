/**
 * Tray icon / menu regression tests.
 * Tests tray menu structure, preset entries, and tray-triggered navigation.
 * Note: Playwright can't click native macOS menu bar items directly —
 * we test tray behavior by firing the IPC events the tray menu sends.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

let app, page, mainWin;

test.beforeAll(async () => {
  const electronPath = require('electron');
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '..')],
    env: { ...process.env }
  });
  page = await app.firstWindow();
  mainWin = await app.browserWindow(page);
  await page.waitForSelector('#navDashboard', { timeout: 10000 });
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── helper: send an IPC event directly (simulates tray click) ───────────
async function sendIPC(channel, ...args) {
  await app.evaluate(async ({ BrowserWindow }, { channel, args }) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) wins[0].webContents.send(channel, ...args);
  }, { channel, args });
}

// ─── 1. Tray: "Video + Audio" navigates to picker ────────────────────────
test('tray-start-recording navigates to source picker', async () => {
  // Start from dashboard
  await page.click('#navDashboard');
  await page.waitForSelector('#viewDashboard:not(.hidden)', { timeout: 3000 });

  // Fire the tray "Start Recording" IPC
  await sendIPC('tray-start-recording');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });

  await expect(page.locator('#viewPicker')).not.toHaveClass(/hidden/);
  console.log('✓ tray-start-recording navigates to source picker');
});

// ─── 2. Tray: navigate-to Settings ───────────────────────────────────────
test('tray-navigate-to viewSettings opens settings page', async () => {
  await sendIPC('tray-navigate-to', 'viewSettings');
  await page.waitForSelector('#viewSettings:not(.hidden)', { timeout: 4000 });
  await expect(page.locator('#viewSettings')).not.toHaveClass(/hidden/);
  console.log('✓ tray-navigate-to viewSettings works');
});

// ─── 3. Tray: apply video preset (Tutorial) switches to video mode ────────
test('tray-apply-preset with video preset goes to picker in video mode', async () => {
  // Simulate tray clicking "Tutorial" preset
  const tutorialPreset = {
    id: 'default-tutorial', name: 'Tutorial',
    quality: 'high', fps: 30, countdown: 3,
    cam: true, mic: true, sysAudio: false, audioOnly: false
  };
  await sendIPC('tray-apply-preset', tutorialPreset);
  await page.waitForTimeout(600);

  // Should be on picker in video mode
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  await expect(page.locator('#modeVideo')).toHaveClass(/active/);
  await expect(page.locator('#modeAudio')).not.toHaveClass(/active/);

  // Preset values applied: cam on, mic on, sys off, countdown 3s
  await expect(page.locator('#toggleCam')).toHaveClass(/active/);
  await expect(page.locator('#toggleMic')).toHaveClass(/active/);
  await expect(page.locator('#toggleSys')).not.toHaveClass(/active/);
  await expect(page.locator('#countdownSel')).toHaveValue('3');

  console.log('✓ Tray video preset applies correctly and stays in video mode');
});

// ─── 4. Tray: apply Presentation preset (sysAudio=true) ──────────────────
test('tray-apply-preset with Presentation preset sets sys audio on', async () => {
  // Clear defaultPresetId so navTo('viewPicker') doesn't re-apply a default on top
  await page.evaluate(function() { return window.electronAPI.setSettings({ defaultPresetId: '' }); });
  await page.waitForTimeout(200);

  const presPreset = {
    id: 'default-presentation', name: 'Presentation',
    quality: 'high', fps: 30, countdown: 5,
    cam: false, mic: true, sysAudio: true, audioOnly: false
  };
  await sendIPC('tray-apply-preset', presPreset);
  await page.waitForTimeout(800);

  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  await expect(page.locator('#modeVideo')).toHaveClass(/active/);
  await expect(page.locator('#toggleCam')).not.toHaveClass(/active/);
  await expect(page.locator('#toggleSys')).toHaveClass(/active/);
  await expect(page.locator('#countdownSel')).toHaveValue('5');

  console.log('✓ Tray Presentation preset applies sysAudio=true, cam=false, countdown=5s');
});

// ─── 5. Tray: apply Audio Recording preset starts audio recording ─────────
test('tray-apply-preset with audioOnly preset starts audio recording directly', async () => {
  const audioPreset = {
    id: 'default-audio', name: 'Audio Recording',
    quality: 'medium', fps: 30, countdown: 0,
    cam: false, mic: true, sysAudio: false, audioOnly: true
  };
  await sendIPC('tray-apply-preset', audioPreset);

  // Should go straight to audio recording (skips picker)
  const result = await Promise.race([
    page.waitForSelector('#viewAudioRecording:not(.hidden)', { timeout: 8000 }).then(() => 'recording'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 8000 }).then(() => 'error')
  ]);

  if (result === 'error') {
    const errText = await page.locator('#errorBox').textContent();
    console.warn('  Mic not available:', errText);
    test.skip(); return;
  }

  await expect(page.locator('#viewAudioRecording')).not.toHaveClass(/hidden/);
  await expect(page.locator('#audioTimer')).toBeVisible();
  // Sidebar hidden during recording
  await expect(page.locator('#sidebar')).toHaveClass(/hidden/);
  console.log('✓ Tray audio preset skips picker and starts recording directly');

  // Stop it cleanly
  await page.waitForTimeout(1500);
  await page.click('#btnAudioStop');
  await page.waitForSelector('#viewAudioTrim:not(.hidden)', { timeout: 6000 });
  // Discard
  await page.click('#btnAudioDiscard');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  console.log('✓ Audio recording stopped and discarded cleanly');
});

// ─── 6. Tray stop shortcut stops active recording ────────────────────────
test('shortcut-stop IPC stops an active recording', async () => {
  // Start an audio recording (no countdown, easy to automate)
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  await page.click('#modeAudio');
  await page.waitForTimeout(200);
  await page.locator('#countdownSel').selectOption('0');
  await page.click('#btnStart');

  const started = await Promise.race([
    page.waitForSelector('#viewAudioRecording:not(.hidden)', { timeout: 8000 }).then(() => 'ok'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 8000 }).then(() => 'err')
  ]);
  if (started === 'err') { test.skip(); return; }

  await page.waitForTimeout(1200);

  // Fire tray "Stop Recording" shortcut
  await sendIPC('shortcut-stop');
  await page.waitForSelector('#viewAudioTrim:not(.hidden)', { timeout: 6000 });
  console.log('✓ shortcut-stop IPC stops active audio recording → trim view');

  // Discard
  await page.click('#btnAudioDiscard');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
});

// ─── 7. Tray pause/resume shortcut ───────────────────────────────────────
test('shortcut-toggle-pause IPC pauses and resumes recording', async () => {
  // Start a fresh audio recording
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  await page.click('#modeAudio');
  await page.waitForTimeout(200);
  await page.locator('#countdownSel').selectOption('0');
  await page.click('#btnStart');

  const started = await Promise.race([
    page.waitForSelector('#viewAudioRecording:not(.hidden)', { timeout: 8000 }).then(() => 'ok'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 8000 }).then(() => 'err')
  ]);
  if (started === 'err') { test.skip(); return; }

  await page.waitForTimeout(800);

  // Pause via tray shortcut
  await sendIPC('shortcut-toggle-pause');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnAudioPause')).toHaveText('RESUME');
  await expect(page.locator('#audioRecDot')).toHaveClass(/paused/);
  console.log('✓ shortcut-toggle-pause pauses audio recording');

  // Resume via tray shortcut
  await sendIPC('shortcut-toggle-pause');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnAudioPause')).toHaveText('PAUSE');
  await expect(page.locator('#audioRecDot')).not.toHaveClass(/paused/);
  console.log('✓ shortcut-toggle-pause resumes audio recording');

  // Stop and discard
  await page.click('#btnAudioStop');
  await page.waitForSelector('#viewAudioTrim:not(.hidden)', { timeout: 6000 });
  await page.click('#btnAudioDiscard');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
});

// ─── 8. settings-updated IPC refreshes UI ────────────────────────────────
test('settings-updated IPC event refreshes the UI state', async () => {
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 4000 });
  await page.click('#modeVideo');
  await page.waitForTimeout(200);

  // Fire settings-updated with a new outputDir
  await sendIPC('settings-updated', {
    outputDir: '/tmp/test-output-dir',
    quality: 'medium', fps: 30, countdown: 0,
    clickHighlight: true, cursorFxSize: 'medium', cursorFxColor: 'yellow',
    theme: 'dark', audioDeviceId: null, defaultPresetId: ''
  });
  await page.waitForTimeout(300);

  const pathText = await page.locator('#outputPath').textContent();
  expect(pathText).toBe('/tmp/test-output-dir');
  console.log('✓ settings-updated IPC updates the output path display');
});
