import {
  createGoalSkill,
  listGoals,
  projectRootFromContext,
  readCurrentGoalState,
  readGoalHandoffs,
  recordHandoff,
  updateGoalStatus,
} from "./core.js";

export function createGoalLoopToolDefinitions(tool) {
  const schema = tool.schema;

  return {
    goal_create_skill: tool({
      description: "Create a reusable Agent Skill under .agents/skills and a lightweight OpenCode goal record under the current project's .opencode directory.",
      args: {
        goal: schema.string().min(1).describe("The user-approved goal."),
        plan: schema.string().min(1).describe("The approved execution plan."),
        phases: schema.array(schema.object({
          name: schema.string().min(1),
          objective: schema.string().min(1),
          order: schema.number().int().positive().optional(),
          dependencies: schema.array(schema.string()).optional(),
          subagents: schema.array(schema.string()).optional(),
        })).optional().default([]),
        subagentTasks: schema.array(schema.object({
          role: schema.string().min(1),
          task: schema.string().min(1),
          phase: schema.string().optional(),
          order: schema.number().int().positive().optional(),
          dependencies: schema.array(schema.string()).optional(),
          parallelWith: schema.array(schema.string()).optional(),
        })).optional().default([]),
        loopEligibility: schema.object({
          repeats: schema.object({
            passed: schema.boolean(),
            evidence: schema.string().min(1),
          }),
          automatedVerification: schema.object({
            passed: schema.boolean(),
            evidence: schema.string().min(1),
          }),
          tokenBudget: schema.object({
            passed: schema.boolean(),
            evidence: schema.string().min(1),
          }),
          seniorTools: schema.object({
            passed: schema.boolean(),
            evidence: schema.string().min(1),
          }),
        }).describe("Four-condition loop eligibility evidence. All four conditions must pass."),
        acceptanceCriteria: schema.array(schema.string()).optional().default([]),
        constraints: schema.array(schema.string()).optional().default([]),
        tokenBudget: schema.string().optional().describe("Optional explicit token budget. Otherwise use the bounded execution evidence."),
        notes: schema.string().optional(),
        goalId: schema.string().optional().describe("Optional precomputed goal id. Must start with goal-."),
      },
      async execute(args, context) {
        const result = await createGoalSkill(projectRootFromContext(context), args);
        context.metadata?.({
          title: "Goal skill created",
          metadata: {
            goalId: result.goalId,
            skillName: result.skillName,
            skillPath: result.skillPath,
          },
        });

        return {
          output: [
            `goal_id: ${result.goalId}`,
            `skill_name: ${result.skillName}`,
            `skill_path: ${result.skillPath}`,
            `goal_path: ${result.goalPath}`,
            `state_path: ${result.statePath}`,
            `handoff_dir: ${result.handoffDir}`,
            "",
            "Continue by executing the approved workflow. Persist every subagent handoff with goal_record_handoff, then finish with goal_update_status.",
          ].join("\n"),
          metadata: result,
        };
      },
    }),

    goal_record_handoff: tool({
      description: "Persist a normalized markdown handoff under the current project's .opencode goal directory.",
      args: {
        goalId: schema.string().min(1).describe("Goal id returned by goal_create_skill."),
        agent: schema.string().min(1).describe("Subagent name or role."),
        goal: schema.string().min(1),
        description: schema.string().min(1),
        achieved: schema.boolean(),
        findings: schema.string().optional().default("None"),
        notes: schema.string().optional().default("None"),
        timestamp: schema.string().optional().describe("ISO timestamp. Defaults to current time."),
      },
      async execute(args, context) {
        const result = await recordHandoff(projectRootFromContext(context), args);
        context.metadata?.({
          title: "Goal handoff recorded",
          metadata: {
            goalId: result.goalId,
            handoffPath: result.handoffPath,
          },
        });

        return {
          output: `handoff_path: ${result.handoffPath}`,
          metadata: result,
        };
      },
    }),

    goal_list_handoffs: tool({
      description: "List ordered handoff files and contents from the current project's .opencode goal directory.",
      args: {
        goalId: schema.string().min(1).describe("Goal id returned by goal_create_skill."),
      },
      async execute(args, context) {
        const handoffs = await readGoalHandoffs(projectRootFromContext(context), args.goalId);
        context.metadata?.({
          title: "Goal handoffs listed",
          metadata: {
            goalId: args.goalId,
            count: handoffs.length,
          },
        });

        if (handoffs.length === 0) {
          return {
            output: `goal_id: ${args.goalId}\nhandoff_count: 0\n\nNo handoff files found.`,
            metadata: {
              goalId: args.goalId,
              handoffs,
            },
          };
        }

        return {
          output: [
            `goal_id: ${args.goalId}`,
            `handoff_count: ${handoffs.length}`,
            "",
            ...handoffs.map((handoff) => [
              `--- handoff: ${handoff.name}`,
              `path: ${handoff.path}`,
              handoff.content.trimEnd(),
            ].join("\n")),
          ].join("\n\n"),
          metadata: {
            goalId: args.goalId,
            handoffs,
          },
        };
      },
    }),

    goal_get_status: tool({
      description: "Read structured runtime state for a goal. If goalId is omitted, returns the most recently created goal state.",
      args: {
        goalId: schema.string().optional().describe("Goal id returned by goal_create_skill. Omit to inspect the most recent goal."),
      },
      async execute(args, context) {
        const result = await readCurrentGoalState(projectRootFromContext(context), args.goalId);
        context.metadata?.({
          title: "Goal status read",
          metadata: {
            goalId: result.goalId,
            status: result.status,
          },
        });

        return {
          output: [
            `goal_id: ${result.goalId}`,
            `status: ${result.status}`,
            `objective: ${result.objective || "None"}`,
            `attempts: ${result.attempts ?? 0}`,
            `verification_passes: ${result.verificationPasses ?? 0}`,
            `state_path: ${result.statePath}`,
            result.summary ? `summary: ${result.summary}` : null,
          ].filter(Boolean).join("\n"),
          metadata: result,
        };
      },
    }),

    goal_list_goals: tool({
      description: "List known goals from the current project's .opencode goal state directory.",
      args: {},
      async execute(_args, context) {
        const goals = await listGoals(projectRootFromContext(context));
        context.metadata?.({
          title: "Goals listed",
          metadata: {
            count: goals.length,
          },
        });

        if (goals.length === 0) {
          return {
            output: "goal_count: 0\n\nNo goal state found.",
            metadata: {
              goals,
            },
          };
        }

        return {
          output: [
            `goal_count: ${goals.length}`,
            "",
            ...goals.map((goal) => [
              `goal_id: ${goal.goalId}`,
              `status: ${goal.status}`,
              `objective: ${goal.objective || "None"}`,
              `created_at: ${goal.createdAt || "unknown"}`,
            ].join("\n")),
          ].join("\n\n"),
          metadata: {
            goals,
          },
        };
      },
    }),

    goal_update_status: tool({
      description: "Mark a goal complete or blocked in structured runtime state after verification evidence is recorded.",
      args: {
        goalId: schema.string().min(1).describe("Goal id returned by goal_create_skill."),
        status: schema.string().min(1).describe("Final status. Must be complete or blocked."),
        summary: schema.string().min(1).describe("Concise final summary."),
        evidence: schema.string().min(1).describe("Verification or blocker evidence from handoffs."),
      },
      async execute(args, context) {
        const result = await updateGoalStatus(projectRootFromContext(context), args);
        context.metadata?.({
          title: "Goal status updated",
          metadata: {
            goalId: result.goalId,
            status: result.status,
          },
        });

        return {
          output: [
            `goal_id: ${result.goalId}`,
            `status: ${result.status}`,
            `attempts: ${result.attempts}`,
            `verification_passes: ${result.verificationPasses}`,
            `summary: ${result.summary}`,
            `evidence: ${result.evidence}`,
          ].join("\n"),
          metadata: result,
        };
      },
    }),
  };
}
