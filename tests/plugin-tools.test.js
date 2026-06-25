import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGoalLoopToolDefinitions } from "../src/opencode-tools.js";

function fakeSchema() {
  const chain = {
    min: () => chain,
    describe: () => chain,
    optional: () => chain,
    default: () => chain,
    int: () => chain,
    positive: () => chain,
  };

  return {
    string: () => chain,
    boolean: () => chain,
    number: () => chain,
    array: () => chain,
    object: () => chain,
  };
}

function fakeTool(definition) {
  return definition;
}
fakeTool.schema = fakeSchema();

function passingLoopEligibility() {
  return {
    repeats: {
      passed: true,
      evidence: "User says this workflow will be reused.",
    },
    automatedVerification: {
      passed: true,
      evidence: "`npm test` is available.",
    },
    tokenBudget: {
      passed: true,
      evidence: "Workflow is bounded to one correction pass.",
    },
    seniorTools: {
      passed: true,
      evidence: "Agent can inspect files and run commands.",
    },
  };
}

test("plugin tools create skills and handoffs with a mocked OpenCode context", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "goalkit-plugin-test-"));
  try {
    const tools = createGoalLoopToolDefinitions(fakeTool);
    const context = {
      directory: project,
      worktree: project,
      metadataCalls: [],
      metadata(input) {
        this.metadataCalls.push(input);
      },
    };

    const skillResult = await tools.goal_create_skill.execute({
      goal: "Build loop",
      plan: "Approved plan",
      loopEligibility: passingLoopEligibility(),
      phases: [],
      acceptanceCriteria: [],
      constraints: [],
    }, context);

    assert.match(skillResult.output, /goal_id: goal-/);
    assert.match(skillResult.output, /\.agents\/skills\/goal-/);
    assert.match(skillResult.output, /state_path:/);
    assert.match(skillResult.metadata.skillPath, /\.agents\/skills\/goal-/);
    assert.match(skillResult.metadata.statePath, /\.opencode\/goals\/goal-/);
    assert.equal(context.metadataCalls[0].title, "Goal skill created");
    assert.match(context.metadataCalls[0].metadata.skillPath, /\.agents\/skills\/goal-/);

    const statusResult = await tools.goal_get_status.execute({
      goalId: skillResult.metadata.goalId,
    }, context);

    assert.match(statusResult.output, /status: active/);
    assert.equal(statusResult.metadata.status, "active");
    assert.equal(context.metadataCalls[1].title, "Goal status read");

    const handoffResult = await tools.goal_record_handoff.execute({
      goalId: skillResult.metadata.goalId,
      agent: "general",
      goal: "Build loop",
      description: "Do task",
      achieved: true,
      findings: "Done",
      notes: "None",
    }, context);

    assert.match(handoffResult.output, /handoff_path:/);
    assert.equal(context.metadataCalls[2].title, "Goal handoff recorded");

    const verificationResult = await tools.goal_record_handoff.execute({
      goalId: skillResult.metadata.goalId,
      agent: "verification-agent",
      goal: "Build loop",
      description: "Isolated verification pass 1",
      achieved: true,
      findings: "Handoff evidence proves completion",
      notes: "None",
    }, context);

    assert.match(verificationResult.output, /handoff_path:/);
    assert.equal(context.metadataCalls[3].title, "Goal handoff recorded");

    const listResult = await tools.goal_list_handoffs.execute({
      goalId: skillResult.metadata.goalId,
    }, context);

    assert.match(listResult.output, /handoff_count: 2/);
    assert.match(listResult.output, /--- handoff: .*general\.md/);
    assert.match(listResult.output, /--- handoff: .*verification-agent\.md/);
    assert.equal(listResult.metadata.handoffs.length, 2);
    assert.equal(context.metadataCalls[4].title, "Goal handoffs listed");

    const updateResult = await tools.goal_update_status.execute({
      goalId: skillResult.metadata.goalId,
      status: "complete",
      summary: "Build loop completed.",
      evidence: "Verification handoff proves completion.",
    }, context);

    assert.match(updateResult.output, /status: complete/);
    assert.match(updateResult.output, /verification_passes: 1/);
    assert.equal(updateResult.metadata.status, "complete");
    assert.equal(context.metadataCalls[5].title, "Goal status updated");

    const listGoalsResult = await tools.goal_list_goals.execute({}, context);
    assert.match(listGoalsResult.output, /goal_count: 1/);
    assert.match(listGoalsResult.output, /status: complete/);
    assert.equal(listGoalsResult.metadata.goals.length, 1);
    assert.equal(context.metadataCalls[6].title, "Goals listed");

    const blockedResult = await tools.goal_update_status.execute({
      goalId: skillResult.metadata.goalId,
      status: "blocked",
      summary: "Blocked on missing fixture.",
      evidence: "Verification pass 2 documents the same blocker.",
    }, context);

    assert.match(blockedResult.output, /status: blocked/);
    assert.equal(blockedResult.metadata.status, "blocked");
    assert.equal(context.metadataCalls[7].title, "Goal status updated");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
