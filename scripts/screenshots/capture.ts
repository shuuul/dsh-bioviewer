#!/usr/bin/env bun
/**
 * Build the throwaway capture page, serve it, photograph each scene with
 * the local Chrome via CDP, and write JPEG product shots to docs/screenshots/.
 *
 * Usage: bun run screenshots
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outDir = join(root, ".verification", "screenshots");
const shotsDir = join(root, "docs", "screenshots");
const chrome =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SCENES = ["em-map", "nucleic-acids", "ligand", "workspace"] as const;
const WIDTH = 2400;
const HEIGHT = 1710;
const READY_TIMEOUT_MS = 180_000;

const cssAsText: BunPlugin = {
  name: "css-as-text",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path).text())};`,
      loader: "js",
    }));
  },
};

async function bundle(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(root, "scripts/screenshots/app.tsx")],
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "none",
    plugins: [cssAsText],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    naming: "app.js",
    outdir: outDir,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("screenshot app build failed");
  }
  await Bun.write(
    join(outDir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>dsh-bioviewer screenshots</title>
<style>html,body,#root{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#f4f0e6}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="./app.js"></script>
</body>
</html>
`,
  );
  await Bun.write(join(outDir, "icon.png"), Bun.file(join(root, "resources/img/icon.png")));
}

function serve(): { port: number; stop: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const file = Bun.file(join(outDir, url.pathname === "/" ? "index.html" : url.pathname));
      if (await file.exists()) return new Response(file);
      return new Response("not found", { status: 404 });
    },
  });
  const port = server.port;
  if (typeof port !== "number") throw new Error("screenshot server did not bind a port");
  return { port, stop: () => server.stop(true) };
}

interface CdpClient {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  close(): void;
}

async function openCdp(wsUrl: string): Promise<CdpClient> {
  const socket = new WebSocket(wsUrl);
  const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
  socket.addEventListener("open", () => resolve());
  socket.addEventListener("error", () => reject(new Error(`CDP websocket failed: ${wsUrl}`)));
  await opened;

  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(message.error.message ?? "CDP error"));
    else waiter.resolve(message.result);
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const { promise, resolve: done, reject: fail } = Promise.withResolvers<unknown>();
      pending.set(id, { resolve: done, reject: fail });
      socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }));
      return promise;
    },
    close() {
      socket.close();
    },
  };
}

async function waitHttp(url: string, timeoutMs = 15_000): Promise<Response> {
  const started = Date.now();
  for (;;) {
    try {
      return await fetch(url);
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await Bun.sleep(150);
    }
  }
}

async function launchChrome(): Promise<{ port: number; kill: () => void }> {
  const profile = join(outDir, "chrome-profile");
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  const port = 19_221;
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      `--remote-debugging-address=127.0.0.1`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`Chrome exited ${code}: ${stderr.slice(-400)}`);
    }
  });
  await waitHttp(`http://127.0.0.1:${port}/json/version`);
  return {
    port,
    kill() {
      child.kill("SIGKILL");
    },
  };
}

async function captureScene(cdp: CdpClient, origin: string, scene: string): Promise<Uint8Array> {
  const created = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
  const attached = (await cdp.send("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  })) as { sessionId: string };
  const session = attached.sessionId;
  await cdp.send("Page.enable", {}, session);
  await cdp.send("Runtime.enable", {}, session);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await cdp.send("Page.navigate", { url: `${origin}/?scene=${scene}` }, session);

  const started = Date.now();
  for (;;) {
    const evaluated = (await cdp.send(
      "Runtime.evaluate",
      {
        expression:
          "({ ready: document.body?.dataset?.ready === '1', error: document.body?.dataset?.error ?? null })",
        returnByValue: true,
      },
      session,
    )) as { result?: { value?: { ready: boolean; error: string | null } }; exceptionDetails?: { text?: string } };
    if (evaluated.exceptionDetails !== undefined) {
      throw new Error(`${scene}: ${evaluated.exceptionDetails.text ?? "evaluate failed"}`);
    }
    const value = evaluated.result?.value;
    if (value?.error) throw new Error(`${scene}: ${value.error}`);
    if (value?.ready) break;
    if (Date.now() - started > READY_TIMEOUT_MS) throw new Error(`${scene}: timed out waiting for data-ready`);
    await Bun.sleep(400);
  }
  await Bun.sleep(800);

  const shot = (await cdp.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } },
    session,
  )) as { data: string };
  await cdp.send("Target.closeTarget", { targetId: created.targetId });
  return Buffer.from(shot.data, "base64");
}

async function toJpeg(png: Uint8Array, dest: string): Promise<void> {
  const pngPath = dest.replace(/\.jpe?g$/i, ".png");
  await writeFile(pngPath, png);
  const converted = Bun.spawnSync(
    ["ffmpeg", "-y", "-i", pngPath, "-frames:v", "1", "-update", "1", "-q:v", "4", dest],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (converted.exitCode !== 0) throw new Error(`ffmpeg failed for ${dest}`);
  await rm(pngPath);
}

async function main(): Promise<void> {
  await bundle();
  await mkdir(shotsDir, { recursive: true });
  const http = serve();
  const origin = `http://127.0.0.1:${http.port}`;
  const chromeProc = await launchChrome();
  try {
    const version = (await (await waitHttp(`http://127.0.0.1:${chromeProc.port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    const cdp = await openCdp(version.webSocketDebuggerUrl);
    try {
      for (const scene of SCENES) {
        console.log(`capturing ${scene}…`);
        const png = await captureScene(cdp, origin, scene);
        await toJpeg(png, join(shotsDir, `${scene}.jpeg`));
        console.log(`  wrote docs/screenshots/${scene}.jpeg`);
      }
    } finally {
      cdp.close();
    }
  } finally {
    chromeProc.kill();
    http.stop();
  }
}

await main();
