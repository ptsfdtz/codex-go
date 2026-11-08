import { t } from '../i18n';
import './loading-placeholder.css';

export function LoadingPlaceholder({ conversation = false }: { conversation?: boolean }) {
  return (
    <div
      className={`loading-placeholder ${conversation ? 'loading-conversation' : 'loading-list'}`}
      role="status"
      aria-busy="true"
    >
      <span className="visually-hidden">
        {conversation ? t('正在读取会话历史…') : t('加载中…')}
      </span>
      <div aria-hidden="true">
        {conversation ? (
          <>
            <div className="loading-bubble" />
            <div className="loading-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="loading-bubble loading-bubble-short" />
            <div className="loading-lines">
              <i />
              <i />
              <i />
            </div>
          </>
        ) : (
          [0, 1, 2].map((row) => (
            <div className="loading-row" key={row}>
              <b />
              <i />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
