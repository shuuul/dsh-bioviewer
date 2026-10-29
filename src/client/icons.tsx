/**
 * Inline SVG icons for the viewer and the browser tab.
 *
 * No icon dependency and no color literals: every glyph draws with
 * `stroke="currentColor"`, so the caller's `color` (a DSH token) decides the
 * paint and skins work without per-theme assets.
 */
import type { ReactElement, ReactNode } from "react";

export interface IconProps {
  /** Width and height in px. Defaults to 16. */
  readonly size?: number;
  readonly className?: string;
  /**
   * Accessible name. Omitted (the default) the icon is decorative: it is
   * hidden from assistive technology, which is what a label next to it wants.
   */
  readonly title?: string;
}

/** Shared SVG frame: 24x24 viewBox, stroked with the inherited color. */
function SvgIcon({ size = 16, className, title, children }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title === undefined ? undefined : "img"}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      {title === undefined ? null : <title>{title}</title>}
      {children}
    </svg>
  );
}

/** The plugin's mark: a ringed atom with three bonds. */
export function BioViewerIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 8.6V4.8M9.1 13.7 5.7 15.9M14.9 13.7l3.4 2.2" />
      <circle cx="12" cy="3.5" r="1.3" />
      <circle cx="4.7" cy="16.9" r="1.3" />
      <circle cx="19.3" cy="16.9" r="1.3" />
    </SvgIcon>
  );
}

/** A file row: document sheet with a folded corner. */
export function FileIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </SvgIcon>
  );
}

/** A directory row. */
export function FolderIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h3.3a2 2 0 0 1 1.5.7l1.1 1.4H18.8A2.2 2.2 0 0 1 21 9.3v7.5A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z" />
    </SvgIcon>
  );
}

/** "Go up one directory": the folder glyph with an upward arrow. */
export function FolderUpIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h3.3a2 2 0 0 1 1.5.7l1.1 1.4H18.8A2.2 2.2 0 0 1 21 9.3v7.5A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z" />
      <path d="M12 16.2v-5.4M9.6 13.2 12 10.8l2.4 2.4" />
    </SvgIcon>
  );
}

/**
 * A rotating arc. The rotation is SMIL, not CSS, so the icon animates without
 * the host having to ship a keyframes rule.
 */
export function SpinnerIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6" />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </SvgIcon>
  );
}

/** A failed operation. */
export function ErrorIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M12 4.4 21 19.6H3z" />
      <path d="M12 10.2v4M12 17.1h.01" />
    </SvgIcon>
  );
}

/** Re-run a failed operation. */
export function RetryIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8" />
      <path d="M20.4 4.6v5.2h-5.2" />
    </SvgIcon>
  );
}

/** Disclosure chevron for a collapsed row. */
export function ChevronRightIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M9.6 6.4 15.2 12l-5.6 5.6" />
    </SvgIcon>
  );
}

/** Dismiss a banner. */
export function CloseIcon(props: IconProps): ReactElement {
  return (
    <SvgIcon {...props}>
      <path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4" />
    </SvgIcon>
  );
}
