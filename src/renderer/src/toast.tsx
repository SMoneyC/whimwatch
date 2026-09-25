import { X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { IconButton } from './ui';

export interface ToastOptions {
  text: ReactNode;
  action?: { label: string; run: () => void };
  tone?: 'info' | 'error';
  /** Milliseconds; toasts with an action stay a little longer. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id)), []);
  const show = useCallback(
    (options: ToastOptions) => {
      const id = next.current++;
      setToasts((prev) => [...prev.slice(-2), { ...options, id }]);
      setTimeout(() => dismiss(id), options.duration ?? (options.action ? 8000 : 5000));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="region" aria-label={t().common.notifications} aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'toast-error' : ''}`}>
            <span className="toast-text">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action!.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <IconButton label={t().common.dismiss} icon={X} size={14} onClick={() => dismiss(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (options: ToastOptions) => void {
  return useContext(ToastContext);
}
