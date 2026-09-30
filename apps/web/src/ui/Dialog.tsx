import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Where focus goes on open; defaults to the first focusable element. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

/** Modal dialog with focus trap, Escape to close and focus restore. */
export function Dialog({ open, onClose, title, children, footer, wide, initialFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first =
      initialFocus?.current ??
      el?.querySelector<HTMLElement>(`.dialog__body ${FOCUSABLE}`) ??
      el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab" && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, initialFocus]);

  if (!open) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a mouse convenience; Escape and the Close button cover keyboard users
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`dialog${wide ? " dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" iconOnly label="Close" icon={<X />} onClick={onClose} />
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
      {children}
    </Dialog>
  );
}
