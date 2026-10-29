/**
 * The model-facing `bio_open` tool.
 *
 * This is the host half of agent-triggered opening: the model calls the tool,
 * the host queues a request for the CALLING session's sidebar, and the sidebar
 * long-polls it back (`./route.ts` + `./registry.ts`).
 *
 * It deliberately coexists with better-sidebar's own `sidebar_open` and is not
 * a replacement for it: `sidebar_open` opens anything the editor can render,
 * while this one is bio-aware — it validates the extension against our format
 * table, accepts `pdb:` / `alphafold:` / `emdb:` accessions that have no local
 * path at all, and refuses an unsupported file with the list of supported
 * formats instead of opening it as text. The description says so, because the
 * model picks between the two from the description alone.
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
import { supportedExtensionsText } from "../shared/opens";
import type { OpenRegistry } from "./registry";
import { resolveOpen } from "./target";

/** The tool name the model sees. */
export const BIO_OPEN_TOOL = "bio_open";

/** The tool's parameters (mirrors `parameters` below). */
interface BioOpenArgs {
  readonly target: string;
  readonly title?: string;
}

/** The canonical value `bio_open` returns (mirrors `output.schema` below). */
interface BioOpenResult {
  readonly kind: "file" | "structure";
  readonly target: string;
  readonly title: string;
  readonly delivered: boolean;
}

/** Extract the calling agent or throw the canonical "no agent" error. */
function requireAgent(agent: ToolRunContext["agent"]): NonNullable<ToolRunContext["agent"]> {
  if (agent === undefined) {
    throw new Error(`${BIO_OPEN_TOOL} requires an initiating agent`);
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

/**
 * Register `bio_open` against the host tool registry.
 *
 * A host without a tool registry (a stripped-down composition) is logged and
 * skipped rather than thrown at: this plugin's main job is the sidebar UI, and
 * losing the agent-triggered open must not take the whole plugin down.
 *
 * @param ctx - host plugin context (carries `tools` and `workingDirectory`).
 * @param registry - the open-request registry the tool queues into.
 * @returns a disposer that unregisters the tool.
 */
export function registerBioOpenTool(ctx: Context, registry: OpenRegistry): () => void {
  const tools = ctx.get("tools");
  if (tools === undefined) {
    ctx.logger.warn(
      `[dsh-bioviewer] no tool registry on this host; the ${BIO_OPEN_TOOL} tool is not registered`,
    );
    return () => {};
  }

  return tools.register(defineTool({
    name: BIO_OPEN_TOOL,
    description:
      "Open a biomolecular file or a database structure in the sidebar's BioViewer. "
      + "Use this instead of sidebar_open for structures and molecules: the extension is validated against the supported biomolecular formats "
      + "(an unsupported file is refused with an actionable error rather than opened in the text editor), and a database entry is addressed directly "
      + "as `pdb:1cbs`, `alphafold:P00533` or `emdb:EMD-1234` with no local file involved. "
      + `Supported extensions: ${supportedExtensionsText()} (each is also accepted with a .gz suffix). `
      + "The path may be absolute or relative to the session working directory. "
      + "The open lands in the CALLING session's sidebar: while that session's sidebar view is not connected, "
      + "the open is queued and delivered when the session sidebar is next shown — the result reports `delivered` so you know whether it is visible right now.",
    parameters: {
      target: {
        type: "string",
        required: true,
        description:
          "a file path (absolute or relative to the session working directory), or a database structure as `pdb:1cbs`, `alphafold:P00533` or `emdb:EMD-1234`",
      },
      title: {
        type: "string",
        description:
          "Optional tab title (defaults to the file name, or the database and id for a structure entry).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true, description: "What was opened: file | structure." },
          target: {
            type: "string",
            required: true,
            description: "The absolute path, or the normalised source:id of the database entry.",
          },
          title: { type: "string", required: true, description: "The tab title used." },
          delivered: {
            type: "boolean",
            required: true,
            description:
              "Whether the open reached a connected sidebar at call time (false = queued until that session's sidebar is next shown).",
          },
        },
      },
      render: textRender((v: BioOpenResult) =>
        v.delivered
          ? `Opened ${v.kind} "${v.title}" (${v.target}) in the BioViewer sidebar.`
          : `Requested opening ${v.kind} "${v.title}" (${v.target}) in the BioViewer sidebar — the session sidebar is not connected yet, so the open is queued and will appear when it is next shown.`,
      ),
    },
    execute: async (args: BioOpenArgs, exec: ToolRunContext): Promise<BioOpenResult> => {
      // Cancellation is checked before the work and again before the handover:
      // an aborted call must not leave an open queued for a turn that is gone.
      exec.signal.throwIfAborted();
      const session = requireAgent(exec.agent).session;
      const resolved = resolveOpen(args.target, args.title, sessionCwdOf(ctx, session));
      exec.signal.throwIfAborted();
      const { delivered } = registry.enqueue(session.id, resolved.request);
      return { kind: resolved.kind, target: resolved.target, title: resolved.title, delivered };
    },
  }));
}
