import type { EventHubGroup } from "../content/events";
import type { EventEdition, ExternalActionStatus } from "../content/models";

// Canonical message keys for event and registration statuses. The subset
// constants below mirror the keys each presentation context can produce, so
// every status derivation stays explicit and greppable.
export const eventStatusMessageKeys = {
  active: "event_status_active",
  historical: "event_status_historical",
  inProgress: "event_status_in_progress",
  noUpcomingDate: "event_status_no_upcoming_date",
  upcomingEdition: "event_status_upcoming_edition",
} as const;

export type EventStatusMessageKey =
  (typeof eventStatusMessageKeys)[keyof typeof eventStatusMessageKeys];

export const eventActivityMessageKeys = {
  active: eventStatusMessageKeys.active,
  historical: eventStatusMessageKeys.historical,
} as const;

export type EventActivityMessageKey =
  (typeof eventActivityMessageKeys)[keyof typeof eventActivityMessageKeys];

export const eventHubStatusMessageKeys = {
  historical: eventStatusMessageKeys.historical,
  inProgress: eventStatusMessageKeys.inProgress,
  noUpcomingDate: eventStatusMessageKeys.noUpcomingDate,
  upcomingEdition: eventStatusMessageKeys.upcomingEdition,
} as const;

export type EventHubStatusMessageKey =
  (typeof eventHubStatusMessageKeys)[keyof typeof eventHubStatusMessageKeys];

export const homepageEventStatusMessageKeys = {
  inProgress: eventStatusMessageKeys.inProgress,
  noUpcomingDate: eventStatusMessageKeys.noUpcomingDate,
  upcomingEdition: eventStatusMessageKeys.upcomingEdition,
} as const;

export type HomepageEventStatusMessageKey =
  (typeof homepageEventStatusMessageKeys)[keyof typeof homepageEventStatusMessageKeys];

export const registrationStatusMessageKeys = {
  open: "event_registration_open",
  closed: "event_registration_closed",
  "coming-soon": "event_registration_coming_soon",
  unavailable: "event_registration_unavailable",
} as const satisfies Record<EventEdition["registrationStatus"], string>;

export type RegistrationStatusMessageKey =
  (typeof registrationStatusMessageKeys)[keyof typeof registrationStatusMessageKeys];

export type RegistrationPresentation = {
  key: RegistrationStatusMessageKey;
  url?: string;
};

// An available external action renders its link, so only the unavailable
// statuses map to a message key; the fixed pages explain each state with the
// shared external-action contract prepared by the content-contracts task.
export const externalActionStatusMessageKeys = {
  "coming-soon": "external_action_coming_soon",
  "temporarily-unavailable": "external_action_temporarily_unavailable",
  unavailable: "external_action_unavailable",
} as const satisfies Record<Exclude<ExternalActionStatus, "available">, string>;

export type ExternalActionStatusMessageKey =
  (typeof externalActionStatusMessageKeys)[keyof typeof externalActionStatusMessageKeys];

export function getExternalActionStatusMessageKey(
  status: ExternalActionStatus,
): ExternalActionStatusMessageKey | undefined {
  if (status === "available") {
    return undefined;
  }
  return externalActionStatusMessageKeys[status];
}

export function getEventActivityMessageKey(
  active: boolean,
): EventActivityMessageKey {
  return active
    ? eventActivityMessageKeys.active
    : eventActivityMessageKeys.historical;
}

export function getEventHubStatusMessageKey(
  event: { active: boolean },
  edition: Pick<EventEdition, "startDate"> | undefined,
  group: EventHubGroup,
  today: string,
): EventHubStatusMessageKey {
  if (!event.active) return eventHubStatusMessageKeys.historical;
  if (group === "active-without-date" || edition === undefined) {
    return eventHubStatusMessageKeys.noUpcomingDate;
  }
  return edition.startDate <= today
    ? eventHubStatusMessageKeys.inProgress
    : eventHubStatusMessageKeys.upcomingEdition;
}

export function getHomepageEventStatusMessageKey(
  nextEdition: Pick<EventEdition, "startDate"> | undefined,
  today: string,
): HomepageEventStatusMessageKey {
  if (nextEdition === undefined) {
    return homepageEventStatusMessageKeys.noUpcomingDate;
  }
  return nextEdition.startDate <= today
    ? homepageEventStatusMessageKeys.inProgress
    : homepageEventStatusMessageKeys.upcomingEdition;
}

export function getRegistrationPresentation(
  status: EventEdition["registrationStatus"] | undefined,
  url: string | undefined,
): RegistrationPresentation {
  const resolvedStatus = status ?? "unavailable";
  const key = registrationStatusMessageKeys[resolvedStatus];
  if (resolvedStatus === "open" && url !== undefined) {
    return { key, url };
  }
  return { key };
}
