import { describe, expect, it } from "vitest";
import {
  schoolPracticalSectionMessageKeys,
  schoolPracticalSectionOrder,
} from "../lib/presentation/schools";

describe("school practical presentation contract", () => {
  it("keeps practical fields in the editorial reading order", () => {
    expect(schoolPracticalSectionOrder).toEqual([
      "since",
      "purpose",
      "audience",
      "schedule",
      "location",
      "prices",
    ]);
  });

  it("maps every practical field to a translated label", () => {
    expect(
      schoolPracticalSectionOrder.every((sectionKey) =>
        schoolPracticalSectionMessageKeys[sectionKey].startsWith("school_"),
      ),
    ).toBe(true);
  });
});
