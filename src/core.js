import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCODE_PLUGIN_DEPENDENCY = "@opencode-ai/plugin";
export const OPENCODE_PLUGIN_VERSION = "1.14.28";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");

export function packageRoot() {
  return PACKAGE_ROOT;
}

export function slugify(value, maxLength = 40) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  const trimmed = slug.slice(0, maxLength).replace(/-$/g, "");
  return trimmed || "goal";
}

export function timestampParts(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${now}`);
  }

  const iso = date.toISOString();
  return {
    iso,
    date: iso.slice(0, 10).replaceAll("-", ""),
    time: iso.slice(11, 19).replaceAll(":", ""),
    compact: iso.replace(/[-:.TZ]/g, "").slice(0, 14),
  };
}

export function createGoalId(goal, now = new Date()) {
  const parts = timestampParts(now);
  const prefix = `goal-${parts.date}-${parts.time}`;
  const maxSlugLength = 64 - prefix.length - 1;
  return `${prefix}-${slugify(goal, maxSlugLength)}`;
}

export function normalizeGoalId(goalId) {
  const normalized = slugify(goalId, 64);
  if (!/^goal-[a-z0-9]+(-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`Invalid goal id: ${goalId}`);
  }
  return normalized;
}

export function safeResolveInside(root, ...segments) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...segments);
  const relative = path.relative(base, candidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidate;
  }

  throw new Error(`Refusing to write outside ${base}: ${candidate}`);
}

export function projectRootFromContext(context) {
  const candidates = [context?.directory, context?.worktree]
    .filter((candidate) => typeof candidate === "string" && candidate.trim() !== "")
    .map((candidate) => path.resolve(candidate));
  const root = candidates.find((candidate) => candidate !== path.parse(candidate).root);

  if (!root) {
    throw new Error("Goal artifacts must be written inside project .agents and .opencode directories. Start OpenCode from the target project directory.");
  }
  return root;
}

export function opencodeDirForProject(projectRoot) {
  const root = path.resolve(projectRoot);
  if (root === path.parse(root).root) {
    throw new Error("Goal artifacts must be written inside project .agents and .opencode directories. Start OpenCode from the target project directory.");
  }
  return safeResolveInside(root, ".opencode");
}

export function resolveGlobalConfigDir(env = process.env, homeDir = process.env.HOME) {
  if (env.OPENCODE_CONFIG_DIR) {
    return path.resolve(env.OPENCODE_CONFIG_DIR);
  }

  if (env.XDG_CONFIG_HOME) {
    return path.resolve(env.XDG_CONFIG_HOME, "opencode");
  }

  if (!homeDir) {
    throw new Error("Cannot resolve global OpenCode config directory without HOME");
  }

  return path.resolve(homeDir, ".config", "opencode");
}

export function truncateLine(value, maxLength = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export const LOOP_ELIGIBILITY_CONDITIONS = [
  {
    key: "repeats",
    label: "repeats",
    description: "Workflow is likely reusable enough to justify creating a skill.",
  },
  {
    key: "automatedVerification",
    label: "automated_verification",
    description: "A test, typecheck, lint, build, or equivalent automated failure signal exists.",
  },
  {
    key: "tokenBudget",
    label: "token_budget",
    description: "The loop has a stated maximum execution time or bounded retry/context policy.",
  },
  {
    key: "seniorTools",
    label: "senior_tools",
    description: "The agent can inspect logs, run code, reproduce issues, and observe failures.",
  },
];

function listBlock(items, fallback = "- None") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${String(item).trim()}`).join("\n");
}

function renderPhase(phase, index) {
  const name = truncateLine(phase?.name || `Phase ${index + 1}`, 80);
  const objective = truncateLine(phase?.objective || phase?.description || "No objective provided.", 240);
  const order = phase?.order ?? index + 1;
  const dependencies = Array.isArray(phase?.dependencies) && phase.dependencies.length > 0
    ? phase.dependencies.join(", ")
    : "None";
  const subagents = Array.isArray(phase?.subagents) && phase.subagents.length > 0
    ? phase.subagents.join(", ")
    : "Use the most suitable available subagent.";

  return [
    `## ${order}. ${name}`,
    `Goal: ${objective}`,
    `Dependencies: ${dependencies}`,
    `Subagents: ${subagents}`,
  ].join("\n");
}

function renderSubagentTask(task, index) {
  const order = task?.order ?? index + 1;
  const role = truncateLine(task?.role || task?.agent || `subagent-${index + 1}`, 80);
  const objective = truncateLine(task?.task || task?.objective || task?.description || "No task provided.", 260);
  const phase = truncateLine(task?.phase || "Unspecified", 80);
  const dependencies = Array.isArray(task?.dependencies) && task.dependencies.length > 0
    ? task.dependencies.join(", ")
    : "None";
  const parallelWith = Array.isArray(task?.parallelWith) && task.parallelWith.length > 0
    ? task.parallelWith.join(", ")
    : "None";

  return [
    `## ${order}. ${role}`,
    `Task: ${objective}`,
    `Phase: ${phase}`,
    `Dependencies: ${dependencies}`,
    `Parallel with: ${parallelWith}`,
  ].join("\n");
}

export function normalizeLoopEligibility(input) {
  if (!input || typeof input !== "object") {
    throw new Error("loopEligibility is required before creating a goal skill");
  }

  const normalized = {};
  const failures = [];

  for (const condition of LOOP_ELIGIBILITY_CONDITIONS) {
    const value = input[condition.key];
    const passed = value?.passed === true;
    const evidence = String(value?.evidence ?? "").trim();

    normalized[condition.key] = {
      passed,
      evidence,
    };

    if (!passed) {
      failures.push(`${condition.label} did not pass`);
    }
    if (!evidence) {
      failures.push(`${condition.label} is missing evidence`);
    }
  }

  if (failures.length > 0) {
    const error = new Error(`Loop not justified: ${failures.join("; ")}`);
    error.failures = failures;
    throw error;
  }

  return normalized;
}

export function formatLoopEligibilityMarkdown(input) {
  const eligibility = input && typeof input === "object" ? input : {};

  return LOOP_ELIGIBILITY_CONDITIONS.map((condition) => {
    const value = eligibility[condition.key] || {};
    const passed = value.passed === true ? "pass" : "fail";
    const evidence = String(value.evidence ?? "").trim() || "Missing evidence";
    return [
      `## ${condition.label}: ${passed}`,
      `Definition: ${condition.description}`,
      `Evidence: ${evidence}`,
    ].join("\n");
  }).join("\n\n");
}

export function buildSkillMarkdown(input) {
  const goalId = normalizeGoalId(input.goalId);
  const goal = String(input.goal ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  const loopEligibility = normalizeLoopEligibility(input.loopEligibility);
  const createdAt = input.createdAt || timestampParts().iso;
  const phases = Array.isArray(input.phases) ? input.phases : [];
  const subagentTasks = Array.isArray(input.subagentTasks) ? input.subagentTasks : [];
  const acceptanceCriteria = Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : [];
  const constraints = Array.isArray(input.constraints) ? input.constraints : [];
  const description = truncateLine(goal, 220) || "Execute approved goal workflow";

  return `---\nname: ${goalId}\ndescription: Execute approved goal workflow for: ${description}\ncompatibility: Requires OpenCode goalkit plugin tools for handoff persistence.\nmetadata:\n  generated-by: opencode-goalkit\n  goal-id: ${goalId}\n  created-at: ${createdAt}\n---\n\n# Goal\n${goal}\n\n# Four-Condition Loop Test\n${formatLoopEligibilityMarkdown(loopEligibility)}\n\n# Plan\n${plan}\n\n# Execution Workflow\n- Execute only the approved plan captured in this skill.\n- Keep orchestration concise; delegate focused work to existing subagents when useful.\n- Run independent subagent tasks in parallel when the plan says they do not depend on each other.\n- Ask the user before expanding scope, changing acceptance criteria, or taking destructive actions.\n- After every execution subagent result, call \`goal_record_handoff\` with the required handoff fields.\n- Always finish execution with the isolated verification loop below.\n\n# Ordered Phases\n${phases.length > 0 ? phases.map(renderPhase).join("\n\n") : "1. Execute the approved plan in the smallest safe sequence."}\n\n# Subagent Tasks\n${subagentTasks.length > 0 ? subagentTasks.map(renderSubagentTask).join("\n\n") : "Use subagents only when they reduce context or enable safe parallel work. Give each subagent one focused task."}\n\n# Acceptance Criteria\n${listBlock(acceptanceCriteria)}\n\n# Constraints\n${listBlock(constraints)}\n\n# Isolated Verification Loop\n- After execution handoffs are recorded, call \`goal_list_handoffs\` for this goal id.\n- Start a verification subagent that was not used for execution.\n- Give the verifier only the goal, approved plan, acceptance criteria, subagent task list, and \`goal_list_handoffs\` output.\n- The verifier must not rely on execution conversation context or claims outside the handoff files.\n- Record verifier output with \`goal_record_handoff\` using \`agent: verification-agent\` and \`description: Isolated verification pass 1\`.\n- The verifier sets \`achieved: true\` only when handoff evidence proves the goal and every acceptance criterion is complete, with no relevant \`#acheieved: no\` handoff left unresolved.\n- If pass 1 fails, create one correction execution pass from the verifier handoff \`#notes\`, record new execution handoffs, then run one more isolated verification pass with \`description: Isolated verification pass 2\`.\n- If pass 2 fails, stop and ask the user how to proceed.\n\n# Handoff Contract\nEvery execution and verification subagent response must contain these fields and nothing verbose unless needed:\n\n\`\`\`md\n#goal\n#description\n#acheieved: yes/no\n#findings\n#notes\n#timestamp\n\`\`\`\n\nThe orchestrator must persist each handoff with \`goal_record_handoff\` before continuing.\n`;
}

export function buildGoalRecordMarkdown(input) {
  const goalId = normalizeGoalId(input.goalId);
  const goal = String(input.goal ?? "").trim();
  const skillName = input.skillName || goalId;
  const createdAt = input.createdAt || timestampParts().iso;
  const skillPath = input.skillPath || `.agents/skills/${goalId}/SKILL.md`;
  const handoffDir = input.handoffDir || `.opencode/goals/${goalId}/handoffs`;

  return `# Goal\n${goal}\n\n# Goal ID\n${goalId}\n\n# Status\napproved\n\n# Skill\n${skillName}\n\n# Canonical Skill Path\n${skillPath}\n\n# Handoff Directory\n${handoffDir}\n\n# Created\n${createdAt}\n\n# Instructions\nFollow the canonical Agent Skill at \`${skillPath}\`. This OpenCode goal record exists only to track goal state and handoff storage for the goalkit plugin.\n`;
}

export function formatHandoffMarkdown(input) {
  const goal = String(input.goal ?? "").trim() || "None";
  const description = String(input.description ?? "").trim() || "None";
  const achieved = input.achieved === true || input.achieved === "yes" ? "yes" : "no";
  const findings = String(input.findings ?? "").trim() || "None";
  const notes = String(input.notes ?? "").trim() || "None";
  const timestamp = input.timestamp || timestampParts().iso;

  return `#goal\n${goal}\n\n#description\n${description}\n\n#acheieved: ${achieved}\n\n#findings\n${findings}\n\n#notes\n${notes}\n\n#timestamp\n${timestamp}\n`;
}

async function writeExclusive(filePath, content) {
  try {
    await writeFile(filePath, content, { flag: "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${filePath}`);
    }
    throw error;
  }
}

async function writeMaybeOverwrite(filePath, content, force) {
  if (force) {
    await writeFile(filePath, content);
    return;
  }
  await writeExclusive(filePath, content);
}

export async function createGoalSkill(projectRoot, input, options = {}) {
  const now = options.now || new Date();
  const createdAt = timestampParts(now).iso;
  const goalId = input.goalId ? normalizeGoalId(input.goalId) : createGoalId(input.goal, now);
  const loopEligibility = normalizeLoopEligibility(input.loopEligibility);
  const opencodeDir = opencodeDirForProject(projectRoot);
  const skillDir = safeResolveInside(projectRoot, ".agents", "skills", goalId);
  const goalDir = safeResolveInside(opencodeDir, "goals", goalId);
  const handoffDir = safeResolveInside(goalDir, "handoffs");
  const skillPath = safeResolveInside(skillDir, "SKILL.md");
  const goalPath = safeResolveInside(goalDir, "goal.md");
  const relativeSkillPath = `.agents/skills/${goalId}/SKILL.md`;
  const relativeHandoffDir = `.opencode/goals/${goalId}/handoffs`;

  await mkdir(skillDir, { recursive: true });
  await mkdir(handoffDir, { recursive: true });

  const payload = {
    ...input,
    goalId,
    loopEligibility,
    createdAt,
    skillName: goalId,
    skillPath: relativeSkillPath,
    handoffDir: relativeHandoffDir,
  };

  await writeExclusive(skillPath, buildSkillMarkdown(payload));
  await writeExclusive(goalPath, buildGoalRecordMarkdown(payload));

  return {
    goalId,
    skillName: goalId,
    skillPath,
    goalPath,
    handoffDir,
  };
}

async function nextHandoffPath(handoffDir, timestamp, agent) {
  const baseName = `${timestampParts(timestamp).compact}-${slugify(agent, 32)}`;
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = safeResolveInside(handoffDir, `${baseName}${suffix}.md`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`Could not allocate a handoff file in ${handoffDir}`);
}

export async function recordHandoff(projectRoot, input, options = {}) {
  const goalId = normalizeGoalId(input.goalId);
  const timestamp = input.timestamp || timestampParts(options.now || new Date()).iso;
  const opencodeDir = opencodeDirForProject(projectRoot);
  const handoffDir = safeResolveInside(opencodeDir, "goals", goalId, "handoffs");
  await mkdir(handoffDir, { recursive: true });

  const handoffPath = await nextHandoffPath(handoffDir, timestamp, input.agent || "subagent");
  await writeExclusive(handoffPath, formatHandoffMarkdown({ ...input, timestamp }));
  return {
    goalId,
    handoffPath,
  };
}

async function assertDirectory(target) {
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`Target is not a directory: ${target}`);
  }
}

async function readTemplate(packageDir, relativePath) {
  return readFile(path.join(packageDir, relativePath), "utf8");
}

async function copyPackageFile(packageDir, relativePath, destination, force) {
  await mkdir(path.dirname(destination), { recursive: true });
  if (force) {
    await copyFile(path.join(packageDir, relativePath), destination);
    return;
  }

  try {
    await copyFile(path.join(packageDir, relativePath), destination, 1);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${destination}`);
    }
    throw error;
  }
}

async function mergePackageJson(packageJsonPath) {
  let existing = {};
  try {
    existing = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const dependencies = {
    ...(existing.dependencies || {}),
  };

  if (!dependencies[OPENCODE_PLUGIN_DEPENDENCY]) {
    dependencies[OPENCODE_PLUGIN_DEPENDENCY] = OPENCODE_PLUGIN_VERSION;
  }

  const next = {
    ...existing,
    dependencies,
  };

  await writeFile(packageJsonPath, `${JSON.stringify(next, null, 2)}\n`);
}

export async function installIntoProject(options = {}) {
  const target = path.resolve(options.target || process.cwd());
  const packageDir = path.resolve(options.packageRoot || PACKAGE_ROOT);
  const force = Boolean(options.force);

  await assertDirectory(target);

  const opencodeDir = opencodeDirForProject(target);
  const commandsDir = safeResolveInside(opencodeDir, "commands");
  const pluginsDir = safeResolveInside(opencodeDir, "plugins");
  const pluginRuntimeDir = safeResolveInside(pluginsDir, "goalkit");

  await mkdir(commandsDir, { recursive: true });
  await mkdir(pluginRuntimeDir, { recursive: true });

  const commandPath = safeResolveInside(commandsDir, "goal.md");
  const grillCommandPath = safeResolveInside(commandsDir, "grill.md");
  const wrapperPath = safeResolveInside(pluginsDir, "goalkit.js");
  const packageJsonPath = safeResolveInside(opencodeDir, "package.json");

  await writeMaybeOverwrite(commandPath, await readTemplate(packageDir, "templates/goal-command.md"), force);
  await writeMaybeOverwrite(grillCommandPath, await readTemplate(packageDir, "templates/grill-command.md"), force);
  await writeMaybeOverwrite(wrapperPath, await readTemplate(packageDir, "templates/plugin-wrapper.js"), force);

  for (const fileName of ["core.js", "opencode-tools.js", "plugin.js"]) {
    await copyPackageFile(packageDir, `src/${fileName}`, safeResolveInside(pluginRuntimeDir, fileName), force);
  }

  await mergePackageJson(packageJsonPath);

  return {
    target,
    commandPath,
    grillCommandPath,
    wrapperPath,
    runtimeDir: pluginRuntimeDir,
    packageJsonPath,
  };
}

export async function installGlobalCommand(options = {}) {
  const packageDir = path.resolve(options.packageRoot || PACKAGE_ROOT);
  const force = Boolean(options.force);
  const configDir = path.resolve(options.configDir || resolveGlobalConfigDir(options.env, options.homeDir));
  const commandsDir = safeResolveInside(configDir, "commands");
  const commandPath = safeResolveInside(commandsDir, "goal.md");
  const grillCommandPath = safeResolveInside(commandsDir, "grill.md");

  await mkdir(commandsDir, { recursive: true });
  await writeMaybeOverwrite(commandPath, await readTemplate(packageDir, "templates/goal-command.md"), force);
  await writeMaybeOverwrite(grillCommandPath, await readTemplate(packageDir, "templates/grill-command.md"), force);

  return {
    configDir,
    commandPath,
    grillCommandPath,
  };
}

export async function listGoalHandoffs(projectRoot, goalId) {
  const normalizedGoalId = normalizeGoalId(goalId);
  const handoffDir = safeResolveInside(opencodeDirForProject(projectRoot), "goals", normalizedGoalId, "handoffs");
  try {
    return (await readdir(handoffDir)).filter((name) => name.endsWith(".md")).sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function readGoalHandoffs(projectRoot, goalId) {
  const normalizedGoalId = normalizeGoalId(goalId);
  const opencodeDir = opencodeDirForProject(projectRoot);
  const handoffDir = safeResolveInside(opencodeDir, "goals", normalizedGoalId, "handoffs");
  const names = await listGoalHandoffs(projectRoot, normalizedGoalId);

  return Promise.all(names.map(async (name) => {
    const handoffPath = safeResolveInside(handoffDir, name);
    return {
      path: handoffPath,
      name,
      content: await readFile(handoffPath, "utf8"),
    };
  }));
}
