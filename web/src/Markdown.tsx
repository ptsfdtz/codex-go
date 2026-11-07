import { createContext, useContext, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { remarkChatMath } from './features/markdown/math';
import 'katex/dist/katex.min.css';
import { MessageImage, type MessageImageSource } from './features/message-images/MessageImage';

const MessageImages = createContext<MessageImageSource | undefined>(undefined);
const FileLinks = createContext<((path: string) => void) | undefined>(undefined);
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const onFile = useContext(FileLinks);
  return href && /^(https?:\/\/|mailto:)/i.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : href &&
    onFile &&
    (!/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(?:file:|[a-z]:[\\/])/i.test(href)) ? (
    <button className="file-link" onClick={() => onFile(href)}>
      {children}
    </button>
  ) : (
    <span>{children}</span>
  );
}
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const source = useContext(MessageImages);
  return <MessageImage src={src} alt={alt} source={source} />;
}

export function Markdown({
  text,
  onFile,
  images,
}: {
  text: string;
  onFile?: (path: string) => void;
  images?: MessageImageSource;
}) {
  // Parse only when the message text changes. Context keeps link handlers and
  // image authorization current without reparsing every completed message.
  const content = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkChatMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore', maxSize: 20 }]]}
        skipHtml
        urlTransform={(url) => url}
        components={{
          a: MarkdownLink,
          img: MarkdownImage,
        }}
      >
        {text}
      </ReactMarkdown>
    ),
    [text],
  );
  return (
    <MessageImages.Provider value={images}>
      <FileLinks.Provider value={onFile}>{content}</FileLinks.Provider>
    </MessageImages.Provider>
  );
}
