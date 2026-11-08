/* global document, requestAnimationFrame, HTMLElement, WheelEvent, Event */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(process.env.HISTORY_TEST_ORIGIN || 'http://127.0.0.1:1538');
  const report = await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = client.default || client;
    const dom = await import('/node_modules/.vite/deps/react-dom.js');
    const { flushSync } = dom.default || dom;
    const { Timeline } = await import('/src/Timeline.tsx');
    const { ActivityStages } = await import('/src/features/activity/ActivityStages.tsx');
    const { Markdown } = await import('/src/Markdown.tsx');
    const { useHistory } = await import('/src/features/use-history.ts');
    document.getElementById('root').style.display = 'none';
    const mount = document.createElement('main');
    document.body.append(mount);
    const root = createRoot(mount);
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const h = React.createElement;
    let entries = Array.from({ length: 1000 }, (_, i) => ({
      turnId: `t${i}`,
      item: { id: `i${i}`, type: 'agentMessage', text: `Message ${i}` },
    }));
    const render = (revision) =>
      flushSync(() =>
        root.render(
          h(
            Timeline,
            { identity: 'a', revision },
            entries.map((entry) =>
              h(
                'article',
                {
                  key: entry.item.id,
                  'data-history-key': entry.item.id,
                  style: { height: 40 },
                },
                entry.item.text,
              ),
            ),
          ),
        ),
      );
    render(0);
    const timeline = mount.querySelector('.timeline');
    timeline.style.cssText = 'height:400px;overflow:auto;overflow-anchor:none';
    await frame();
    let reads = 0;
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-history-key')) reads++;
      return original.call(this);
    };
    for (let i = 1; i <= 20; i++) {
      entries = entries.map((entry, n) =>
        n === 999
          ? {
              ...entry,
              item: { ...entry.item, text: `Delta ${i}` },
            }
          : entry,
      );
      render(i);
    }
    await frame();
    const followingReads = reads;
    timeline.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    timeline.scrollTop = 20000;
    timeline.dispatchEvent(new Event('scroll', { bubbles: true }));
    await frame();
    const anchor = mount.querySelector('[data-history-key="i500"]');
    const before = original.call(anchor).top;
    entries = [{ turnId: 'old', item: { id: 'old', text: 'Older message' } }, ...entries];
    render(21);
    await frame();
    const anchorDrift = Math.abs(original.call(anchor).top - before);
    HTMLElement.prototype.getBoundingClientRect = original;
    const tools = Array.from({ length: 500 }, (_, i) => ({
      turnId: 'tools',
      item: { id: `tool${i}`, type: 'commandExecution' },
    }));
    flushSync(() =>
      root.render(
        h(ActivityStages, { entries: tools }, (entry) =>
          h('article', { key: entry.item.id }, entry.item.id),
        ),
      ),
    );
    const foldedNodes = mount.querySelectorAll('article').length;
    mount.querySelector('details').open = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await frame();
    const expandedNodes = mount.querySelectorAll('article').length;
    let clicked = '';
    const renderMarkdown = (name) =>
      flushSync(() =>
        root.render(
          h(Markdown, {
            text: '[file](src/main.ts)',
            onFile: () => {
              clicked = name;
            },
          }),
        ),
      );
    renderMarkdown('old');
    const link = mount.querySelector('.file-link');
    renderMarkdown('new');
    mount.querySelector('.file-link').click();
    const reusedMarkdownNode = link === mount.querySelector('.file-link');
    let state;
    function HistoryProbe() {
      state = useHistory();
      return null;
    }
    flushSync(() => root.render(h(HistoryProbe)));
    state.update([entries[0]]);
    state.update((value) => [...value, entries[1]]);
    const synchronousHistoryLength = state.current.current.length;
    root.unmount();
    return {
      followingReads,
      anchorDrift,
      foldedNodes,
      expandedNodes,
      clicked,
      reusedMarkdownNode,
      synchronousHistoryLength,
    };
  });
  assert.equal(report.followingReads, 0, 'Following stream must not measure old history rows');
  assert(report.anchorDrift < 2, 'Prepending history preserves reading position');
  assert.equal(report.foldedNodes, 0);
  assert.equal(report.expandedNodes, 500);
  assert.equal(report.clicked, 'new', 'Memoized markdown must use the current file handler');
  assert(report.reusedMarkdownNode);
  assert.equal(report.synchronousHistoryLength, 2, 'Batched events must see the latest history');
  assert.deepEqual(errors, []);
  await mkdir(new URL('../../artifacts/history-performance/', import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL('../../artifacts/history-performance/report.json', import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}
