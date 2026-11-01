import { math } from 'micromark-extension-llm-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Code, Construct, Extension, State, Tokenizer } from 'micromark-util-types';
import type { Plugin } from 'unified';

const dollar = 36;
const backslash = 92;
const isSpace = (code: Code) => code !== null && (code < 0 || code === 32);
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57;

// Pandoc-style boundaries keep prices such as "$50 and $100" as prose.
// Parse at the Markdown tokenizer level so code and link destinations stay intact.
const tokenizeSingleDollar: Tokenizer = function (effects, ok, nok) {
  let previous: Code = null;
  let braces = 0;

  const start: State = (code) => {
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    effects.exit('mathTextSequence');
    return open;
  };
  const open: State = (code) => {
    if (code === null || isSpace(code) || code === dollar || code === 96) return nok(code);
    effects.enter('mathTextData');
    return content(code);
  };
  const content: State = (code) => {
    // Single-dollar spans never consume another paragraph or a code span.
    if (code === null || code < -2 || code === 96) return nok(code);
    if (code === dollar) {
      if (isSpace(previous) || braces !== 0) return nok(code);
      effects.exit('mathTextData');
      effects.enter('mathTextSequence');
      effects.consume(code);
      return close;
    }
    if (code === backslash) {
      effects.consume(code);
      return escaped;
    }
    if (code === 123) braces++;
    if (code === 125 && --braces < 0) return nok(code);
    previous = code;
    effects.consume(code);
    return content;
  };
  const escaped: State = (code) => {
    if (code === null || code < -2) return nok(code);
    previous = code;
    effects.consume(code);
    return content;
  };
  const close: State = (code) => {
    if (code === dollar || isDigit(code)) return nok(code);
    effects.exit('mathTextSequence');
    effects.exit('mathText');
    return ok(code);
  };
  return start;
};

const singleDollar: Construct = {
  name: 'chatSingleDollarMath',
  tokenize: tokenizeSingleDollar,
  previous(code) {
    return code !== dollar || this.events.at(-1)?.[1].type === 'characterEscape';
  },
};

// The same TeX-aware micromark extension is used by LibreChat. Unlike replacing
// delimiters in the source string, it respects Markdown's code/escape boundaries.
export const remarkChatMath: Plugin = function () {
  const data = this.data() as {
    micromarkExtensions?: Extension[];
    fromMarkdownExtensions?: ReturnType<typeof mathFromMarkdown>[];
  };
  (data.micromarkExtensions ??= []).push(math({ singleDollarTextMath: false }), {
    text: { [dollar]: singleDollar },
  });
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
};
