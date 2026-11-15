import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";

import { Dropdown } from "./Dropdown";
afterEach(cleanup);
it("supports keyboard selection, type-ahead, Escape, and outside clicks without stealing focus", () => {
  const change = vi.fn<(value: string) => void>();
  render(
    <>
      <input aria-label="Search" />
      <Dropdown
        label="Key type"
        value=""
        onChange={change}
        options={[
          { value: "", label: "All types" },
          { value: "hash", label: "hash" },
          { value: "string", label: "string" },
        ]}
      />
    </>,
  );
  const control = screen.getByRole("combobox", { name: "Key type" });
  control.focus();
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.keyDown(control, { key: "ArrowDown" });
  expect(control).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { name: "hash" }).id,
  );
  fireEvent.keyDown(control, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith("hash");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(control).toHaveFocus();
  fireEvent.keyDown(control, { key: "s" });
  fireEvent.keyDown(control, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith("string");
  fireEvent.click(control);
  fireEvent.keyDown(control, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(control);
  fireEvent.pointerDown(screen.getByLabelText("Search"));
  screen.getByLabelText("Search").focus();
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByLabelText("Search")).toHaveFocus();
});

it("leaves Tab native and disables a dropdown with no choices", () => {
  const { rerender } = render(
    <Dropdown
      label="Engine"
      value="sqlite"
      options={[{ value: "sqlite", label: "SQLite" }]}
      onChange={() => {}}
    />,
  );
  const button = screen.getByRole("combobox");
  button.focus();
  fireEvent.keyDown(button, { key: "Enter" });
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  rerender(<Dropdown label="Engine" value="" options={[]} onChange={() => {}} />);
  expect(button).toBeDisabled();
});
