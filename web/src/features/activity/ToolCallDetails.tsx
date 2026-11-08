import { useState } from 'react';
import { t } from '../../i18n';
import { toolPresentation } from './tool-presentation';

function Output({ value }: { value: unknown }) {
  const [full, setFull] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return null;
  return (
    <>
      <pre>{full ? text : text.slice(0, 16000)}</pre>
      {text.length > 16000 && (
        <button className="text-button" onClick={() => setFull(!full)}>
          {full ? t('收起') : t('读取完整输出')}
        </button>
      )}
    </>
  );
}

export function ToolCallDetails({ item }: { item: Record<string, unknown> }) {
  const info = toolPresentation(item);
  return (
    <div className="tool-call-details">
      {typeof item.durationMs === 'number' && (
        <div className="tool-meta">
          {item.durationMs} {t(' ms')}
        </div>
      )}
      {info.progress && (
        <section>
          <strong>{t('调用进度')}</strong>
          <Output value={info.progress} />
        </section>
      )}
      {info.error && (
        <section className="error">
          <strong>{t('调用失败')}</strong>
          <Output value={info.error} />
        </section>
      )}
      {info.output && (
        <section>
          <strong>{t('调用结果')}</strong>
          <Output value={info.output} />
        </section>
      )}
      {info.structured != null && (
        <section>
          <strong>{t('结构化结果')}</strong>
          <Output value={info.structured} />
        </section>
      )}
      {info.media > 0 && <p>{t('工具返回了 {{p0}} 个媒体内容', { p0: info.media })}</p>}
      {!info.output && info.structured == null && !info.error && !info.media && (
        <p className="muted">
          {info.status === 'running' ? t('等待工具返回结果…') : t('没有可显示的返回内容')}
        </p>
      )}
      {item.arguments !== undefined && (
        <details className="technical-details">
          <summary>{t('调用参数')}</summary>
          <Output value={item.arguments} />
        </details>
      )}
    </div>
  );
}
