import { describe, expect, it } from "vitest";
import { getSiteSocialLinks } from "../lib/presentation/social";

describe("site social links", () => {
  it("publishes the Instagram profile for the club office", () => {
    expect(
      getSiteSocialLinks("https://www.instagram.com/infomountain/"),
    ).toEqual([
      {
        id: "instagram",
        labelMessageKey: "footer_social_instagram",
        url: "https://www.instagram.com/infomountain/",
      },
    ]);
  });

  it("omits social links without a published profile URL", () => {
    expect(getSiteSocialLinks(undefined)).toEqual([]);
  });
});
