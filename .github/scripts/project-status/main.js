// Entry point, called from actions/github-script in .github/workflows/*.yml:
//   await require('./.github/scripts/project-status/main.js')({ github, context, core, getOctokit, checksResult })
//
// - `github` (GITHUB_TOKEN) is used for repository reads and label updates.
// - process.env.PROJECT_TOKEN is used only for the Project board. Without it the
//   board is NOT updated and the run says so explicitly.

'use strict';

const {
  STATUS,
  IN_PROGRESS_LABEL,
  GUIDE_REVISION_LABEL,
  parseLinkedIssues,
  decideStatus,
  shouldRemoveInProgressLabel,
} = require('./rules');
const { withRetry, loadProject, getIssueItem, addIssueToProject, setItemStatus } = require('./project');

function issueLabels(issue) {
  return (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name);
}

function isAppGuideRevision(issue, owner) {
  return issue.user?.login === (process.env.GUIDE_REVISION_ISSUE_AUTHOR || owner)
    && issueLabels(issue).includes('bug')
    && issue.title?.startsWith('Revise the ')
    && issue.title.endsWith(' movement guide')
    && issue.body?.startsWith("Marked **Needs revision** in the app's movement guide review (#277).");
}

async function addGuideRevisionLabel(github, repo, issueNumber) {
  try {
    await github.rest.issues.getLabel({ ...repo, name: GUIDE_REVISION_LABEL });
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      await github.rest.issues.createLabel({
        ...repo, name: GUIDE_REVISION_LABEL, color: '7057ff', description: 'Movement guide review requests from ThoeneFit',
      });
    } catch (createError) {
      if (createError.status !== 422) throw createError;
      // Another issue event may have created the label at the same time.
      await github.rest.issues.getLabel({ ...repo, name: GUIDE_REVISION_LABEL });
    }
  }
  await github.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels: [GUIDE_REVISION_LABEL] });
}

/** Turns the GitHub event into one normalized event per affected issue. */
async function collectTargets({ github, context, checksResult }) {
  const { eventName, payload } = context;
  const repoFullName = `${context.repo.owner}/${context.repo.repo}`;

  if (eventName === 'issues') {
    const issue = payload.issue;
    if (issue.number === 1) return [];
    const labels = issueLabels(issue);
    const appGuideRevision = isAppGuideRevision(issue, context.repo.owner);
    const guideRevision = appGuideRevision || labels.includes(GUIDE_REVISION_LABEL);
    const base = {
      number: issue.number, nodeId: issue.node_id, state: issue.state,
      needsGuideLabel: ['opened', 'reopened'].includes(payload.action) && appGuideRevision && !labels.includes(GUIDE_REVISION_LABEL),
    };
    switch (payload.action) {
      case 'opened':
        return [{ ...base, event: { type: 'issue_opened', guideRevision, issueState: issue.state } }];
      case 'labeled':
        return [{ ...base, event: { type: 'issue_labeled', label: payload.label?.name, guideRevision, issueState: issue.state } }];
      case 'reopened':
        return [{ ...base, event: { type: 'issue_reopened', guideRevision, hasInProgressLabel: labels.includes(IN_PROGRESS_LABEL) } }];
      case 'closed':
        return [{ ...base, event: { type: 'issue_closed', stateReason: issue.state_reason } }];
      default:
        return [];
    }
  }

  if (eventName === 'pull_request') {
    let pr = payload.pull_request;
    // Ignore a late CI run after another push or merge.
    if (checksResult && github.rest.pulls) {
      const { data: latest } = await github.rest.pulls.get({ ...context.repo, pull_number: pr.number });
      if (latest.state !== 'open' || latest.head.sha !== pr.head.sha) return [];
      pr = latest;
    }
    if (pr.head?.repo?.full_name !== repoFullName) return []; // forks: no secrets, no board access
    const linked = parseLinkedIssues(`${pr.title}\n\n${pr.body || ''}`, repoFullName);
    const common = { prNumber: pr.number, baseRef: pr.base.ref, draft: pr.draft };

    let makeEvent;
    if (checksResult) {
      makeEvent = () => ({ type: 'pr_checks_completed', ...common, checksResult });
    } else if (payload.action === 'converted_to_draft') {
      makeEvent = () => ({ type: 'pr_converted_to_draft', ...common });
    } else if (payload.action === 'closed') {
      makeEvent = (link) => ({ type: 'pr_closed', ...common, merged: Boolean(pr.merged), closes: link.closes });
    } else {
      return [];
    }

    const targets = [];
    for (const link of linked) {
      try {
        const { data: issue } = await github.rest.issues.get({ ...context.repo, issue_number: link.number });
        if (issue.pull_request || issue.state === 'closed') continue; // a PR number, not an issue
        targets.push({ number: issue.number, nodeId: issue.node_id, state: issue.state, event: { ...makeEvent(link), guideRevision: issueLabels(issue).includes(GUIDE_REVISION_LABEL) || isAppGuideRevision(issue, context.repo.owner) } });
      } catch (error) {
        targets.push({ number: link.number, error: `could not read issue #${link.number}: ${error.message}` });
      }
    }
    return targets;
  }

  return [];
}

module.exports = async function run({ github, context, core, getOctokit, checksResult }) {
  const config = {
    owner: process.env.PROJECT_OWNER || context.repo.owner,
    number: Number(process.env.PROJECT_NUMBER || 0),
    statusField: process.env.PROJECT_STATUS_FIELD || 'Status',
  };
  const token = process.env.PROJECT_TOKEN;
  const log = (message) => core.info(message);

  const targets = await collectTargets({ github, context, checksResult });
  const rows = [];
  let failed = false;

  if (targets.length === 0) {
    log('No linked issues or no status-relevant change for this event.');
  }

  let project = null;
  let graphql = null;
  if (targets.length > 0 && token && config.number) {
    graphql = getOctokit(token).graphql;
    try {
      project = await withRetry('load project', () => loadProject(graphql, config), { log });
      log(`Project: "${project.title}" (${config.owner} #${config.number})`);
    } catch (error) {
      core.error(`Cannot access the project board: ${error.message}`);
      failed = true;
    }
  } else if (targets.length > 0) {
    core.warning(
      'PROJECT_TOKEN secret (or PROJECT_NUMBER) is not configured, so the Project board was NOT updated. ' +
        'See docs/project-board.md → "Project board automation".',
    );
  }

  for (const target of targets) {
    if (target.error) {
      rows.push([`#${target.number}`, '?', '?', `❌ ${target.error}`]);
      failed = true;
      continue;
    }

    if (target.needsGuideLabel) {
      try {
        await withRetry(`label #${target.number}`, () => addGuideRevisionLabel(github, context.repo, target.number), { log });
      } catch (error) {
        core.error(`Could not label guide revision #${target.number}: ${error.message}`);
        failed = true;
      }
    }

    // A closed issue is no longer "in progress"; drop the label so it doesn't go stale.
    if (shouldRemoveInProgressLabel(target.event)) {
      try {
        await github.rest.issues.removeLabel({ ...context.repo, issue_number: target.number, name: IN_PROGRESS_LABEL });
        log(`Removed "${IN_PROGRESS_LABEL}" label from #${target.number}.`);
      } catch (error) {
        if (error.status !== 404) core.warning(`Could not remove label from #${target.number}: ${error.message}`);
      }
    }

    if (!project) {
      const intended = decideStatus(target.event, null);
      rows.push([
        `#${target.number}`,
        'unknown',
        intended.status ?? '—',
        `⚠️ board not updated (${token ? 'project not accessible' : 'no PROJECT_TOKEN'}) — ${intended.reason}`,
      ]);
      continue;
    }

    try {
      let item = await withRetry(`read #${target.number}`, () => getIssueItem(graphql, project, target.nodeId, config.statusField), { log });
      const current = item?.status ?? null;
      const decision = decideStatus(target.event, current);
      if (!decision.status) {
        rows.push([`#${target.number}`, current ?? '(none)', '—', `unchanged: ${decision.reason}`]);
        continue;
      }
      if (!item) {
        const itemId = await withRetry(`add #${target.number}`, () => addIssueToProject(graphql, project, target.nodeId), { log });
        item = { itemId, status: null };
        log(`Added issue #${target.number} to the project.`);
      }
      await withRetry(`set #${target.number}`, () => setItemStatus(graphql, project, item.itemId, decision.status), { log });

      // Read back so we never report an update that did not stick.
      const verified = await withRetry(`verify #${target.number}`, () => getIssueItem(graphql, project, target.nodeId, config.statusField), { log });
      if (verified?.status === decision.status) {
        rows.push([`#${target.number}`, current ?? '(none)', decision.status, `✅ updated and verified — ${decision.reason}`]);
      } else {
        rows.push([`#${target.number}`, current ?? '(none)', decision.status, `❌ verification failed (board shows "${verified?.status ?? 'none'}")`]);
        failed = true;
      }
    } catch (error) {
      rows.push([`#${target.number}`, '?', '?', `❌ ${error.message}`]);
      core.error(`Issue #${target.number}: ${error.message}`);
      failed = true;
    }
  }

  if (rows.length > 0) {
    await core.summary
      .addHeading('Project board status', 3)
      .addTable([[{ data: 'Issue', header: true }, { data: 'From', header: true }, { data: 'To', header: true }, { data: 'Result', header: true }], ...rows])
      .write();
    for (const row of rows) log(row.join(' | '));
  }

  if (failed) core.setFailed('One or more Project board updates failed; see the job summary.');
};

module.exports.STATUS = STATUS;
module.exports.collectTargets = collectTargets;
