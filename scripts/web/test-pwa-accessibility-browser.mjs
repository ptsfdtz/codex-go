/* global document, window, Event, WheelEvent, KeyboardEvent, Touch, TouchEvent, getComputedStyle */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.route('**/api/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  const page = await context.newPage();
  await page.goto(process.env.COMPOSER_TEST_ORIGIN || 'http://127.0.0.1:1430');
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  const checks = await page.evaluate(() => {
    const prevented = [];
    for (const type of ['gesturestart', 'gesturechange']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      if (event.defaultPrevented) prevented.push(type);
    }
    for (const key of ['+', '=', '-', '0'])
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const event = new KeyboardEvent('keydown', {
          key,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(event);
        if (event.defaultPrevented) prevented.push(`${modifier}:${key}`);
      }
    const wheel = new WheelEvent('wheel', { ctrlKey: true, cancelable: true });
    window.dispatchEvent(wheel);
    if (wheel.defaultPrevented) prevented.push('wheel');
    const touches = [1, 2].map((identifier) => new Touch({ identifier, target: document.body }));
    const touch = new TouchEvent('touchmove', { touches, bubbles: true, cancelable: true });
    document.dispatchEvent(touch);
    if (touch.defaultPrevented) prevented.push('multitouch');
    return {
      prevented,
      viewport: document.querySelector('meta[name="viewport"]').content,
      touchAction: getComputedStyle(document.documentElement).touchAction,
    };
  });
  assert.deepEqual(checks.prevented, []);
  assert(!/user-scalable|maximum-scale|minimum-scale/.test(checks.viewport));
  // Chromium canonicalizes pan-x pan-y pinch-zoom to manipulation.
  assert(checks.touchAction.includes('pinch-zoom') || checks.touchAction === 'manipulation');
  const cdp = await context.newCDPSession(page);
  const heightBefore = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--app-height'),
  );
  // CDP pinch synthesis is browser-version dependent. Verify magnification and
  // the viewport handler separately from the uncanceled gesture events above.
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForFunction(() => window.visualViewport.scale > 1.4);
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height')),
    heightBefore,
  );
  console.log(
    'PASS: zoom shortcuts, gesture/wheel/multi-touch events are not canceled; viewport/touch-action allow magnification; CDP page zoom preserves app height. Actual phone pinch gestures remain untested.',
  );
} finally {
  await browser.close();
}
