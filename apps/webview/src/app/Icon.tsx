/** The same Codicon glyphs used by VS Code's workbench. */
export function Icon({ name }: { name: string }) {
  const [glyph, modifier] = name.split("~");
  return (
    <span
      className={`codicon codicon-${glyph}${modifier === "spin" ? " codicon-modifier-spin" : ""}`}
      aria-hidden="true"
    />
  );
}
