export const analyticsEventNames = {
  pageDwell: "Page Dwell",
  uiAction: "UI Action",
} as const;

export const analyticsAreas = {
  aboutStatutes: "about_statutes",
  documents: "documents",
  eventActions: "event_actions",
  eventCalendar: "event_calendar",
  eventResources: "event_resources",
  eventsHub: "events_hub",
  footerNav: "footer_nav",
  footerSocial: "footer_social",
  headerNav: "header_nav",
  homepage: "homepage",
  languageSelector: "language_selector",
  legalContact: "legal_contact",
  membersAction: "members_action",
  membersCollaborators: "members_collaborators",
  prefooterContact: "prefooter_contact",
  prefooterNewsletter: "prefooter_newsletter",
  schoolRegistration: "school_registration",
  schoolsHub: "schools_hub",
} as const;

export type AnalyticsArea =
  (typeof analyticsAreas)[keyof typeof analyticsAreas];

export const analyticsActions = {
  anchorJump: "anchor_jump",
  calendarDayOpen: "calendar_day_open",
  calendarEventLink: "calendar_event_link",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  documentOpen: "document_open",
  eventInformation: "event_information",
  eventRegistration: "event_registration",
  federationSignup: "federation_signup",
  localeSwitch: "locale_switch",
  memberSignup: "member_signup",
  navigate: "navigate",
  newsletterSubscribe: "newsletter_subscribe",
  schoolRegistration: "school_registration",
  socialLink: "social_link",
  collaboratorWebsite: "collaborator_website",
} as const;

export type AnalyticsAction =
  (typeof analyticsActions)[keyof typeof analyticsActions];

export const analyticsPageTypes = {
  about: "about",
  documents: "documents",
  eventDetail: "event_detail",
  eventsHub: "events_hub",
  home: "home",
  legal: "legal",
  members: "members",
  other: "other",
  schoolDetail: "school_detail",
  schoolsHub: "schools_hub",
} as const;

export type AnalyticsPageType =
  (typeof analyticsPageTypes)[keyof typeof analyticsPageTypes];

export const dwellTimeThresholdsSeconds = [15, 30, 60, 120] as const;

const analyticsTargetPattern = /^[a-z0-9_-]{1,64}$/u;

export function sanitizeAnalyticsTarget(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/gu, "_")
    .replaceAll(/_+/gu, "_")
    .replaceAll(/^_|_$/gu, "")
    .slice(0, 64);

  if (normalized.length === 0 || !analyticsTargetPattern.test(normalized)) {
    return "unknown";
  }

  return normalized;
}
