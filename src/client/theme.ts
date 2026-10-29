/**
 * Live color-scheme access for surfaces that cannot consume DSH token colors
 * directly.
 *
 * Mol* needs a concrete `light`/`dark` decision, but the shell flips scheme at
 * runtime: the layout presenter projects the user's choice onto
 * `html { color-scheme }` and `body[data-ds-dark-theme]`. This mirrors the
 * detection the host's own terminal/editor use (see
 * `dsh-better-sidebar/src/client/theme.ts`) so our viewer flips in place
 * instead of freezing in whatever scheme it happened to mount under.
 */

/** The viewer theme, matching `@molstudio/react`'s `StudioTheme`. */
export type ViewerTheme = "light" | "dark";

/**
 * Whether the shell resolved to the dark scheme.
 *
 * `html { color-scheme }` is set together with the body palette attribute, so
 * a set `color-scheme` means the decision is authoritative — an absent
 * `data-ds-dark-theme` attribute is then LIGHT even when the OS prefers dark,
 * because the user chose light. Before the presenter has run, the OS media
 * query is the best available guess.
 */
export function isDarkScheme(doc: Document | undefined = globalThis.document): boolean {
  if (doc === undefined) return true;
  const decided = doc.documentElement.style.colorScheme !== "";
  if (decided) return doc.body?.hasAttribute("data-ds-dark-theme") ?? false;
  return typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
}

/** {@link isDarkScheme} as a `StudioTheme`. */
export function resolveTheme(doc?: Document): ViewerTheme {
  return isDarkScheme(doc) ? "dark" : "light";
}

/**
 * Subscribe to scheme flips (the presenter toggles the body attribute and
 * `html.style.color-scheme`). The callback fires after the change; re-read the
 * scheme inside it.
 *
 * @returns the disposer.
 */
export function subscribeColorScheme(callback: () => void, doc: Document | undefined = globalThis.document): () => void {
  if (doc === undefined || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() => {
    callback();
  });
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["style", "data-ds-dark-theme"],
  });
  if (doc.body !== null) {
    observer.observe(doc.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
  }
  return () => {
    observer.disconnect();
  };
}
