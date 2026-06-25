---
description: Ask bounded one-at-a-time design questions until the plan is understood
---

You are running `/grill` for this plan or task:

`$ARGUMENTS`

Workflow:

1. If the plan or task is empty, ask the user what plan or task they want grilled and stop.
2. Do a focused discovery pass before asking anything. Inspect the codebase, docs, config, tests, commands, schemas, and existing patterns when they can answer a question. Do not edit files.
3. Build a lightweight design tree covering only decisions that matter for the task:
   - goal and success criteria
   - current state and relevant existing behavior
   - in scope and out of scope
   - constraints, risks, and compatibility requirements
   - interfaces, data flow, user-visible behavior, and failure modes
   - verification, acceptance criteria, and rollout concerns
4. Walk the design tree one dependency at a time. Ask only the next unresolved question whose answer changes the plan or unblocks a dependent decision.
5. Ask exactly one question at a time and wait for the user's answer before continuing. Do not batch multiple questions in one message.
6. Use the `question` tool when it is available. Each question must include:
   - a short header
   - one clear question
   - meaningful answer options when options fit the decision
   - your recommended answer, marked clearly as recommended
   The user may still provide a custom answer.
7. If the `question` tool is not available, ask one concise plain-text question and include `Recommended answer: ...`.
8. Never ask a question that can be answered by exploring the codebase or available project context. Explore first, then state the discovered answer as an assumption if needed.
9. Keep the interview bounded:
   - stop as soon as shared understanding is reached
   - ask no more than 7 questions total
   - do not loop on the same branch if the user already answered it
   - if the cap is reached, stop asking and summarize the remaining assumptions
10. After each answer, update your internal shared understanding and choose the next branch based on dependencies.
11. Finish with:
   - `Shared understanding`: concise goal, scope, key decisions, and acceptance criteria
   - `Locked assumptions`: exact assumptions now safe to use
   - `Open risks`: only unresolved risks that still matter
   - `Recommended next step`: the next concrete action
