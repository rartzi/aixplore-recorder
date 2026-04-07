/**
 * Regression test: rename confirm button must work when clicked
 *
 * Root cause: the { once: true } actionsDiv listener was consumed by the
 * same ✏️ click event bubbling up, so ✓ did nothing.
 * Fix: stopPropagation() on rename click + named listener + explicit removeEventListener.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');

test.describe('Rename confirm button fix', () => {
  let app, page, tmpFile;

  test.beforeEach(async () => {
    // Create a fake recording file in the system temp dir so the app can rename it
    tmpFile = path.join(os.tmpdir(), `AIXplore-Audio-rename-test-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, Buffer.alloc(1024)); // 1KB placeholder

    app = await electron.launch({ args: [APP_DIR], timeout: 60000 });
    page = await app.firstWindow({ timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Inject the fake file into historyCache and navigate to History view
    await page.evaluate(async (filePath) => {
      // Override outputDir in settings to match the tmp location
      var dir = filePath.substring(0, filePath.lastIndexOf('/'));
      await window.electronAPI.setSettings({ outputDir: dir });
      // Add a history entry directly
      await window.electronAPI.addHistoryEntry({
        filePath: filePath,
        format: 'mp3',
        duration: 30,
        savedAt: new Date().toISOString(),
        audioOnly: true
      });
    }, tmpFile);

    // Navigate to history
    await page.click('#navHistory');
    await page.waitForTimeout(300);
  });

  test.afterEach(async () => {
    await app.close();
    // Clean up any renamed files
    try {
      const dir = path.dirname(tmpFile);
      fs.readdirSync(dir)
        .filter(f => f.startsWith('AIXplore-Audio-rename-test-') || f.startsWith('My Meeting'))
        .forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    } catch (e) {}
  });

  test('clicking ✓ confirm renames the file', async () => {
    // Click the rename button on the first history row
    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    // Input should be visible with current stem
    const input = page.locator('.hr-rename-input').first();
    await expect(input).toBeVisible();

    // Type a new name
    await input.fill('My Meeting Notes');

    // Click confirm ✓
    const confirmBtn = page.locator('[data-action="confirm"]').first();
    await confirmBtn.click();
    await page.waitForTimeout(500);

    // The input should be gone — rename mode exited
    await expect(input).not.toBeVisible();

    // The row should show the new filename
    const hrName = page.locator('.history-row').first().locator('.hr-name');
    await expect(hrName).toContainText('My Meeting Notes');

    // File should exist on disk with the new name
    const newFile = path.join(path.dirname(tmpFile), 'My Meeting Notes.mp3');
    expect(fs.existsSync(newFile)).toBe(true);
  });

  test('confirm button remains functional after a failed rename attempt', async () => {
    // Create a second file to cause a duplicate-name collision on first attempt
    const collidingFile = path.join(path.dirname(tmpFile), 'Taken Name.mp3');
    fs.writeFileSync(collidingFile, Buffer.alloc(512));

    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    const input = page.locator('.hr-rename-input').first();
    await input.fill('Taken Name'); // Will collide → IPC throws
    await page.locator('[data-action="confirm"]').first().click();
    await page.waitForTimeout(300);

    // Input should still be visible (rename failed, edit mode stays)
    await expect(input).toBeVisible();

    // Now type a valid unique name and click confirm again — must work
    await input.fill('Valid New Name');
    await page.locator('[data-action="confirm"]').first().click();
    await page.waitForTimeout(500);

    await expect(input).not.toBeVisible();
    const hrName = page.locator('.history-row').first().locator('.hr-name');
    await expect(hrName).toContainText('Valid New Name');

    // Clean up colliding file
    try { fs.unlinkSync(collidingFile); } catch (e) {}
    try { fs.unlinkSync(path.join(path.dirname(tmpFile), 'Valid New Name.mp3')); } catch (e) {}
  });

  test('Escape key cancels rename without saving', async () => {
    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    const input = page.locator('.hr-rename-input').first();
    const originalName = path.basename(tmpFile);
    await input.fill('Should Not Save');
    await input.press('Escape');
    await page.waitForTimeout(200);

    await expect(input).not.toBeVisible();
    const hrName = page.locator('.history-row').first().locator('.hr-name');
    await expect(hrName).toContainText(originalName);
    expect(fs.existsSync(tmpFile)).toBe(true);
  });
});
