import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  width?: number | "anchor";
  role?: "menu" | "dialog" | "listbox";
  label?: string;
  className?: string;
}

/** Floating panel anchored to an element; closes on outside click or Escape. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  placement = "bottom-start",
  width,
  role = "dialog",
  label,
  className,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number }>({ top: -9999, left: -9999 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = width === "anchor" ? a.width : (width ?? el.offsetWidth);
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = placement.startsWith("top") ? a.top - h - 6 : a.bottom + 6;
      if (placement.startsWith("bottom") && top + h > vh - 8 && a.top - h - 6 > 8) top = a.top - h - 6;
      if (placement.startsWith("top") && top < 8) top = a.bottom + 6;
      let left = placement.endsWith("end") ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      top = Math.max(8, Math.min(top, vh - h - 8));
      setPos({ top, left, width: width === undefined ? undefined : w });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, placement, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        anchor.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is always dialog, menu or listbox, all of which accept aria-label
    <div
      ref={ref}
      className={["popover", className].filter(Boolean).join(" ")}
      role={role}
      aria-label={label}
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  shortcut?: string;
}

/** A menu with arrow-key navigation. */
export function Menu({
  items,
  onClose,
}: {
  items: (MenuItem | "sep" | { group: string })[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: roving arrow-key focus for the menu items inside
    <div
      ref={ref}
      onKeyDown={(e) => {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          els[(i + 1) % els.length]?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          els[(i - 1 + els.length) % els.length]?.focus();
        } else if (e.key === "Home") {
          els[0]?.focus();
        } else if (e.key === "End") {
          els[els.length - 1]?.focus();
        }
      }}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static separators
          <hr key={`sep-${i}`} className="menu-sep" />
        ) : "group" in it ? (
          <div key={`g-${it.group}`} className="menu-group">
            {it.group}
          </div>
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: menu items are static per render
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item${it.danger ? " menu-item--danger" : ""}`}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon}
            <span className="grow">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
