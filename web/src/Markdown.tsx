import { createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageImage, type MessageImageSource } from './features/message-images/MessageImage';

const MessageImages = createContext<MessageImageSource | undefined>(undefined);
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
  return (
    <MessageImages.Provider value={images}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => url}
        components={{
          a: ({ href, children }) =>
            href && /^(https?:\/\/|mailto:)/i.test(href) ? (
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
            ),
          img: MarkdownImage,
        }}
      >
        {text}
      </ReactMarkdown>
    </MessageImages.Provider>
  );
}
