# Resume with `continue`

Canonical branch: `completion/egypt-full-platform`.

1. Read this branch's `PLAN.md`, `DECISIONS.md`, `TASKS.json`, `PROGRESS.md`, `WORK_STATE.json`, `BLOCKERS.md` and `SERVICE_READINESS.md`. Use `CHATGPT_MASTER_PROMPT.md` as the execution contract.
2. Inspect the canonical branch HEAD and the task branch recorded in `WORK_STATE.json`; reconcile GitHub commits/PRs/tests before changing state.
3. Resume the recorded active task. Do not ask what to continue and do not repeat settled market, selling-model, language, voice or hosting questions.
4. **Current active task is E01.3 and its code is IMPLEMENTED. The next action is exact-head certification, not new feature work.**
5. E01.1 is implemented/certified in PR #86; E01.2 is implemented/certified in PR #87; E01.3 is implemented in PR #89.
6. E01.3 functional head `b5327a716628c88d8ddcff30a6d5803222a61c8f` passed its dedicated E01 certification plus Foundation, Full Stack Acceptance, Gate 4-5 and Gate 6 Non-Functional, then exposed secondary release-gate failures that subsequent commits repaired.
7. Bot-authored lockfile head `a68e3bd835c628811368775889659b2d16fe46f4` created `action_required` workflow records with zero jobs, so it is not verification evidence. A user-authored checkpoint now retriggers the exact-head matrix.
8. Do **not** mark E01.3 TESTED/VERIFIED and do **not** start E02 until the current user-authored E01.3 head passes at minimum: E01 Privileged Assurance, Production Foundation, Full Stack Acceptance, Gate 6 Security, Gate 6 Non-Functional and Gate 7 software-side go/no-go. Repair any failing inherited gate instead of waiving it.
9. Once E01.3 is exact-head green, update `TASKS.json`, `TASKS.md`, `PROGRESS.md`, `WORK_STATE.json` and this file, then start E02.1/E02.2 from the certified E01.3 head.
10. Do not claim live-provider or production-server evidence from sandbox/mock/CI work. Deployment remains deferred until separately authorized.
11. If interrupted, commit the smallest truthful recoverable checkpoint; never discard unverified user work or blindly rerun destructive/production operations.

Verified baseline for the completion program:
- candidate: `c2746523eb434898cbb4c46cf5df452d122ba78f` (PR #81 baseline)
- planning head: `446cfe4803bedc9868ee28799ff4b376277c0d91`
- published demo/main: `1a6e61c891e040221f09c773e6de589928a9a0b7`
- latest fully verified completed task code head: `747e9a3b54e8e12946d1b99294e9a9f0f7a9d4a4` (E01.2 / PR #87)
- E01.3 implementation branch: `task/e01-privileged-assurance` / PR #89
