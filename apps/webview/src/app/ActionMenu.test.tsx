import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ActionMenu } from "./ActionMenu";
afterEach(cleanup);
it("supports arrow navigation and Escape focus restoration without swallowing input focus", () => {
  const close = vi.fn<() => void>();
  const { rerender } = render(
    <>
      <button>Open</button>
      <input aria-label="Search" />
    </>,
  );
  screen.getByText("Open").focus();
  rerender(
    <>
      <button>Open</button>
      <input aria-label="Search" />
      <ActionMenu x={0} y={0} onClose={close}>
        <button role="menuitem">First</button>
        <button role="menuitem" disabled>
          Unavailable
        </button>
        <button role="menuitem">Last</button>
      </ActionMenu>
    </>,
  );
  expect(screen.getByText("First")).toHaveFocus();
  fireEvent.keyDown(screen.getByText("First"), { key: "ArrowDown" });
  expect(screen.getByText("Last")).toHaveFocus();
  fireEvent.keyDown(screen.getByText("Last"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  rerender(
    <>
      <button>Open</button>
      <input aria-label="Search" />
    </>,
  );
  expect(screen.getByText("Open")).toHaveFocus();
  close.mockClear();
  rerender(
    <>
      <button>Open</button>
      <input aria-label="Search" />
      <ActionMenu x={0} y={0} onClose={close}>
        <button role="menuitem">First</button>
      </ActionMenu>
    </>,
  );
  fireEvent.pointerDown(screen.getByRole("textbox"));
  screen.getByRole("textbox").focus();
  rerender(
    <>
      <button>Open</button>
      <input aria-label="Search" />
    </>,
  );
  expect(screen.getByRole("textbox")).toHaveFocus();
});
