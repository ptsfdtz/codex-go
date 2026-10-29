import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import ini from 'highlight.js/lib/languages/ini';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import cpp from 'highlight.js/lib/languages/cpp';

for (const [name, language] of Object.entries({
  javascript,
  typescript,
  rust,
  python,
  json,
  yaml,
  bash,
  css,
  xml,
  markdown,
  ini,
  sql,
  go,
  cpp,
}))
  hljs.registerLanguage(name, language);
const languages: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  rs: 'rust',
  py: 'python',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  scss: 'css',
  html: 'xml',
  svg: 'xml',
  xml: 'xml',
  md: 'markdown',
  mdx: 'markdown',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  go: 'go',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
};
export const escapeCode = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Balance highlighter spans on every line so rows can be rendered independently. */
export function highlightLines(text: string, path: string): { lines: string[]; language: string } {
  const language =
    languages[path.split('.').pop()?.toLowerCase() || ''] ||
    (path.endsWith('Dockerfile') ? 'bash' : 'text');
  const normalized = text.replace(/\r\n/g, '\n');
  if (
    language === 'text' ||
    normalized.length > 120_000 ||
    normalized.split('\n').some((line) => line.length > 10_000)
  )
    return { lines: normalized.split('\n').map(escapeCode), language };
  let html: string;
  try {
    html = hljs.highlight(normalized, { language, ignoreIllegals: true }).value;
  } catch {
    return { lines: normalized.split('\n').map(escapeCode), language: 'text' };
  }
  const stack: string[] = [],
    lines: string[] = [];
  let line = '';
  for (const token of html.split(/(<span\b[^>]*>|<\/span>|\n)/g)) {
    if (token === '\n') {
      lines.push(line + '</span>'.repeat(stack.length));
      line = stack.join('');
    } else {
      line += token;
      if (token.startsWith('<span')) stack.push(token);
      else if (token === '</span>') stack.pop();
    }
  }
  lines.push(line);
  return { lines, language };
}
