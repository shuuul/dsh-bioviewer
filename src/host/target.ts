/**
 * Pure mapping from the `bio_open` tool's `target` argument to the wire
 * request the sidebar receives.
 *
 * This is the part of the tool worth testing on its own: everything here is a
 * function of `(target, title, cwd)` and nothing touches cordis, the tool
 * registry or the filesystem. `./tool.ts` owns the rest.
 *
 * The rules come from the frozen shared contract (`../shared/opens`): the
 * `source:id` prefix decides a database structure, anything else is a path,
 * and a path is only accepted when the format table recognises its extension.
 * The last point is the whole reason this plugin has its own tool — an
 * unsupported file is refused with the list of supported extensions instead of
 * being opened as text.
 *
 * @module dsh-bioviewer/host/target
 */
import { isAbsolute, resolve } from "node:path";
import { detectBioFile } from "../shared/formats";
import {
  parseOpenTarget,
  structureTitle,
  unsupportedPathReason,
  type OpenMode,
  type OpenRequest,
} from "../shared/opens";

/** One resolved `bio_open` target: the wire request plus the tool's reply fields. */
export interface ResolvedOpen {
  /** What the caller asked for, for the tool's canonical value. */
  readonly kind: "file" | "structure";
  /** The request queued for the sidebar. */
  readonly request: OpenRequest;
  /** Canonical target text: the absolute path, or `source:ID`. */
  readonly target: string;
  /** The title the sidebar tab uses. */
  readonly title: string;
}

/**
 * Turn one tool call into the request to queue, or explain why it cannot be.
 *
 * @param target - the raw `target` argument.
 * @param title - the optional caller-supplied title; blank is treated as absent.
 * @param cwd - the calling session's working directory, used for relative paths.
 * @param mode - `"open"` a new tab, or `"add"` into the live viewer.
 * @returns the request plus the canonical fields the tool reports.
 * @throws with a caller-actionable reason for an invalid target, an unsupported
 * extension, or a relative path in a session without a working directory.
 */
export function resolveOpen(
  target: string,
  title: string | undefined,
  cwd: string | undefined,
  mode: OpenMode,
): ResolvedOpen {
  const parsed = parseOpenTarget(target);
  if (parsed.kind === "invalid") throw new Error(parsed.reason);

  const asked = title !== undefined && title.trim() !== "" ? title : undefined;

  if (parsed.kind === "structure") {
    // The id is already normalised to the form its loader expects
    // (`parseOpenTarget` uppercases a PDB id, pads an EMDB one), so the title
    // and the echoed target are built from that, never from the raw argument.
    const resolvedTitle = asked ?? structureTitle(parsed.source, parsed.id);
    return {
      kind: "structure",
      request: { kind: "structure", mode, source: parsed.source, id: parsed.id, title: resolvedTitle },
      target: `${parsed.source}:${parsed.id}`,
      title: resolvedTitle,
    };
  }

  const absolute = absolutePathOf(parsed.path, cwd);
  const detected = detectBioFile(absolute);
  if (detected === undefined) {
    // `unsupportedPathReason` is total here (the detector just said no), but the
    // `??` keeps the message reachable without a non-null assertion.
    throw new Error(unsupportedPathReason(absolute) ?? `"${absolute}" is not a supported biomolecular file`);
  }
  // The tab title drops a trailing `.gz` (the contract's `baseName`): the tab
  // then names what is *inside* the file, while `path` keeps the real name the
  // viewer has to fetch.
  const resolvedTitle = asked ?? detected.baseName;
  return {
    kind: "file",
    request: { kind: "file", mode, path: absolute, title: resolvedTitle, formatId: detected.format.id },
    target: absolute,
    title: resolvedTitle,
  };
}

/**
 * Resolve a path argument against the session working directory.
 *
 * `resolve` normalises either branch, so `./a/../1abc.pdb` and an already
 * absolute path both come out canonical. A relative path with no working
 * directory is refused rather than silently resolved against the host
 * process's cwd, which would point at a file the user never meant.
 */
function absolutePathOf(path: string, cwd: string | undefined): string {
  if (isAbsolute(path)) return resolve(path);
  if (cwd === undefined || cwd === "") {
    throw new Error(`"${path}" is relative but this session has no working directory; pass an absolute path`);
  }
  return resolve(cwd, path);
}
