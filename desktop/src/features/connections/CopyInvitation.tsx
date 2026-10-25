import { useState } from 'react';
import type { Invitation } from '../../bridge/host';

export function CopyInvitation({ invitation }: { invitation: Invitation }) {
  const [status, setStatus] = useState('');
  const [fallback, setFallback] = useState(false);
  const { image: _image, ...payload } = invitation;
  const text = JSON.stringify(payload);
  return (
    <div>
      <button
        className="text-button"
        onClick={async () => {
          if (Date.parse(invitation.expiresAt) <= Date.now()) {
            setStatus('配对信息已过期，请重新生成');
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            setStatus('已复制，请在 Web 配对页粘贴并核对六位码');
            setFallback(false);
          } catch {
            setFallback(true);
            setStatus('剪贴板不可用，请选中下方信息手动复制');
          }
        }}
      >
        复制公网配对信息
      </button>
      {status && <p role="status">{status}</p>}
      {fallback && (
        <textarea
          aria-label="公网配对信息"
          readOnly
          value={text}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}
