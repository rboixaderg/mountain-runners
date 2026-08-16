import type { EventHubGroup } from "../content/events";
import type {
  EventEdition,
  ExternalAction,
  ExternalActionStatus,
  RegistrationStatus,
} from "../content/models";
import type { Locale } from "../content/primitives";

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
} as const satisfies Record<RegistrationStatus, string>;

export type RegistrationStatusMessageKey =
  (typeof registrationStatusMessageKeys)[keyof typeof registrationStatusMessageKeys];

// Canonical message keys for the registration action link. An open
// registration points to the registration form; any other status with a URL
// points to the official event website, so the panel never depends on the
// maintained status to offer a path to register.
export const registrationActionMessageKeys = {
  register: "event_register_action",
  website: "event_registration_website_action",
} as const;

export type RegistrationActionMessageKey =
  (typeof registrationActionMessageKeys)[keyof typeof registrationActionMessageKeys];

export type RegistrationPresentation = {
  key: RegistrationStatusMessageKey;
  url?: string;
  // Message key for the action link label; present only when a URL exists.
  actionKey?: RegistrationActionMessageKey;
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

// The key helpers below map statuses to message keys that are identical in
// every language; the component resolves the text with its own locale. They
// still receive the locale because the ADR 0006 contract requires every
// presentation helper to accept it, so the signatures stay uniform when a
// future status needs language-dependent output.
export function getExternalActionStatusMessageKey(
  status: ExternalActionStatus | undefined,
  locale: Locale,
): ExternalActionStatusMessageKey | undefined {
  void locale;
  if (status === undefined || status === "available") {
    return undefined;
  }
  return externalActionStatusMessageKeys[status];
}

export type ExternalActionPresentation = {
  href: string | undefined;
  stateMessageKey: ExternalActionStatusMessageKey | undefined;
};

// The Members actions render an available action as a link and every other
// state as explanatory text; a missing action is explained as unavailable.
// The helper returns the locale href and the message key so the component
// resolves them with the current locale and never emits an empty state
// element when no text applies.
export function getExternalActionPresentation(
  action: ExternalAction | undefined,
  locale: Locale,
): ExternalActionPresentation {
  if (action === undefined) {
    return {
      href: undefined,
      stateMessageKey: externalActionStatusMessageKeys.unavailable,
    };
  }
  if (action.status === "available") {
    return { href: action.url?.[locale], stateMessageKey: undefined };
  }
  return {
    href: undefined,
    stateMessageKey: externalActionStatusMessageKeys[action.status],
  };
}

export type ExternalActionLink = {
  href: string;
  isExternal: boolean;
};

export type MemberSignupLink = ExternalActionLink;

export function getMemberSignupLink(
  memberSignupAction: ExternalAction | undefined,
  locale: Locale,
  membersPagePath: string,
): MemberSignupLink {
  return getExternalActionLink(memberSignupAction, locale, membersPagePath);
}

export type FederationLink = ExternalActionLink;

export function getFederationLink(
  federationAction: ExternalAction | undefined,
  locale: Locale,
  membersPagePath: string,
): FederationLink {
  return getExternalActionLink(
    federationAction,
    locale,
    `${membersPagePath}#members-federation-title`,
  );
}

function getExternalActionLink(
  action: ExternalAction | undefined,
  locale: Locale,
  fallbackPath: string,
): ExternalActionLink {
  const presentation = getExternalActionPresentation(action, locale);
  return {
    href: presentation.href ?? fallbackPath,
    isExternal: presentation.href !== undefined,
  };
}

export function getEventActivityMessageKey(
  active: boolean,
  locale: Locale,
): EventActivityMessageKey {
  void locale;
  return active
    ? eventActivityMessageKeys.active
    : eventActivityMessageKeys.historical;
}

export function getEventHubStatusMessageKey(
  event: { active: boolean },
  edition: Pick<EventEdition, "startDate"> | undefined,
  group: EventHubGroup,
  today: string,
  locale: Locale,
): EventHubStatusMessageKey {
  void locale;
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
  locale: Locale,
): HomepageEventStatusMessageKey {
  void locale;
  if (nextEdition === undefined) {
    return homepageEventStatusMessageKeys.noUpcomingDate;
  }
  return nextEdition.startDate <= today
    ? homepageEventStatusMessageKeys.inProgress
    : homepageEventStatusMessageKeys.upcomingEdition;
}

export function getRegistrationPresentation(
  status: RegistrationStatus | undefined,
  url: string | undefined,
  locale: Locale,
): RegistrationPresentation {
  void locale;
  const resolvedStatus = status ?? "unavailable";
  const key = registrationStatusMessageKeys[resolvedStatus];
  if (url === undefined) {
    return { key };
  }
  return {
    key,
    url,
    actionKey:
      resolvedStatus === "open"
        ? registrationActionMessageKeys.register
        : registrationActionMessageKeys.website,
  };
}
