import { fileURLToPath } from 'node:url';
/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/markdown-math/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  const remote = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.abort());
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/'))
      remote.push(route.request().url());
    return route.abort();
  });
  if (process.env.COMPOSER_TEST_FONT)
    await page.route('**/__font', (route) =>
      route.fulfill({ path: process.env.COMPOSER_TEST_FONT }),
    );
  await page.goto(process.env.MATH_TEST_ORIGIN || 'http://127.0.0.1:1430/');
  await page.evaluate(async (font) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { Markdown, RichContent } = await import('/src/RichContent.tsx');
    document.getElementById('root').style.display = 'none';
    const el = document.createElement('main');
    el.id = 'math-test';
    el.style.cssText = 'padding:24px;max-width:780px;margin:auto;min-width:0';
    document.body.append(el);
    if (font) {
      const style = document.createElement('style');
      style.textContent =
        "@font-face{font-family:MathTest;src:url('/__font')} main{font-family:MathTest,sans-serif} main .katex{font-family:KaTeX_Main,MathTest,serif}";
      document.head.append(style);
    }
    const root = (dom.default || dom).createRoot(el);
    window.opened = [];
    window.renderMath = (text, mode) => {
      const onFile = (path) => window.opened.push(path);
      const content =
        mode === 'agentchat'
          ? React.createElement(
              'div',
              { className: 'api-message-body' },
              React.createElement(Markdown, { text, onFile }),
            )
          : React.createElement(RichContent, {
              entry: { item: { id: 'math-message', type: 'agentMessage', text } },
              onFile,
            });
      root.render(
        React.createElement('section', { 'data-math-source': text, 'data-mode': mode }, content),
      );
    };
  }, Boolean(process.env.COMPOSER_TEST_FONT));

  const host = page.locator('#math-test');
  async function render(text, count, mode = 'codex') {
    await page.evaluate(({ text, mode }) => window.renderMath(text, mode), { text, mode });
    await page.waitForFunction(
      ({ count, text, mode }) => {
        const el = document.getElementById('math-test');
        return (
          el.querySelector('.rich-content, .api-message-body') &&
          el.querySelector('section')?.getAttribute('data-math-source') === text &&
          el.querySelector('section')?.getAttribute('data-mode') === mode &&
          !el.querySelector('.markdown-pending') &&
          el.querySelectorAll('.katex').length === count
        );
      },
      { count, text, mode },
    );
  }
  async function formulas() {
    return host.locator('annotation[encoding="application/x-tex"]').allTextContents();
  }
  const screenshot = String.raw`这些是从现在出发的夺冠概率。

① **用 Elo 形式把评分差转换成单局胜率。**

设两队评分为 \(R_A、R_B\)，A 的单局胜率为：

\[
p=\frac{1}{1+10^{(R_B-R_A)/600}}
\]

分母 **600** 参照 Riot 公开的 GPR 方法说明。

② **根据单局胜率计算系列赛胜率。**

假设各局独立、单局胜率固定：

\[ P(\text{赢 BO3})=3p^2-2p^3 \]

\[ P(\text{赢 BO5})=10p^3-15p^4+6p^5 \]

因此强队打 BO5 的优势通常比打 BO1 更大。`;
  for (const mode of ['codex', 'agentchat']) {
    await render(screenshot, 4, mode);
    assert.equal(await host.locator('.katex-display').count(), 3);
    assert.equal(await host.locator('.katex-error').count(), 0);
    assert((await formulas()).includes(String.raw`p=\frac{1}{1+10^{(R_B-R_A)/600}}`));
    checks.push(`${mode}: screenshot Elo/BO3/BO5 and Chinese inline math`);
  }
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('16px KaTeX_Main')));
  await host.screenshot({ path: fileURLToPath(new URL('elo-desktop.png', out)) });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await host.screenshot({ path: fileURLToPath(new URL('elo-mobile.png', out)) });

  const syntaxes = String.raw`行内 $x^2$ 和 \(R_A\)。

$$
\frac{a}{b}
$$

\[
\begin{aligned}a&=b+c\\d&=e-f\end{aligned}
\]

> \[
> \begin{pmatrix}1&2\\3&4\end{pmatrix}
> \]

- 行内 $p^2$。

| 表格 | 值 |
| --- | --- |
| 胜率 | $p^3$ |

~~~math
E=mc^2
~~~`;
  await render(syntaxes, 8);
  assert.equal(await host.locator('.katex-display').count(), 4);
  assert.equal(await host.locator('.katex-error').count(), 0);
  assert((await formulas()).includes(String.raw`\begin{aligned}a&=b+c\\d&=e-f\end{aligned}`));
  assert.equal(await host.locator('table .katex').count(), 1);
  checks.push('dollar/TeX delimiters, math fence, aligned/matrix, list, quote and GFM table');

  const prose = String.raw`价格 $50 和 $100，范围 $100-$200，预算 $2bn 到 $4bn。

转义 \$5，普通 [括号] 与 (R_A)。

${'`'}\(x\) $y$ \[z\]${'`'}

~~~js
const text = "\\[x\\] $y$";
~~~

    \[indented\] $code$

[文档](https://example.com/math?q=$x$) 和 [文件](src/math.ts:12)。`;
  await render(prose, 0);
  assert(
    (await host.textContent()).includes('价格 $50 和 $100，范围 $100-$200，预算 $2bn 到 $4bn。'),
  );
  assert.equal(await host.locator('p > code').textContent(), String.raw`\(x\) $y$ \[z\]`);
  assert.equal(await host.locator('pre').count(), 2);
  assert.equal(
    await host.getByRole('link', { name: '文档' }).getAttribute('href'),
    'https://example.com/math?q=$x$',
  );
  await host.getByRole('button', { name: '文件', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.opened), ['src/math.ts:12']);
  checks.push('currency, escapes, plain brackets, inline/fenced/indented code and links unchanged');

  // Exercise every prefix through the actual React update path, including incomplete TeX.
  for (const text of [
    String.raw`行内 \(\frac{1}{2}\) 完成`,
    '块公式\n\n' +
      String.raw`\[
\frac{1}{2}
\]

完成`,
    String.raw`$\frac{1}{2}$ 完成`,
  ]) {
    await page.evaluate(async (text) => {
      for (let i = 0; i <= text.length; i++) {
        window.renderMath(text.slice(0, i), 'codex');
        await new Promise(requestAnimationFrame);
      }
    }, text);
    await host.getByText('完成', { exact: false }).first().waitFor();
    assert.equal(await host.locator('.katex').count(), 1);
    assert.equal(await host.locator('.katex-error').count(), 0);
  }
  await render(
    String.raw`坏公式 \(\frac{1}{\) 后文。

正常公式 $x+1$。`,
    1,
  );
  assert.equal(await host.locator('.katex-error').count(), 1);
  assert((await host.textContent()).includes('后文'));
  checks.push('incremental streaming, incomplete formulas, error fallback and following content');

  await render(
    String.raw`\(\href{javascript:alert(1)}{bad}\)

\(\includegraphics{https://external.example/secret.png}\)

<img src="https://external.example/html.png" onerror="alert(1)">

$x$`,
    3,
  );
  assert.equal(await host.locator('a, img, iframe, script, [onclick], [onerror]').count(), 0);
  checks.push('untrusted TeX and raw HTML cannot create links/images/scripts or fetch externally');

  const long =
    String.raw`\[
\displaystyle ` +
    Array.from({ length: 40 }, (_, i) => `x_{${i}}`).join('+') +
    String.raw`
\]`;
  const layout = [];
  for (const mode of ['codex', 'agentchat']) {
    await render(long, 1, mode);
    for (const width of [320, 390, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const dimensions = await host.evaluate((el) => {
        const display = el.querySelector('.katex-display');
        display.scrollLeft = 100;
        return {
          rootWidth: document.documentElement.clientWidth,
          pageWidth: document.documentElement.scrollWidth,
          scrollable: display.scrollWidth > display.clientWidth,
          scrolled: display.scrollLeft > 0,
          overflow: getComputedStyle(display).overflowX,
        };
      });
      assert(dimensions.pageWidth <= dimensions.rootWidth, JSON.stringify(dimensions));
      assert(dimensions.scrollable && dimensions.scrolled && dimensions.overflow === 'auto');
      layout.push({ mode, width, ...dimensions });
      if (width === 320)
        await host.screenshot({ path: fileURLToPath(new URL('long-mobile.png', out)) });
    }
  }
  checks.push('320/390/1100px long formulas scroll within message without page overflow');
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        layout,
        errors,
        remote,
        scope: 'Controlled Chromium rendering of real components; no model or Host; not deployed.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`PASS: ${checks.join('; ')}`);
} finally {
  await browser.close();
}
