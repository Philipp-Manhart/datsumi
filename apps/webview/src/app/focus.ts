/** Move past a composite widget without visiting its internal controls or trapping Tab. */
export function focusOutside(container: HTMLElement, backwards = false): boolean {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      "a[href],button,input,select,textarea,summary,[tabindex]",
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest('[hidden], [inert], dialog:not([open]), [role="menu"]') &&
      getComputedStyle(element).visibility !== "hidden" &&
      (typeof element.checkVisibility !== "function" || element.checkVisibility()),
  );
  const index = candidates.indexOf(container);
  const next = (
    backwards ? candidates.slice(0, index).reverse() : candidates.slice(index + 1)
  ).find((element) => !container.contains(element));
  next?.focus();
  return Boolean(next);
}
