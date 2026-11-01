import { fileURLToPath } from 'node:url';
/* global window, document, Event, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/speech-input/', import.meta.url);
const fontPath = process.env.COMPOSER_TEST_FONT;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [];
try {
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1100, height: 820 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(7000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (r) => r.abort());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, (r) => r.abort());
  if (fontPath)
    await page.route('**/__speech-font.otf', (r) =>
      r.fulfill({ path: fontPath, contentType: 'font/otf' }),
    );
  await page.goto(process.env.SPEECH_TEST_ORIGIN || 'http://127.0.0.1:1498/');
  await page.evaluate(async (useTestFont) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const dom = await import('/node_modules/.vite/deps/react-dom_client.js');
    window.recognitions = [];
    class Recognition {
      constructor() {
        window.recognitions.push(this);
      }
      start() {
        this.starts = (this.starts || 0) + 1;
        this.lateResult = (...args) => this.savedResult?.(...args);
        this.savedResult = this.onresult;
        this.savedEnd = this.onend;
        this.savedStart = this.onstart;
        if (window.throwOnStart) {
          window.throwOnStart = false;
          throw new Error('start failed');
        }
        this.onstart?.();
      }
      stop() {
        this.stops = (this.stops || 0) + 1;
      }
      abort() {
        this.aborts = (this.aborts || 0) + 1;
      }
    }
    window.SpeechRecognition = Recognition;
    window.webkitSpeechRecognition = Recognition;
    window.testRecognition = Recognition;
    window.latestRecognition = () => window.recognitions.at(-1);
    window.emitResult = (parts, instance = window.latestRecognition(), late = false) => {
      const event = {
        resultIndex: 0,
        results: parts.map(([text, final]) => ({ isFinal: final, 0: { transcript: text } })),
      };
      (late ? instance.savedResult : instance.onresult)?.(event);
    };
    const { Composer } = await import('/src/features/Composer.tsx');
    if (useTestFont) {
      const font = document.createElement('style');
      font.textContent =
        "@font-face{font-family:SpeechTest;src:url('/__speech-font.otf')} :root{--font-sans:SpeechTest,sans-serif;font-family:SpeechTest,sans-serif}";
      document.head.append(font);
    }
    const { createRoot } = dom.default || dom;
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('main');
    host.id = 'speech-test';
    document.body.append(host);
    const root = createRoot(host);
    window.drafts = {
      main: {
        text: '原有草稿',
        attachments: [],
        skills: [],
        mode: 'default',
        model: '',
        effort: '',
      },
      side: { text: '', attachments: [], skills: [], mode: 'default', model: '', effort: '' },
    };
    window.scope = 'a';
    window.disabled = false;
    window.busy = false;
    window.apiMode = false;
    window.active = false;
    window.sends = [];
    window.stops = [];
    window.panels = [];
    window.renderSpeech = () =>
      root.render(
        React.createElement(
          'div',
          { className: 'speech-test-grid', style: { display: 'flex', gap: 16, padding: 16 } },
          ...['main', 'side'].map((id) =>
            React.createElement(
              'section',
              { key: id, id: `speech-${id}`, style: { width: '50%', minWidth: 0 } },
              React.createElement('h2', {}, id === 'main' ? '主对话' : '侧边对话'),
              React.createElement(Composer, {
                key: id + window.scope,
                draft: window.drafts[id],
                models: [],
                supports: () => false,
                execution: !window.apiMode,
                chat: window.apiMode,
                active: window.active,
                disabled: window.disabled,
                busy: window.busy,
                permission: 'workspace',
                onPermission: () => {},
                onChange: (change) => {
                  window.drafts[id] = { ...window.drafts[id], ...change };
                  window.renderSpeech();
                },
                onSend: () => window.sends.push(id),
                onStop: () => window.stops.push(id),
                onNew: () => {},
                onPanel: (name) => window.panels.push(name),
              }),
            ),
          ),
        ),
      );
    window.renderSpeech();
  }, !!fontPath);
  await page.evaluate(() => document.fonts.ready);
  const main = page.locator('#speech-main'),
    side = page.locator('#speech-side');
  const input = main.getByRole('textbox', { name: '消息', exact: true });
  const mic = main.getByRole('button', { name: '语音输入', exact: true });
  const finish = main.getByRole('button', { name: '结束语音输入', exact: true });
  assert.equal(
    await page.evaluate(() => window.recognitions.length),
    0,
    'never request microphone on mount',
  );
  const send = main.getByRole('button', { name: '发送', exact: true });
  const begin = async () => {
    await input.fill('');
    await mic.click();
  };
  await send.waitFor();
  assert.equal(await mic.count(), 0, 'text replaces voice with the send arrow');
  assert.equal(await main.locator('.send-button').count(), 1);
  await input.fill('');
  await mic.waitFor();
  assert.equal(await send.count(), 0, 'empty draft has only the voice action');
  await page.screenshot({ path: fileURLToPath(new URL('desktop-empty.png', out)) });
  await input.fill('普通文字');
  await send.waitFor();
  assert.equal(await mic.count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-send.png', out)) });
  await input.fill('');
  checks.push(
    'one primary action: empty draft voice, typed text send arrow, clearing restores voice',
  );
  await begin();
  await main.getByText('正在听，请说话…', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.latestRecognition().lang), 'zh-CN');
  await page.evaluate(() => window.emitResult([['临时文字', false]]));
  await main.getByText('临时文字', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '');
  assert.equal(await send.count(), 0);
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['还在说', false],
    ]),
  );
  await page.waitForFunction(() => window.drafts.main.text === '语音');
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
    ]),
  );
  await page.waitForFunction(() => window.drafts.main.text === '语音输入');
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
    ]),
  );
  assert.equal(await input.inputValue(), '语音输入');
  await finish.click();
  await main.getByText('正在完成识别…', { exact: true }).waitFor();
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
      ['完成', true],
    ]),
  );
  await page.evaluate(() => window.latestRecognition().onend?.());
  await send.waitFor();
  assert.equal(await input.inputValue(), '语音输入完成');
  assert.deepEqual(await page.evaluate(() => window.sends), []);
  await main.getByRole('button', { name: '发送', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sends), ['main']);
  checks.push(
    'explicit start, interim preview, draft insertion, final deduplication and manual sending',
  );

  await begin();
  await page.evaluate(() => {
    window.staleRecognition = window.latestRecognition();
  });
  await input.fill('手动编辑');
  await send.waitFor();
  await page.evaluate(() => window.emitResult([['不应覆盖', true]], window.staleRecognition, true));
  assert.equal(await input.inputValue(), '手动编辑');
  assert.ok(await page.evaluate(() => window.staleRecognition.aborts > 0));
  checks.push('manual typing cancels listening and discards late callbacks');

  await begin();
  await page.evaluate(() => {
    window.staleRecognition = window.latestRecognition();
    window.scope = 'b';
    window.drafts.main.text = '新会话';
    window.renderSpeech();
  });
  await send.waitFor();
  await page.evaluate(() =>
    window.emitResult([['旧会话结果', true]], window.staleRecognition, true),
  );
  assert.equal(await input.inputValue(), '新会话');
  assert.ok(await page.evaluate(() => window.staleRecognition.aborts > 0));
  checks.push('conversation replacement aborts recognition and protects the new draft');

  await begin();
  await side.getByRole('button', { name: '语音输入', exact: true }).click();
  await mic.waitFor();
  assert.ok(await page.evaluate(() => window.recognitions.at(-2).aborts > 0));
  await page.evaluate(() => window.emitResult([['侧边听写', true]]));
  assert.equal(await input.inputValue(), '');
  await page.waitForFunction(() => window.drafts.side.text === '侧边听写');
  await page.evaluate(() => {
    document.getElementById('speech-side').hidden = true;
  });
  await page.waitForFunction(() => window.latestRecognition().aborts > 0);
  await page.evaluate(() => {
    document.getElementById('speech-side').hidden = false;
  });
  checks.push('only one microphone owner; hidden side panes release it and drafts stay isolated');

  await begin();
  await page.evaluate(() => {
    window.disabled = true;
    window.renderSpeech();
  });
  await page.waitForFunction(() => window.latestRecognition().aborts > 0);
  await page.evaluate(() => {
    window.disabled = false;
    window.renderSpeech();
  });
  await begin();
  await page.keyboard.press('Escape');
  await mic.waitFor();
  await begin();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await mic.waitFor();
  checks.push('disconnect/disabled state, Escape and page exit release the microphone');
  await begin();
  await page.evaluate(() => {
    document.getElementById('speech-main').style.display = 'none';
  });
  await page.waitForFunction(() => window.latestRecognition().aborts > 0);
  await page.evaluate(() => {
    document.getElementById('speech-main').style.display = '';
  });
  checks.push('CSS-hidden mobile main conversations also release the microphone');

  for (const [code, expected] of [
    ['not-allowed', '麦克风或语音识别权限未获允许'],
    ['network', '语音识别服务连接失败'],
    ['audio-capture', '无法使用麦克风'],
    ['no-speech', '未识别到语音'],
  ]) {
    await begin();
    await page.evaluate((code) => window.latestRecognition().onerror?.({ error: code }), code);
    await main.getByText(new RegExp(expected)).waitFor();
    assert.equal(await input.inputValue(), '');
  }
  await page.evaluate(() => {
    window.throwOnStart = true;
  });
  await begin();
  await main.getByText(/语音识别启动失败/).waitFor();
  await main.getByRole('button', { name: '关闭语音提示' }).click();
  checks.push(
    'permission, network, capture, silence and synchronous startup failures preserve drafts',
  );

  await page.evaluate(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
    window.renderSpeech();
  });
  await begin();
  await main.getByText(/当前浏览器未提供网页语音识别/).waitFor();
  await page.evaluate(() => {
    window.webkitSpeechRecognition = window.testRecognition;
    window.apiMode = true;
    window.renderSpeech();
  });
  await begin();
  await main.getByText('正在听，请说话…', { exact: true }).waitFor();
  await page.evaluate(() => window.emitResult([['/new ', true]]));
  await page.waitForFunction(() => window.drafts.main.text.includes('/new '));
  assert.deepEqual(await page.evaluate(() => window.panels), []);
  await page.evaluate(() => window.latestRecognition().onend?.());
  checks.push(
    'unsupported-browser fallback, prefixed API and AgentChat text entry without slash-command execution',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.getElementById('speech-side').hidden = true;
    document.getElementById('speech-main').style.width = '100%';
    document.querySelector('.speech-test-grid').style.padding = '8px';
    document.documentElement.dataset.theme = 'dark';
  });
  await begin();
  await page.evaluate(() => window.emitResult([['手机语音识别中的预览文字', false]]));
  await main.getByText('手机语音识别中的预览文字', { exact: true }).waitFor();
  assert.equal(
    await main.locator('.speech-feedback').evaluate((el) => getComputedStyle(el).paddingTop),
    '10px',
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#speech-main .speech-button')).color ===
      'rgb(207, 85, 85)',
  );
  await page.screenshot({ path: fileURLToPath(new URL('mobile-listening.png', out)) });
  const box = await mic.or(finish).boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
    false,
  );
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.screenshot({ path: fileURLToPath(new URL('mobile-light.png', out)) });
  await main.getByRole('button', { name: '取消听写' }).click();
  checks.push('390px light/dark layout keeps microphone, text preview and stop controls visible');

  await page.clock.install();
  await begin();
  await finish.click();
  await page.clock.fastForward(5100);
  await main.getByText(/未确认的片段已舍弃/).waitFor();
  await begin();
  await page.clock.fastForward(120100);
  assert.ok(await page.evaluate(() => window.latestRecognition().stops > 0));
  await page.clock.fastForward(5100);
  await mic.waitFor();
  checks.push('recording deadline and missing-browser-end watchdog terminate listening');

  assert.deepEqual(errors, []);
  await writeFile(
    new URL('verification.json', out),
    JSON.stringify(
      { checks, errors, realMicrophone: false, realRecognitionService: false },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
