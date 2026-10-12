import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import MembersServices from "../components/members/MembersServices.astro";
import type { Contact, ExternalAction } from "../lib/content/models";
import type { Locale } from "../lib/content/primitives";
import * as messages from "../paraglide/messages.js";
import { locales } from "../../i18n.config.mjs";

const reservationUrl =
  "https://mountainrunners.playoffinformatica.com/Reserva.php#";

const contact: Contact = {
  id: "mountain-runners-contact",
  published: true,
  email: "info@mountainrunners.cat",
  address: {
    ca: "Plaça Sant Joan, 15 baixos, 08600 Berga",
    es: "Plaza Sant Joan, 15 bajos, 08600 Berga",
    en: "Plaça Sant Joan, 15 ground floor, 08600 Berga",
  },
  hours: { ca: "De dilluns a divendres, de 18 h a 20 h" },
  cif: "G63999817",
};

function actionWithStatus(status: ExternalAction["status"]): ExternalAction {
  return {
    id: "functional-training",
    published: true,
    status,
    ...(status === "available"
      ? {
          url: {
            ca: reservationUrl,
            es: reservationUrl,
            en: reservationUrl,
          },
        }
      : {}),
  };
}

function getSection(html: string): Element {
  const section = new JSDOM(html).window.document.querySelector(
    'section[aria-labelledby="members-services-title"]',
  );
  if (section === null) {
    throw new Error("Members services section did not render");
  }
  return section;
}

describe("MembersServices", () => {
  it.each(locales as Locale[])(
    "renders the localized section and reservation link for %s",
    async (locale) => {
      const container = await AstroContainer.create();
      const html = await container.renderToString(MembersServices, {
        props: { action: actionWithStatus("available"), contact, locale },
      });

      const section = getSection(html);
      const link = section.querySelector("a");

      expect(section.querySelector("h2")?.textContent).toBe(
        messages.members_services_title({}, { locale }),
      );
      expect(section.querySelector("h3")?.textContent).toBe(
        messages.members_functional_training_title({}, { locale }),
      );
      expect(section.textContent).toContain(
        messages.members_functional_training_members_only({}, { locale }),
      );
      expect(section.textContent).toContain(
        messages.members_functional_training_price({}, { locale }),
      );
      expect(section.textContent).toContain(contact.address[locale]);
      expect(link?.getAttribute("href")).toBe(reservationUrl);
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link?.textContent).toContain(
        messages.members_functional_training_action({}, { locale }),
      );
      expect(link?.getAttribute("data-analytics-action")).toBe(
        "training_reservation",
      );
      expect(link?.getAttribute("data-analytics-area")).toBe(
        "members_training",
      );
      expect(link?.getAttribute("data-analytics-target")).toBe(
        "functional_training",
      );
    },
  );

  it("explains an unavailable action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersServices, {
      props: {
        action: actionWithStatus("temporarily-unavailable"),
        contact,
        locale: "ca",
      },
    });

    const section = getSection(html);

    expect(section.textContent).toContain("Temporalment no disponible");
    expect(section.querySelector("a, button, input")).toBeNull();
    // The section keeps describing the service when booking is not offered.
    expect(section.textContent).toContain(
      messages.members_functional_training_intro({}, { locale: "ca" }),
    );
  });

  it("omits the address when the institutional contact is unavailable", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersServices, {
      props: {
        action: actionWithStatus("available"),
        contact: undefined,
        locale: "ca",
      },
    });

    const section = getSection(html);

    expect(section.textContent).not.toContain(contact.address.ca);
  });
});
