/**
 * Regression test: rename via Enter key (no confirm button)
 *
 * Previous UX had ✓/✗ buttons whose click events were consumed by event
 * bubbling bugs. New UX: Enter confirms, Escape cancels — no buttons needed.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_DIR = path.join(__dirname, '..');

test.describe('Rename via Enter key', () => {
  let app, page, tmpFile;

  test.beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `AIXplore-Audio-rename-test-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, Buffer.alloc(1024));

    app = await electron.launch({ args: [APP_DIR], timeout: 60000 });
    page = await app.firstWindow({ timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await page.evaluate(async (filePath) => {
      var dir = filePath.substring(0, filePath.lastIndexOf('/'));
      await window.electronAPI.setSettings({ outputDir: dir });
      await window.electronAPI.addHistoryEntry({
        filePath: filePath, format: 'mp3', duration: 30,
        savedAt: new Date().toISOString(), audioOnly: true
      });
    }, tmpFile);

    await page.click('#navHistory');
    await page.waitForTimeout(300);
  });

  test.afterEach(async () => {
    await app.close();
    try {
      const dir = path.dirname(tmpFile);
      fs.readdirSync(dir)
        .filter(f => f.startsWith('AIXplore-Audio-rename-test-') || f.startsWith('My Meeting') || f.startsWith('Valid New'))
        .forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    } catch (e) {}
  });

  test('Enter key renames the file', async () => {
    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    const input = page.locator('.hr-rename-input').first();
    await expect(input).toBeVisible();

    await input.fill('My Meeting Notes');
    await input.press('Enter');
    await page.waitForTimeout(500);

    await expect(input).not.toBeVisible();
    await expect(page.locator('.history-row').first().locator('.hr-name')).toContainText('My Meeting Notes');
    expect(fs.existsSync(path.join(path.dirname(tmpFile), 'My Meeting Notes.mp3'))).toBe(true);
  });

  test('Enter still works after a failed rename (duplicate name)', async () => {
    const collidingFile = path.join(path.dirname(tmpFile), 'Taken Name.mp3');
    fs.writeFileSync(collidingFile, Buffer.alloc(512));

    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    const input = page.locator('.hr-rename-input').first();
    await input.fill('Taken Name');
    await input.press('Enter');
    await page.waitForTimeout(300);

    await expect(input).toBeVisible(); // still in edit mode

    await input.fill('Valid New Name');
    await input.press('Enter');
    await page.waitForTimeout(500);

    await expect(input).not.toBeVisible();
    await expect(page.locator('.history-row').first().locator('.hr-name')).toContainText('Valid New Name');

    try { fs.unlinkSync(collidingFile); } catch (e) {}
    try { fs.unlinkSync(path.join(path.dirname(tmpFile), 'Valid New Name.mp3')); } catch (e) {}
  });

  test('Escape cancels without saving', async () => {
    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();

    const input = page.locator('.hr-rename-input').first();
    const originalName = path.basename(tmpFile);
    await input.fill('Should Not Save');
    await input.press('Escape');
    await page.waitForTimeout(200);

    await expect(input).not.toBeVisible();
    await expect(page.locator('.history-row').first().locator('.hr-name')).toContainText(originalName);
    expect(fs.existsSync(tmpFile)).toBe(true);
  });

  test('no confirm button exists in rename mode', async () => {
    const renameBtn = page.locator('.history-row').first().locator('[data-action="rename"]');
    await renameBtn.click();
    await expect(page.locator('[data-action="confirm"]')).not.toBeVisible();
  });
});
