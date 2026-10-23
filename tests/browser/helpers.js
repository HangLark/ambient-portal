// Follow the same confirmation flow as a user. Repeated toggles in one page need no dialog.
export async function toggleListening(page) {
  await page.locator('#microphone-switch').click();
  if (await page.locator('#playback-dialog').isVisible()) await page.locator('#playback-confirm').click();
}
