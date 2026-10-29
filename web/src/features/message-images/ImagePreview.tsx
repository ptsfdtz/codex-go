import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../../ui';
import { MotionPresence } from '../../motion';

/** Shared viewer for already authorized, locally loaded image resources. */
export function ImagePreview({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  onError?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button
        type="button"
        className="message-image-open"
        aria-label={`放大图片 ${alt}`}
        onClick={() => setExpanded(true)}
      >
        <img src={src} alt={alt} onError={onError} />
      </button>
      {createPortal(
        <MotionPresence>
          {expanded && (
            <Modal title={alt} wide onClose={() => setExpanded(false)}>
              <img className="message-image-expanded" src={src} alt={alt} />
            </Modal>
          )}
        </MotionPresence>,
        document.body,
      )}
    </>
  );
}
