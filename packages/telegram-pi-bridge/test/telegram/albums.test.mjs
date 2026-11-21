import assert from "node:assert/strict";
import { test } from "node:test";
import { AlbumCollector } from "../../src/telegram/albums.mjs";

function update(
  updateIdentifier,
  mediaGroupIdentifier = "album-1",
  overrides = {},
) {
  return {
    update_id: updateIdentifier,
    message: {
      message_id: updateIdentifier + 1000,
      chat: { id: -1001234567890 },
      from: { id: 42 },
      message_thread_id: 7,
      media_group_id: mediaGroupIdentifier,
      ...overrides,
    },
  };
}

const groupIdentifier = "-1001234567890:7:42:album-1";

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
  assert.equal(expired.identifier, groupIdentifier);
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

  groups.remove(groupIdentifier);

  assert.equal(groups.hasPending(), false);
  assert.equal(groups.oldestUpdateIdentifier(), null);
});

test("keeps the same media group of another author apart", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  groups.add(update(10));
  groups.add(update(11, "album-1", { from: { id: 43 } }));
  clock.value = 1000;

  const expired = groups.expired();
  assert.equal(expired.length, 2);
  assert.deepEqual(
    expired.map((group) => group.updates.length),
    [1, 1],
  );
  assert.equal(expired[0].identifier, groupIdentifier);
  assert.equal(expired[1].identifier, "-1001234567890:7:43:album-1");
});

test("keeps the same media group of another topic apart", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  groups.add(update(10));
  groups.add(update(11, "album-1", { message_thread_id: 8 }));
  clock.value = 1000;

  const expired = groups.expired();
  assert.equal(expired.length, 2);
  assert.equal(expired[1].identifier, "-1001234567890:8:42:album-1");
  assert.equal(groups.hasPendingSession("-1001234567890:8"), true);
});

test("removes only the group whose composite key is given", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });
  groups.add(update(10));
  groups.add(update(11, "album-1", { from: { id: 43 } }));

  groups.remove(groupIdentifier);
  clock.value = 1000;

  assert.equal(groups.hasPending(), true);
  assert.deepEqual(
    groups.expired().map((group) => group.identifier),
    ["-1001234567890:7:43:album-1"],
  );
});

test("bounds the pending groups and ignores a new one at the cap", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  for (let index = 0; index <= 200; index += 1) {
    groups.add(update(index, `album-${index}`));
  }
  clock.value = 1000;

  const expired = groups.expired();
  assert.equal(expired.length, 200);
  assert.equal(
    expired.some((group) => group.identifier.endsWith(":album-0")),
    true,
  );
  assert.equal(
    expired.some((group) => group.identifier.endsWith(":album-200")),
    false,
  );
});

test("bounds the members of one group", () => {
  const clock = { value: 0 };
  const groups = collector({ clock });

  for (let index = 1; index <= 25; index += 1) {
    groups.add(update(index));
  }
  clock.value = 1000;

  const [expired] = groups.expired();
  assert.deepEqual(
    expired.updates.map((member) => member.update_id),
    Array.from({ length: 20 }, (_, index) => index + 1),
  );
});

test("accepts a zero wait for immediate admission", () => {
  const clock = { value: 0 };
  const groups = collector({ clock, waitMilliseconds: 0 });

  groups.add(update(10));

  assert.equal(groups.expired().length, 1);
});
