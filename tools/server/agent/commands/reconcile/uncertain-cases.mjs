// Operator reconciliation of unknown external results (T8.5).
//
// An interrupted instruction, automatic repair or CI notice leaves the service
// unable to start or to trust its own state, because the external effect may or
// may not have happened. A person with root access reads the real state here and
// closes the case with an explicit decision. Nothing is executed again and
// nothing is pushed, commented or merged: the only writes are the durable store,
// the published-head mark of an instruction whose head is confirmed and the
// private trace.
//
// A resolution is never kept without its trace. The instruction transition and
// its trace share the admission database, so they are one transaction. A repair
// or a notice lives in another database: the trace is written first and a
// failure changes nothing.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  mergeSynchronizationRequestedAction,
  reconcileReports,
  reconcileResolutions,
  shortCommit,
} from "../../policy/development.mjs";
import {
  createIdentifierNames,
  readIdentifierSalt,
} from "../../repository/identifiers.mjs";
import {
  currentBranch,
  findSessionWorktree,
  headCommit,
  listLegacyIdentifierNames,
  publishedCommit,
  recordPublication,
} from "../../repository/worktrees.mjs";

export const caseKinds = {
  instruction: "instruction",
  repair: "repair",
  notice: "notice",
  merge: "merge",
};

/** Outcomes stored with a reconciled instruction or repair. */
export const reconcileOutcomes = {
  [reconcileResolutions.published]: "reconciled_published",
  [reconcileResolutions.notPublished]: "reconciled_not_published",
};

/** Which resolutions each kind accepts. `published` also requires a commit. */
export const resolutionsByKind = {
  [caseKinds.instruction]: [
    reconcileResolutions.published,
    reconcileResolutions.notPublished,
  ],
  [caseKinds.repair]: [
    reconcileResolutions.published,
    reconcileResolutions.notPublished,
  ],
  [caseKinds.notice]: [
    reconcileResolutions.delivered,
    reconcileResolutions.resend,
  ],
  [caseKinds.merge]: [
    reconcileResolutions.merged,
    reconcileResolutions.notMerged,
  ],
};

// Whether the GitHub facts of a case could be read. A failed read leaves the
// case for the operator instead of stopping the command.
const githubReadStates = {
  ok: "ok",
  unavailable: "unavailable",
  skipped: "skipped",
};

/** The case cannot be resolved: it is not uncertain any more or it has no trace. */
export class ReconcileCaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReconcileCaseError";
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : "unknown error";
}

// An instruction that is uncertain belongs to a worktree. The command cannot
// attribute it before the installation has its salt and every worktree has an
// opaque name, and it never creates the salt or migrates by itself: the
// operator decides when the migration runs.
const migrationRequired =
  "The identifier migration has not run. Execute the migrate-identifiers command before listing or resolving an instruction case.";

/**
 * The naming source of this installation for an instruction case. A missing
 * salt or a worktree that still carries a private name stops the case instead
 * of closing a publication that could not be marked.
 */
function instructionIdentifiers(config) {
  let salt;
  try {
    salt = readIdentifierSalt(config.paths.state);
  } catch {
    throw new ReconcileCaseError(migrationRequired);
  }
  const legacyNames = listLegacyIdentifierNames({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
  });
  if (legacyNames.length > 0) {
    throw new ReconcileCaseError(migrationRequired);
  }
  return createIdentifierNames({ salt });
}

/** The facts of an interrupted instruction: its worktree and its open PR. */
async function instructionCase({ config, identifiers, row, github }) {
  const facts = {
    kind: caseKinds.instruction,
    update_identifier: row.update_identifier,
    session_key: row.session_key,
    created_at: row.created_at,
    worktree: null,
    pull_request: null,
    worktree_error: null,
    github: githubReadStates.skipped,
  };
  let worktree;
  try {
    worktree = await findSessionWorktree({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      name: identifiers.worktreeName(row.session_key),
    });
  } catch (error) {
    // One damaged worktree prints its error instead of hiding every remaining
    // case of the list.
    facts.worktree_error = messageOf(error);
    return facts;
  }
  if (worktree === null) {
    return facts;
  }
  let head;
  let branch;
  try {
    head = await headCommit(worktree);
    branch = await currentBranch(worktree);
  } catch (error) {
    facts.worktree_error = messageOf(error);
    return facts;
  }
  facts.worktree = {
    branch,
    head,
    published: publishedCommit(worktree) === head,
  };
  if (branch === null) {
    return facts;
  }
  try {
    const pullRequest = await github.findOpenPullRequest({ branch });
    facts.pull_request =
      pullRequest === null
        ? null
        : { number: pullRequest.number, head_sha: pullRequest.headSha };
    facts.github = githubReadStates.ok;
  } catch {
    facts.github = githubReadStates.unavailable;
  }
  return facts;
}

/** The facts of an interrupted repair: its pull request and the failed commit. */
async function repairCase({ row, github }) {
  const facts = {
    kind: caseKinds.repair,
    update_identifier: row.update_identifier,
    sequence: row.sequence,
    session_key: row.session_key,
    created_at: row.created_at,
    pull_request_number: row.pull_request_number,
    failed_commit: row.commit_sha,
    pull_request: null,
    github: githubReadStates.unavailable,
  };
  try {
    const pullRequest = await github.getPullRequest({
      number: row.pull_request_number,
    });
    facts.pull_request = {
      state: pullRequest.state,
      head_sha: pullRequest.headSha,
    };
    facts.github = githubReadStates.ok;
  } catch {
    // The operator resolves nothing on a stale read: only the flag is printed.
  }
  return facts;
}

/**
 * The facts of an unknown CI notice. Its result was read from GitHub before the
 * delivery, so it also says what the topic would have received.
 */
function noticeCase({ row }) {
  return {
    kind: caseKinds.notice,
    update_identifier: row.update_identifier,
    session_key: row.session_key,
    created_at: row.created_at,
    pull_request_number: row.pull_request_number,
    commit: row.commit_sha,
    result: row.result,
  };
}

/** The facts of an unknown merge request; resolving it reads the pull request. */
function mergeCase({ row }) {
  return {
    kind: caseKinds.merge,
    update_identifier: row.update_identifier,
    session_key: row.session_key,
    created_at: row.created_at,
    pull_request_number: row.pull_request_number,
    commit: row.commit_sha,
  };
}

/**
 * One JSON-serialisable object per uncertain case, grouped by kind and oldest
 * first. A failed GitHub read prints `github: "unavailable"` for that case and
 * the remaining cases are still listed. A database that does not exist has no
 * case of its kind and is never created.
 */
export async function listUncertainCases({ config, stores, github }) {
  const instructions = stores.instructions?.uncertain() ?? [];
  const identifiers =
    instructions.length === 0 ? null : instructionIdentifiers(config);
  const cases = [];
  for (const row of instructions) {
    cases.push(await instructionCase({ config, identifiers, row, github }));
  }
  for (const row of stores.repairs?.uncertainRepairs() ?? []) {
    cases.push(await repairCase({ row, github }));
  }
  for (const row of stores.repairs?.uncertainNotices() ?? []) {
    cases.push(noticeCase({ row }));
  }
  for (const row of stores.merges?.uncertain() ?? []) {
    cases.push(mergeCase({ row }));
  }
  return cases;
}

function traceDetail(resolved) {
  const parts = [resolved.kind, resolved.resolution];
  if (resolved.pullRequestNumber !== null) {
    parts.push(`#${resolved.pullRequestNumber}`);
  }
  if (resolved.commit !== undefined) {
    parts.push(shortCommit(resolved.commit));
  }
  return parts.join(" ");
}

// The trace never repeats the instruction text and records no operator
// identity: the operator is root and the case is the subject.
function traceEntry(resolved, action = "uncertain_reconciled") {
  return {
    updateIdentifier: resolved.telegramUpdateIdentifier,
    sessionKey: resolved.sessionKey,
    action,
    detail: traceDetail(resolved),
  };
}

function recordTrace({ stores, entry }) {
  if (stores.instructions === null) {
    throw new ReconcileCaseError("The private trace database is missing.");
  }
  stores.instructions.recordTrace(entry);
}

function recordTraceBestEffort({ stores, entry, warn }) {
  try {
    recordTrace({ stores, entry });
  } catch (error) {
    warn(`The failure could not be traced: ${messageOf(error)}`);
  }
}

// A repair already has its success trace: if the guarded change fails
// afterwards, the case is annotated and the command stops.
function failTransition({ stores, resolved, warn, error }) {
  recordTraceBestEffort({
    stores,
    entry: traceEntry(resolved, "uncertain_reconcile_failed"),
    warn,
  });
  throw error;
}

/**
 * A confirmed publication is not a confirmed notice: the topic must still
 * receive the report of the commit. The command rebuilds the durable watch the
 * failed registration never wrote, so the ordinary worker re-reads the pull
 * request and reports before `/merge` can resolve anything again. The watch is
 * written before the instruction changes; a failure keeps it uncertain. An
 * existing watch of the same update is left as it is.
 */
function registerConfirmedWatch({
  stores,
  sessionKey,
  updateIdentifier,
  pullRequestNumber,
  commit,
}) {
  if (stores.repairs === null) {
    throw new ReconcileCaseError(
      "The CI watch database is missing; the publication cannot be followed.",
    );
  }
  if (stores.repairs.state(updateIdentifier) !== undefined) {
    return;
  }
  stores.repairs.add({
    updateIdentifier,
    sessionKey,
    pullRequestNumber,
    commitSha: commit,
  });
}

/**
 * The topic worktree is marked as published only when its head is exactly the
 * commit a person confirmed, so the same commit can never be published twice.
 * The marker is written before the instruction changes: a failure keeps the
 * case uncertain for a later attempt, and a marker of a confirmed commit is
 * never wrong. Any other local state is left untouched for a continuation.
 */
async function recordConfirmedPublication({
  config,
  identifiers,
  sessionKey,
  commit,
}) {
  const worktree = await findSessionWorktree({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    name: identifiers.worktreeName(sessionKey),
  });
  if (worktree === null) {
    return;
  }
  if ((await headCommit(worktree)) !== commit) {
    return;
  }
  recordPublication(worktree, commit);
}

async function resolveInstruction({
  config,
  stores,
  identifiers,
  updateIdentifier,
  resolution,
  commit,
  pullRequestNumber,
}) {
  const row = (stores.instructions?.uncertain() ?? []).find(
    (candidate) => candidate.update_identifier === updateIdentifier,
  );
  if (row === undefined) {
    throw new ReconcileCaseError(
      `Instruction ${updateIdentifier} is not an uncertain case.`,
    );
  }
  const published = resolution === reconcileResolutions.published;
  const resolved = {
    kind: caseKinds.instruction,
    updateIdentifier,
    telegramUpdateIdentifier: row.update_identifier,
    sessionKey: row.session_key,
    pullRequestNumber: published ? pullRequestNumber : null,
    commit,
    resolution,
  };

  if (published) {
    registerConfirmedWatch({
      stores,
      sessionKey: row.session_key,
      updateIdentifier,
      pullRequestNumber,
      commit,
    });
    await recordConfirmedPublication({
      config,
      identifiers,
      sessionKey: row.session_key,
      commit,
    });
    const synchronization = stores.instructions
      .traceEntries()
      .find(
        (entry) =>
          entry.update_identifier === updateIdentifier &&
          entry.action === mergeSynchronizationRequestedAction,
      );
    if (synchronization) {
      if (!stores.previews) {
        throw new ReconcileCaseError("The preview request store is missing.");
      }
      stores.previews.track({
        updateIdentifier,
        sessionKey: row.session_key,
        authorIdentifier: synchronization.author_identifier,
        pullRequestNumber,
        commitSha: commit,
        mergeSynchronization: true,
      });
    }
  }

  // The transition and its trace are one transaction: the instruction is never
  // closed without the audit entry.
  const applied = stores.instructions.resolveUncertain({
    updateIdentifier,
    outcome: reconcileOutcomes[resolution],
    trace: traceEntry(resolved),
  });
  if (applied === null) {
    throw new ReconcileCaseError(
      `Instruction ${updateIdentifier} is not an uncertain case.`,
    );
  }
  return resolved;
}

async function resolveRepair({
  config,
  stores,
  identifiers,
  updateIdentifier,
  sequence,
  failedCommit,
  resolution,
  commit,
  warn,
}) {
  const row = (stores.repairs?.uncertainRepairs() ?? []).find(
    (candidate) =>
      candidate.sequence === sequence &&
      candidate.update_identifier === updateIdentifier &&
      candidate.commit_sha === failedCommit,
  );
  if (row === undefined) {
    throw new ReconcileCaseError(
      `Repair ${sequence} is not an uncertain case.`,
    );
  }
  // The published commit is the one the repair pushed; without one, the failed
  // commit identifies the case.
  const resolved = {
    kind: caseKinds.repair,
    updateIdentifier,
    sequence,
    telegramUpdateIdentifier: row.update_identifier,
    sessionKey: row.session_key,
    pullRequestNumber: row.pull_request_number,
    failedCommit,
    commit: commit === undefined ? row.commit_sha : commit,
    resolution,
  };

  // The trace lives in another database: it is written first, so a failure
  // leaves the repair uncertain.
  recordTrace({ stores, entry: traceEntry(resolved) });
  if (resolution === reconcileResolutions.published) {
    // A published repair left its commit in the topic worktree: marking it there
    // keeps the same commit from being published twice, exactly as a confirmed
    // instruction does.
    await recordConfirmedPublication({
      config,
      identifiers,
      sessionKey: row.session_key,
      commit: resolved.commit,
    });
  }
  let applied;
  try {
    applied = stores.repairs.resolveUncertainRepair({
      updateIdentifier,
      sequence,
      failedCommit,
      outcome: reconcileOutcomes[resolution],
    });
  } catch (error) {
    failTransition({ stores, resolved, warn, error });
  }
  if (applied === null) {
    failTransition({
      stores,
      resolved,
      warn,
      error: new ReconcileCaseError(
        `Repair ${sequence} is not an uncertain case.`,
      ),
    });
  }
  return resolved;
}

function resolveNotice({ stores, updateIdentifier, resolution, warn }) {
  const row = (stores.repairs?.uncertainNotices() ?? []).find(
    (candidate) => candidate.update_identifier === updateIdentifier,
  );
  if (row === undefined) {
    throw new ReconcileCaseError(
      `Notice ${updateIdentifier} is not an uncertain case.`,
    );
  }
  const resolved = {
    kind: caseKinds.notice,
    updateIdentifier,
    telegramUpdateIdentifier: row.update_identifier,
    sessionKey: row.session_key,
    pullRequestNumber: row.pull_request_number,
    commit: row.commit_sha,
    resolution,
  };

  // The trace lives in another database: it is written first, so a failure
  // leaves the notice uncertain.
  recordTrace({ stores, entry: traceEntry(resolved) });
  let applied;
  try {
    applied =
      resolution === reconcileResolutions.delivered
        ? stores.repairs.resolveUncertainNoticeDelivered(updateIdentifier)
        : stores.repairs.resolveUncertainNoticeResend(updateIdentifier);
  } catch (error) {
    failTransition({ stores, resolved, warn, error });
  }
  if (applied === null) {
    failTransition({
      stores,
      resolved,
      warn,
      error: new ReconcileCaseError(
        `Notice ${updateIdentifier} is not an uncertain case.`,
      ),
    });
  }
  return resolved;
}

/**
 * An uncertain merge is closed from the pull request itself: a merged pull
 * request ends as `merged` with its merge commit, one that is not merged ends
 * as `not_merged`, and the chosen resolution must match what GitHub says. A
 * merge also needs the pinned head. The
 * trace is written first, so a failure changes nothing. The topic already got
 * the unknown-result answer, so no notice is sent.
 */
async function resolveMerge({
  stores,
  github,
  updateIdentifier,
  resolution,
  warn,
}) {
  const row = (stores.merges?.uncertain() ?? []).find(
    (candidate) => candidate.update_identifier === updateIdentifier,
  );
  if (row === undefined) {
    throw new ReconcileCaseError(
      `Merge ${updateIdentifier} is not an uncertain case.`,
    );
  }
  const pullRequest = await github.getPullRequest({
    number: row.pull_request_number,
  });
  const actual = pullRequest.merged
    ? reconcileResolutions.merged
    : reconcileResolutions.notMerged;
  if (resolution !== actual) {
    throw new ReconcileCaseError(
      `Pull request #${row.pull_request_number} is ${actual} on GitHub, not ${resolution}.`,
    );
  }
  if (
    resolution === reconcileResolutions.merged &&
    pullRequest.headSha !== row.commit_sha
  ) {
    throw new ReconcileCaseError(
      `Pull request #${row.pull_request_number} was merged with a different head than the pinned commit.`,
    );
  }
  const resolved = {
    kind: caseKinds.merge,
    updateIdentifier,
    telegramUpdateIdentifier: row.update_identifier,
    sessionKey: row.session_key,
    pullRequestNumber: row.pull_request_number,
    commit: row.commit_sha,
    resolution,
  };
  recordTrace({ stores, entry: traceEntry(resolved) });
  let applied;
  try {
    applied =
      resolution === reconcileResolutions.merged
        ? stores.merges.markMerged(updateIdentifier, pullRequest.mergeCommitSha)
        : stores.merges.markNotMerged(updateIdentifier);
  } catch (error) {
    failTransition({ stores, resolved, warn, error });
  }
  if (!applied) {
    failTransition({
      stores,
      resolved,
      warn,
      error: new ReconcileCaseError(
        `Merge ${updateIdentifier} is not an uncertain case.`,
      ),
    });
  }
  return resolved;
}

function resolveCase({
  config,
  stores,
  github,
  warn,
  kind,
  updateIdentifier,
  sequence,
  failedCommit,
  resolution,
  commit,
  pullRequestNumber,
}) {
  const resolutions = resolutionsByKind[kind];
  if (resolutions === undefined || !resolutions.includes(resolution)) {
    throw new ReconcileCaseError(
      `Resolution ${resolution} is not valid for ${kind}.`,
    );
  }
  switch (kind) {
    case caseKinds.instruction:
      return resolveInstruction({
        config,
        stores,
        identifiers: instructionIdentifiers(config),
        updateIdentifier,
        resolution,
        commit,
        pullRequestNumber,
      });
    case caseKinds.repair:
      return resolveRepair({
        config,
        stores,
        // Only the publication marker of the topic worktree needs the naming
        // source: a not published repair never touches it.
        identifiers:
          resolution === reconcileResolutions.published
            ? instructionIdentifiers(config)
            : null,
        updateIdentifier,
        sequence,
        failedCommit,
        resolution,
        commit,
        warn,
      });
    case caseKinds.notice:
      return resolveNotice({ stores, updateIdentifier, resolution, warn });
    case caseKinds.merge:
      return resolveMerge({
        stores,
        github,
        updateIdentifier,
        resolution,
        warn,
      });
    default:
      throw new ReconcileCaseError(`Unknown case kind ${kind}.`);
  }
}

/**
 * Tell the topic that the case was resolved. The text is the effect of the
 * service, so it is kept for the next turn of the session before it is sent: a
 * failed notice never loses it, and its identity makes a repeated resolution
 * idempotent. A note failure never stops the notice.
 */
async function notify({ stores, telegram, resolved, warn }) {
  const text = reconcileReports.reconciled({ resolution: resolved.resolution });
  try {
    stores.notes?.addNote({
      sessionKey: resolved.sessionKey,
      text,
      // A repair row sequence is reused by a later attempt, so the identity of
      // the effect names it too: two attempts of the same instruction are two
      // different results.
      effectKey:
        resolved.kind === caseKinds.repair
          ? `reconcile:${resolved.kind}:${resolved.updateIdentifier}:${resolved.sequence}`
          : `reconcile:${resolved.kind}:${resolved.updateIdentifier}`,
    });
  } catch (error) {
    warn(
      `The resolution is kept, but its effect could not be stored for the session: ${messageOf(error)}`,
    );
  }
  try {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      resolved.sessionKey,
    );
    await telegram.sendMessage({
      chatIdentifier,
      messageThreadIdentifier: threadIdentifier,
      text,
    });
  } catch (error) {
    warn(
      `The resolution is kept, but the topic notice could not be sent: ${messageOf(error)}`,
    );
    recordTraceBestEffort({
      stores,
      entry: traceEntry(resolved, "uncertain_reconciled_notice_failed"),
      warn,
    });
  }
}

/**
 * Resolve one case with the decision of a person. Every store update is guarded
 * by the uncertain state, so an already resolved case is refused instead of
 * being overwritten. A resolution is never kept without its trace, and a failed
 * notice never undoes one. A reconciled notice sends no topic notice: `delivered`
 * means the topic already received it and `resend` asks the ordinary worker to
 * send it again.
 */
export async function resolveUncertainCase({
  config,
  stores,
  telegram,
  github,
  kind,
  updateIdentifier,
  sequence,
  failedCommit,
  resolution,
  commit,
  pullRequestNumber,
  warn = () => {},
}) {
  const resolved = await resolveCase({
    config,
    stores,
    github,
    warn,
    kind,
    updateIdentifier,
    sequence,
    failedCommit,
    resolution,
    commit,
    pullRequestNumber,
  });
  if (
    resolved.kind === caseKinds.instruction ||
    resolved.kind === caseKinds.repair
  ) {
    await notify({ stores, telegram, resolved, warn });
  }
  return resolved;
}
