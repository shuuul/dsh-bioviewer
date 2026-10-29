/**
 * Host half of dsh-bioviewer.
 *
 * The plugin is a **UI extension**: the viewers, the compressed-file sniffer
 * and the workspace tab all live in the client half (`./client/index.tsx`) and
 * register with the third-party `dsh-better-sidebar` service, which only exists
 * in the browser. This entry still has two jobs of its own:
 *
 * - the loader mounts the plugin through it (`package.json#main`), and it is
 *   that loader row which makes the client half discoverable through
 *   `package.json#dsh.client`;
 * - it owns **agent-triggered opening**. The model calls the `bio_open` tool
 *   (`./host/tool.ts`), the request is queued per session
 *   (`./host/registry.ts`), and the sidebar long-polls it back from
 *   `GET /bioviewer/open` (`./host/route.ts`). `ctx.sidebarRight` is a
 *   client-only service — its host half contributes nothing to the host tree —
 *   so a host route plus a tool is the only way to push an open into the
 *   sidebar at all.
 *
 * Both registrations sit inside one `ctx.effect`, so unloading the plugin
 * releases the route and the tool and settles every in-flight poll.
 *
 * @module dsh-bioviewer
 */
import type { Context } from "@deepseek-ai/cordis";
import { OpenRegistry } from "./host/registry";
import { registerOpenRoute } from "./host/route";
import { registerBioOpenTool } from "./host/tool";

/** Cordis plugin name, shown in loader diagnostics. */
export const name = "dsh-bioviewer";

/**
 * No host-side service dependencies.
 *
 * In particular this plugin does **not** inject `dsh-better-sidebar`: it is an
 * optional peer, and the registration code that needs it lives on the client
 * half behind `ctx.inject`. The host half reads `tools`, `webServer` and
 * `workingDirectory` through `ctx.get`, which returns `undefined` instead of
 * holding the fiber pending, so a stripped-down host still mounts the UI half.
 */
export const inject: readonly string[] = [];

/**
 * Plugin entry point.
 *
 * @param ctx - the host cordis context.
 */
export function apply(ctx: Context): void {
  // `webServer` and `tools` are provided by the host tree, and this plugin's own
  // activation is **not** ordered after them. Reading them with `ctx.get` at
  // `apply()` time therefore races the provider: on a real host the lookup lost
  // that race, both registrations degraded to no-ops, and the plugin looked
  // mounted while its route answered the server's generic 404. `ctx.inject`
  // waits for the services on a child fiber instead — registration happens the
  // moment both exist, the UI half is still not gated on them (a static
  // `inject` would have blocked the whole plugin), and a host that never
  // provides them simply never registers the tool or the route.
  ctx.inject(["webServer", "tools"], (scoped) => {
    scoped.effect(() => {
      const registry = new OpenRegistry();
      const disposers: Array<() => void> = [
        registerBioOpenTool(scoped, registry),
        registerOpenRoute(scoped, registry),
      ];

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        // Route first, then the tool: stop admitting new polls before the queue
        // they would park on is released.
        for (const dispose of disposers.reverse()) dispose();
        registry.dispose();
      };
    }, "dsh-bioviewer: bio_open tool and open route");
  });

  ctx.logger.info("[dsh-bioviewer] mounted; the bio_open tool and its open route register once the host services are up");
}
