import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import MembersActionSection from "../components/members/MembersActionSection.astro";
import type { ExternalAction } from "../lib/content/models";

function actionWithStatus(status: ExternalAction["status"]): ExternalAction {
  return {
    id: "test-action",
    published: true,
    status,
    ...(status === "available"
      ? { url: { ca: "https://example.org/action" } }
      : {}),
  };
}

const sectionProps = {
  actionLabelKey: "members_signup_action" as const,
  introKey: "members_signup_intro" as const,
  locale: "ca" as const,
  sectionId: "members-signup-title",
  titleKey: "members_signup_title" as const,
};

function getActionSection(html: string) {
  const section = new JSDOM(html).window.document.querySelector(
    'section[aria-labelledby="members-signup-title"]',
  );
  if (section === null) {
    throw new Error("Members action section did not render");
  }
  return section;
}

describe("MembersActionSection", () => {
  it("renders a descriptive link for an available action", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("available") },
    });

    const section = getActionSection(html);
    const link = section.querySelector("a");

    expect(link?.getAttribute("href")).toBe("https://example.org/action");
    expect(link?.textContent).toContain("Fes-te soci o sòcia");
    expect(section.textContent).not.toContain("Properament");
    expect(section.textContent).not.toContain("Temporalment no disponible");
    expect(section.textContent).not.toContain("No disponible");
  });

  it("explains a coming-soon action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("coming-soon") },
    });

    const section = getActionSection(html);

    expect(section.textContent).toContain("Properament");
    expect(section.querySelector("a, button, input")).toBeNull();
  });

  it("explains a temporarily unavailable action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: {
        ...sectionProps,
        action: actionWithStatus("temporarily-unavailable"),
      },
    });

    const section = getActionSection(html);

    expect(section.textContent).toContain("Temporalment no disponible");
    expect(section.querySelector("a, button, input")).toBeNull();
  });

  it("explains an unavailable action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("unavailable") },
    });

    const section = getActionSection(html);

    expect(section.textContent).toContain("No disponible");
    expect(section.querySelector("a, button, input")).toBeNull();
  });

  it("explains a missing action without rendering an empty state", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: undefined },
    });

    const section = getActionSection(html);

    expect(section.textContent).toContain("No disponible");
    expect(section.querySelector("a, button, input")).toBeNull();
  });
});
