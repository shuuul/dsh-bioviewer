/**
 * Turn an agent `OpenRequest` into a `ViewerPayload` the studio can load.
 *
 * Database entries need no fetch. Files go through the same byte route the
 * file-viewer descriptor uses, so a `.gz` is inflated and a `.cmm` is parsed
 * before `loadIntoStudio` sees them.
 *
 * @module dsh-bioviewer/client/open-payload
 */
import { detectBioFile } from "../shared/formats";
import { unsupportedPathReason, type OpenRequest } from "../shared/opens";
import { parseCmmMarkerSets } from "./cmm";
import type { ViewerPayload } from "./payload";

export type ReadBioFile = (
  path: string,
  signal?: AbortSignal,
) => Promise<{ bytes: Uint8Array; gzip: boolean }>;

/** Build the payload `loadIntoStudio` expects for one queued request. */
export async function payloadFromOpenRequest(
  request: OpenRequest,
  readFile: ReadBioFile,
  signal?: AbortSignal,
): Promise<ViewerPayload> {
  if (request.kind === "structure") {
    return { kind: "structure", source: request.source, id: request.id, title: request.title };
  }
  const detected = detectBioFile(request.path);
  if (detected === undefined) {
    throw new Error(unsupportedPathReason(request.path) ?? `"${request.path}" is not a supported biomolecular file`);
  }
  const { bytes, gzip } = await readFile(request.path, signal);
  if (detected.format.kind === "markers") {
    return {
      kind: "markers",
      path: request.path,
      title: request.title,
      sets: parseCmmMarkerSets(new TextDecoder().decode(bytes), request.title),
      gzip,
    };
  }
  return {
    kind: "bytes",
    path: request.path,
    title: request.title,
    format: detected.format,
    bytes,
    gzip,
  };
}
