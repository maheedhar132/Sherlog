import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** An accessible dialog: Escape closes, Tab stays inside, focus moves in on open and back to where it was on close. */
export function Modal({ label, onClose, className = '', children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((e) => !e.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="overlay" onClick={() => closeRef.current()}>
      <div ref={ref} className={`modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
