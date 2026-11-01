/* global window, localStorage, performance, PerformanceObserver */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/performance/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const [label, origin] of [
    ['before', process.env.PERF_BASELINE_ORIGIN],
    ['after', process.env.PERF_TEST_ORIGIN || 'http://127.0.0.1:1599'],
  ].filter(([, origin]) => origin)) {
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 1280, height: 850 },
        serviceWorkers: 'block',
      });
      await context.addInitScript(() => {
        localStorage.setItem('agentdeck.web.work-mode', '"codex"');
        localStorage.setItem('agentdeck.web.theme', 'dark');
        window.longTasks = [];
        new PerformanceObserver((list) =>
          window.longTasks.push(
            ...list
              .getEntries()
              .map((entry) => ({ start: entry.startTime, duration: entry.duration })),
          ),
        ).observe({ type: 'longtask', buffered: true });
      });
      await context.route('**/api/v1/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(
            path.endsWith('/web/session')
              ? { accountId: 'perf', cloudDeviceId: 'test' }
              : path.endsWith('/hosts')
                ? { hosts: [] }
                : {},
          ),
        });
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Performance.enable');
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin);
      await page.getByRole('button', { name: '设置', exact: true }).waitFor();
      await page.waitForTimeout(350);
      const initial = await page.evaluate(() => ({
        paint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        scripts: performance
          .getEntriesByType('resource')
          .filter((e) => /\.js(?:\?|$)/.test(e.name))
          .map((e) => ({ name: e.name.split('/').at(-1), bytes: e.decodedBodySize })),
        longTasks: window.longTasks,
      }));
      if (label === 'after') {
        assert(
          !initial.scripts.some((s) =>
            /Markdown-|FileWorkspace-|Panels-|ApiChat-|tls-/.test(s.name),
          ),
          'Unused feature chunks must not load on the initial workbench',
        );
        assert(initial.scripts.reduce((sum, s) => sum + s.bytes, 0) < 450000);
      }
      const before = await cdp.send('Performance.getMetrics');
      // Save a trace that can be opened directly in Chrome Performance.
      if (run === 0)
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,blink.user_timing',
          transferMode: 'ReturnAsStream',
        });
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const nav = page.getByRole('navigation', { name: '设置分类' });
      for (const name of ['对话', '常规', '电脑', '数据', '常规']) {
        await nav.getByRole('button', { name, exact: true }).click();
      }
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForTimeout(300);
      const after = await cdp.send('Performance.getMetrics');
      if (run === 0) {
        const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const { stream } = await completed;
        let trace = '';
        while (true) {
          const chunk = await cdp.send('IO.read', { handle: stream });
          trace += chunk.data;
          if (chunk.eof) break;
        }
        await cdp.send('IO.close', { handle: stream });
        await writeFile(new URL(`${label}-interaction-trace.json`, out), trace);
      }
      const metric = (result, name) => result.metrics.find((m) => m.name === name)?.value || 0;
      const result = {
        label,
        run,
        ...initial,
        initialJsBytes: initial.scripts.reduce((sum, s) => sum + s.bytes, 0),
        interactionTaskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000,
        interactionLayoutMs:
          (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
      };
      report.push(result);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      report.map(
        ({ label, run, paint, initialJsBytes, interactionTaskMs, interactionLayoutMs }) => ({
          label,
          run,
          paint,
          initialJsBytes,
          interactionTaskMs,
          interactionLayoutMs,
        }),
      ),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
