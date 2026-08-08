import { describe, expect, it } from "vitest";
import type { ExternalAction } from "../lib/content/models";
import {
  getNewsletterPresentation,
  newsletterSubscribeMessageKey,
  newsletterUnavailableMessageKey,
} from "../lib/presentation/newsletter";

function newsletterAction(
  status: ExternalAction["status"],
  url: ExternalAction["url"],
): ExternalAction {
  return { id: "newsletter", published: true, status, url };
}

describe("getNewsletterPresentation", () => {
  it("renders nothing when the newsletter action is missing", () => {
    expect(getNewsletterPresentation(undefined, "ca")).toBeUndefined();
  });

  it("renders the subscribe link for an available action", () => {
    const action = newsletterAction("available", {
      ca: "https://example.com/newsletter",
    });
    expect(getNewsletterPresentation(action, "ca")).toEqual({
      kind: "link",
      url: "https://example.com/newsletter",
      labelMessageKey: newsletterSubscribeMessageKey,
    });
  });

  it("renders the shared coming-soon message for a coming-soon action", () => {
    const action = newsletterAction("coming-soon", undefined);
    expect(getNewsletterPresentation(action, "ca")).toEqual({
      kind: "text",
      messageKey: "external_action_coming_soon",
    });
  });

  it("renders the shared temporarily-unavailable message", () => {
    const action = newsletterAction("temporarily-unavailable", undefined);
    expect(getNewsletterPresentation(action, "ca")).toEqual({
      kind: "text",
      messageKey: "external_action_temporarily_unavailable",
    });
  });

  it("renders the section unavailable message for an unavailable action", () => {
    const action = newsletterAction("unavailable", undefined);
    expect(getNewsletterPresentation(action, "ca")).toEqual({
      kind: "text",
      messageKey: newsletterUnavailableMessageKey,
    });
  });

  it("renders nothing for an available action without a URL", () => {
    const action = newsletterAction("available", undefined);
    expect(getNewsletterPresentation(action, "ca")).toBeUndefined();
  });
});
