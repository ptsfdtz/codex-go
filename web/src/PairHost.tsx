import { useEffect, useRef, useState } from 'react';
import { randomToken } from './cloud';
import { parseInvitation, invitationFromImage } from './pairing';
import { hostPost } from './transport/host';
import { saveGrant, type HostGrant } from './host-book';

export function PairHost({
  hostId,
  scope,
  onPaired,
  onCancel,
}: {
  hostId: string;
  scope: string;
  onPaired: (grant: HostGrant) => void;
  onCancel: () => void;
}) {
  const [invitation, setInvitation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  async function pair() {
    setBusy(true);
    setError('');
    try {
      const qr = parseInvitation(invitation, hostId, scope);
      const pending = await hostPost<{
        code: string;
        expiresAt: string;
        requestId: string;
        claimToken: string;
      }>(hostId, qr.fingerprint, '/api/v1/pair/request', {
        token: qr.token,
        displayName: 'AgentDeck Web',
        nonce: randomToken(),
      });
      if (cancelled.current) return;
      if (
        !/^\d{6}$/.test(pending.code) ||
        !pending.requestId ||
        !/^[A-Za-z0-9_-]{43}$/.test(pending.claimToken) ||
        !Number.isFinite(Date.parse(pending.expiresAt)) ||
        Date.parse(pending.expiresAt) <= Date.now()
      )
        throw new Error('电脑返回了无效的配对核对信息');
      setCode(pending.code);
      while (!cancelled.current && Date.parse(pending.expiresAt) > Date.now()) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cancelled.current) return;
        const result = await hostPost<{ status: string; hostId: string; credential: string }>(
          hostId,
          qr.fingerprint,
          '/api/v1/pair/claim',
          {
            requestId: pending.requestId,
            claimToken: pending.claimToken,
          },
        );
        if (cancelled.current) return;
        if (result.status === 'rejected') throw new Error('电脑拒绝了配对请求');
        if (result.status === 'approved') {
          if (result.hostId !== hostId || !/^[A-Za-z0-9_-]{43}$/.test(result.credential))
            throw new Error('配对结果身份不匹配');
          const grant = { hostId, fingerprint: qr.fingerprint, credential: result.credential };
          await saveGrant(scope, grant);
          if (!cancelled.current) onPaired(grant);
          return;
        }
        if (result.status !== 'pending') throw new Error('配对状态无效');
      }
      if (!cancelled.current) throw new Error('配对已过期，请重新生成邀请码');
    } catch (error) {
      if (!cancelled.current)
        setError(error instanceof Error ? error.message : '配对失败，请重新生成邀请码');
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  }
  return (
    <div className="pair-panel">
      <h2>授权此浏览器</h2>
      <p>在电脑端生成公网配对信息并粘贴到这里。连接后请在电脑端核对六位码并批准。</p>
      <label>
        导入二维码图片（也可用手机相机拍摄）
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              const text = await invitationFromImage(file);
              parseInvitation(text, hostId, scope);
              if (!cancelled.current) setInvitation(text);
            } catch (error) {
              if (!cancelled.current) setError(String(error));
            } finally {
              if (!cancelled.current) setBusy(false);
            }
          }}
        />
      </label>
      <textarea
        aria-label="公网配对信息"
        value={invitation}
        onChange={(event) => setInvitation(event.target.value)}
        disabled={busy}
        placeholder="粘贴配对 JSON"
      />
      {code && <p className="pair-code">核对码：{code}</p>}
      {error && <p className="error">{error}</p>}
      <button disabled={busy || !invitation.trim()} onClick={() => void pair()}>
        {busy ? '等待电脑批准…' : '请求配对'}
      </button>
      <button
        className="ghost"
        onClick={() => {
          cancelled.current = true;
          onCancel();
        }}
      >
        取消
      </button>
    </div>
  );
}
