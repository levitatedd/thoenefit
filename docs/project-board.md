# Project board automation

The visual tracker is https://github.com/users/levitatedd/projects/5.

| Trigger | Status |
| --- | --- |
| Issue opened | Todo |
| Add `status: in progress` label | In Progress |
| Ready PR to staging passes Checks | In Review |
| Reviewed PR fails Checks, becomes draft, or closes without merge | In Progress |
| Implementation PR merges into staging | On Staging |
| Issue closed after verified production release | Done |
| Issue reopened | Todo, or In Progress if labelled |

Use `Refs #N` for implementation issues in PR bodies. Closing keywords also work, but use Refs to keep production closeout explicit. `Part of` and `Related to` are contextual references; they do not move parent issues. #1 is always excluded. Release PRs to main do not mark issues Done: verify the live deploy, update backlog #1, then close delivered issues per CLAUDE.md. Partial work stays open.

## Setup

Add a repository Actions secret named `PROJECT_TOKEN` with access to edit Mike's user-owned Project #5 and read this repository. GITHUB_TOKEN cannot edit a user-owned project. A classic PAT needs `project` scope (and repository read access if private); use the narrowest applicable access. Never paste the token in issues, logs, or chat. The workflow fixes owner `levitatedd` and project number `5`.

Issue events start only when project-status.yml reaches the default branch, main. PR Checks use the PR's workflow; the separate board job cannot block deployment. Until the token is configured, runs explicitly warn that no board update occurred. Expired or insufficient tokens are reported as failures, not successful updates. Every write is read back and verified; transient API errors retry. Fork PRs are ignored. Stale CI runs and closed issues cannot move staged/completed issues backwards.

Keep native Item added → Todo and Item closed → Done workflows. Disable Auto-close issue and PR merged → Done workflows: a staging merge is not production completion. Native auto-add may remain enabled. Avoid native review transitions that bypass Checks.

## Validation

Run `node --test .github/scripts/project-status/*.test.js`. After activation, label an open implementation issue, run its staging PR Checks, and inspect the Project board status job summary for an updated-and-verified result. Merge to staging only with Mike's authorization and confirm On Staging with the issue still open. Closing after a verified release should produce Done. Existing events are not replayed automatically; reconcile old cards manually.
