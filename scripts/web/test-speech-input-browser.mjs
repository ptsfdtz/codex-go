import { fileURLToPath } from 'node:url';
/* global window, document, Event, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = new URL('../../artifacts/speech-input/', import.meta.url);
const fontPath = process.env.COMPOSER_TEST_FONT;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
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
    const reactDom = await import('/node_modules/.vite/deps/react-dom.js');
    const { flushSync } = reactDom.default || reactDom;
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
      flushSync(() =>
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
        ),
      );
    window.renderSpeech();
  }, !!fontPath);
  await page.evaluate(() => document.fonts.ready);
  const main = page.locator('#speech-main'),
    side = page.locator('#speech-side');
  const input = main.getByRole('textbox', { name: '消息', exact: true });
  const settleTheme = () =>
    page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#speech-main textarea')).color ===
        getComputedStyle(document.documentElement).color,
    );

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
  assert.equal(await mic.count(), 1, 'microphone remains available beside the send arrow');
  assert.equal(await main.locator('.send-button').count(), 1);
  await input.fill('');
  await mic.waitFor();
  assert(await send.isDisabled(), 'empty draft keeps a disabled send arrow');
  await page.screenshot({ path: fileURLToPath(new URL('desktop-empty.png', out)) });
  await input.fill('普通文字');
  await send.waitFor();
  assert.equal(await mic.count(), 1);
  await page.screenshot({ path: fileURLToPath(new URL('desktop-send.png', out)) });
  await input.fill('');
  checks.push(
    'microphone remains available for empty and typed drafts; empty send arrow is disabled',
  );
  await begin();
  await finish.waitFor();
  assert(await send.isDisabled(), 'an empty recording has nothing to send');
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
  assert.equal(await page.evaluate(() => window.latestRecognition().lang), 'zh-CN');
  await page.evaluate(() => window.emitResult([['临时文字', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '临时文字',
  );
  await page.evaluate(() => window.emitResult([['临时修正', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '临时修正',
  );
  assert(await send.isEnabled(), 'the recording bar can send the visible draft');
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['还在说', false],
    ]),
  );
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '语音还在说',
  );
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
    ]),
  );
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '语音输入',
  );
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
    ]),
  );
  assert.equal(await input.inputValue(), '语音输入');
  await finish.click();
  assert.equal(await finish.isDisabled(), true);
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
  await page.evaluate(() =>
    window.emitResult([
      ['语音', true],
      ['输入', true],
      ['完成', true],
    ]),
  );
  await page.evaluate(() => window.latestRecognition().onend?.());
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '语音输入完成',
  );
  assert.equal(await input.inputValue(), '语音输入完成');
  assert.deepEqual(await page.evaluate(() => window.sends), []);
  await main.getByRole('button', { name: '发送', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.sends), ['main']);
  checks.push(
    'live draft transcription, interim revisions, cumulative final deduplication and manual sending',
  );
  await input.fill('原有草稿');
  await input.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
  await mic.click();
  await page.evaluate(() => window.emitResult([['本次听写', false]]));
  await page.waitForFunction(() => window.drafts.main.text === '原有草稿本次听写');
  await main.getByRole('button', { name: '取消本次听写', exact: true }).click();
  assert.equal(await input.inputValue(), '原有草稿');
  await begin();
  await page.evaluate(() => window.emitResult([['直接发送', false]]));
  await page.waitForFunction(() => window.drafts.main.text === '直接发送');
  await main
    .locator('.composer-recording')
    .getByRole('button', { name: '发送', exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.sends), ['main', 'main']);
  assert.ok(await page.evaluate(() => window.latestRecognition().aborts > 0));
  checks.push(
    'Cancel restores the prior draft; Send during recording submits only the visible transcription',
  );

  await begin();
  await page.evaluate(() => window.emitResult([['说了但还没确认', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '说了但还没确认',
  );
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
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '新会话',
  );
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
  await page.waitForFunction(
    () => document.querySelector('#speech-side textarea')?.value === '侧边听写',
  );
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
  await page.evaluate(() => window.latestRecognition().onerror?.({ error: 'no-speech' }));
  await mic.waitFor();
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
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
    ['not-allowed', '请允许麦克风权限'],
    ['network', '语音连接失败，请重试'],
    ['audio-capture', '麦克风不可用'],
  ]) {
    await begin();
    await page.evaluate((code) => window.latestRecognition().onerror?.({ error: code }), code);
    await main
      .locator('.composer-speech-status')
      .filter({ hasText: expected })
      .waitFor({ state: 'attached' });
    assert.equal(await main.locator('.speech-error').count(), 0);
    assert.equal(
      await page.evaluate(() => window.latestRecognition().aborts || 0),
      0,
      'A terminal recognition error must not reenter native recognition with abort()',
    );
    assert.equal(await input.inputValue(), '');
  }
  await page.evaluate(() => {
    window.throwOnStart = true;
  });
  await begin();
  await main
    .locator('.composer-speech-status')
    .filter({ hasText: '语音启动失败' })
    .waitFor({ state: 'attached' });
  assert.equal(await main.locator('.speech-error').count(), 0);
  checks.push('concise permission, network, capture and startup errors preserve drafts');

  await page.evaluate(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
    window.renderSpeech();
  });
  await begin();
  await main
    .locator('.composer-speech-status')
    .filter({ hasText: '当前浏览器不支持语音输入' })
    .waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.webkitSpeechRecognition = window.testRecognition;
    window.apiMode = true;
    window.renderSpeech();
  });
  await begin();
  await finish.waitFor();
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
  await page.evaluate(() => window.emitResult([['/new ', true]]));
  await page.waitForFunction(() => window.drafts.main.text.includes('/new '));
  assert.deepEqual(await page.evaluate(() => window.panels), []);
  await page.evaluate(() => window.latestRecognition().onend?.());
  checks.push(
    'unsupported-browser fallback, prefixed API and AgentChat text entry without slash-command execution',
  );

  // A whitespace-only draft keeps the voice action available, allowing a
  // selection insertion to verify that revisions preserve surrounding text.
  await input.fill(' \n ');
  await input.evaluate((node) => node.setSelectionRange(1, 2));
  await mic.click();
  await page.evaluate(() => window.emitResult([['中间', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === ' 中间 ',
  );
  await page.evaluate(() => window.emitResult([['修正后', true]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === ' 修正后 ',
  );
  await page.evaluate(() => window.latestRecognition().onend?.());
  checks.push('selection replacement and live revisions preserve the surrounding draft');

  const actionStyle = async (button) => {
    await page.mouse.move(0, 0);
    return button.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
      const style = getComputedStyle(node);
      return Object.fromEntries(
        ['width', 'height', 'borderWidth', 'borderRadius', 'marginLeft', 'padding'].map((key) => [
          key,
          style[key],
        ]),
      );
    });
  };
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      window.apiMode = false;
      window.renderSpeech();
    }, theme);
    await input.fill('');
    await mic.waitFor();
    const reference = await actionStyle(mic);
    assert.equal(reference.width, '34px');
    assert.equal(reference.height, '34px');
    await mic.click();
    await finish.waitFor();
    const recordingStyle = await actionStyle(finish);
    assert.equal(recordingStyle.width, '44px');
    assert.equal(recordingStyle.height, '44px');
    await page.evaluate(() => window.emitResult([['按钮样式', false]]));
    await page.waitForFunction(
      () => document.querySelector('#speech-main textarea')?.value === '按钮样式',
    );
    await finish.click();
    await page.evaluate(() => window.latestRecognition().onend?.());
    await send.waitFor();
    assert.deepEqual(await actionStyle(send), reference);
    await page.evaluate(() => {
      window.active = true;
      window.renderSpeech();
    });
    const stop = main.getByRole('button', { name: '停止', exact: true });
    const queue = main.getByRole('button', { name: '加入队列', exact: true });
    await stop.waitFor();
    assert.deepEqual(await actionStyle(stop), reference);
    const queueStyle = await actionStyle(queue);
    assert.deepEqual(queueStyle, reference);
    await main.getByRole('button', { name: '添加附件和操作', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: fileURLToPath(new URL(`desktop-actions-${theme}.png`, out)) });
    await page.evaluate(() => {
      window.active = false;
      window.renderSpeech();
    });
  }
  checks.push(
    'voice, finish, send, queue, stop and collapse preserve circular control geometry in both themes',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.getElementById('speech-side').hidden = true;
    document.getElementById('speech-main').style.width = '100%';
    document.querySelector('.speech-test-grid').style.padding = '8px';
    document.documentElement.dataset.theme = 'dark';
  });
  await begin();
  const recording = main.locator('.composer-recording');
  await recording.waitFor();
  const recordingBounds = await recording.boundingBox();
  assert.equal(Math.round(recordingBounds.height), 44);
  assert.equal(await recording.locator('.recording-dots').count(), 1);
  await page.screenshot({ path: fileURLToPath(new URL('mobile-recording-capsule.png', out)) });
  await page.evaluate(() => window.emitResult([['手机语音识别中的预览文字', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '手机语音识别中的预览文字',
  );
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
  await settleTheme();
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
  await settleTheme();
  await page.screenshot({ path: fileURLToPath(new URL('mobile-light.png', out)) });
  await finish.click();
  await page.evaluate(() => window.latestRecognition().onend?.());
  assert.equal(await input.inputValue(), '手机语音识别中的预览文字');
  checks.push('390px light/dark layout writes directly into draft without listening hints');

  await page.clock.install();
  await begin();
  await page.evaluate(() => window.emitResult([['停止后保留', false]]));
  await page.waitForFunction(
    () => document.querySelector('#speech-main textarea')?.value === '停止后保留',
  );
  await finish.click();
  await page.clock.fastForward(5100);
  await send.waitFor();
  assert.equal(await input.inputValue(), '停止后保留');
  assert.equal(await main.locator('.speech-feedback, .speech-error').count(), 0);
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
