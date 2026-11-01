import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
const katex = requireWeb('katex');

test('all math rendering paths use the patched KaTeX instance', () => {
  assert.equal(katex.version, '0.18.2');
  for (const dependency of ['rehype-katex', 'micromark-extension-llm-math']) {
    const requireDependency = createRequire(requireWeb.resolve(dependency));
    assert.equal(requireDependency.resolve('katex'), requireWeb.resolve('katex'));
  }
});

test('inherited trust cannot enable links or external images (GHSA-238p-pmpm-9mq7)', () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'trust');
  try {
    Object.defineProperty(Object.prototype, 'trust', {
      value: true,
      writable: true,
      configurable: true,
    });
    for (const expression of [
      String.raw`\href{javascript:alert(1)}{unsafe}`,
      String.raw`\includegraphics{https://invalid.example/tracker.png}`,
    ]) {
      const html = katex.renderToString(expression, { strict: 'ignore', throwOnError: false });
      assert(!/<a\b|<img\b|\bsrc=/i.test(html));
    }
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'trust', previous);
    else delete Object.prototype.trust;
  }
  assert(katex.renderToString(String.raw`\frac{a}{b}`).includes('katex'));
});
