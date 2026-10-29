/**
 * Chimera marker models (`.cmm`), parsed into `@molstudio/core`'s own marker
 * vocabulary so `MolStudio.loadMarkers` can draw them as spheres and tubes
 * beside whatever else the viewer holds.
 *
 * The semantics are a port of BioViewer's shipped implementation
 * (`bioviewer/src/webview/services/cmmMarkers.ts`), which is the behaviour
 * users of the VS Code extension already have:
 * - Chimera's marker radius reads large next to atoms and density, so markers
 *   are drawn at half of it (`cmmMarkers.ts:4`).
 * - A marker defaults to radius 1 (before that scale) and red; a link defaults
 *   to radius 0.2 and white (`cmmMarkers.ts:100,133-134`). Only marker radii
 *   are scaled — a link keeps the radius the file gives it.
 * - `r`/`g`/`b` are floats in 0..1, clamped, and become `#rrggbb`
 *   (`cmmMarkers.ts:66-81`).
 * - `x`/`y`/`z` are required and must be finite; a `radius` that is present
 *   must be greater than 0 (`cmmMarkers.ts:31-59`).
 * - A link names markers **by id, scoped to its own `<marker_set>`**, and the
 *   ids become indices into that set's `markers` array (`cmmMarkers.ts:84-135`).
 * - One `MarkerSet` per `<marker_set>`, in file order. A lone set is labelled
 *   with the file label; several are labelled `<set name> · <file>`
 *   (`cmmMarkers.ts:144-165`).
 * Malformed input throws a descriptive error instead of quietly yielding an
 * empty model.
 *
 * DOM-FREE ON PURPOSE: BioViewer parses with `DOMParser` (`cmmMarkers.ts:149`),
 * which does not exist under Bun — and this module is unit-tested there, which
 * is the only reason the format is testable at all. `.cmm` is a flat dialect:
 * a `<marker_set>` (or a `<marker_sets>` wrapper) whose direct `<marker>` and
 * `<link>` children carry nothing but attributes, so the scan below reads the
 * text directly. The tradeoff is that it is not a general XML parser — no
 * namespaces, no DTD-declared entities, no schema validation — and a real XML
 * parser would add a dependency (AGENTS.md: no new dependencies) for a dialect
 * that never needs one.
 *
 * React-free and Mol*-free: the only import is a type, erased at build time.
 *
 * @module dsh-bioviewer/client/cmm
 */
import type { Marker, MarkerLink, MarkerSet } from "@molstudio/core";

/** Chimera's marker radius reads large next to atoms and density; markers are drawn at half of it. */
const CMM_MARKER_RADIUS_SCALE = 0.5;

/**
 * One scanned element. Tag names are lowercased for matching, so `<MARKER>`
 * matches `<marker>` the way BioViewer's own `tagName.toLowerCase()` comparison
 * does (`cmmMarkers.ts:8-10`); attribute names are **not** — XML attributes are
 * case-sensitive and `getAttribute("x")` in the reference would not see `X`.
 */
interface CmmElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: CmmElement[];
}

/** Tag and attribute names: anything up to whitespace, `=`, `/`, `<` or `>`. */
const NAME_PATTERN = /[^\s=/><]+/y;
const WHITESPACE = /\s/;

function invalidXml(reason: string): Error {
  return new Error(`Invalid CMM XML: ${reason}.`);
}

/** The five predefined XML entities; anything else must be a character reference. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeEntity(body: string): string {
  const named = NAMED_ENTITIES.get(body);
  if (named !== undefined) return named;

  const hexadecimal = /^#x([0-9a-fA-F]+)$/.exec(body);
  const decimal = hexadecimal === null ? /^#([0-9]+)$/.exec(body) : null;
  const codePoint =
    hexadecimal !== null
      ? Number.parseInt(hexadecimal[1] ?? "", 16)
      : decimal !== null
        ? Number.parseInt(decimal[1] ?? "", 10)
        : Number.NaN;
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    throw invalidXml(`unknown entity &${body};`);
  }
  return String.fromCodePoint(codePoint);
}

/** Decode `&amp;`-style references the way a DOM would, so names survive intact. */
function decodeEntities(raw: string): string {
  let decoded = "";
  let index = 0;
  for (;;) {
    const ampersand = raw.indexOf("&", index);
    if (ampersand === -1) return decoded + raw.slice(index);

    const semicolon = raw.indexOf(";", ampersand + 1);
    if (semicolon === -1) throw invalidXml("unterminated entity reference");
    decoded += raw.slice(index, ampersand) + decodeEntity(raw.slice(ampersand + 1, semicolon));
    index = semicolon + 1;
  }
}

/** Advance past `terminator`, or fail with a message naming what was left open. */
function skipTo(xmlText: string, from: number, terminator: string, what: string): number {
  const end = xmlText.indexOf(terminator, from);
  if (end === -1) throw invalidXml(`unterminated ${what}`);
  return end + terminator.length;
}

/** Skip `<!DOCTYPE …>`, including a `[…]` internal subset. */
function skipDeclaration(xmlText: string, start: number): number {
  let depth = 0;
  for (let index = start + 2; index < xmlText.length; index += 1) {
    const character = xmlText[index];
    if (character === "[") depth += 1;
    else if (character === "]") depth -= 1;
    else if (character === ">" && depth <= 0) return index + 1;
  }
  throw invalidXml("unterminated declaration");
}

/** Read one `<name …>` / `<name … />` tag, starting at its `<`. */
function readOpenTag(xmlText: string, start: number): { element: CmmElement; end: number; selfClosing: boolean } {
  NAME_PATTERN.lastIndex = start + 1;
  const nameMatch = NAME_PATTERN.exec(xmlText);
  if (nameMatch === null) throw invalidXml("unterminated tag");
  const name = nameMatch[0].toLowerCase();
  let index = NAME_PATTERN.lastIndex;

  const attributes = new Map<string, string>();
  const element: CmmElement = { name, attributes, children: [] };
  for (;;) {
    while (index < xmlText.length && WHITESPACE.test(xmlText[index])) index += 1;
    if (index >= xmlText.length) throw invalidXml(`unterminated <${name}> tag`);

    const character = xmlText[index];
    if (character === ">") return { element, end: index + 1, selfClosing: false };
    if (character === "/") {
      if (xmlText[index + 1] !== ">") throw invalidXml(`stray "/" in <${name}>`);
      return { element, end: index + 2, selfClosing: true };
    }

    NAME_PATTERN.lastIndex = index;
    const attributeMatch = NAME_PATTERN.exec(xmlText);
    if (attributeMatch === null) throw invalidXml(`malformed attribute in <${name}>`);
    const attributeName = attributeMatch[0];
    index = NAME_PATTERN.lastIndex;

    while (index < xmlText.length && WHITESPACE.test(xmlText[index])) index += 1;
    if (xmlText[index] !== "=") throw invalidXml(`attribute ${attributeName} in <${name}> has no value`);
    index += 1;
    while (index < xmlText.length && WHITESPACE.test(xmlText[index])) index += 1;

    const quote = xmlText[index];
    if (quote !== '"' && quote !== "'") throw invalidXml(`attribute ${attributeName} in <${name}> is not quoted`);
    const closingQuote = xmlText.indexOf(quote, index + 1);
    if (closingQuote === -1) throw invalidXml(`unterminated value for attribute ${attributeName} in <${name}>`);
    if (attributes.has(attributeName)) throw invalidXml(`duplicate attribute ${attributeName} in <${name}>`);

    attributes.set(attributeName, decodeEntities(xmlText.slice(index + 1, closingQuote)));
    index = closingQuote + 1;
  }
}

/** Close the innermost open element, checking that the names match. */
function closeElement(xmlText: string, start: number, open: CmmElement[]): number {
  const end = xmlText.indexOf(">", start);
  if (end === -1) throw invalidXml("unterminated closing tag");

  const name = xmlText.slice(start + 2, end).trim().toLowerCase();
  const element = open.pop();
  if (element === undefined) throw invalidXml(`unexpected closing tag </${name}>`);
  if (element.name !== name) throw invalidXml(`closing tag </${name}> does not match <${element.name}>`);
  return end + 1;
}

/**
 * Scan the whole file into a small element tree, checking well-formedness on
 * the way. The tree is what lets `<marker>`/`<link>` be read as *direct*
 * children of their `<marker_set>` (`cmmMarkers.ts:6-11`) instead of matching
 * every tag in the file.
 */
function parseCmmDocument(xmlText: string): CmmElement {
  const open: CmmElement[] = [];
  let root: CmmElement | undefined;
  let index = 0;

  while (index < xmlText.length) {
    const tagStart = xmlText.indexOf("<", index);
    const text = tagStart === -1 ? xmlText.slice(index) : xmlText.slice(index, tagStart);
    if (open.length === 0 && text.trim() !== "") throw invalidXml("text outside the root element");
    if (tagStart === -1) break;
    index = tagStart;

    if (xmlText.startsWith("<!--", index)) {
      index = skipTo(xmlText, index + 4, "-->", "comment");
      continue;
    }
    if (xmlText.startsWith("<![CDATA[", index)) {
      index = skipTo(xmlText, index + 9, "]]>", "CDATA section");
      continue;
    }
    if (xmlText.startsWith("<!", index)) {
      index = skipDeclaration(xmlText, index);
      continue;
    }
    if (xmlText.startsWith("<?", index)) {
      index = skipTo(xmlText, index + 2, "?>", "processing instruction");
      continue;
    }
    if (xmlText.startsWith("</", index)) {
      index = closeElement(xmlText, index, open);
      continue;
    }

    const tag = readOpenTag(xmlText, index);
    const parent = open[open.length - 1];
    if (parent === undefined) {
      if (root !== undefined) throw invalidXml("more than one root element");
      root = tag.element;
    } else {
      parent.children.push(tag.element);
    }
    if (!tag.selfClosing) open.push(tag.element);
    index = tag.end;
  }

  const unclosed = open[open.length - 1];
  if (unclosed !== undefined) throw invalidXml(`unclosed <${unclosed.name}> element`);
  if (root === undefined) throw invalidXml("no root element");
  return root;
}

/** Every descendant named `name`, in document order (the root included). */
function collectElements(element: CmmElement, name: string, found: CmmElement[] = []): CmmElement[] {
  if (element.name === name) found.push(element);
  for (const child of element.children) collectElements(child, name, found);
  return found;
}

/** `<marker_set>`'s own `<marker>`/`<link>` children; nested elements do not count. */
function directChildren(element: CmmElement, name: string): CmmElement[] {
  return element.children.filter((child) => child.name === name);
}

function parseOptionalNumber(element: CmmElement, attributeName: string, defaultValue: number): number {
  const rawValue = element.attributes.get(attributeName);
  if (rawValue === undefined || rawValue.trim() === "") return defaultValue;

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue)) throw new Error(`invalid ${attributeName}`);
  return parsedValue;
}

function parsePositiveOptionalNumber(element: CmmElement, attributeName: string, defaultValue: number): number {
  const parsedValue = parseOptionalNumber(element, attributeName, defaultValue);
  if (parsedValue <= 0) throw new Error(`${attributeName} must be greater than 0`);
  return parsedValue;
}

function parseRequiredNumber(element: CmmElement, attributeName: string): number {
  const rawValue = element.attributes.get(attributeName);
  if (rawValue === undefined || rawValue.trim() === "") throw new Error(`missing ${attributeName}`);

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue)) throw new Error(`invalid ${attributeName}`);
  return parsedValue;
}

/**
 * A marker-scoped message, so the reader knows which `<marker>` to fix.
 *
 * The reference spells this `Invalid CMM marker${" marker " + id}` and prints
 * "marker marker 1"; that doubled word is dropped here. Nothing observable
 * depends on the extra word, and the id is still named.
 */
function markerError(markerId: string | null, reason: string): Error {
  const markerLabel = markerId ? ` ${markerId}` : "";
  return new Error(`Invalid CMM marker${markerLabel}: ${reason}.`);
}

function toHexComponent(value: number): string {
  const clamped = Math.min(Math.max(value, 0), 1);
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

function readColor(element: CmmElement, defaultRed: number, defaultGreen: number, defaultBlue: number): string {
  const red = parseOptionalNumber(element, "r", defaultRed);
  const green = parseOptionalNumber(element, "g", defaultGreen);
  const blue = parseOptionalNumber(element, "b", defaultBlue);
  return `#${toHexComponent(red)}${toHexComponent(green)}${toHexComponent(blue)}`;
}

function parseMarkerSet(markerSetElement: CmmElement, label: string): MarkerSet {
  // Marker ids are scoped to their marker_set: a link only reaches markers of its own set.
  const indexById = new Map<string, number>();
  const markers = directChildren(markerSetElement, "marker").map((markerElement, index): Marker => {
    const id = markerElement.attributes.get("id")?.trim() ?? "";
    if (!id) throw markerError(null, "missing id");

    try {
      const marker: Marker = {
        position: [
          parseRequiredNumber(markerElement, "x"),
          parseRequiredNumber(markerElement, "y"),
          parseRequiredNumber(markerElement, "z"),
        ],
        radius: parsePositiveOptionalNumber(markerElement, "radius", 1) * CMM_MARKER_RADIUS_SCALE,
        color: readColor(markerElement, 1, 0, 0),
      };
      indexById.set(id, index);
      return marker;
    } catch (error) {
      if (error instanceof Error) throw markerError(id, error.message);
      throw error;
    }
  });

  if (markers.length === 0) throw new Error(`CMM marker_set ${label} contains no markers.`);

  const markerIndex = (id: string, attributeName: string): number => {
    if (!id) throw new Error(`Invalid CMM link: missing ${attributeName}.`);
    const index = indexById.get(id);
    if (index === undefined) throw new Error(`Invalid CMM link: unknown marker id ${id}.`);
    return index;
  };

  // Links are resolved after every marker, so a link may name a marker declared later.
  const links = directChildren(markerSetElement, "link").map(
    (linkElement): MarkerLink => ({
      from: markerIndex(linkElement.attributes.get("id1")?.trim() ?? "", "id1"),
      to: markerIndex(linkElement.attributes.get("id2")?.trim() ?? "", "id2"),
      radius: parsePositiveOptionalNumber(linkElement, "radius", 0.2),
      color: readColor(linkElement, 1, 1, 1),
    }),
  );

  return { label, markers, links };
}

/**
 * Parse every `<marker_set>` of a CMM file, in file order. A file with one set
 * is labelled by its file label; with several, each set is labelled
 * `<set name> · <file>` (unnamed sets by their position).
 *
 * Throws a descriptive error for invalid XML, a file without a `<marker_set>`,
 * a set with no markers, missing or invalid attributes, and links to an unknown
 * marker id — the same rejections the BioViewer reference makes.
 */
export function parseCmmMarkerSets(xmlText: string, fileLabel: string): MarkerSet[] {
  const markerSetElements = collectElements(parseCmmDocument(xmlText), "marker_set");
  if (markerSetElements.length === 0) throw new Error("CMM file does not contain a marker_set element.");

  return markerSetElements.map((markerSetElement, index) => {
    if (markerSetElements.length === 1) return parseMarkerSet(markerSetElement, fileLabel);

    const name = markerSetElement.attributes.get("name")?.trim() || `marker set ${index + 1}`;
    return parseMarkerSet(markerSetElement, `${name} · ${fileLabel}`);
  });
}
