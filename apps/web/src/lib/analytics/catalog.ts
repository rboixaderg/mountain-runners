export const analyticsEventNames = {
  pageDwell: "Page Dwell",
  uiAction: "UI Action",
} as const;

export type AnalyticsEventName =
  (typeof analyticsEventNames)[keyof typeof analyticsEventNames];

export const analyticsAreas = {
  aboutStatutes: "about_statutes",
  documents: "documents",
  eventActions: "event_actions",
  eventCalendar: "event_calendar",
  eventResources: "event_resources",
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

export type DwellTimeThresholdSeconds =
  (typeof dwellTimeThresholdsSeconds)[number];

const analyticsTargetPattern = /^[a-z0-9_-]{1,64}$/u;
const analyticsPropPattern = /^[\w.-]{1,64}$/u;

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

export function sanitizeAnalyticsProp(value: string): string {
  const normalized = value.trim().slice(0, 64);
  if (normalized.length === 0 || !analyticsPropPattern.test(normalized)) {
    return "unknown";
  }

  return normalized;
}

export function sanitizeAnalyticsRoute(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  return withoutQuery.slice(0, 120);
}

export function buildAnalyticsEventProps(options: {
  action: AnalyticsAction;
  area: AnalyticsArea;
  locale: string;
  pageType: AnalyticsPageType;
  route: string;
  target?: string;
}): Record<string, string> {
  const props: Record<string, string> = {
    action: sanitizeAnalyticsProp(options.action),
    area: sanitizeAnalyticsProp(options.area),
    locale: sanitizeAnalyticsProp(options.locale),
    page_type: sanitizeAnalyticsProp(options.pageType),
    route: sanitizeAnalyticsRoute(options.route),
  };

  if (options.target !== undefined) {
    props.target = sanitizeAnalyticsTarget(options.target);
  }

  return props;
}

export function buildDwellEventProps(options: {
  locale: string;
  pageType: AnalyticsPageType;
  route: string;
  thresholdSeconds: DwellTimeThresholdSeconds;
}): Record<string, string> {
  return {
    locale: sanitizeAnalyticsProp(options.locale),
    page_type: sanitizeAnalyticsProp(options.pageType),
    route: sanitizeAnalyticsRoute(options.route),
    threshold: sanitizeAnalyticsProp(String(options.thresholdSeconds)),
  };
}
