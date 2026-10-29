import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const validator = join(repo, "scripts/check-specs.mjs");
const template = readFileSync(join(repo, "specs/000-template.md"), "utf8");
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const active = "001-example.md";
const archived = "archive/002-example.md";
const row = (file: string) => `| [Spec](${file}) | Active | Fixture |\n`;
function index(activeRows = "", archiveRows = "") {
  return `# Specs\n\n[Template](000-template.md)\n\n## Active specs\n\n| Spec | Status | Outcome |\n| --- | --- | --- |\n${activeRows}\n## Archived specs\n\n| Spec | Completed | Outcome |\n| --- | --- | --- |\n${archiveRows}`;
}
function write(dir: string, file: string, value: string) {
  writeFileSync(join(dir, "specs", file), value);
}
function mutate(dir: string, file: string, from: string, to: string) {
  const source = readFileSync(join(dir, "specs", file), "utf8");
  expect(source).toContain(from); // A fixture mutation must actually land.
  write(dir, file, source.replace(from, to));
}
function spec(id: string, status = "Active") {
  return template.replaceAll("NNN", id).replace("status: Draft", `status: ${status}`)
    .replaceAll("YYYY-MM-DD", "2026-10-29");
}
function fixture(populated = true) {
  const dir = mkdtempSync(join(tmpdir(), "bioviewer-specs-"));
  temporary.push(dir);
  mkdirSync(join(dir, "specs/archive"), { recursive: true });
  write(dir, "000-template.md", template);
  write(dir, "README.md", index(populated ? row(active) : "", populated ? row(archived) : ""));
  if (populated) {
    write(dir, active, spec("001"));
    write(dir, archived, spec("002", "Completed"));
  }
  return dir;
}
function run(dir: string) {
  const result = Bun.spawnSync([process.execPath, validator], { cwd: dir });
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}
function passes(dir: string) {
  expect(run(dir)).toEqual({ code: 0, output: "Specs check passed.\n" });
}
function fails(dir: string, diagnostic: string) {
  const result = run(dir);
  expect(result.code).toBe(1);
  expect(result.output).toContain("Specs check failed:");
  expect(result.output).toContain(diagnostic);
}

test("repository tree passes the real validator", () => passes(repo));
test("empty index and template pass", () => passes(fixture(false)));
test("indexed active and archived specs pass", () => passes(fixture()));
test("archive transition passes before and after moving file and index together", () => {
  const dir = fixture();
  passes(dir);
  mutate(dir, active, "status: Active", "status: Completed");
  renameSync(join(dir, "specs", active), join(dir, "specs/archive", active));
  write(dir, "README.md", index("", row("archive/" + active) + row(archived)));
  passes(dir);
});
test("template must retain flat frontmatter and required headings", () => {
  const dir = fixture(false);
  mutate(dir, "000-template.md", "## Context", "## Removed");
  mutate(dir, "000-template.md", 'title: "Spec title"', "title: [invalid]");
  fails(dir, 'heading "Context" must occur exactly once');
  fails(dir, "structured or unsupported frontmatter scalar for title");
});
test("Draft, leap dates, scalar quoting, optional subsections and fenced decoys pass", () => {
  const dir = fixture();
  mutate(dir, active, "status: Active", "status: Draft");
  mutate(dir, active, "created: 2026-10-29", "created: 2024-02-29");
  mutate(dir, active, 'title: "Spec title"', "title: '[a scalar]'");
  write(dir, active, readFileSync(join(dir, "specs", active), "utf8")
    + "\n### Optional\n````md\n## Context\n```\n## Context\n````\n~~~md\n## Verification\n~~~\n");
  passes(dir);
});

for (const file of ["README.md", "000-template.md", "archive"]) {
  test(`missing ${file} fails`, () => {
    const dir = fixture();
    rmSync(join(dir, "specs", file), { recursive: true });
    fails(dir, file === "archive" ? "required directory missing" : `${file}: required file missing`);
  });
}
test("missing specs directory reports all missing scaffolding", () => {
  const dir = fixture();
  rmSync(join(dir, "specs"), { recursive: true });
  fails(dir, "required directory missing");
  fails(dir, "README.md: required file missing");
});
for (const filename of ["001-Bad.md", "1-example.md", "000-other.md"]) {
  test(`invalid/reserved filename ${filename} fails`, () => {
    const dir = fixture();
    renameSync(join(dir, "specs", active), join(dir, "specs", filename));
    fails(dir, filename.startsWith("000") ? "000 is reserved" : "invalid formal filename");
  });
}
for (const [from, to, diagnostic] of [
  ['id: "001"', 'id: "003"', "frontmatter id must match filename 001"],
  ["status: Active", "status: Completed", "status must be Draft or Active"],
  ["status: Active", "status: Blocked", "status must be Draft or Active"],
  ["## Context", "## Removed", 'heading "Context" must occur exactly once (found 0)'],
  ["## Context", "## Context\n\n## Context", 'heading "Context" must occur exactly once (found 2)'],
  ["created: 2026-10-29", "created: 2026-02-30", "created must be a real YYYY-MM-DD date"],
  ["updated: 2026-10-29", "updated: 2026-13-01", "updated must be a real YYYY-MM-DD date"],
  ["updated: 2026-10-29", "updated: 2026-10-28", "updated precedes created"],
  ["coordinator: \"Responsible coordinator\"\n", "", "missing required frontmatter key coordinator"],
  ["coordinator: \"Responsible coordinator\"", 'coordinator: ""', "empty frontmatter value for coordinator"],
  ["status: Active", "status: Active\nstatus: Draft", "duplicate frontmatter key status"],
  ['title: "Spec title"', 'title: "unterminated', "invalid quoted scalar for title"],
  ['title: "Spec title"', "title: 'unterminated", "invalid quoted scalar for title"],
  ['title: "Spec title"', "title:   ", "empty frontmatter value for title"],
  ["---\n", "", "missing flat frontmatter"],
] as const) {
  test(`rejects ${diagnostic}`, () => {
    const dir = fixture();
    mutate(dir, active, from, to);
    fails(dir, diagnostic);
  });
}
for (const value of ["[one]", "{name: one}", "|", ">", "&anchor text", "*alias", "!!str text", "- item", "null", "~"]) {
  test(`rejects structured/non-scalar frontmatter ${value}`, () => {
    const dir = fixture();
    mutate(dir, active, 'title: "Spec title"', `title: ${value}`);
    fails(dir, "structured or unsupported frontmatter scalar for title");
  });
}
test("rejects indented nested YAML", () => {
  const dir = fixture();
  mutate(dir, active, 'title: "Spec title"', "title: nested\n  key: value");
  fails(dir, "frontmatter must contain only non-empty flat scalar");
});
test("archive rejects non-Completed", () => {
  const dir = fixture();
  mutate(dir, archived, "status: Completed", "status: Active");
  fails(dir, "status must be Completed");
});
test("duplicate IDs across directories fail", () => {
  const dir = fixture();
  write(dir, "archive/001-copy.md", spec("001", "Completed"));
  fails(dir, "duplicate spec id 001");
});
test("ID gaps fail", () => {
  const dir = fixture();
  renameSync(join(dir, "specs", active), join(dir, "specs/003-example.md"));
  fails(dir, "ID gap: expected 001");
});
for (const [name, content, diagnostic] of [
  ["missing", index("", row(archived)), `${active} must be indexed exactly once (found 0)`],
  ["duplicate", index(row(active) + row(active), row(archived)), `${active} must be indexed exactly once (found 2)`],
  ["wrong section", index(row(active) + row(archived)), `wrong section or path for ${archived}`],
  ["broken", index(row("003-missing.md"), row(archived)), "broken index link 003-missing.md"],
  ["wrong path", index(row("./" + active), row(archived)), `wrong section or path for ./${active}`],
  ["non-table", index(`[Spec](${active})\n`, row(archived)), `wrong section or path for ${active}`],
  ["missing template", index(row(active), row(archived)).replace("[Template](000-template.md)", ""), "template must be linked exactly once"],
  ["duplicate template", index(row(active), row(archived)) + "\n[Again](000-template.md)", "template must be linked exactly once"],
  ["missing section", index(row(active), row(archived)).replace("## Active specs", "## Else"), 'section "Active specs" must occur exactly once'],
] as const) {
  test(`index ${name} fails`, () => {
    const dir = fixture();
    write(dir, "README.md", content);
    fails(dir, diagnostic);
  });
}
test("out-of-order index fails", () => {
  const dir = fixture();
  write(dir, "003-third.md", spec("003"));
  write(dir, "README.md", index(row("003-third.md") + row(active), row(archived)));
  fails(dir, "index links out of order in Active specs");
});
test("reports independent failures together", () => {
  const dir = fixture();
  mutate(dir, active, "status: Active", "status: Blocked");
  mutate(dir, active, "## Context", "## Removed");
  const result = run(dir);
  expect(result.code).toBe(1);
  expect(result.output).toContain("status must be Draft or Active");
  expect(result.output).toContain('heading "Context"');
});
test("historical verification bytes and migration link are preserved", () => {
  const bytes = readFileSync(join(repo, "specs/archive/evidence/verification-revision-7.md"));
  expect(createHash("sha256").update(bytes).digest("hex"))
    .toBe("33434bd14decd5dbfa1cffa8fc0069e25b6ec2ff824b3ab6f2ef45bc6ce7790f");
  expect(bytes.toString().match(/\n/g)?.length).toBe(1296);
  expect(readFileSync(join(repo, "docs/VERIFICATION.md"), "utf8"))
    .toContain("../specs/archive/evidence/verification-revision-7.md");
});
test("local and CI gates keep spec validation before build and include docs-only changes", () => {
  const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  expect(manifest.packageManager).toBe("bun@1.4.4");
  expect(manifest.scripts["check:specs"]).toBe("bun scripts/check-specs.mjs");
  const gate: string = manifest.scripts["verify:fast"];
  expect(gate).toContain("bun run check:specs");
  expect(gate.indexOf("bun run check:specs")).toBeLessThan(gate.indexOf("bun run build"));
  const workflow = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
  expect(workflow).toContain('bun-version: "1.4.4"');
  expect(workflow).toContain("run: bun run verify:fast");
  expect(workflow).toContain("pull_request:");
  expect(workflow).not.toContain("paths-ignore:");
  expect(workflow).not.toMatch(/^\s+paths:/m);
});
