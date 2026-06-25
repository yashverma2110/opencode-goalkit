import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const cliPath = path.join(repoRoot, "src", "cli.js");

test("cli installs global command using OPENCODE_CONFIG_DIR", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "goalkit-cli-global-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "install", "--global"], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: configDir,
      },
      cwd: repoRoot,
    });

    assert.match(stdout, /Installed global \/goal and \/grill commands/);
    assert.match(stdout, /Goal command:/);
    assert.match(stdout, /Grill command:/);
    assert.match(stdout, /adding "opencode-goalkit" to the plugin list in opencode\.json/);
    assert.match(await readFile(path.join(configDir, "commands", "goal.md"), "utf8"), /Loop not justified/);
    assert.match(await readFile(path.join(configDir, "commands", "grill.md"), "utf8"), /Ask exactly one question at a time/);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("cli rejects global and target together", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "install", "--global", "--target", "/tmp/project"], {
      cwd: repoRoot,
    }),
    (error) => {
      assert.match(error.stderr, /Use either --global or --target, not both/);
      return true;
    },
  );
});
