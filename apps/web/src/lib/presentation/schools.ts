import { getVariantPath } from "../content/routes";
import type { PublishedSchoolVariant } from "../content/schools";
import type { School } from "../content/models";
import type { Locale } from "../content/primitives";

export const schoolPracticalSectionOrder = [
  "since",
  "purpose",
  "audience",
  "schedule",
  "location",
  "requirements",
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
  requirements: "school_requirements_label",
  prices: "school_prices_label",
} as const satisfies Record<SchoolPracticalSectionKey, string>;

export type SchoolPracticalSectionMessageKey =
  (typeof schoolPracticalSectionMessageKeys)[keyof typeof schoolPracticalSectionMessageKeys];

export interface ParsedSchoolPracticalSection {
  body: string;
  label: string | null;
  lead: string | null;
}

export function hasSchoolSectionContent(
  content: string | null | undefined,
): boolean {
  return content !== undefined && content !== null && content.trim().length > 0;
}

export function hasParsedPracticalSectionContent(
  parsedSection: ParsedSchoolPracticalSection,
): boolean {
  return (
    hasSchoolSectionContent(parsedSection.label) ||
    hasSchoolSectionContent(parsedSection.lead) ||
    hasSchoolSectionContent(parsedSection.body)
  );
}

export function parseSchoolPracticalSection(
  markdown: string,
): ParsedSchoolPracticalSection {
  const trimmed = markdown.trim();

  if (trimmed.length === 0) {
    return { label: null, lead: null, body: "" };
  }

  if (trimmed.startsWith("**")) {
    const labelEnd = trimmed.indexOf("**", 2);
    const label = trimmed.slice(2, labelEnd).replace(/:+$/, "").trim();
    const remainder = trimmed.slice(labelEnd + 2).replace(/^:\s*/, "");
    const paragraphBreak = remainder.indexOf("\n\n");

    if (paragraphBreak >= 0) {
      return {
        label,
        lead: remainder.slice(0, paragraphBreak).trim() || null,
        body: remainder.slice(paragraphBreak + 2).trim(),
      };
    }

    return {
      label,
      lead: remainder.trim() || null,
      body: "",
    };
  }

  const paragraphBreak = trimmed.indexOf("\n\n");

  if (paragraphBreak >= 0) {
    return {
      label: null,
      lead: trimmed.slice(0, paragraphBreak).trim() || null,
      body: trimmed.slice(paragraphBreak + 2).trim(),
    };
  }

  return {
    label: null,
    lead: trimmed,
    body: "",
  };
}

export function extractScheduleParts(lead: string): {
  days: string;
  time: string | null;
} {
  const timeMatch = lead.match(
    /(\d{1,2}[,.]\d{2}\s*h(?:\s*a\s*\d{1,2}[,.]\d{2}\s*h)?)/i,
  );

  if (!timeMatch || timeMatch.index === undefined) {
    return { days: lead, time: null };
  }

  const time = timeMatch[0].trim();
  const days = lead
    .slice(0, timeMatch.index)
    .replace(/\s*de\s*$/u, "")
    .trim();

  return {
    days: days.length > 0 ? days : lead,
    time,
  };
}

export interface ParsedPriceListItem {
  amount: string;
  label: string;
}

export function parsePriceSectionBody(body: string): {
  footnote: string | null;
  items: ParsedPriceListItem[];
} {
  const parts = body.split(/\n\n+/);
  const listPart = parts[0] ?? "";
  const footnote = parts.slice(1).join("\n\n").trim() || null;
  const items = listPart
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const colonIndex = line.indexOf(":");

      if (colonIndex === -1) {
        return { label: line, amount: "" };
      }

      return {
        label: line.slice(0, colonIndex).trim(),
        amount: line.slice(colonIndex + 1).trim(),
      };
    });

  return { items, footnote };
}

export interface ParsedPreviewPriceSection {
  footnote: string | null;
  listedFees: ParsedPriceListItem[];
  monthlyTiers: ParsedPriceListItem[];
  registrationFees: ParsedPriceListItem[];
}

function isMonthlyTierLabel(label: string): boolean {
  return /^\d+\s+(dia|dies)\b/i.test(label);
}

function isRegistrationFeeLabel(label: string): boolean {
  return /matr[ií]cula/i.test(label);
}

export function formatPriceAmount(amount: string): {
  unit: string;
  value: string;
} {
  const match = amount.match(/^([\d,.]+\s*€)\s*(.*)$/u);

  if (!match) {
    return { value: amount, unit: "" };
  }

  return {
    value: match[1].trim(),
    unit: match[2].trim(),
  };
}

function splitRegistrationPriceItem(
  item: ParsedPriceListItem,
): ParsedPriceListItem[] {
  if (!item.amount.includes(";")) {
    return [item];
  }

  const segments = item.amount.split(";").map((segment) => segment.trim());
  const registrationFees: ParsedPriceListItem[] = [
    { label: item.label, amount: segments[0]! },
  ];

  for (const segment of segments.slice(1)) {
    const colonIndex = segment.indexOf(":");

    if (colonIndex === -1) {
      registrationFees.push({ label: segment, amount: "" });
      continue;
    }

    registrationFees.push({
      label: segment.slice(0, colonIndex).trim(),
      amount: segment.slice(colonIndex + 1).trim(),
    });
  }

  return registrationFees;
}

export function parsePreviewPriceSection(
  body: string,
): ParsedPreviewPriceSection {
  const { items, footnote } = parsePriceSectionBody(body);
  const expandedItems = items.flatMap((item) =>
    /matr[ií]cula/i.test(item.label)
      ? splitRegistrationPriceItem(item)
      : [item],
  );
  const monthlyTiers = expandedItems.filter((item) =>
    isMonthlyTierLabel(item.label),
  );
  const registrationFees = expandedItems.filter((item) =>
    isRegistrationFeeLabel(item.label),
  );
  const listedFees = expandedItems.filter(
    (item) =>
      !isMonthlyTierLabel(item.label) && !isRegistrationFeeLabel(item.label),
  );

  return {
    footnote,
    listedFees,
    monthlyTiers,
    registrationFees,
  };
}

export function hasPreviewPriceContent(pricesMarkdown: string): boolean {
  if (!hasSchoolSectionContent(pricesMarkdown)) {
    return false;
  }

  const parsedSection = parseSchoolPracticalSection(pricesMarkdown);
  const priceSection = parsePreviewPriceSection(parsedSection.body);

  return (
    hasSchoolSectionContent(parsedSection.lead) ||
    priceSection.listedFees.length > 0 ||
    priceSection.monthlyTiers.length > 0 ||
    priceSection.registrationFees.length > 0 ||
    hasSchoolSectionContent(priceSection.footnote)
  );
}

export function isCompactSchedulePreview(
  parsedSection: ParsedSchoolPracticalSection,
): boolean {
  return hasSchoolSectionContent(parsedSection.lead);
}

export function isDetailedSchedulePreview(
  markdown: string | undefined,
): boolean {
  if (!hasSchoolSectionContent(markdown)) {
    return false;
  }

  return !isCompactSchedulePreview(parseSchoolPracticalSection(markdown!));
}

export function orderPreviewEssentialSections(
  sectionKeys: readonly SchoolPracticalSectionKey[],
  sectionContentByKey: (
    sectionKey: SchoolPracticalSectionKey,
  ) => string | undefined,
): SchoolPracticalSectionKey[] {
  const orderedKeys = [...sectionKeys];

  if (
    !orderedKeys.includes("schedule") ||
    !isDetailedSchedulePreview(sectionContentByKey("schedule"))
  ) {
    return orderedKeys;
  }

  return [
    ...orderedKeys.filter((sectionKey) => sectionKey !== "schedule"),
    "schedule",
  ];
}

export function hasPreviewPracticalCardContent(
  sectionKey: SchoolPracticalSectionKey,
  markdown: string | undefined,
): boolean {
  if (sectionKey === "prices") {
    return markdown !== undefined && hasPreviewPriceContent(markdown);
  }

  if (!hasSchoolSectionContent(markdown)) {
    return false;
  }

  const parsedSection = parseSchoolPracticalSection(markdown!);

  if (sectionKey === "schedule") {
    if (isCompactSchedulePreview(parsedSection)) {
      const scheduleParts = extractScheduleParts(parsedSection.lead!);

      return (
        hasSchoolSectionContent(parsedSection.label) ||
        hasSchoolSectionContent(scheduleParts.days) ||
        hasSchoolSectionContent(scheduleParts.time) ||
        hasSchoolSectionContent(parsedSection.body)
      );
    }

    return hasParsedPracticalSectionContent(parsedSection);
  }

  if (sectionKey === "location") {
    if (!hasSchoolSectionContent(parsedSection.lead)) {
      return false;
    }

    const locationParts = extractLocationParts(parsedSection.lead!);

    return (
      hasSchoolSectionContent(locationParts.primary) ||
      hasSchoolSectionContent(locationParts.secondary)
    );
  }

  if (sectionKey === "audience") {
    return hasSchoolSectionContent(parsedSection.lead);
  }

  return (
    hasSchoolSectionContent(parsedSection.lead) ||
    hasSchoolSectionContent(parsedSection.body)
  );
}

export const schoolPracticalPreviewEssentialOrder = [
  "schedule",
  "location",
  "audience",
] as const satisfies readonly SchoolPracticalSectionKey[];

export const schoolPracticalPreviewContextOrder = [
  "since",
  "purpose",
  "requirements",
] as const satisfies readonly SchoolPracticalSectionKey[];

export function extractLocationParts(text: string): {
  primary: string;
  secondary: string | null;
} {
  const commaIndex = text.indexOf(",");

  if (commaIndex === -1) {
    return { primary: text.trim(), secondary: null };
  }

  return {
    primary: text.slice(0, commaIndex).trim(),
    secondary: text.slice(commaIndex + 1).trim() || null,
  };
}

export const schoolPracticalPreviewLayoutClasses: Record<
  SchoolPracticalSectionKey,
  string
> = {
  since: "schools-detail-preview__practical-card--since",
  purpose: "schools-detail-preview__practical-card--purpose",
  audience: "schools-detail-preview__practical-card--audience",
  schedule: "schools-detail-preview__practical-card--schedule",
  location: "schools-detail-preview__practical-card--location",
  requirements: "schools-detail-preview__practical-card--requirements",
  prices: "schools-detail-preview__practical-card--prices",
};

export type SchoolNavigationItem = {
  href: string;
  id: string;
  label: string;
};

// Builds the navigation entries from variants already selected and ordered by
// the domain layer (`getOrderedPublishedSchoolVariants`). The presentation
// helper never reads the catalog.
export function getSchoolNavigationItems(
  schoolVariants: readonly PublishedSchoolVariant[],
  locale: Locale,
): SchoolNavigationItem[] {
  return schoolVariants.flatMap((variant) => {
    const label = variant.entry.name[locale];
    if (label === undefined) {
      return [];
    }

    return [{ href: getVariantPath(variant), id: variant.entry.id, label }];
  });
}
