import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const MARGIN = 8;

/**
 * A "⋯" button with a dropdown menu. The menu is rendered in a portal with
 * fixed positioning so a scrolling or clipped container (like the clients
 * table) can't cut it off. It opens below the button, or above when there is
 * no room below, and stays inside the viewport.
 */
export function RowMenu({ label = "Actions", children }: { label?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      // The row scrolled out of view: nothing left to anchor to.
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const { offsetWidth: w, offsetHeight: h } = menu;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const below = vh - anchor.bottom - GAP - MARGIN;
      const above = anchor.top - GAP - MARGIN;
      const top = h <= below || below >= above ? anchor.bottom + GAP : Math.max(MARGIN, anchor.top - GAP - h);
      const left = Math.min(Math.max(MARGIN, anchor.right - w), vw - w - MARGIN);
      setPos({ top, left });
    };
    place();
    // The menu is fixed, so follow the button when the page or table scrolls.
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) place();
    };
    addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className="ghost"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
