import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import EventDetail from "../components/events/EventDetail.astro";
import type { Event } from "../lib/content/models";
import type {
  PublishedVariant,
  PublicationCatalog,
} from "../lib/content/publication";
import * as messages from "../paraglide/messages.js";

// The browser journey in shell.spec.ts derives the active event without an
// announced date from the published catalog, so the day the club announces a
// date for every active event there is no published route left with that
// state and the journey skips. This render test keeps the branch covered with
// synthetic data: an active event whose only edition is already in the past
// must still say it has no announced date, must not announce a calendar date
// and must not offer an open registration action.
//
// Rendering EventDetail directly keeps the guarantee independent of the
// calendar and of editorial updates, while the E2E keeps proving that the
// published page wires this component to the real content.

const today = "2026-10-08";
const locale = "ca" as const;

// Synthetic editorial data: an active event with one closed edition in the
// past. The cover is external so the test never reads or re-encodes an asset.
const syntheticEvent: Event = {
  id: "synthetic-undated-event",
  published: true,
  slug: { ca: "synthetic-undated-event" },
  active: true,
  title: { ca: "Esdeveniment sense data" },
  summary: { ca: "Una activitat del club pendent de data." },
  description: { ca: "Descripció sintètica de l'activitat." },
  clubRelationship: "organizes",
  cover: {
    resource: { kind: "external", url: "https://example.com/cartell.jpg" },
    alt: { ca: "Cartell de l'esdeveniment" },
  },
  gallery: [],
  videoUrls: [],
  informationUrl: { ca: "https://example.com/informacio" },
  registrationUrl: { ca: "https://example.com/inscripcio" },
  organizerIds: ["mountain-runners"],
  collaboratorIds: [],
  editions: [
    {
      id: "edition-2024",
      startDate: "2024-05-11",
      endDate: "2024-05-12",
      location: { ca: "Berga" },
      modalities: [{ ca: "Trail" }],
      registrationStatus: "closed",
      documentIds: [],
    },
  ],
};

const variant: Extract<PublishedVariant, { kind: "event" }> = {
  kind: "event",
  locale,
  slug: "synthetic-undated-event",
  entry: syntheticEvent,
};

// EventDetail resolves related entities and edition documents from the
// catalog. This event references no document and only the club itself, so an
// empty catalog is enough for the branch under test.
const catalog: PublicationCatalog = {
  variants: [variant],
  entities: new Map(),
  documents: new Map(),
  externalActions: new Map(),
  contact: undefined,
};

let rendered: Document;

function section(label: string): Element {
  const element = rendered.querySelector(`section[aria-label="${label}"]`);
  if (element === null) {
    throw new Error(`Section "${label}" did not render`);
  }
  return element;
}

function linkLabel(scope: ParentNode, href: string): string {
  const link = scope.querySelector(`a[href="${href}"]`);
  if (link === null) {
    throw new Error(`No link to ${href}`);
  }
  // The trailing arrow is decorative and marked aria-hidden, so it is not part
  // of the control's accessible name.
  const copy = link.cloneNode(true) as HTMLElement;
  for (const node of copy.querySelectorAll('[aria-hidden="true"]')) {
    node.remove();
  }
  return copy.textContent?.trim() ?? "";
}

beforeAll(async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(EventDetail, {
    props: { catalog, locale, today, variant },
  });
  rendered = new JSDOM(html).window.document;
});

describe("EventDetail for an active event without an announced date", () => {
  it("announces the activity and the missing date instead of a calendar date", () => {
    const body = rendered.body.textContent ?? "";
    expect(body).toContain(messages.event_club_badge_organizes({}, { locale }));
    expect(body).toContain(messages.event_status_active({}, { locale }));

    const practicalInfo = section(
      messages.event_practical_info({}, { locale }),
    );
    expect(practicalInfo.textContent).toContain(
      messages.event_no_date_announced({}, { locale }),
    );
    // A missing announced date means no calendar date at all, not an empty
    // element the reader has to interpret.
    expect(practicalInfo.querySelectorAll("time")).toHaveLength(0);
    // The past edition still appears in the history, so the missing date
    // belongs to the next edition and not to the edition list.
    expect(body).toContain(messages.event_previous_editions({}, { locale }));
  });

  it("keeps the registration closed and offers only the official website", () => {
    const actions = section(messages.event_actions_region({}, { locale }));

    expect(actions.textContent).toContain(
      messages.event_registration_closed({}, { locale }),
    );
    expect(linkLabel(actions, "https://example.com/inscripcio")).toBe(
      messages.event_registration_website_action({}, { locale }),
    );
    expect(linkLabel(actions, "https://example.com/informacio")).toBe(
      messages.event_more_information({}, { locale }),
    );
    // The open-registration action never renders for a closed registration.
    expect(actions.textContent).not.toContain(
      messages.event_register_action({}, { locale }),
    );
  });

  it("renders no fake control and no resources section without documents", () => {
    expect(rendered.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
    expect(rendered.querySelectorAll("[disabled]")).toHaveLength(0);
    expect(rendered.querySelectorAll('a[href=""], a[href="#"]')).toHaveLength(
      0,
    );
    expect(rendered.body.textContent).not.toContain(
      messages.event_resources_title({}, { locale }),
    );
  });
});
