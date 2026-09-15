import {
  AlertTriangle,
  ArrowUpCircle,
  Ban,
  BellOff,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Info,
  LoaderCircle,
  type LucideIcon,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ROW_STATUS_LABEL, type RowStatus } from './eligibility';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'default' | 'quiet' | 'danger';
  size?: 'md' | 'sm';
  icon?: LucideIcon;
};

export function Button({ variant = 'default', size = 'md', icon: IconComponent, className = '', children, ...props }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...props}>
      {IconComponent && <IconComponent size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: IconComponent,
  size = 18,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; size?: number }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      <IconComponent size={size} aria-hidden="true" />
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** A settings line: title and explanation on the left, the control on the right. */
export function SettingRow({
  title,
  hint,
  children,
  indent,
  disabled,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  indent?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`setting-row ${indent ? 'indent' : ''} ${disabled ? 'disabled' : ''}`}>
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  indent,
  disabled,
}: {
  title: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  indent?: boolean;
  disabled?: boolean;
}) {
  return (
    <SettingRow title={title} hint={hint} indent={indent} disabled={disabled}>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </SettingRow>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" className="checkbox" checked={checked} onChange={onChange} aria-label={label} disabled={disabled} />;
}

/** A row of mutually exclusive choices; arrow keys move between them. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T | undefined;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const pos = enabled.indexOf(index);
    const next = enabled[(pos + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]!;
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  };
  const focusable = options.some((o) => o.value === value) ? value : options.find((o) => !o.disabled)?.value;
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={focusable === o.value ? 0 : -1}
          className={value === o.value ? 'active' : ''}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const BANNER_ICON = { info: Info, warn: AlertTriangle, error: Ban, ok: CheckCircle2 } as const;

export function Banner({
  tone,
  title,
  children,
  actions,
  onClose,
}: {
  tone: keyof typeof BANNER_ICON;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  const IconComponent = BANNER_ICON[tone];
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <IconComponent size={18} className="banner-icon" aria-hidden="true" />
      <div className="banner-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {actions && <div className="banner-actions">{actions}</div>}
      {onClose && <IconButton label="Dismiss" icon={X} size={16} onClick={onClose} />}
    </div>
  );
}

const STATUS_ICON: Record<RowStatus, LucideIcon> = {
  update: ArrowUpCircle,
  current: CheckCircle2,
  verify: AlertTriangle,
  missing: CircleDashed,
  failed: AlertTriangle,
  off: BellOff,
};

/** The single status marker on a row: an icon and a word, never colour alone. */
export function StatusMarker({ status, checking }: { status: RowStatus; checking?: boolean }) {
  const IconComponent = checking ? LoaderCircle : STATUS_ICON[status];
  return (
    <span className={`status status-${status}`} title={checking ? 'Being checked now' : undefined}>
      <IconComponent size={16} className={checking ? 'spin' : undefined} aria-hidden="true" />
      {ROW_STATUS_LABEL[status]}
      {checking && <span className="visually-hidden"> (checking)</span>}
    </span>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = '',
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`disclosure ${open ? 'open' : ''} ${className}`}>
      <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronRight size={16} className="chevron" aria-hidden="true" />
        {summary}
      </button>
      {open && (
        <div id={id} className="disclosure-body">
          {children}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}

/** A "⋯" button with a small in-app menu. Escape or a click outside closes it; arrow keys move. */
export function MenuButton({ label, items, icon = MoreHorizontal }: { label: string; items: MenuItem[]; icon?: LucideIcon }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const IconComponent = icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onHidden = (): void => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onHidden);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onHidden);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const entries = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    entries[(index + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconComponent size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu" onKeyDown={onMenuKey}>
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {ItemIcon && <ItemIcon size={15} aria-hidden="true" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The WhimWatch mark: a "w" whose last stroke becomes a magnifying glass (the app icon's shapes, build/icon.svg). */
export function LogoMark({ size = 28 }: { size?: number }) {
  const inner = Math.round(size * 0.72);
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={inner} height={inner} viewBox="140 97 740 740" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M196 432 L296 724 L404 508 L512 724 L662 422" strokeWidth="84" />
        <circle cx="712" cy="322" r="112" strokeWidth="84" />
      </svg>
    </span>
  );
}
