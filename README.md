# opencode-goalkit

OpenCode plugin that adds approval-gated goal execution tools plus `/goal` and `/grill` commands.

## Getting Started

Add the plugin to your OpenCode configuration at `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-goalkit"]
}
```

Install the slash commands globally:

```sh
npx opencode-goalkit install --global
```

Restart OpenCode. You can then run:

```text
/goal implement the checkout retry workflow
```

The global command installer writes:

- `<global-opencode-config>/commands/goal.md`
- `<global-opencode-config>/commands/grill.md`

The global command installer does not copy plugin runtime files. OpenCode loads the plugin runtime from the npm package listed in your `opencode.json`.

## Project-Local Install

```sh
npx opencode-goalkit install --target /path/to/project
```

For local development from this repo:

```sh
node ./src/cli.js install --target /path/to/project
```

This writes:

- `.opencode/commands/goal.md`
- `.opencode/commands/grill.md`
- `.opencode/plugins/goalkit.js`
- `.opencode/plugins/goalkit/*.js`
- `.opencode/package.json`

## Usage

Inside OpenCode:

```text
/goal implement the checkout retry workflow
```

The command first runs a four-condition loop gate. It only creates a reusable loop when the workflow is reusable enough to justify a skill, automated or measurable verification exists, maximum execution time is bounded, and the agent has enough local tools to inspect and reproduce failures. If any condition lacks evidence, `/goal` stops with a one-shot prompt plus the information needed to make the goal loop-eligible.

After the gate passes, the command creates a plan and asks for approval. After approval, it creates a reusable Agent Skill under `.agents/skills/<goal-id>/SKILL.md`, records lightweight OpenCode goal state under `.opencode/goals/<goal-id>/goal.md`, executes the workflow, persists subagent handoffs under `.opencode/goals/<goal-id>/handoffs/`, then runs an isolated `verification-agent` pass based only on those handoffs. The `.agents/skills` file is the canonical skill; `.opencode/goals` is plugin runtime storage for goal records and handoffs.

If verification fails, the workflow runs one correction pass from the verifier handoff notes, records new handoffs, and verifies once more before asking the user how to proceed.
