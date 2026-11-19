import assert from "node:assert/strict";
import { test } from "node:test";
import { AlbumCollector } from "../../src/telegram/albums.mjs";

function update(updateIdentifier, mediaGroupIdentifier = "album-1") {
  return {
    update_id: updateIdentifier,
    message: {
      message_id: updateIdentifier + 1000,
      chat: { id: -1001234567890 },
      message_thread_id: 7,
      media_group_id: mediaGroupIdentifier,
    },
  };
}

function collector({
  waitMilliseconds = 1000,
  clock,
  maximumWaitMilliseconds,
} = {}) {
  return new AlbumCollector({
    now: () => clock.value,
    waitMilliseconds,
    ...(maximumWaitMilliseconds === undefined
      ? {}
      : { maximumWaitMilliseconds }),
  });
}

test("does not move the deadline when Telegram re-delivers a member", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  groups.add(update(10));
  clock.value = 600;
  groups.add(update(10));
  clock.value = 900;
  groups.add(update(10));

  assert.equal(groups.expired().length, 0);
  clock.value = 1000;
  const [expired] = groups.expired();
  assert.equal(expired.identifier, "album-1");
  assert.deepEqual(
    expired.updates.map((member) => member.update_id),
    [10],
  );
});

test("a new member extends the wait only up to the absolute maximum", () => {
  const clock = { value: 0 };
  const groups = collector({
    clock,
    waitMilliseconds: 1000,
    maximumWaitMilliseconds: 1500,
  });

  groups.add(update(10));
  clock.value = 900;
  groups.add(update(11));
  clock.value = 1200;
  groups.add(update(12));

  assert.equal(groups.expired().length, 0);
  clock.value = 1500;
  assert.equal(groups.expired().length, 1);
});

test("reports the pending session and the oldest member", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  groups.add(update(12));
  groups.add(update(10));
  groups.add(update(11));

  assert.equal(groups.hasPendingSession("-1001234567890:7"), true);
  assert.equal(groups.hasPendingSession("-1001234567890:8"), false);
  assert.equal(groups.oldestUpdateIdentifierForSession("-1001234567890:7"), 10);
  assert.equal(
    groups.oldestUpdateIdentifierForSession("-1001234567890:8"),
    null,
  );
  assert.equal(groups.oldestUpdateIdentifier(), 10);
  assert.equal(groups.remainingMilliseconds(), 1000);
});

test("removes a group once it is admitted", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });
  groups.add(update(10));

  groups.remove("album-1");

  assert.equal(groups.hasPending(), false);
  assert.equal(groups.oldestUpdateIdentifier(), null);
});

test("accepts a zero wait for immediate admission", () => {
  const clock = { value: 0 };
  const groups = collector({ clock, waitMilliseconds: 0 });

  groups.add(update(10));

  assert.equal(groups.expired().length, 1);
});
