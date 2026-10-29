/**
 * Host half of dsh-bioviewer.
 *
 * This plugin is a **UI extension**: all of its behaviour lives in the client
 * half (`./client/index.tsx`), which registers file viewers and a browser tab
 * with the third-party `dsh-better-sidebar` service. That service only exists in
 * the browser, so there is nothing for the Node side to provide.
 *
 * The host half still has to exist and export `apply`: the DSH loader mounts the
 * plugin through this entry (`package.json#main`), and it is the loader row that
 * makes the client half discoverable through `package.json#dsh.client`. Keeping
 * it empty is deliberate — an unused service or route here would be surface with
 * no consumer.
 *
 * @module dsh-bioviewer
 */
import type { Context } from "@deepseek-ai/cordis";

/** Cordis plugin name, shown in loader diagnostics. */
export const name = "dsh-bioviewer";

/**
 * No host-side service dependencies. In particular this plugin does **not**
 * inject `dsh-better-sidebar`: it is an optional peer, and the registration code
 * that needs it lives on the client half behind `ctx.inject`.
 */
export const inject: readonly string[] = [];

/**
 * Plugin entry point.
 *
 * @param ctx - the host cordis context.
 */
export function apply(ctx: Context): void {
  ctx.logger.info("[dsh-bioviewer] mounted; biomolecular viewers are registered on the client half");
}
