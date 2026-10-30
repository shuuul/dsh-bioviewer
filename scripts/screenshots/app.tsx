/**
 * Throwaway product-shot page. Loads MolStudio the same way the plugin does,
 * then dresses the canvas in DSH window chrome so marketplace screenshots look
 * like a sidebar tab rather than a bare WebGL viewport.
 *
 * Not shipped. Built by `scripts/screenshots/capture.ts`.
 */
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Studio, type StudioTheme } from "@molstudio/react";
import type { MolStudio, StudioObject } from "@molstudio/core";
import studioCss from "@molstudio/react/styles.css";
import browserCss from "../../src/client/browser.css";
import frameCss from "./frame.css";

const ICON = "./icon.png";

interface Scene {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly tab: string;
  readonly theme: StudioTheme;
  readonly kind: "studio" | "browser";
  readonly prepare?: (studio: MolStudio) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitFor(
  studio: MolStudio,
  predicate: (objects: readonly StudioObject[]) => boolean,
  timeoutMs = 90_000,
): Promise<readonly StudioObject[]> {
  const started = Date.now();
  for (;;) {
    const objects = studio.getSnapshot().objects;
    if (predicate(objects)) return objects;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `timed out waiting for studio objects: ${objects.map((object) => `${object.kind}:${object.label}`).join(", ") || "(empty)"}`,
      );
    }
    await sleep(200);
  }
}

function clickNamed(selector: string, name: string): boolean {
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  for (const node of nodes) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.includes(name)) {
      node.click();
      return true;
    }
  }
  return false;
}

async function clickNamedUntil(selector: string, name: string, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (clickNamed(selector, name)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`could not click "${name}" (${selector})`);
    await sleep(120);
  }
}

async function prepareEmMap(studio: MolStudio): Promise<void> {
  await Promise.all([studio.loadPdb("3j5p"), studio.loadEmdb("EMD-5778")]);
  const objects = await waitFor(
    studio,
    (list) => list.some((object) => object.kind === "structure") && list.some((object) => object.kind === "volume"),
  );
  const volume = objects.find((object) => object.kind === "volume");
  const structure = objects.find((object) => object.kind === "structure");
  if (volume === undefined) throw new Error("EMD-5778 did not land as a volume");
  if (structure === undefined || structure.kind !== "structure") throw new Error("3J5P did not load");
  const water = structure.components.find((component) => component.staticType === "water");
  if (water !== undefined) await studio.setVisible(water.ref, false);
  await studio.setIsoLevel(volume.id, 9.13);
  await studio.setOpacity(volume.id, 0.35);
  studio.focus(structure.id);
  await sleep(800);
  await clickNamedUntil(".ms-object-main", "EMD-5778");
}

async function prepareNucleic(studio: MolStudio): Promise<void> {
  await studio.loadPdb("4oo8");
  const objects = await waitFor(studio, (list) => list.some((object) => object.kind === "structure"));
  const structure = objects.find((object) => object.kind === "structure");
  if (structure === undefined || structure.kind !== "structure") throw new Error("4OO8 did not load");
  const rna = structure.entities.find((entity) => /rna/i.test(entity.label));
  if (rna === undefined) throw new Error(`4OO8 has no RNA entity: ${structure.entities.map((entity) => entity.label).join(", ")}`);
  await studio.overridePart({ objectId: structure.id, scope: "entity", index: rna.index });
  const after = studio.getSnapshot().objects.find((object) => object.id === structure.id);
  if (after === undefined || after.kind !== "structure") throw new Error("4OO8 vanished after override");
  const rnaComponent = after.components.find((component) => component.part?.scope === "entity" && component.part.index === rna.index);
  if (rnaComponent !== undefined) await studio.setColor(rnaComponent.ref, "#c9842a");
  const water = after.components.find((component) => component.staticType === "water");
  if (water !== undefined) await studio.setVisible(water.ref, false);
  studio.focus(structure.id);
  await sleep(500);
  await clickNamedUntil(".ms-view-switch button", "Entities");
  await clickNamedUntil(".ms-part-row", "RNA");
}

async function prepareLigand(studio: MolStudio): Promise<void> {
  await studio.loadPdb("1iep");
  const objects = await waitFor(studio, (list) => list.some((object) => object.kind === "structure"));
  const structure = objects.find((object) => object.kind === "structure");
  if (structure === undefined || structure.kind !== "structure") throw new Error("1IEP did not load");
  const ligand = structure.components.find((component) => component.staticType === "ligand");
  if (ligand === undefined) {
    throw new Error(`1IEP has no ligand component: ${structure.components.map((component) => component.label).join(", ")}`);
  }
  const water = structure.components.find((component) => component.staticType === "water");
  const ion = structure.components.find((component) => component.staticType === "ion");
  if (water !== undefined) await studio.setVisible(water.ref, false);
  if (ion !== undefined) await studio.setVisible(ion.ref, false);
  await studio.setRepresentation(ligand.ref, "ball-and-stick");
  studio.focus(ligand.ref);
  await sleep(700);
  await clickNamedUntil(".ms-part-row", "Ligand");
}

const SCENES: readonly Scene[] = [
  {
    id: "em-map",
    title: "Cryo-EM maps with fitted models",
    subtitle: "EMD-5778 with PDB 3J5P. Set the contour by σ, fade the map, and check the fit.",
    tab: "EMD-5778 · 3J5P",
    theme: "dark",
    kind: "studio",
    prepare: prepareEmMap,
  },
  {
    id: "nucleic-acids",
    title: "Protein, RNA and DNA in one view",
    subtitle: "Cas9 with guide RNA and target DNA (PDB 4OO8). Browse entities, recolor one, read its sequence.",
    tab: "4OO8",
    theme: "dark",
    kind: "studio",
    prepare: prepareNucleic,
  },
  {
    id: "ligand",
    title: "Ligands in their binding pocket",
    subtitle: "Imatinib bound to Abl kinase (PDB 1IEP), shown in the DSH light theme.",
    tab: "1IEP",
    theme: "light",
    kind: "studio",
    prepare: prepareLigand,
  },
  {
    id: "workspace",
    title: "Browse the workspace, then open",
    subtitle: "The BioViewer tab lists structures, maps and ligands in the current folder.",
    tab: "BioViewer",
    theme: "dark",
    kind: "browser",
  },
];

function sceneFromQuery(): Scene {
  const id = new URLSearchParams(window.location.search).get("scene") ?? "em-map";
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0]!;
}

function injectStyle(id: string, css: string): void {
  if (document.getElementById(id) !== null) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.append(style);
}

function WindowChrome({
  scene,
  children,
}: {
  scene: Scene;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="page">
      <div className="blob blob-teal" />
      <div className="blob blob-gold" />
      <div className="blob blob-coral" />
      <header className="header">
        <div className="brand">
          <img src={ICON} alt="" />
          BioViewer for DeepSeek Harness
        </div>
        <h1>{scene.title}</h1>
        <p>{scene.subtitle}</p>
      </header>
      <div className="stage">
        <div className="window" data-theme={scene.theme}>
          <div className="titlebar">
            <div className="traffic" aria-hidden="true">
              <i className="red" />
              <i className="yellow" />
              <i className="green" />
            </div>
            <div className="tabs">
              <div className="tab">
                <img src={ICON} alt="" />
                {scene.tab}
              </div>
            </div>
          </div>
          <div className="body">
            <aside className="sidebar">
              <h2>Sidebar</h2>
              <div className="nav">
                <button type="button">Files</button>
                <button type="button" data-active="true">
                  <img src={ICON} alt="" />
                  BioViewer
                </button>
                <button type="button">Git</button>
              </div>
            </aside>
            <div className="canvas">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceMock(): ReactElement {
  const files = [
    ["1cbs.pdb", "PDB"],
    ["4oo8.cif", "CIF"],
    ["emd_5778.map", "MAP"],
    ["1iep.pdb.gz", "PDB·GZ"],
    ["prompt.cmm", "CMM"],
  ] as const;
  return (
    <div className="dsh-bioviewer workspace" data-dsh-bioviewer="">
      <div className="dsh-bioviewer__bar">
        <button type="button" className="dsh-bioviewer__icon-button" disabled title="Go to the parent folder">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 12.5V3.9M4.2 7.4 8 3.6l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="dsh-bioviewer__cwd" title="/session/structures">
          /session/structures
        </span>
        <button type="button" className="dsh-bioviewer__icon-button" title="Refresh the listing">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4h-2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <ul className="dsh-bioviewer__list" aria-label="Folders">
        <li>
          <button type="button" className="dsh-bioviewer__row">
            <svg className="dsh-bioviewer__glyph" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h3.1c.33 0 .65.13.88.37l.9.9H13a1.25 1.25 0 0 1 1.25 1.25v7A1.25 1.25 0 0 1 13 13.25H3A1.25 1.25 0 0 1 1.75 12z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="dsh-bioviewer__name">maps</span>
            <span className="dsh-bioviewer__chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      </ul>
      <ul className="dsh-bioviewer__list" aria-label="Bio files">
        {files.map(([name, badge]) => (
          <li key={name}>
            <button type="button" className="dsh-bioviewer__row">
              <svg className="dsh-bioviewer__glyph" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.75 1.75h5l3.5 3.5v9H3.75z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <span className="dsh-bioviewer__name">{name}</span>
              <span className="dsh-bioviewer__badge">{badge}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CaptureApp(): ReactElement {
  const scene = sceneFromQuery();
  const [status, setStatus] = useState(scene.kind === "browser" ? "ready" : "loading");
  const [detail, setDetail] = useState("Starting Mol*…");

  useEffect(() => {
    injectStyle("ms-styles", studioCss);
    injectStyle("browser-styles", browserCss);
    injectStyle("frame-styles", frameCss);
  }, []);

  useEffect(() => {
    if (scene.kind !== "browser") return;
    document.body.dataset.ready = "1";
  }, [scene.kind]);

  const onReady = useCallback(
    (studio: MolStudio) => {
      const run = scene.prepare;
      if (run === undefined) {
        document.body.dataset.ready = "1";
        setStatus("ready");
        return;
      }
      setDetail(`Loading ${scene.tab}…`);
      void run(studio)
        .then(async () => {
          await sleep(1200);
          setStatus("ready");
          document.body.dataset.ready = "1";
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setStatus("error");
          setDetail(message);
          document.body.dataset.error = message;
        });
    },
    [scene],
  );

  return (
    <WindowChrome scene={scene}>
      {scene.kind === "browser" ? (
        <WorkspaceMock />
      ) : (
        <>
          {status !== "ready" && (
            <div className="status" role="status">
              {detail}
            </div>
          )}
          <Studio theme={scene.theme} locale="en" onReady={onReady} onError={(error) => {
            setStatus("error");
            setDetail(error.message);
            document.body.dataset.error = error.message;
          }} />
        </>
      )}
    </WindowChrome>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing");
createRoot(root).render(<CaptureApp />);
