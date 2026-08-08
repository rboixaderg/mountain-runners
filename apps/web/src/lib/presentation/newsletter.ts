import type { ExternalAction } from "../content/models";
import type { Locale } from "../content/primitives";
import {
  getExternalActionStatusMessageKey,
  type ExternalActionStatusMessageKey,
} from "./status";

// Canonical message keys of the newsletter section of the Contact page. The
// subscribe label and the section unavailable message belong to the section
// itself, so they are not part of the shared external-action status keys.
export const newsletterSubscribeMessageKey = "contact_newsletter_subscribe";
export const newsletterUnavailableMessageKey = "newsletter_unavailable";

export type NewsletterPresentation =
  | {
      kind: "link";
      url: string;
      labelMessageKey: typeof newsletterSubscribeMessageKey;
    }
  | {
      kind: "text";
      messageKey:
        ExternalActionStatusMessageKey | typeof newsletterUnavailableMessageKey;
    };

// The newsletter section renders the external `newsletter` action as a link
// when it is available, and as explanatory text for every other state; it
// never simulates a subscription form or control.
export function getNewsletterPresentation(
  action: ExternalAction | undefined,
  locale: Locale,
): NewsletterPresentation | undefined {
  if (action === undefined) return undefined;
  if (action.status === "available" && action.url !== undefined) {
    return {
      kind: "link",
      url: action.url[locale]!,
      labelMessageKey: newsletterSubscribeMessageKey,
    };
  }
  if (action.status === "unavailable") {
    return {
      kind: "text",
      messageKey: newsletterUnavailableMessageKey,
    };
  }
  const statusMessageKey = getExternalActionStatusMessageKey(action.status);
  if (statusMessageKey !== undefined) {
    return { kind: "text", messageKey: statusMessageKey };
  }
  return undefined;
}
