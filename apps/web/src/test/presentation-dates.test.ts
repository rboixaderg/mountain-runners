import { describe, expect, it } from "vitest";
import {
  formatEditionDate,
  getEditionDayMonth,
} from "../lib/presentation/dates";

describe("formatEditionDate", () => {
  it("formats a single start date in the page locale", () => {
    expect(formatEditionDate({ startDate: "2026-10-02" }, "ca")).toEqual({
      startLabel: "2 d’octubre del 2026",
    });
  });

  it("formats the end date when the edition has one", () => {
    expect(
      formatEditionDate(
        { startDate: "2026-10-02", endDate: "2026-10-04" },
        "ca",
      ),
    ).toEqual({
      startLabel: "2 d’octubre del 2026",
      endLabel: "4 d’octubre del 2026",
    });
  });

  it("keeps the label stable across the Europe/Madrid time zone", () => {
    expect(formatEditionDate({ startDate: "2026-01-01" }, "ca")).toEqual({
      startLabel: "1 de gener del 2026",
    });
  });
});

describe("getEditionDayMonth", () => {
  it("returns the day and short month of the start date", () => {
    expect(getEditionDayMonth({ startDate: "2026-10-02" }, "ca")).toEqual({
      day: "2",
      month: "d’oct.",
    });
  });

  it("returns undefined when there is no edition", () => {
    expect(getEditionDayMonth(undefined, "ca")).toBeUndefined();
  });
});
