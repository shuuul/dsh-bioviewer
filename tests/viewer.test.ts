import { expect, test } from "bun:test";
import { join } from "node:path";

test("database theme changes preserve the loaded structure; accession changes load a new one", () => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures/viewer-lifecycle.tsx")], {
    timeout: 5000,
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
}, 6000);
