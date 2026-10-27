export function DiffText({ text }: { text: string }) {
  return (
    <pre className="diff-text">
      <code className="diff-lines">
        {text.split('\n').map((line, index) => (
          <span
            key={index}
            className={
              line.startsWith('+')
                ? 'diff-add'
                : line.startsWith('-')
                  ? 'diff-remove'
                  : line.startsWith('@@')
                    ? 'diff-hunk'
                    : ''
            }
          >
            <i>{index + 1}</i>
            {line}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}
