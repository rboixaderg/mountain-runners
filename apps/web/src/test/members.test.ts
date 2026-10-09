import { describe, expect, it } from "vitest";
import type { ExternalAction } from "../lib/content/models";
import { getMembersDirectoryEntities } from "../lib/content/members";
import { createPublicationCatalog } from "../lib/content/publication";
import {
  externalActionStatusMessageKeys,
  getExternalActionPresentation,
  getFederationLink,
  getMemberSignupLink,
} from "../lib/presentation/status";
import { loadContentSource } from "./support/publication-catalog";

describe("members directory", () => {
  it("derives collaborators from published entities with a membership benefit", async () => {
    const source = await loadContentSource();
    const catalog = createPublicationCatalog(source);
    const collaborators = getMembersDirectoryEntities(catalog, "ca");

    // The directory is derived from the content, so the contract is that it
    // lists every published entity carrying a benefit, not a fixed roster.
    const expectedIds = source.entities
      .filter(
        (entity) =>
          entity.published &&
          entity.membershipBenefit !== undefined &&
          entity.id !== "mountain-runners",
      )
      .map((entity) => entity.id)
      .sort((left, right) => {
        const catalogLeft = catalog.entities.get(left)!;
        const catalogRight = catalog.entities.get(right)!;
        return (
          catalogLeft.name.ca.localeCompare(catalogRight.name.ca, "ca") ||
          left.localeCompare(right)
        );
      });
    expect(collaborators.length).toBeGreaterThan(0);
    expect(collaborators.map((entity) => entity.id)).toEqual(expectedIds);
  });

  it("orders collaborators by their localized name", async () => {
    const catalog = createPublicationCatalog(await loadContentSource());
    const names = getMembersDirectoryEntities(catalog, "ca").map(
      (entity) => entity.name.ca,
    );

    expect(names).toEqual(
      [...names].sort((left, right) => left.localeCompare(right, "ca")),
    );
  });

  it("excludes entities without a benefit and the club itself", async () => {
    const catalog = createPublicationCatalog(await loadContentSource());
    const collaborators = getMembersDirectoryEntities(catalog, "ca");
    const collaboratorIds = collaborators.map((entity) => entity.id);

    expect(collaboratorIds).not.toContain("mountain-runners");
    for (const entity of collaborators) {
      expect(entity.membershipBenefit).toBeDefined();
    }
  });

  it("excludes unpublished entities from the directory", async () => {
    const source = await loadContentSource();
    const initialDirectory = getMembersDirectoryEntities(
      createPublicationCatalog(source),
      "ca",
    );
    const unpublishedEntity = source.entities.find(
      ({ id }) => id === initialDirectory[0]!.id,
    )!;
    unpublishedEntity.published = false;

    const updatedDirectory = getMembersDirectoryEntities(
      createPublicationCatalog(source),
      "ca",
    );
    const updatedIds = updatedDirectory.map(({ id }) => id);

    expect(updatedIds).not.toContain(unpublishedEntity.id);
    expect(updatedDirectory).toHaveLength(initialDirectory.length - 1);
  });
});

describe("member action links", () => {
  const membersPath = "/ca/socis/";

  it("links the reviewed registration and federation URLs when available", () => {
    const available: ExternalAction = {
      id: "member-signup",
      published: true,
      status: "available",
      url: { ca: "https://example.com/alta" },
    };

    expect(getMemberSignupLink(available, "ca", membersPath)).toEqual({
      href: "https://example.com/alta",
      isExternal: true,
    });
    expect(getFederationLink(available, "ca", membersPath)).toEqual({
      href: "https://example.com/alta",
      isExternal: true,
    });
  });

  // The header and footer must always offer a path to these actions, so a
  // missing or unavailable action falls back to the section anchor.
  it("falls back to the members page when no action URL is available", () => {
    const unavailable: ExternalAction = {
      id: "member-signup",
      published: true,
      status: "unavailable",
    };

    expect(getMemberSignupLink(undefined, "ca", membersPath)).toEqual({
      href: membersPath,
      isExternal: false,
    });
    expect(getMemberSignupLink(unavailable, "ca", membersPath)).toEqual({
      href: membersPath,
      isExternal: false,
    });
  });

  it("points the federation fallback at its section anchor", () => {
    expect(
      getFederationLink(
        {
          id: "federation",
          published: true,
          status: "unavailable",
        },
        "ca",
        membersPath,
      ),
    ).toEqual({
      href: `${membersPath}#members-federation-title`,
      isExternal: false,
    });
  });

  it("omits an available action URL that has no translation for the locale", () => {
    expect(
      getMemberSignupLink(
        {
          id: "member-signup",
          published: true,
          status: "available",
          url: { ca: "https://example.com/alta" },
        },
        "en",
        membersPath,
      ),
    ).toEqual({ href: membersPath, isExternal: false });
  });
});

describe("external action presentation", () => {
  function memberAction(
    status: ExternalAction["status"],
    url: ExternalAction["url"],
  ): ExternalAction {
    return { id: "member-signup", published: true, status, url };
  }

  it("explains a missing action as unavailable without a href", () => {
    expect(getExternalActionPresentation(undefined, "ca")).toEqual({
      href: undefined,
      stateMessageKey: "external_action_unavailable",
    });
  });

  it("resolves the locale href of an available action", () => {
    const action = memberAction("available", {
      ca: "https://example.com/alta",
      es: "https://example.com/alta-es",
    });
    expect(getExternalActionPresentation(action, "es")).toEqual({
      href: "https://example.com/alta-es",
      stateMessageKey: undefined,
    });
  });

  it("maps every unavailable status to its message key without a href", () => {
    for (const status of [
      "coming-soon",
      "temporarily-unavailable",
      "unavailable",
    ] as const) {
      const action = memberAction(status, undefined);
      expect(getExternalActionPresentation(action, "ca")).toEqual({
        href: undefined,
        stateMessageKey: externalActionStatusMessageKeys[status],
      });
    }
  });

  it("renders no state message for an available action without a locale URL", () => {
    const action = memberAction("available", undefined);
    expect(getExternalActionPresentation(action, "ca")).toEqual({
      href: undefined,
      stateMessageKey: undefined,
    });
  });
});
