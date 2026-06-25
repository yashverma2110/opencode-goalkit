import { tool } from "@opencode-ai/plugin";
import { createGoalLoopToolDefinitions } from "./opencode-tools.js";

export const GoalLoopPlugin = async () => {
  return {
    tool: createGoalLoopToolDefinitions(tool),
  };
};

export default GoalLoopPlugin;
