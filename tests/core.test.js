import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSkillMarkdown,
  createGoalId,
  createGoalSkill,
  formatLoopEligibilityMarkdown,
  formatHandoffMarkdown,
  installIntoProject,
  installGlobalCommand,
  listGoalHandoffs,
  normalizeLoopEligibility,
  readGoalHandoffs,
  recordHandoff,
  resolveGlobalConfigDir,
  safeResolveInside,
  projectRootFromContext,
  slugify,
} from "../src/core.js";

const fixedDate = new Date("2026-06-25T08:30:15.000Z");

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), "goalkit-test-"));
}

function passingLoopEligibility() {
  return {
    repeats: {
      passed: true,
      evidence: "User says this audit workflow will be reused across multiple performance investigations.",
    },
    automatedVerification: {
      passed: true,
      evidence: "`npm test` fails automatically when the workflow is broken.",
    },
    tokenBudget: {
      passed: true,
      evidence: "One execution pass, one correction pass, and two verification passes maximum.",
    },
    seniorTools: {
      passed: true,
      evidence: "Agent can read source, run tests, inspect output, and reproduce failures locally.",
    },
  };
}

test("slugify creates stable lowercase slugs", () => {
  assert.equal(slugify("Ship Goal Loop Plugin!!"), "ship-goal-loop-plugin");
  assert.equal(slugify("../../escape"), "escape");
  assert.equal(slugify(""), "goal");
});

test("createGoalId is timestamped, safe, and bounded", () => {
  const id = createGoalId("Build a goal command that loops through a very long implementation plan", fixedDate);
  assert.match(id, /^goal-20260625-083015-build-a-goal-command/);
  assert.ok(id.length <= 64);
});

test("safeResolveInside rejects path traversal", () => {
  const root = path.join(os.tmpdir(), "root");
  assert.equal(safeResolveInside(root, "a", "b"), path.join(root, "a", "b"));
  assert.throws(() => safeResolveInside(root, "..", "outside"), /Refusing to write outside/);
});

test("projectRootFromContext prefers current project directory and rejects root-only contexts", () => {
  assert.equal(projectRootFromContext({ directory: "/repo", worktree: "/" }), "/repo");
  assert.equal(projectRootFromContext({ directory: "/", worktree: "/repo" }), "/repo");
  assert.equal(projectRootFromContext({ directory: "/repo", worktree: "/other" }), "/repo");

  assert.throws(
    () => projectRootFromContext({ directory: "/", worktree: "/" }),
    /Goal artifacts must be written inside project \.agents and \.opencode directories/,
  );
  assert.throws(
    () => projectRootFromContext({}),
    /Goal artifacts must be written inside project \.agents and \.opencode directories/,
  );
});

test("resolveGlobalConfigDir follows OpenCode env precedence", () => {
  assert.equal(
    resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "/tmp/opencode-custom", XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/alice"),
    "/tmp/opencode-custom",
  );
  assert.equal(
    resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/alice"),
    "/tmp/xdg/opencode",
  );
  assert.equal(
    resolveGlobalConfigDir({}, "/home/alice"),
    "/home/alice/.config/opencode",
  );
  assert.throws(() => resolveGlobalConfigDir({}, ""), /Cannot resolve global OpenCode config directory/);
});

test("handoff markdown preserves required headings and typo", () => {
  const markdown = formatHandoffMarkdown({
    goal: "Goal",
    description: "Do work",
    achieved: true,
    findings: "Found it",
    notes: "No notes",
    timestamp: "2026-06-25T08:30:15.000Z",
  });

  assert.equal(markdown, `#goal\nGoal\n\n#description\nDo work\n\n#acheieved: yes\n\n#findings\nFound it\n\n#notes\nNo notes\n\n#timestamp\n2026-06-25T08:30:15.000Z\n`);
});

test("formatLoopEligibilityMarkdown renders pass and fail evidence", () => {
  const passed = formatLoopEligibilityMarkdown(passingLoopEligibility());
  assert.match(passed, /## repeats: pass/);
  assert.match(passed, /Evidence: User says this audit workflow will be reused across multiple performance investigations\./);
  assert.match(passed, /## automated_verification: pass/);

  const missingAutomatedVerification = formatLoopEligibilityMarkdown({
    ...passingLoopEligibility(),
    automatedVerification: {
      passed: false,
      evidence: "",
    },
  });
  assert.match(missingAutomatedVerification, /## automated_verification: fail/);
  assert.match(missingAutomatedVerification, /Evidence: Missing evidence/);

  const missingRecurrence = formatLoopEligibilityMarkdown({
    ...passingLoopEligibility(),
    repeats: {
      passed: false,
      evidence: "This is a one-time request.",
    },
  });
  assert.match(missingRecurrence, /## repeats: fail/);
  assert.match(missingRecurrence, /Evidence: This is a one-time request\./);
});

test("normalizeLoopEligibility blocks missing or failed conditions", () => {
  assert.deepEqual(normalizeLoopEligibility(passingLoopEligibility()), passingLoopEligibility());

  assert.throws(
    () => normalizeLoopEligibility({
      ...passingLoopEligibility(),
      automatedVerification: {
        passed: false,
        evidence: "",
      },
    }),
    /Loop not justified: automated_verification did not pass; automated_verification is missing evidence/,
  );

  assert.throws(
    () => normalizeLoopEligibility({
      ...passingLoopEligibility(),
      repeats: {
        passed: false,
        evidence: "This is a one-time request.",
      },
    }),
    /Loop not justified: repeats did not pass/,
  );
});

test("buildSkillMarkdown includes execution workflow and handoff contract", () => {
  const markdown = buildSkillMarkdown({
    goalId: "goal-20260625-083015-loop",
    goal: "Loop engineering",
    plan: "Plan the work.",
    loopEligibility: passingLoopEligibility(),
    createdAt: "2026-06-25T08:30:15.000Z",
    phases: [{ name: "Discover", objective: "Find facts", subagents: ["explore"] }],
    subagentTasks: [{ role: "explore", task: "Map the repo", phase: "Discover", parallelWith: ["scout"] }],
    acceptanceCriteria: ["Handoffs recorded"],
  });

  assert.match(markdown, /^---\nname: goal-20260625-083015-loop/m);
  assert.match(markdown, /compatibility: Requires OpenCode goalkit plugin tools for handoff persistence\./);
  assert.match(markdown, /# Four-Condition Loop Test/);
  assert.match(markdown, /## repeats: pass/);
  assert.match(markdown, /## automated_verification: pass/);
  assert.match(markdown, /# Execution Workflow/);
  assert.match(markdown, /# Subagent Tasks\n## 1\. explore\nTask: Map the repo/);
  assert.match(markdown, /Parallel with: scout/);
  assert.match(markdown, /goal_record_handoff/);
  assert.match(markdown, /# Isolated Verification Loop/);
  assert.match(markdown, /goal_list_handoffs/);
  assert.match(markdown, /agent: verification-agent/);
  assert.match(markdown, /Isolated verification pass 2/);
  assert.match(markdown, /#acheieved: yes\/no/);
});

test("createGoalSkill writes skill and goal files without overwriting", async () => {
  const project = await tempProject();
  try {
    const result = await createGoalSkill(project, {
      goal: "Build loop",
      plan: "Approved plan",
      loopEligibility: passingLoopEligibility(),
      phases: [{ name: "Implement", objective: "Write code" }],
      acceptanceCriteria: ["Tests pass"],
    }, { now: fixedDate });

    assert.equal(result.goalId, "goal-20260625-083015-build-loop");
    assert.equal(result.skillPath, path.join(project, ".agents", "skills", "goal-20260625-083015-build-loop", "SKILL.md"));
    assert.equal(result.goalPath, path.join(project, ".opencode", "goals", "goal-20260625-083015-build-loop", "goal.md"));
    assert.equal(result.handoffDir, path.join(project, ".opencode", "goals", "goal-20260625-083015-build-loop", "handoffs"));
    assert.match(await readFile(result.skillPath, "utf8"), /# Goal\nBuild loop/);
    assert.match(await readFile(result.skillPath, "utf8"), /# Four-Condition Loop Test/);
    assert.match(await readFile(result.skillPath, "utf8"), /^name: goal-20260625-083015-build-loop$/m);

    const goalRecord = await readFile(result.goalPath, "utf8");
    assert.match(goalRecord, /# Status\napproved/);
    assert.match(goalRecord, /# Canonical Skill Path\n\.agents\/skills\/goal-20260625-083015-build-loop\/SKILL\.md/);
    assert.match(goalRecord, /# Handoff Directory\n\.opencode\/goals\/goal-20260625-083015-build-loop\/handoffs/);
    assert.match(goalRecord, /Follow the canonical Agent Skill/);
    assert.doesNotMatch(goalRecord, /# Plan\nApproved plan/);
    assert.doesNotMatch(goalRecord, /## senior_tools: pass/);

    await assert.rejects(
      () => readFile(path.join(project, ".opencode", "skills", "goal-20260625-083015-build-loop", "SKILL.md"), "utf8"),
      /ENOENT/,
    );

    await assert.rejects(
      () => createGoalSkill(project, {
        goalId: result.goalId,
        goal: "Build loop",
        plan: "Approved plan",
        loopEligibility: passingLoopEligibility(),
      }, { now: fixedDate }),
      /Refusing to overwrite/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("createGoalSkill blocks failed loop eligibility before writing files", async () => {
  const project = await tempProject();
  try {
    const loopEligibility = {
      ...passingLoopEligibility(),
      automatedVerification: {
        passed: false,
        evidence: "",
      },
    };

    await assert.rejects(
      () => createGoalSkill(project, {
        goal: "Build loop",
        plan: "Approved plan",
        loopEligibility,
      }, { now: fixedDate }),
      /Loop not justified: automated_verification did not pass; automated_verification is missing evidence/,
    );

    await assert.rejects(
      () => readFile(path.join(project, ".agents", "skills", "goal-20260625-083015-build-loop", "SKILL.md"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("createGoalSkill refuses filesystem root project path", async () => {
  await assert.rejects(
    () => createGoalSkill("/", {
      goal: "Build loop",
      plan: "Approved plan",
      loopEligibility: passingLoopEligibility(),
    }, { now: fixedDate }),
    /Goal artifacts must be written inside project \.agents and \.opencode directories/,
  );
});

test("recordHandoff writes normalized markdown under the goal handoff directory", async () => {
  const project = await tempProject();
  try {
    await createGoalSkill(project, {
      goal: "Build loop",
      plan: "Approved plan",
      loopEligibility: passingLoopEligibility(),
    }, { now: fixedDate });

    const result = await recordHandoff(project, {
      goalId: "goal-20260625-083015-build-loop",
      agent: "Explore Agent",
      goal: "Build loop",
      description: "Inspect files",
      achieved: false,
      findings: "No files",
      notes: "Empty repo",
      timestamp: "2026-06-25T08:31:00.000Z",
    });

    assert.match(result.handoffPath, /\.opencode\/goals\/goal-20260625-083015-build-loop\/handoffs\/20260625083100-explore-agent\.md$/);
    assert.match(await readFile(result.handoffPath, "utf8"), /#acheieved: no/);
    assert.deepEqual(await listGoalHandoffs(project, "goal-20260625-083015-build-loop"), ["20260625083100-explore-agent.md"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("readGoalHandoffs returns ordered paths and contents for verification", async () => {
  const project = await tempProject();
  try {
    await createGoalSkill(project, {
      goal: "Build loop",
      plan: "Approved plan",
      loopEligibility: passingLoopEligibility(),
    }, { now: fixedDate });

    await recordHandoff(project, {
      goalId: "goal-20260625-083015-build-loop",
      agent: "Execution Agent",
      goal: "Build loop",
      description: "Implement task",
      achieved: true,
      findings: "Implemented",
      notes: "None",
      timestamp: "2026-06-25T08:32:00.000Z",
    });

    await recordHandoff(project, {
      goalId: "goal-20260625-083015-build-loop",
      agent: "verification-agent",
      goal: "Build loop",
      description: "Isolated verification pass 1",
      achieved: true,
      findings: "All execution handoffs prove completion",
      notes: "None",
      timestamp: "2026-06-25T08:33:00.000Z",
    });

    const handoffs = await readGoalHandoffs(project, "goal-20260625-083015-build-loop");
    assert.deepEqual(handoffs.map((handoff) => handoff.name), [
      "20260625083200-execution-agent.md",
      "20260625083300-verification-agent.md",
    ]);
    assert.match(handoffs[0].path, /\.opencode\/goals\/goal-20260625-083015-build-loop\/handoffs\/20260625083200-execution-agent\.md$/);
    assert.match(handoffs[0].content, /#findings\nImplemented/);
    assert.match(handoffs[1].content, /#description\nIsolated verification pass 1/);

    assert.deepEqual(await readGoalHandoffs(project, "goal-20260625-083015-missing"), []);
    await assert.rejects(() => readGoalHandoffs(project, "../outside"), /Invalid goal id/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("installIntoProject installs command, plugin wrapper, runtime, and merges package json", async () => {
  const project = await tempProject();
  try {
    const opencodeDir = path.join(project, ".opencode");
    await writeFile(path.join(project, "README.md"), "fixture\n");

    const result = await installIntoProject({ target: project });
    assert.equal(result.commandPath, path.join(opencodeDir, "commands", "goal.md"));
    assert.equal(result.grillCommandPath, path.join(opencodeDir, "commands", "grill.md"));

    assert.match(await readFile(path.join(opencodeDir, "commands", "goal.md"), "utf8"), /Approve this plan/);
    const commandTemplate = await readFile(path.join(opencodeDir, "commands", "goal.md"), "utf8");
    assert.match(commandTemplate, /perform grill-style clarification/);
    assert.match(commandTemplate, /ask no more than 7 clarification questions total/);
    assert.match(commandTemplate, /use the `question` tool when available/);
    assert.ok(commandTemplate.indexOf("Run the 4-condition loop test") < commandTemplate.indexOf("Approve this plan"));
    assert.ok(commandTemplate.indexOf("Loop not justified") < commandTemplate.indexOf("After explicit approval, call `goal_create_skill`"));
    assert.match(commandTemplate, /do not call `goal_create_skill`/);
    assert.match(commandTemplate, /`loopEligibility`/);
    assert.match(commandTemplate, /Maximum execution time:/);
    assert.match(commandTemplate, /Verification checks:/);
    assert.match(commandTemplate, /Whether this workflow will be reused:/);
    assert.match(commandTemplate, /LCP, TTFB, Lighthouse performance score/);
    assert.match(commandTemplate, /current project `.agents\/skills` directory/);
    assert.match(commandTemplate, /current project `.opencode\/goals` directory/);
    assert.match(commandTemplate, /Restart OpenCode from the target project directory/);
    assert.match(commandTemplate, /Do not launch subagents and do not continue execution/);
    assert.doesNotMatch(commandTemplate, /recurs weekly/);
    assert.doesNotMatch(commandTemplate, /weekly automation/);

    const grillTemplate = await readFile(path.join(opencodeDir, "commands", "grill.md"), "utf8");
    assert.match(grillTemplate, /Ask bounded one-at-a-time design questions/);
    assert.match(grillTemplate, /Ask exactly one question at a time/);
    assert.match(grillTemplate, /your recommended answer/);
    assert.match(grillTemplate, /Use the `question` tool when it is available/);
    assert.match(grillTemplate, /Never ask a question that can be answered by exploring the codebase/);
    assert.match(grillTemplate, /ask no more than 7 questions total/);
    assert.match(grillTemplate, /Shared understanding/);
    assert.match(await readFile(path.join(opencodeDir, "plugins", "goalkit.js"), "utf8"), /GoalLoopPlugin/);
    assert.match(await readFile(path.join(opencodeDir, "plugins", "goalkit", "plugin.js"), "utf8"), /@opencode-ai\/plugin/);

    const packageJson = JSON.parse(await readFile(path.join(opencodeDir, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@opencode-ai/plugin"], "1.14.28");

    await assert.rejects(() => installIntoProject({ target: project }), /Refusing to overwrite/);
    await installIntoProject({ target: project, force: true });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("installGlobalCommand writes only global command file", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "goalkit-global-config-"));
  try {
    const result = await installGlobalCommand({
      env: {
        OPENCODE_CONFIG_DIR: configDir,
      },
    });

    assert.equal(result.configDir, configDir);
    assert.equal(result.commandPath, path.join(configDir, "commands", "goal.md"));
    assert.equal(result.grillCommandPath, path.join(configDir, "commands", "grill.md"));
    assert.match(await readFile(result.commandPath, "utf8"), /Run the 4-condition loop test/);
    assert.match(await readFile(result.commandPath, "utf8"), /Maximum execution time:/);
    assert.match(await readFile(result.grillCommandPath, "utf8"), /Ask exactly one question at a time/);
    assert.match(await readFile(result.grillCommandPath, "utf8"), /ask no more than 7 questions total/);

    await assert.rejects(() => installGlobalCommand({
      env: {
        OPENCODE_CONFIG_DIR: configDir,
      },
    }), /Refusing to overwrite/);

    await installGlobalCommand({
      env: {
        OPENCODE_CONFIG_DIR: configDir,
      },
      force: true,
    });

    await assert.rejects(
      () => readFile(path.join(configDir, "plugins", "goalkit.js"), "utf8"),
      /ENOENT/,
    );
    await assert.rejects(
      () => readFile(path.join(configDir, "package.json"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
