# Resume with `continue`

Canonical branch: `completion/egypt-full-platform`.

1. Read this branch's `PLAN.md`, `DECISIONS.md`, `TASKS.json`, `PROGRESS.md`, `WORK_STATE.json`, `BLOCKERS.md` and `SERVICE_READINESS.md`. Use `CHATGPT_MASTER_PROMPT.md` as the execution contract.
2. Inspect the canonical branch HEAD and the task branch recorded in `WORK_STATE.json`; reconcile GitHub commits/PRs/tests before changing state.
3. Resume the recorded active task. Do not ask what to continue and do not repeat settled market, selling-model, language, voice or hosting questions.
4. Current active task after the E00 checkpoint is **E01.1**: centralize tenant/membership/project lifecycle enforcement for direct API requests.
5. Use a focused task branch against `completion/egypt-full-platform`. Preserve the GitHub Pages demo and do not merge unrelated historical PRs.
6. Implement a meaningful increment, run task-specific positive/negative tests plus required existing gates, document evidence, then checkpoint the task and exact next action back to the canonical controls.
7. Do not claim live-provider or production-server evidence from sandbox/mock/CI work. Deployment remains deferred until separately authorized.
8. If interrupted, commit the smallest truthful recoverable checkpoint; never discard unverified user work or blindly rerun destructive/production operations.

Verified baseline for this checkpoint:
- candidate: `c2746523eb434898cbb4c46cf5df452d122ba78f` (PR #81)
- planning head: `446cfe4803bedc9868ee28799ff4b376277c0d91`
- published demo/main: `1a6e61c891e040221f09c773e6de589928a9a0b7`
