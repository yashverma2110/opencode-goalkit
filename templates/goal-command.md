---
description: Plan, approve, create a reusable goal skill, and execute it
---

You are running `/goal` for this user goal:

`$ARGUMENTS`

Workflow:

1. If the goal is empty, ask the user for the goal and stop.
2. Do a focused discovery pass. Gather only the facts needed to plan safely. Do not edit files or call `goal_create_skill` yet.
3. Confirm OpenCode is running from the target project directory. The reusable skill must be written inside the current project `.agents/skills` directory, and OpenCode goal state must be written inside the current project `.opencode/goals` directory, never the global OpenCode config directory.
4. Before running the 4-condition loop test, perform grill-style clarification for missing goal-tree facts. Do not invoke `/grill` literally; apply its behavior inline:
   - ask only for facts needed to decide loop eligibility or build the approved plan
   - never ask questions that discovery can answer
   - ask exactly one question at a time and wait for the user's answer before continuing
   - use the `question` tool when available, with meaningful options and your recommended answer marked clearly
   - if `question` is unavailable, ask one concise plain-text question with `Recommended answer: ...`
   - stop as soon as the goal, scope, constraints, verification, reuse expectation, and execution bounds are clear
   - ask no more than 7 clarification questions total; if important facts are still missing after the cap, treat them as missing evidence in the loop test
5. Run the 4-condition loop test before building anything. Each condition must include concrete evidence from discovery, available commands/tools, or direct user-provided constraints. Do not pass a condition by assumption:
   - `repeats`: evidence that this workflow is likely reusable enough to justify creating a skill; do not imply OpenCode will schedule future runs
   - `automated_verification`: concrete test/typecheck/lint/build command, metric threshold, structured report requirement, or equivalent automated/measurable failure signal
   - `bounded_execution`: token budget if provided, otherwise a stated maximum pass, time, or retry policy
   - `senior_tools`: evidence that the agent can inspect logs, run code, reproduce issues, and observe failures
6. If any condition lacks evidence or fails, stop immediately with:
   - `Loop not justified`
   - the four-condition test result
   - which condition blocked the loop
   - a suggested one-shot prompt or script alternative
   - `Make this goal loop-eligible` with exactly these prompts:
     1. `Maximum execution time:`
     2. `Verification checks:`
     3. `Whether this workflow will be reused:`
   - for research/performance tasks, suggest measurable checks such as LCP, TTFB, Lighthouse performance score, trace-backed opportunities, bundle size, or a required structured report format
   Do not ask for approval, do not call `goal_create_skill`, and do not execute.
7. If all four conditions pass, present a concise plan with:
   - the 4-condition test result
   - goal summary
   - ordered phases
   - tasks that can run in parallel
   - proposed subagent roles and the exact task each should perform
   - acceptance criteria
   - risks or assumptions
8. Ask for approval exactly once: `Approve this plan? Reply approve to create the reusable goal skill and execute it.`
9. Stop until the user approves. If the user asks for changes, revise the plan and ask for approval again.
10. After explicit approval, call `goal_create_skill` with the approved goal, plan, ordered phases, subagent tasks, constraints, acceptance criteria, and `loopEligibility`.
11. If `goal_create_skill` fails because the project path is root, read-only, or missing write permissions, stop immediately. Tell the user: `Goal artifacts must be written inside project .agents and .opencode directories. Restart OpenCode from the target project directory.` Do not launch subagents and do not continue execution without the skill and handoff storage.
12. Treat the `state_path` returned by `goal_create_skill` as the runtime source of truth. You may call `goal_get_status` at any point to inspect the active goal state.
13. Execute the approved workflow immediately after the skill is created.
14. Use existing subagents when useful. Keep each subagent task focused and token-light.
15. Every execution and verification subagent must return this exact markdown field set:

```md
#goal
#description
#achieved: yes/no
#findings
#notes
#timestamp
```

Legacy handoffs may contain `#acheieved`; treat those as equivalent when reading old goal records, but write `#achieved` for all new handoffs.
16. After each execution subagent result, call `goal_record_handoff` to persist the normalized handoff. If `goal_record_handoff` says the goal record is missing, stop; do not create ad hoc handoff files.
17. After execution handoffs are recorded, call `goal_list_handoffs`.
18. Start an isolated verifier subagent that was not used for execution. Give it only:
    - original approved goal
    - approved plan
    - acceptance criteria
    - subagent task list
    - `goal_list_handoffs` output
19. The verifier must not rely on execution conversation context or claims outside handoff files.
20. Record verifier output with `goal_record_handoff` using:
    - `agent`: `verification-agent`
    - `description`: `Isolated verification pass 1`
    - `achieved`: `true` only if handoff evidence proves the goal and acceptance criteria are complete
    - `findings`: concise evidence, missing criteria, and conflicting handoff claims
    - `notes`: correction tasks, or `None` if verified
21. If verification pass 1 succeeds, call `goal_update_status` with `status: complete`, a concise summary, and evidence from the verification handoff.
22. If verification pass 1 fails, create one correction execution pass from verifier `#notes`, record new execution handoffs, then run one more isolated verifier pass with `description: Isolated verification pass 2`.
23. If verification pass 2 succeeds, call `goal_update_status` with `status: complete`, a concise summary, and evidence from the verification handoff.
24. If verification pass 2 fails and the same blocker is documented in the handoffs, call `goal_update_status` with `status: blocked`, a concise blocker summary, and evidence from the verification handoff. Then ask the user how to proceed.
25. Keep all orchestration updates precise and to the point.
26. Finish with goal id, final status, completed work, changed files or work performed, handoff file paths, verification evidence, verification handoff paths, and remaining risks.
