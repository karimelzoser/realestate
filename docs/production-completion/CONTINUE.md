# Resume with `continue`

Canonical branch: `completion/egypt-full-platform`.

1. Read this branch's `PLAN.md`, `DECISIONS.md`, `TASKS.json`, `PROGRESS.md`, `WORK_STATE.json`, `BLOCKERS.md` and `SERVICE_READINESS.md`. Use `CHATGPT_MASTER_PROMPT.md` as the execution contract.
2. Inspect the canonical branch HEAD and the task branch recorded in `WORK_STATE.json`; reconcile GitHub commits/PRs/tests before changing state.
3. Resume the recorded active task. Do not ask what to continue and do not repeat settled market, selling-model, language, voice or hosting questions.
4. **Current active task is E01.3:** privileged assurance/step-up, release/build identity correctness, and truthful non-empty normal test/lint commands.
5. E01.1 is implemented in PR #86; E01.2 is implemented in PR #87. E01.2 functional head `747e9a3b54e8e12946d1b99294e9a9f0f7a9d4a4` passed Foundation, Gate 4-5, Gate 6 Security, Gate 6 Non-Functional, Full Stack Acceptance and Gate 7.
6. Start E01.3 from the E01.2 checkpoint on a focused task branch. Preserve the GitHub Pages demo and do not merge unrelated historical PRs.
7. Implement a meaningful increment, run task-specific positive/negative tests plus required existing gates, document evidence, then checkpoint the task and exact next action back to the canonical controls.
8. Do not claim live-provider or production-server evidence from sandbox/mock/CI work. Deployment remains deferred until separately authorized.
9. If interrupted, commit the smallest truthful recoverable checkpoint; never discard unverified user work or blindly rerun destructive/production operations.

Verified baseline for the completion program:
- candidate: `c2746523eb434898cbb4c46cf5df452d122ba78f` (PR #81 baseline)
- planning head: `446cfe4803bedc9868ee28799ff4b376277c0d91`
- published demo/main: `1a6e61c891e040221f09c773e6de589928a9a0b7`
- latest verified task code head: `747e9a3b54e8e12946d1b99294e9a9f0f7a9d4a4` (E01.2 / PR #87)
