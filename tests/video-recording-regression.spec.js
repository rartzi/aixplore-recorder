/**
 * Regression tests for the original video+audio recording flow.
 * Ensures nothing was broken by the audio-only feature addition.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

let app, page;

test.beforeAll(async () => {
  const electronPath = require('electron');
  app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '..')],
    env: { ...process.env }
  });
  page = await app.firstWindow();
  await page.waitForSelector('#navDashboard', { timeout: 10000 });
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── helpers ─────────────────────────────────────────────────────────────
async function goToPicker() {
  await page.click('#navRecord');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });
  // Make sure we're in video mode
  await page.click('#modeVideo');
  await page.waitForTimeout(300);
}

// ─── 1. Picker default state ──────────────────────────────────────────────
test('picker opens in video mode with source grid visible', async () => {
  await goToPicker();

  await expect(page.locator('#modeVideo')).toHaveClass(/active/);
  await expect(page.locator('#modeAudio')).not.toHaveClass(/active/);
  await expect(page.locator('#sourceGrid')).not.toHaveClass(/hidden/);
  await expect(page.locator('#camToggleGroup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#sysToggleGroup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#cursorFxGroup')).not.toHaveClass(/hidden/);
  await expect(page.locator('#btnRefresh')).not.toHaveClass(/hidden/);
  await expect(page.locator('#btnStart')).toHaveText('Start Recording');
  await expect(page.locator('#btnStart')).toBeDisabled();

  console.log('✓ Video picker opens correctly with all controls visible');
});

// ─── 2. Source grid loads screens/windows ────────────────────────────────
test('source grid loads at least one screen source', async () => {
  await goToPicker();

  // Wait for source cards to appear (may take a moment for screen permission)
  await page.waitForSelector('.source-card', { timeout: 10000 });
  const cards = page.locator('.source-card');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  console.log('  Sources found:', count);

  console.log('✓ Source grid populated with screen/window sources');
});

// ─── 3. Selecting a source enables Start Recording ───────────────────────
test('clicking a source card enables Start Recording button', async () => {
  await goToPicker();
  await page.waitForSelector('.source-card', { timeout: 10000 });

  await page.locator('.source-card').first().click();
  await page.waitForTimeout(200);

  await expect(page.locator('.source-card').first()).toHaveClass(/selected/);
  await expect(page.locator('#btnStart')).toBeEnabled();
  await expect(page.locator('#btnStart')).toHaveText('Start Recording');

  console.log('✓ Selecting a source enables the Start Recording button');
});

// ─── 4. All video toggles work ────────────────────────────────────────────
test('cam / mic / sys audio / cursor FX toggles click correctly', async () => {
  await goToPicker();

  for (const id of ['toggleCam', 'toggleMic', 'toggleSys', 'toggleClickFx']) {
    const btn = page.locator('#' + id);
    const wasBefore = await btn.evaluate(el => el.classList.contains('active'));
    await btn.click();
    await page.waitForTimeout(100);
    const afterClick = await btn.evaluate(el => el.classList.contains('active'));
    expect(afterClick).toBe(!wasBefore);
    // Click back
    await btn.click();
    await page.waitForTimeout(100);
  }

  console.log('✓ All video-mode toggles respond to clicks correctly');
});

// ─── 5. Preset selector has original three presets ────────────────────────
test('preset selector contains all original presets', async () => {
  await goToPicker();

  const options = await page.locator('#presetSel option').allTextContents();
  console.log('  Presets:', options);

  expect(options.some(o => o.includes('Tutorial'))).toBe(true);
  expect(options.some(o => o.includes('Quick Demo'))).toBe(true);
  expect(options.some(o => o.includes('Presentation'))).toBe(true);

  console.log('✓ All three original presets present in selector');
});

// ─── 6. Applying a video preset updates toggles ───────────────────────────
test('applying Tutorial preset sets cam+mic on, sys audio off', async () => {
  await goToPicker();

  const sel = page.locator('#presetSel');
  const options = await sel.locator('option').all();
  let tutorialId = null;
  for (const opt of options) {
    const text = await opt.textContent();
    if (text && text.includes('Tutorial')) { tutorialId = await opt.getAttribute('value'); break; }
  }
  expect(tutorialId).toBeTruthy();
  await sel.selectOption(tutorialId);
  await page.waitForTimeout(400);

  // Tutorial: cam=true, mic=true, sysAudio=false
  await expect(page.locator('#toggleCam')).toHaveClass(/active/);
  await expect(page.locator('#toggleMic')).toHaveClass(/active/);
  await expect(page.locator('#toggleSys')).not.toHaveClass(/active/);
  // Countdown should be 3s
  await expect(page.locator('#countdownSel')).toHaveValue('3');
  // Must still be in video mode
  await expect(page.locator('#modeVideo')).toHaveClass(/active/);

  console.log('✓ Tutorial preset applies correctly and stays in video mode');
});

// ─── 7. Video recording starts (screen share required) ────────────────────
test('starting video recording shows recording view with preview and controls', async () => {
  await goToPicker();
  await page.waitForSelector('.source-card', { timeout: 10000 });

  // Select first source, turn off cam (no camera needed for this test)
  await page.locator('.source-card').first().click();
  const camActive = await page.locator('#toggleCam').evaluate(el => el.classList.contains('active'));
  if (camActive) await page.locator('#toggleCam').click();
  // Set countdown to None
  await page.locator('#countdownSel').selectOption('0');
  await page.waitForTimeout(200);

  await page.click('#btnStart');

  // getDisplayMedia requires user interaction / permission — handle both success and denial
  const result = await Promise.race([
    page.waitForSelector('#viewRecording:not(.hidden)', { timeout: 15000 }).then(() => 'recording'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 15000 }).then(() => 'error')
  ]);

  if (result === 'error') {
    const errText = await page.locator('#errorBox').textContent();
    console.warn('  Screen recording permission denied or cancelled:', errText);
    test.skip();
    return;
  }

  // Recording view is visible
  await expect(page.locator('#viewRecording')).not.toHaveClass(/hidden/);
  // Sidebar is hidden during recording
  await expect(page.locator('#sidebar')).toHaveClass(/hidden/);
  // Timer running
  await expect(page.locator('#timer')).toBeVisible();
  // Pause and stop buttons present
  await expect(page.locator('#btnPause')).toBeVisible();
  await expect(page.locator('#btnStop')).toBeVisible();
  // Audio meter visible
  await expect(page.locator('#meterFill')).toBeVisible();

  // Let it run briefly
  await page.waitForTimeout(2000);
  const timerText = await page.locator('#timer').textContent();
  console.log('  Timer after 2s:', timerText);
  expect(timerText).not.toBe('00:00');

  console.log('✓ Video recording view visible with timer, preview, and controls');
});

// ─── 8. Pause/resume video recording ─────────────────────────────────────
test('pause and resume video recording works', async () => {
  const inRec = await page.locator('#viewRecording:not(.hidden)').count();
  if (inRec === 0) { test.skip(); return; }

  await page.click('#btnPause');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnPause')).toHaveText('RESUME');
  await expect(page.locator('#recDot')).toHaveClass(/paused/);

  await page.click('#btnPause');
  await page.waitForTimeout(300);
  await expect(page.locator('#btnPause')).toHaveText('PAUSE');
  await expect(page.locator('#recDot')).not.toHaveClass(/paused/);

  console.log('✓ Video recording pause/resume works');
});

// ─── 9. Stopping video shows trim view ───────────────────────────────────
test('stopping video recording shows trim view with video player and save options', async () => {
  const inRec = await page.locator('#viewRecording:not(.hidden)').count();
  if (inRec === 0) { test.skip(); return; }

  await page.waitForTimeout(1500);
  await page.click('#btnStop');

  await page.waitForSelector('#viewTrim:not(.hidden)', { timeout: 10000 });

  // Video element populated
  const vid = page.locator('#trimVideo');
  await expect(vid).toBeVisible();
  const src = await vid.getAttribute('src');
  expect(src).toMatch(/^blob:/);

  // Trim sliders
  await expect(page.locator('#trimStart')).toBeVisible();
  await expect(page.locator('#trimEnd')).toBeVisible();

  // All save buttons
  await expect(page.locator('#btnSaveFull')).toBeVisible();
  await expect(page.locator('#btnSaveTrim')).toBeVisible();
  await expect(page.locator('#btnSaveMP4')).toBeVisible();
  await expect(page.locator('#btnDiscard')).toBeVisible();
  await expect(page.locator('#btnReRecord')).toBeVisible();

  // Audio trim buttons must NOT be in this view
  await expect(page.locator('#btnSaveMp3')).not.toBeVisible();

  console.log('✓ Video trim view correct — has video player, sliders, all save buttons');
});

// ─── 10. Saving video WebM instant ───────────────────────────────────────
test('saving full WebM video produces AIXplore- prefixed file (not Audio)', async () => {
  const inTrim = await page.locator('#viewTrim:not(.hidden)').count();
  if (inTrim === 0) { test.skip(); return; }

  await page.click('#btnSaveFull');
  await page.waitForSelector('#saveBanner:not(.hidden)', { timeout: 15000 });

  const savedPath = await page.locator('#savedPath').textContent();
  console.log('  Saved path:', savedPath);

  // Must be a regular AIXplore- file, NOT AIXplore-Audio-
  expect(savedPath).toMatch(/AIXplore-\d{4}/);
  expect(savedPath).not.toMatch(/AIXplore-Audio-/);
  expect(savedPath).toMatch(/\.webm$/);

  expect(fs.existsSync(savedPath)).toBe(true);
  const size = fs.statSync(savedPath).size;
  expect(size).toBeGreaterThan(0);
  console.log('  File size:', size, 'bytes');

  await page.click('#btnDismiss').catch(() => {});

  console.log('✓ Video WebM saved with correct prefix (not Audio prefix)');
});

// ─── 11. Discard returns to picker ───────────────────────────────────────
test('discarding from trim view returns to source picker', async () => {
  // Start a fresh recording and discard it
  await goToPicker();
  await page.waitForSelector('.source-card', { timeout: 10000 });
  await page.locator('.source-card').first().click();
  const camActive = await page.locator('#toggleCam').evaluate(el => el.classList.contains('active'));
  if (camActive) await page.locator('#toggleCam').click();
  await page.locator('#countdownSel').selectOption('0');

  await page.click('#btnStart');
  const result = await Promise.race([
    page.waitForSelector('#viewRecording:not(.hidden)', { timeout: 12000 }).then(() => 'recording'),
    page.waitForSelector('#errorBox:not(.hidden)', { timeout: 12000 }).then(() => 'error')
  ]);
  if (result === 'error') { test.skip(); return; }

  await page.waitForTimeout(1200);
  await page.click('#btnStop');
  await page.waitForSelector('#viewTrim:not(.hidden)', { timeout: 8000 });

  await page.click('#btnDiscard');
  await page.waitForSelector('#viewPicker:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#modeVideo')).toHaveClass(/active/);

  console.log('✓ Discard returns to picker in video mode');
});

// ─── 12. Dashboard shows recordings ──────────────────────────────────────
test('dashboard shows recording stats and history', async () => {
  await page.click('#navDashboard');
  await page.waitForSelector('#viewDashboard:not(.hidden)', { timeout: 3000 });
  await page.waitForTimeout(500);

  const total = await page.locator('#dashTotal').textContent();
  console.log('  Dashboard total:', total);
  expect(parseInt(total)).toBeGreaterThanOrEqual(0);

  // Stat cards are visible
  await expect(page.locator('#dashTotal')).toBeVisible();
  await expect(page.locator('#dashDuration')).toBeVisible();
  await expect(page.locator('#dashSize')).toBeVisible();

  console.log('✓ Dashboard renders stats correctly');
});

// ─── 13. Existing presets in settings are intact ─────────────────────────
test('settings page shows all original presets intact', async () => {
  await page.click('#navSettings');
  await page.waitForSelector('#viewSettings:not(.hidden)', { timeout: 3000 });
  await page.waitForTimeout(500);

  const listText = await page.locator('#presetsList').textContent();
  expect(listText).toContain('Tutorial');
  expect(listText).toContain('Quick Demo');
  expect(listText).toContain('Presentation');
  expect(listText).toContain('Audio Recording');

  console.log('✓ Settings shows all 4 presets (3 original + Audio Recording)');
});
