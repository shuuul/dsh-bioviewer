import { useCallback, useState, useSyncExternalStore } from "react";
import { t, type CopyKey, type CopyVars } from "./copy";
import {
  catalogLocale,
  hostLanguage,
  readLocaleOverride,
  subscribeHostLanguage,
  writeLocaleOverride,
  type StudioLocale,
} from "./locale";

const subscribe = (onChange: () => void): (() => void) => subscribeHostLanguage(onChange);
const hostCatalog = (): StudioLocale => catalogLocale(hostLanguage());

/**
 * Language for `<Studio>` and plugin chrome: a remembered menu choice,
 * otherwise the DSH host.
 *
 * `onLocaleChange` is always provided so MolStudio shows its language menu.
 * The first argument to that callback is a catalog id (`en` / `zh-CN`).
 */
export function useViewerLocale(): {
  locale: StudioLocale;
  onLocaleChange: (locale: string) => void;
  t: (key: CopyKey, vars?: CopyVars) => string;
} {
  const host = useSyncExternalStore(subscribe, hostCatalog, () => "en");
  const [override, setOverride] = useState<string | null>(readLocaleOverride);
  const locale = catalogLocale(override ?? host);
  const onLocaleChange = useCallback((next: string): void => {
    const catalog = catalogLocale(next);
    writeLocaleOverride(catalog);
    setOverride(catalog);
  }, []);
  const translate = useCallback((key: CopyKey, vars?: CopyVars): string => t(locale, key, vars), [locale]);
  return { locale, onLocaleChange, t: translate };
}
