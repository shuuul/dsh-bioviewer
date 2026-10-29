import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Deliberately a flat scalar contract, not a general-purpose YAML parser.
const problems = [];
const root = resolve(process.cwd(), "specs");
const required = ["id", "title", "status", "created", "updated", "coordinator"];
const headings = ["Context", "Goal and success criteria", "Scope and non-goals",
  "Decisions", "Workstreams", "Verification", "Documentation sync",
  "Progress and handoff", "Completion summary"];
const formal = /^([0-9]{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const fail = (file, message) => problems.push(`${file}: ${message}`);
const isFile = (path) => existsSync(path) && statSync(path).isFile();
const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();

function outsideFences(source) {
  let fence;
  return source.split(/\r?\n/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
        && !marker[2].trim()) fence = undefined;
      return "";
    }
    if (marker) { fence = marker[1]; return ""; }
    return line;
  });
}

function checkHeadings(file, body) {
  const found = outsideFences(body).map((line) => /^##\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1]);
  for (const heading of headings) {
    const count = found.filter((value) => value === heading).length;
    if (count !== 1) fail(file, `heading "${heading}" must occur exactly once (found ${count})`);
  }
}

function frontmatter(file, source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  const values = Object.create(null);
  if (!match) { fail(file, "missing flat frontmatter"); return values; }
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([a-z][a-z0-9_-]*):[ \t]+(.+)$/.exec(line);
    if (!pair) { fail(file, "frontmatter must contain only non-empty flat scalar key: value lines"); continue; }
    const [, key, raw] = pair;
    let value = raw.trim();
    if (Object.hasOwn(values, key)) fail(file, `duplicate frontmatter key ${key}`);
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
        if (typeof value !== "string") throw new Error("not a string");
      } catch { fail(file, `invalid quoted scalar for ${key}`); value = ""; }
    } else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) { fail(file, `invalid quoted scalar for ${key}`); value = ""; }
      else value = value.slice(1, -1).replaceAll("''", "'");
    } else if (/^[[\]{}|>&*!#?%@`"']/.test(value) || /^-(?:\s|$)/.test(value)
      || /:\s|\s#/.test(value) || /^(?:null|~)$/i.test(value)) {
      fail(file, `structured or unsupported frontmatter scalar for ${key}`);
      value = "";
    }
    values[key] = value;
    if (!value.trim()) fail(file, `empty frontmatter value for ${key}`);
  }
  for (const key of required) if (!values[key]) fail(file, `missing required frontmatter key ${key}`);
  return values;
}

for (const dir of [root, resolve(root, "archive")]) {
  if (!isDirectory(dir)) fail(dir, "required directory missing");
}
for (const file of ["README.md", "000-template.md"]) {
  if (!isFile(resolve(root, file))) fail(file, "required file missing");
}
if (isFile(resolve(root, "000-template.md"))) {
  const source = readFileSync(resolve(root, "000-template.md"), "utf8");
  frontmatter("000-template.md", source);
  checkHeadings("000-template.md", source);
}

const specs = [];
for (const prefix of ["", "archive/"]) {
  const dir = resolve(root, prefix);
  if (!isDirectory(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // Historical artifacts live in archive/evidence/.
    const file = prefix + entry.name;
    if (!prefix && ["README.md", "000-template.md"].includes(entry.name)) continue;
    const filename = formal.exec(entry.name);
    if (!filename) { fail(file, "invalid formal filename; expected NNN-kebab-case.md"); continue; }
    const id = filename[1];
    if (id === "000") fail(file, "000 is reserved for the template");
    const source = readFileSync(resolve(root, file), "utf8");
    const data = frontmatter(file, source);
    if (data.id !== id) fail(file, `frontmatter id must match filename ${id}`);
    const allowed = prefix ? ["Completed"] : ["Draft", "Active"];
    if (!allowed.includes(data.status)) fail(file, `status must be ${allowed.join(" or ")}`);
    for (const key of ["created", "updated"]) {
      const date = data[key];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
        || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        fail(file, `${key} must be a real YYYY-MM-DD date`);
      }
    }
    if (data.created && data.updated && data.updated < data.created) fail(file, "updated precedes created");
    checkHeadings(file, source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""));
    if (specs.some((spec) => spec.id === id)) fail(file, `duplicate spec id ${id}`);
    specs.push({ file, id, section: prefix ? "Archived specs" : "Active specs" });
  }
}
const ids = [...new Set(specs.map((spec) => Number(spec.id)))].filter((id) => id > 0).sort((a, b) => a - b);
for (let i = 0; i < ids.length; i++) {
  if (ids[i] !== i + 1) { fail("specs", `ID gap: expected ${String(i + 1).padStart(3, "0")}`); break; }
}

if (isFile(resolve(root, "README.md"))) {
  const lines = outsideFences(readFileSync(resolve(root, "README.md"), "utf8"));
  const links = [];
  let section = "";
  const sectionCounts = new Map();
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
    }
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      if (!isFile(resolve(root, target))) fail("README.md", `broken index link ${target}`);
      links.push({ target, section, table: /^\s*\|/.test(line) });
    }
  }
  for (const name of ["Active specs", "Archived specs"]) {
    if (sectionCounts.get(name) !== 1) fail("README.md", `section "${name}" must occur exactly once`);
    const indexed = links.filter((link) => link.section === name && link.target !== "000-template.md");
    let previous = 0;
    for (const link of indexed) {
      const spec = specs.find((item) => item.file === link.target);
      if (!spec || spec.section !== name || !link.table) fail("README.md", `wrong section or path for ${link.target}`);
      const id = Number(/(?:^|\/)(\d{3})-/.exec(link.target)?.[1]);
      if (id <= previous) fail("README.md", `index links out of order in ${name}`);
      previous = id;
    }
  }
  if (links.filter((link) => link.target === "000-template.md").length !== 1) {
    fail("README.md", "template must be linked exactly once");
  }
  for (const spec of specs) {
    const matches = links.filter((link) => link.target === spec.file);
    if (matches.length !== 1) fail("README.md", `${spec.file} must be indexed exactly once (found ${matches.length})`);
    for (const link of matches) {
      if (link.section !== spec.section || !link.table) fail("README.md", `wrong section or path for ${spec.file}`);
    }
  }
}

if (problems.length) {
  console.error(`Specs check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  process.exitCode = 1;
} else console.log("Specs check passed.");
