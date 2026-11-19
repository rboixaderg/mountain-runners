// Bounded collection of a Telegram album.
//
// Telegram delivers every image of an album as a separate update with the same
// `media_group_id`, and usually only one of them carries the caption. The
// updates of one album can span more than one long poll, so the bridge keeps
// the members it has seen for a short bounded wait before it classifies the
// group as one instruction.
//
// Telegram re-delivers every update with an identifier at or above the offset
// on every poll. The wait therefore starts when the group is created and never
// restarts for a member that is already held: otherwise the bounded wait would
// never end. A genuinely new member may extend it, but never beyond an absolute
// maximum measured from the first member.
//
// The collector is memory only. The bridge does not advance the Telegram offset
// past a member that is still waiting, so a restart re-reads the album from the
// same offset instead of losing it; the queue deduplicates whatever was already
// admitted.

const defaultMaximumWaitMilliseconds = 5000;

function sessionKeyOf(update) {
  const message = update.message;
  const chatIdentifier = message?.chat?.id;
  const threadIdentifier = message?.message_thread_id;
  if (chatIdentifier === undefined || typeof threadIdentifier !== "number") {
    return null;
  }
  return `${chatIdentifier}:${threadIdentifier}`;
}

export class AlbumCollector {
  #groups = new Map();
  #now;
  #waitMilliseconds;
  #maximumWaitMilliseconds;

  constructor({
    now = () => Date.now(),
    waitMilliseconds = 1000,
    maximumWaitMilliseconds = Math.max(
      waitMilliseconds * 4,
      defaultMaximumWaitMilliseconds,
    ),
  } = {}) {
    if (!Number.isSafeInteger(waitMilliseconds) || waitMilliseconds < 0) {
      throw new Error("The album wait must be a non-negative integer.");
    }
    if (
      !Number.isSafeInteger(maximumWaitMilliseconds) ||
      maximumWaitMilliseconds < waitMilliseconds
    ) {
      throw new Error(
        "The maximum album wait must be an integer not below the wait.",
      );
    }
    this.#now = now;
    this.#waitMilliseconds = waitMilliseconds;
    this.#maximumWaitMilliseconds = maximumWaitMilliseconds;
  }

  /** Add one member. A re-delivered member never moves the deadline. */
  add(update) {
    const groupIdentifier = update.message.media_group_id;
    let group = this.#groups.get(groupIdentifier);
    const now = this.#now();
    if (group === undefined) {
      group = {
        identifier: groupIdentifier,
        sessionKey: sessionKeyOf(update),
        firstAt: now,
        deadline: now + this.#waitMilliseconds,
        updates: new Map(),
      };
      this.#groups.set(groupIdentifier, group);
    }
    if (group.updates.has(update.update_id)) {
      return;
    }
    group.updates.set(update.update_id, update);
    // A new member may extend the wait, but never past the absolute maximum
    // measured from the first member.
    group.deadline = Math.min(
      now + this.#waitMilliseconds,
      group.firstAt + this.#maximumWaitMilliseconds,
    );
  }

  /** The groups whose bounded wait ended, oldest first. */
  expired() {
    const now = this.#now();
    return [...this.#groups.values()]
      .filter((group) => group.deadline <= now)
      .map((group) => ({
        identifier: group.identifier,
        sessionKey: group.sessionKey,
        updates: [...group.updates.values()].toSorted(
          (first, second) => first.update_id - second.update_id,
        ),
      }));
  }

  remove(groupIdentifier) {
    this.#groups.delete(groupIdentifier);
  }

  hasPending() {
    return this.#groups.size > 0;
  }

  /** Whether an album of this session is still waiting. */
  hasPendingSession(sessionKey) {
    return this.oldestUpdateIdentifierForSession(sessionKey) !== null;
  }

  /** The oldest member of a waiting album of this session, or null. */
  oldestUpdateIdentifierForSession(sessionKey) {
    let oldest = null;
    for (const group of this.#groups.values()) {
      if (group.sessionKey !== sessionKey) {
        continue;
      }
      for (const updateIdentifier of group.updates.keys()) {
        if (oldest === null || updateIdentifier < oldest) {
          oldest = updateIdentifier;
        }
      }
    }
    return oldest;
  }

  /** The smallest update identifier the bridge must not skip, or null. */
  oldestUpdateIdentifier() {
    let oldest = null;
    for (const group of this.#groups.values()) {
      for (const updateIdentifier of group.updates.keys()) {
        if (oldest === null || updateIdentifier < oldest) {
          oldest = updateIdentifier;
        }
      }
    }
    return oldest;
  }

  /** How long until the first group expires, in milliseconds. */
  remainingMilliseconds() {
    let remaining = null;
    const now = this.#now();
    for (const group of this.#groups.values()) {
      const groupRemaining = Math.max(0, group.deadline - now);
      if (remaining === null || groupRemaining < remaining) {
        remaining = groupRemaining;
      }
    }
    return remaining ?? 0;
  }
}
