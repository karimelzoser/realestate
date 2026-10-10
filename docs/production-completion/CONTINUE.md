# Resume with continue

1. If completion/egypt-full-platform exists, read its current docs/production-completion controls; otherwise start with plan/egypt-platform-completion.
2. Read PLAN.md, DECISIONS.md, TASKS.json, PROGRESS.md, WORK_STATE.json, BLOCKERS.md and SERVICE_READINESS.md. The first complete assignment is CHATGPT_MASTER_PROMPT.md.
3. Inspect actual branch/HEAD/dirty files/remotes/PRs and recorded commands. Preserve user work; reconcile stale bookkeeping to evidence.
4. Resume active task or highest-priority dependency-ready unblocked task; never ask what to continue or repeat accepted decisions.
5. Implement, test, repair failures, document and checkpoint to the known GitHub branch after every meaningful increment.
6. Do not treat code presence/mocks/skipped jobs as live production evidence. Do not deploy the server during this stage.
7. End only at a recoverable checkpoint if execution limits force it, when software preparation is genuinely complete, or when all remaining authorized tasks are externally blocked/deferred. State the exact next action and evidence honestly.

A connection failure can still occur. Remote committed checkpoints make resumption reliable; unpushed changes must be reported as such.
