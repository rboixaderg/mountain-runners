import type { School } from "../content/models";

export const schoolPracticalSectionOrder = [
  "since",
  "purpose",
  "audience",
  "schedule",
  "location",
  "prices",
] as const satisfies readonly (keyof School["sections"])[];

export type SchoolPracticalSectionKey =
  (typeof schoolPracticalSectionOrder)[number];

export const schoolPracticalSectionMessageKeys = {
  since: "school_since_label",
  purpose: "school_purpose_label",
  audience: "school_audience_label",
  schedule: "school_schedule_label",
  location: "school_location_label",
  prices: "school_prices_label",
} as const satisfies Record<SchoolPracticalSectionKey, string>;

export type SchoolPracticalSectionMessageKey =
  (typeof schoolPracticalSectionMessageKeys)[keyof typeof schoolPracticalSectionMessageKeys];
