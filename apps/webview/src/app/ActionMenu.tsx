import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { focusOutside } from "./focus";

/** Shared mouse/keyboard menu with VS Code theme tokens and viewport-safe placement. */
export function ActionMenu({
  x,
  y,
  children,
  onClose,
}: {
  x: number;
  y: number;
  children: ReactNode;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const invoker = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
      element.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [x, y]);
  useEffect(() => {
    const previous = document.activeElement;
    invoker.current = previous instanceof HTMLElement ? previous : null;
    restoreFocus.current = true;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !menu.current?.contains(event.target) &&
        !event.target.closest("[data-grid-menu-trigger]")
      ) {
        restoreFocus.current = false;
        onClose();
      }
    };
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("pointerdown", outside);
      if (restoreFocus.current && previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [onClose]);
  return (
    <div
      ref={menu}
      className="cell-context"
      role="menu"
      tabIndex={-1}
      aria-label="Result actions"
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest("button") : null;
        if (target && !target.closest(".column-picker") && !target.hasAttribute("data-keep-open"))
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Tab" && invoker.current) {
            invoker.current.focus();
            focusOutside(invoker.current, event.shiftKey);
            restoreFocus.current = false;
          }
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [
          ...(menu.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), summary, input",
          ) ?? []),
        ].filter((element) => {
          const details = element.closest("details");
          return !details || details.open || element.tagName === "SUMMARY";
        });
        const current = items.indexOf(document.activeElement as HTMLElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }}
    >
      {children}
    </div>
  );
}
