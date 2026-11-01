import { useEffect, useRef, useState } from 'react';
import { errorText, t, useLocale } from '../../i18n';
import type { Bridge, ReceiptCheck } from '../../transport/bridge';
import './receipt-recovery.css';

export function ReceiptRecovery({
  connection,
  connected,
  blocked,
  notice,
  onChecked,
  onDismiss,
}: {
  connection?: Bridge;
  connected: boolean;
  blocked: boolean;
  notice: string;
  onChecked: (message?: string) => void;
  onDismiss: () => void;
}) {
  useLocale();
  const [checks, setChecks] = useState<ReceiptCheck[]>();
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setBusy(false);
    setChecks(undefined);
    setReviewed(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [connection, connected]);
  const canReview =
    checks?.some((check) => check.status === 'unknown' || check.status === 'notFound') &&
    checks.every((check) => ['done', 'unknown', 'notFound'].includes(check.status));
  async function check(confirm = false) {
    if (!connection || !connected || pending.current || (confirm && (!reviewed || !canReview)))
      return;
    const epoch = generation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    setReviewed(false);
    if (!confirm) setChecks(undefined);
    try {
      if (confirm) await connection.acknowledgeReceipts(checks!.map((item) => item.requestId));
      const results = await connection.reconcile();
      if (epoch !== generation.current) return;
      setChecks(results);
      setReviewed(false);
      const rejected = results.find(
        (item) => item.status === 'done' && item.response?.type === 'error',
      );
      onChecked(
        connection.awaitingReceipt
          ? undefined
          : confirm
            ? t('已确认核对，草稿已保留；不会自动重发。')
            : rejected
              ? statusText(rejected)
              : t('核对完成，草稿已保留。请确认结果后再发送。'),
      );
    } catch (cause) {
      if (epoch === generation.current) {
        setError(errorText(cause));
        setChecks(undefined);
      }
    } finally {
      if (epoch === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  if (!blocked)
    return (
      <div className="receipt-recovery receipt-resolved" role="status">
        <span>{notice}</span>
        <button onClick={onDismiss}>{t('关闭提示')}</button>
      </div>
    );
  function statusText(check: ReceiptCheck) {
    switch (check.status) {
      case 'done':
        return check.response?.type === 'error'
          ? t('操作已拒绝：{{p0}}', {
              p0: errorText(check.response.message || check.response.code),
            })
          : t('操作结果已确认');
      case 'pending':
        return t('电脑仍在处理此操作，请稍后再次核对。');
      case 'unknown':
        return t('电脑保存的操作结果不确定，需要人工核对实际结果。');
      case 'notFound':
        return t('电脑未找到此操作回执，需要人工核对实际结果。');
      default:
        return t('未能查询操作结果，请重试；暂时保留发送保护。');
    }
  }
  return (
    <div className="receipt-recovery" role="alert" aria-busy={busy}>
      <div className="receipt-recovery-heading">
        <span>{t('上次操作结果尚未确定。核对前不能继续变更。')}</span>
        <button disabled={!connected || busy} onClick={() => void check()}>
          {busy ? t('正在核对操作结果…') : t('核对操作结果')}
        </button>
      </div>
      {!connected && <p>{t('等待连接电脑后才能核对；恢复连接后请再试。')}</p>}
      {checks && (
        <ul aria-label={t('操作核对结果')}>
          {checks.map((item) => (
            <li key={item.requestId}>
              <span>{statusText(item)}</span>
              <small>{item.requestId}</small>
              {item.message && <small>{errorText(item.message)}</small>}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="status">{error}</p>}
      {canReview && connected && (
        <div className="receipt-review">
          <p>{t('请核对相关会话、队列及电脑上的实际结果。确认只恢复操作，不会重发。')}</p>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>{t('我已核对实际结果，确认可以继续操作')}</span>
          </label>
          <button disabled={!reviewed || busy} onClick={() => void check(true)}>
            {t('确认核对并恢复编辑')}
          </button>
        </div>
      )}
    </div>
  );
}
