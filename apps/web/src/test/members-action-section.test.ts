import { experimental_AstroContainer as AstroContainer } from "astro/container";
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

describe("MembersActionSection", () => {
  it("renders a descriptive link for an available action", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("available") },
    });

    expect(html).toContain('href="https://example.org/action"');
    expect(html).toContain("Fes-te soci o sòcia");
    expect(html).not.toContain("members-action__state");
  });

  it("explains a coming-soon action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("coming-soon") },
    });

    expect(html).toContain("Properament");
    expect(html).not.toContain('href="https://example.org/action"');
  });

  it("explains a temporarily unavailable action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: {
        ...sectionProps,
        action: actionWithStatus("temporarily-unavailable"),
      },
    });

    expect(html).toContain("Temporalment no disponible");
    expect(html).not.toContain('href="https://example.org/action"');
  });

  it("explains an unavailable action without a control", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: actionWithStatus("unavailable") },
    });

    expect(html).toContain("No disponible");
    expect(html).not.toContain('href="https://example.org/action"');
  });

  it("explains a missing action without rendering an empty state", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(MembersActionSection, {
      props: { ...sectionProps, action: undefined },
    });

    expect(html).toContain("No disponible");
    expect(html).not.toContain('href="https://example.org/action"');
  });
});
