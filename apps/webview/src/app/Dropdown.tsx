/* oxlint-disable react-perf/jsx-no-new-function-as-prop,react-perf/jsx-no-new-object-as-prop -- Option handlers carry their value and index. */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- A custom listbox avoids the operating system's unthemed select popup. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./Icon";
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [position, setPosition] = useState({ left: 0, top: 0, width: 120, maxHeight: 240 });
  const button = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef({ text: "", at: 0 });
  const id = useId();
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const choose = (index: number) => {
    const option = options[index];
    if (option) {
      onChange(option.value);
      setOpen(false);
      button.current?.focus();
    }
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 8,
        above = rect.top - 8;
      const height = Math.min(240, options.length * 28 + 8);
      const useAbove = below < Math.min(height, 100) && above > below;
      const maxHeight = Math.max(28, Math.min(height, useAbove ? above : below));
      const width = Math.min(window.innerWidth - 8, Math.max(120, rect.width));
      setPosition({
        left: Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)),
        top: useAbove ? Math.max(4, rect.top - maxHeight - 2) : rect.bottom + 2,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !button.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (open)
      popup.current
        ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled || !options.length}
        role="combobox"
        className="vscode-dropdown"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onBlur={() => setOpen(false)}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setActive((previous) =>
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : !open
                    ? selected
                    : (previous + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                      options.length,
            );
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else {
              setActive(selected);
              setOpen(true);
            }
            return;
          }
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const now = Date.now();
            search.current = {
              text:
                (now - search.current.at < 700 ? search.current.text : "") +
                event.key.toLowerCase(),
              at: now,
            };
            const index = options.findIndex((option) =>
              option.label.toLowerCase().startsWith(search.current.text),
            );
            if (index >= 0) {
              setActive(index);
              setOpen(true);
            }
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label ?? options[0]?.label}</span>
        <Icon name="chevron-down" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="listbox"
            aria-label={label}
            className="vscode-dropdown-list"
            style={position}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                tabIndex={-1}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(index);
                  }
                }}
                aria-selected={option.value === value}
                data-option-index={index}
                className={index === active ? "active" : ""}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
