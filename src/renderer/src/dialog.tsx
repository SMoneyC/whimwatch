import { X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../shared/i18n';
import { Button, IconButton } from './ui';

/** Open dialogs, topmost last: only the top one reacts to Escape and keeps focus. */
const stack: string[] = [];

export function dialogOpen(): boolean {
  return stack.length > 0;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: Escape closes it, Tab stays inside, and focus returns to
 * whatever opened it.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  dismissable = true,
  children,
  footer,
  width = 620,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** False while something can't be interrupted (the close button and Escape do nothing). */
  dismissable?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const canClose = useRef(dismissable);
  useEffect(() => {
    close.current = onClose;
    canClose.current = dismissable;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    stack.push(id);
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (stack.at(-1) !== id || !el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (canClose.current) close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [id]);

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div
        ref={ref}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 48px))` }}
      >
        <header className="dialog-head">
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <IconButton label={t().common.close} icon={X} onClick={onClose} disabled={!dismissable} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Cancel by default. */
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

/** In-app replacement for window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions & { resolve: (ok: boolean) => void }>();
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const finish = (ok: boolean): void => {
    pending?.resolve(ok);
    setPending(undefined);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Dialog
          title={pending.title}
          onClose={() => finish(false)}
          width={460}
          footer={
            <>
              <span className="spacer" />
              <Button variant="quiet" onClick={() => finish(false)}>
                {pending.cancelLabel ?? t().common.cancel}
              </Button>
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => finish(true)} data-autofocus>
                {pending.confirmLabel}
              </Button>
            </>
          }
        >
          <div className="muted">{pending.body}</div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  return useContext(ConfirmContext);
}
