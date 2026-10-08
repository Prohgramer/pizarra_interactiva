import { useEffect } from 'react';
import type { Notice } from '../hooks/useNotice';

const TOAST_DURATION_MS = 4000;

interface ToastProps {
  notice: Notice | null;
  onDismiss: () => void;
}

export function Toast({ notice, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {notice && (
        <div key={notice.id} className="toast">
          {notice.text}
        </div>
      )}
    </div>
  );
}
