/**
 * The components a registered bio file viewer renders.
 *
 * They live together because they are all leaf renderers of a payload the
 * descriptor's `load()` already produced; keeping them in one file also keeps
 * the module's export surface component-only, which is what React Fast Refresh
 * needs (the pure `.cmm` parser therefore lives in `./cmm.ts`).
 *
 * `BioFileView` exists so the theme hook can wrap `BioViewer` while the
 * descriptor itself stays a plain function: better-sidebar calls
 * `descriptor.component` on every render of the editor host, and hooks may only
 * run inside a component.
 */
import { createElement, type ReactNode } from "react";
import { isMarkerPayload, type MarkerPayload } from "./cmm";
import type { BioViewerPayload } from "./payload";
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
  readonly payload: BioViewerPayload | undefined;
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
 * The `.cmm` pane: what the file contains, and why there is no 3D view yet.
 */
export function MarkerNotice(props: { readonly payload: MarkerPayload | undefined }): ReactNode {
  const { payload } = props;
  if (payload === undefined) {
    return createElement(BioNotice, {
      title: "No marker data",
      body: "The marker model could not be read.",
    });
  }
  const { summary } = payload;
  const rows: string[] = [
    `${summary.markers.length} marker${summary.markers.length === 1 ? "" : "s"}`,
    `${summary.links.length} link${summary.links.length === 1 ? "" : "s"}`,
  ];
  if (summary.skipped > 0) rows.push(`${summary.skipped} entr${summary.skipped === 1 ? "y" : "ies"} skipped`);

  return createElement(
    "div",
    { className: "dsh-bioviewer-notice", role: "status" },
    createElement("strong", null, summary.setName ?? "Marker model"),
    createElement("span", null, rows.join(" · ")),
    createElement(
      "span",
      null,
      "3D marker rendering is not implemented yet, so these points are not drawn over the viewport. The file was parsed successfully — this is a viewer limitation, not a problem with the file.",
    ),
  );
}

/**
 * Render whatever a bio viewer's `load()` resolved to.
 *
 * The compressed-file sniffer serves every format, so its component cannot know
 * statically whether it will receive a Mol* payload or a marker summary; it
 * dispatches on the payload shape instead.
 */
export function BioPayloadView(props: { readonly payload: unknown; readonly path: string }): ReactNode {
  if (isMarkerPayload(props.payload)) return createElement(MarkerNotice, { payload: props.payload });
  return createElement(BioFileView, {
    payload: props.payload as BioViewerPayload | undefined,
    path: props.path,
  });
}
