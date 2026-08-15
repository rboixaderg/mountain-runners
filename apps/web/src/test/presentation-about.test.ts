import { describe, expect, it } from "vitest";
import { parseBoardMembers } from "../lib/presentation/about";

describe("parseBoardMembers", () => {
  it("parses localized board member lines", () => {
    expect(
      parseBoardMembers(
        "- **Ernest Garrido Ferrer** — President\n- **Albert Penyaranda Riu** — Vicepresident",
      ),
    ).toEqual([
      { name: "Ernest Garrido Ferrer", role: "President" },
      { name: "Albert Penyaranda Riu", role: "Vicepresident" },
    ]);
  });
});
