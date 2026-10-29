import { useSyncExternalStore } from "react";
import { resolveTheme, subscribeColorScheme, type ViewerTheme } from "./theme";

const subscribe = (onChange: () => void): (() => void) => subscribeColorScheme(onChange);
const getSnapshot = (): ViewerTheme => resolveTheme();

/**
 * The shell's live color scheme as a viewer theme.
 *
 * Mol* cannot consume DSH token colors, so it needs a concrete decision that
 * follows the shell when the user flips scheme. `resolveTheme` returns a
 * primitive, so `useSyncExternalStore`'s identity check is a value comparison
 * and the hook re-renders only on an actual flip.
 */
export function useViewerTheme(): ViewerTheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => "dark");
}
