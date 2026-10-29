/**
 * Viewer language: follow the DSH host, remember an in-viewer override.
 *
 * `@molstudio/react` ships `en` and `zh-CN` (`CATALOGS` in i18n.ts). `<Studio>`
 * defaults to `"en"` and only shows the language menu when `onLocaleChange` is
 * passed — the host is expected to persist the choice (Studio.tsx:47-48).
 *
 * DSH writes the active locale onto `<html lang>` (dsh-client-locale: the
 * preference, else a navigator match). That is the same live-DOM pattern as
 * `theme.ts`, so this module never reads `ctx.locale` at apply time.
 */

/** MolStudio's built-in catalogs. Unknown host tags fall back to English. */
export type StudioLocale = "en" | "zh-CN";

/** localStorage key for a language picked in the viewer menu. */
export const LOCALE_STORAGE_KEY = "dsh-bioviewer.locale";

/**
 * Map any BCP 47 tag onto a MolStudio catalog.
 *
 * DSH's built-in ids are `zh` / `en`; language packs may write a full tag into
 * `<html lang>`. MolStudio's menu compares against catalog ids (`en`, `zh-CN`),
 * so `zh` has to become `zh-CN` or neither radio looks selected.
 */
export function catalogLocale(tag: string): StudioLocale {
  const language = tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  return language === "zh" ? "zh-CN" : "en";
}

/**
 * The shell's current language id, from `<html lang>` then `navigator`.
 *
 * An empty `lang` means the presenter has not run yet, so the browser language
 * is the same provisional guess DSH itself uses before the Host preference
 * arrives.
 */
export function hostLanguage(
  doc: Document | undefined = globalThis.document,
  nav: { readonly language?: string } | undefined = globalThis.navigator,
): string {
  const lang = doc?.documentElement.lang?.trim();
  if (lang) return lang;
  const browser = nav?.language?.trim();
  if (browser) return browser;
  return "en";
}

/**
 * Subscribe to DSH language flips (`<html lang>`). The callback fires after
 * the change; re-read {@link hostLanguage} inside it.
 */
export function subscribeHostLanguage(
  callback: () => void,
  doc: Document | undefined = globalThis.document,
): () => void {
  if (doc === undefined || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() => {
    callback();
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => {
    observer.disconnect();
  };
}

/** A viewer-menu override, or `null` to keep following the host. */
export function readLocaleOverride(storage: Pick<Storage, "getItem"> | undefined = storageOrUndefined()): string | null {
  if (storage === undefined) return null;
  try {
    const value = storage.getItem(LOCALE_STORAGE_KEY);
    return value !== null && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Persist a catalog id chosen in the language menu. */
export function writeLocaleOverride(
  locale: StudioLocale,
  storage: Pick<Storage, "setItem"> | undefined = storageOrUndefined(),
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private mode and missing storage are equivalent: the menu still works
    // for this mount, it just will not survive a reload.
  }
}

function storageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
