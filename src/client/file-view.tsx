/**
 * The components a registered bio file viewer renders.
 *
 * They live together because they are all leaf renderers of a payload the
 * descriptor's `load()` already produced; keeping them in one file also keeps
 * the module's export surface component-only, which is what React Fast Refresh
 * needs.
 *
 * Every payload variant carries a `kind` discriminant, so there is exactly one
 * render path: `BioViewer` narrows the union and `loadIntoStudio` dispatches it.
 * Marker models used to need a special pane here; now that `@molstudio/core`
 * owns marker rendering they are an ordinary payload.
 */
import { createElement, type ReactNode } from "react";
import { parseOpenTarget, structureTitle } from "../shared/opens";
import type { ViewerPayload } from "./payload";
import { BioViewer } from "./studio";
import { useViewerTheme } from "./use-theme";

/** A plain, token-styled message panel — never a blank pane. */
export function BioNotice(props: { readonly title: string; readonly body: string }): ReactNode {
  return createElement(
    "div",
    { className: "dsh-bioviewer-notice", role: "status" },
    createElement("strong", null, props.title),
    createElement("span", null, props.body),
  );
}

export interface BioFileViewProps {
  /**
   * The value the descriptor's `load()` resolved to. The host only renders this
   * component after a successful load, but a defensive branch keeps a host
   * contract change from producing a blank pane.
   */
  readonly payload: ViewerPayload | undefined;
  /** Path the host asked for, used in the fallback notice. */
  readonly path: string;
}

export function BioFileView(props: BioFileViewProps): ReactNode {
  const theme = useViewerTheme();
  const { payload } = props;
  if (payload === undefined) {
    return createElement(BioNotice, {
      title: "No data loaded",
      body: `The viewer did not receive any bytes for ${props.path}.`,
    });
  }
  return createElement(BioViewer, { payload, theme });
}

/**
 * The pane for a structure the agent asked to open (`pdb:1cbs`, …).
 *
 * The tab carries the accession in `tab.path` — the only field a component tab
 * receives that survives a reload — so it is parsed back with the same
 * `parseOpenTarget` the tool used. One parser, so the two halves cannot disagree
 * about what an address means.
 */
export function StructureTabView(props: { readonly path: string | undefined }): ReactNode {
  const theme = useViewerTheme();
  const parsed =
    props.path === undefined
      ? { kind: "invalid" as const, reason: "the tab has no address" }
      : parseOpenTarget(props.path);
  if (parsed.kind !== "structure") {
    return createElement(BioNotice, {
      title: "Unknown structure",
      body:
        parsed.kind === "invalid"
          ? `This tab does not name a database structure: ${parsed.reason}.`
          : "This tab does not name a database structure.",
    });
  }
  return createElement(BioViewer, {
    payload: {
      kind: "structure",
      source: parsed.source,
      id: parsed.id,
      title: structureTitle(parsed.source, parsed.id),
    },
    theme,
  });
}
