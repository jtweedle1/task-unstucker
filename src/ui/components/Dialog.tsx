import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: 'sheet' | 'center';
  /** Hide the visible heading but keep it for screen readers. */
  hideTitle?: boolean;
}

/** Native <dialog>: focus trapping, Escape to close, and inert background for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  variant = 'sheet',
  hideTitle,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The native close event also fires when we close the dialog ourselves; only report
  // closes the parent didn't ask for, so onClose never runs after a deliberate choice.
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={variant === 'sheet' ? 'sheet' : 'sheet center'}
      aria-labelledby={titleId}
      onClose={() => {
        if (openRef.current) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // tap on backdrop
      }}
    >
      {open && (
        <>
          <h2 id={titleId} className={hideTitle ? 'visually-hidden' : undefined}>
            {title}
          </h2>
          {children}
        </>
      )}
    </dialog>
  );
}
