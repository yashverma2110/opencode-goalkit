#!/usr/bin/env node
import { installGlobalCommand, installIntoProject } from "./core.js";

function usage() {
  return `Usage:
  opencode-goalkit install --target <project> [--force]
  opencode-goalkit install --global [--force]

Options:
  --target <project>  Project directory to install into. Defaults to cwd.
  --global            Install the /goal and /grill commands into global OpenCode config.
  --force             Replace existing goal command/plugin files.
  -h, --help          Show this help.
`;
}

function parseArgs(argv) {
  const result = {
    command: argv[0],
    target: process.cwd(),
    targetProvided: false,
    global: false,
    force: false,
    help: argv[0] === "-h" || argv[0] === "--help",
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg === "--global") {
      result.global = true;
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) throw new Error("--target requires a directory");
      result.target = value;
      result.targetProvided = true;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    console.log(usage());
    return;
  }

  if (args.command !== "install") {
    throw new Error(`Unknown command: ${args.command}`);
  }

  if (args.global && args.targetProvided) {
    throw new Error("Use either --global or --target, not both");
  }

  if (args.global) {
    const result = await installGlobalCommand({
      force: args.force,
    });

    console.log(`Installed global /goal and /grill commands into ${result.configDir}`);
    console.log(`Goal command: ${result.commandPath}`);
    console.log(`Grill command: ${result.grillCommandPath}`);
    console.log("Plugin runtime is managed by: opencode plugin opencode-goalkit --global");
    return;
  }

  const result = await installIntoProject({
    target: args.target,
    force: args.force,
  });

  console.log(`Installed /goal and /grill commands into ${result.target}`);
  console.log(`Goal command: ${result.commandPath}`);
  console.log(`Grill command: ${result.grillCommandPath}`);
  console.log(`Plugin: ${result.wrapperPath}`);
  console.log(`Runtime: ${result.runtimeDir}`);
  console.log(`Package config: ${result.packageJsonPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
