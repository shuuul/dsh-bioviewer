/**
 * The model-facing `bio_open` and `bio_add` tools.
 *
 * This is the host half of agent-triggered viewing: the model calls a tool,
 * the host queues a request for the CALLING session's sidebar, and the sidebar
 * long-polls it back (`./route.ts` + `./registry.ts`).
 *
 * `bio_open` always makes a new tab. `bio_add` stacks into the live BioViewer
 * (a density map over a structure, markers over a map, a second PDB). Both
 * share the same queue and the same target grammar; the client decides whether
 * an add has a studio to land in.
 *
 * They deliberately coexist with better-sidebar's own `sidebar_open` and are
 * not a replacement for it: `sidebar_open` opens anything the editor can
 * render, while these are bio-aware — they validate the extension against our
 * format table, accept `pdb:` / `alphafold:` / `emdb:` accessions that have no
 * local path at all, and refuse an unsupported file with the list of supported
 * formats instead of opening it as text. The descriptions say so, because the
 * model picks between the tools from the description alone.
 *
 * The shape follows better-sidebar's `registerOpenTool`
 * (`node_modules/dsh-better-sidebar/src/agent-opens.ts:209-276`): the session
 * comes from `exec.agent` (the model never passes a sessionId), the canonical
 * value is one lossless JSON object, and the model-facing text is a separate
 * pure projection.
 *
 * @module dsh-bioviewer/host/tool
 */
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
// Type-only: brings in the `ctx.workingDirectory` augmentation. The service is
// a host package (present in any deployment that can run this plugin), and the
// import is erased at build time — the plugin never value-imports it.
import type {} from "@deepseek-ai/dsh-working-directory";
import { supportedExtensionsText, type OpenMode } from "../shared/opens";
import type { OpenRegistry } from "./registry";
import { resolveOpen } from "./target";

/** The tool name the model sees for a new tab. */
export const BIO_OPEN_TOOL = "bio_open";
/** The tool name the model sees for stacking into the live viewer. */
export const BIO_ADD_TOOL = "bio_add";

/** The tool's parameters (mirrors `parameters` below). */
interface BioOpenArgs {
  readonly target: string;
  readonly title?: string;
}

/** The canonical value both tools return (mirrors `output.schema` below). */
interface BioOpenResult {
  readonly kind: "file" | "structure";
  readonly target: string;
  readonly title: string;
  readonly delivered: boolean;
}

const SUPPORTED =
  `Supported extensions: ${supportedExtensionsText()} (each is also accepted with a .gz suffix). `;

const TARGET_DESCRIPTION =
  "a file path (absolute or relative to the session working directory), or a database structure as `pdb:1cbs`, `alphafold:P00533` or `emdb:EMD-1234`";

/** Extract the calling agent or throw the canonical "no agent" error. */
function requireAgent(agent: ToolRunContext["agent"], tool: string): NonNullable<ToolRunContext["agent"]> {
  if (agent === undefined) {
    throw new Error(`${tool} requires an initiating agent`);
  }
  return agent;
}

/**
 * The calling session's working directory.
 *
 * The committed directory is the authority for a live session — it tracks `cd`
 * — and the immutable session header keeps the directory the session was
 * created in, which is the only fallback available. Same rule, and same
 * precedence, as better-sidebar's `sessionCwdOf`
 * (`node_modules/dsh-better-sidebar/src/index.ts:213-220`); the tool only ever
 * runs for a live session, so the stored-header path that helper needs for a
 * detached session does not apply here.
 */
function sessionCwdOf(ctx: Context, session: Session): string | undefined {
  const committed = ctx.get("workingDirectory")?.get(session);
  if (committed !== undefined && committed !== "") return committed;
  const header = session.header.cwd;
  return header !== undefined && header !== "" ? header : undefined;
}

/** Pure text projection helper (the canonical value is already structured). */
function textRender<T>(fn: (value: T) => string): (_args: unknown, value: unknown) => ContentBlock[] {
  return (_args, value) => [{ type: "text", text: fn(value as T) }];
}

const OUTPUT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    kind: { type: "string" as const, required: true as const, description: "What was opened: file | structure." },
    target: {
      type: "string" as const,
      required: true as const,
      description: "The absolute path, or the normalised source:id of the database entry.",
    },
    title: { type: "string" as const, required: true as const, description: "The tab or object title used." },
    delivered: {
      type: "boolean" as const,
      required: true as const,
      description:
        "Whether the request reached a connected sidebar at call time (false = queued until that session's sidebar is next shown).",
    },
  },
};

const PARAMETERS = {
  target: {
    type: "string" as const,
    required: true as const,
    description: TARGET_DESCRIPTION,
  },
  title: {
    type: "string" as const,
    description:
      "Optional title (defaults to the file name, or the database and id for a structure entry).",
  },
};

function executeViewerTool(
  ctx: Context,
  registry: OpenRegistry,
  mode: OpenMode,
  tool: string,
): (args: BioOpenArgs, exec: ToolRunContext) => Promise<BioOpenResult> {
  return async (args, exec) => {
    // Cancellation is checked before the work and again before the handover:
    // an aborted call must not leave a request queued for a turn that is gone.
    exec.signal.throwIfAborted();
    const session = requireAgent(exec.agent, tool).session;
    const resolved = resolveOpen(args.target, args.title, sessionCwdOf(ctx, session), mode);
    exec.signal.throwIfAborted();
    const { delivered } = registry.enqueue(session.id, resolved.request);
    return { kind: resolved.kind, target: resolved.target, title: resolved.title, delivered };
  };
}

/**
 * Register `bio_open` and `bio_add` against the host tool registry.
 *
 * A host without a tool registry (a stripped-down composition) is logged and
 * skipped rather than thrown at: this plugin's main job is the sidebar UI, and
 * losing the agent-triggered tools must not take the whole plugin down.
 *
 * @param ctx - host plugin context (carries `tools` and `workingDirectory`).
 * @param registry - the open-request registry the tools queue into.
 * @returns a disposer that unregisters both tools.
 */
export function registerViewerTools(ctx: Context, registry: OpenRegistry): () => void {
  const tools = ctx.get("tools");
  if (tools === undefined) {
    ctx.logger.warn(
      `[dsh-bioviewer] no tool registry on this host; the ${BIO_OPEN_TOOL} and ${BIO_ADD_TOOL} tools are not registered`,
    );
    return () => {};
  }

  const disposeOpen = tools.register(defineTool({
    name: BIO_OPEN_TOOL,
    description:
      "Open a biomolecular file or a database structure in a new BioViewer tab. "
      + "Use this instead of sidebar_open for structures and molecules: the extension is validated against the supported biomolecular formats "
      + "(an unsupported file is refused with an actionable error rather than opened in the text editor), and a database entry is addressed directly "
      + "as `pdb:1cbs`, `alphafold:P00533` or `emdb:EMD-1234` with no local file involved. "
      + "Use bio_add to stack another object into a viewer that is already open (overlay a map, add markers, load a second structure). "
      + SUPPORTED
      + "The path may be absolute or relative to the session working directory. "
      + "The open lands in the CALLING session's sidebar: while that session's sidebar view is not connected, "
      + "the open is queued and delivered when the session sidebar is next shown — the result reports `delivered` so you know whether it is visible right now.",
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: textRender((v: BioOpenResult) =>
        v.delivered
          ? `Opened ${v.kind} "${v.title}" (${v.target}) in the BioViewer sidebar.`
          : `Requested opening ${v.kind} "${v.title}" (${v.target}) in the BioViewer sidebar — the session sidebar is not connected yet, so the open is queued and will appear when it is next shown.`,
      ),
    },
    execute: executeViewerTool(ctx, registry, "open", BIO_OPEN_TOOL),
  }));

  const disposeAdd = tools.register(defineTool({
    name: BIO_ADD_TOOL,
    description:
      "Add a biomolecular file or a database entry to the BioViewer already on screen, stacking it as another Mol* object in the same canvas. "
      + "Use this to overlay a density map on a structure, draw Chimera markers over a map, or load a second PDB next to the first. "
      + "If no BioViewer is open in this session, one is created first (same as bio_open). "
      + "Use bio_open instead when you want a separate tab. "
      + "A database entry is addressed as `pdb:1cbs`, `alphafold:P00533` or `emdb:EMD-1234`. "
      + SUPPORTED
      + "The path may be absolute or relative to the session working directory. "
      + "The add lands in the CALLING session's sidebar: while that session's sidebar view is not connected, "
      + "the add is queued and delivered when the session sidebar is next shown — the result reports `delivered` so you know whether it reached a client right now.",
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: textRender((v: BioOpenResult) =>
        v.delivered
          ? `Added ${v.kind} "${v.title}" (${v.target}) to the BioViewer.`
          : `Requested adding ${v.kind} "${v.title}" (${v.target}) to the BioViewer — the session sidebar is not connected yet, so the add is queued and will appear when it is next shown.`,
      ),
    },
    execute: executeViewerTool(ctx, registry, "add", BIO_ADD_TOOL),
  }));

  return () => {
    disposeAdd();
    disposeOpen();
  };
}
