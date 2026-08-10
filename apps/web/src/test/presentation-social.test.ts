import { describe, expect, it } from "vitest";
import { siteSocialLinks } from "../lib/presentation/social";

describe("site social links", () => {
  it("publishes the Instagram profile for the club office", () => {
    expect(siteSocialLinks).toEqual([
      {
        id: "instagram",
        labelMessageKey: "footer_social_instagram",
        url: "https://www.instagram.com/infomountain/",
      },
    ]);
  });
});
