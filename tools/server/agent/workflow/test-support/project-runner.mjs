import assert from "node:assert/strict";
import { join } from "node:path";
import { createResearchReview } from "../../repository/research-review.mjs";
import { createProjectRunner } from "../project-runner.mjs";

/**
 * The project runner with inert doubles for the dependencies the service always
 * provides: no publication, binding, merge, note or preview exists unless the
 * test passes the real or a recording one.
 */
export function createTestProjectRunner(options) {
  return createProjectRunner({
    ciWatches: { topicPullRequestNumber: () => null, add() {} },
    mergeRequests: { latest: () => undefined },
    topicJobs: { bindingOf: () => null, bind() {} },
    sessionNotes: { claim: () => [], deliver() {}, release() {}, addNote() {} },
    followPreview() {},
    requestMerge: () => assert.fail("no merge is expected"),
    requestMergeConfirmation: { contextualIntent: () => null },
    researchReview: createResearchReview({
      directory: join(options.config.paths.state, "research-review"),
    }),
    ...options,
  });
}
