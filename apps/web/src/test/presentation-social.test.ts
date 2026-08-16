import { describe, expect, it } from "vitest";
import { getSiteSocialLinks } from "../lib/presentation/social";

describe("site social links", () => {
  it("publishes the Instagram and Strava profiles for the club office", () => {
    expect(
      getSiteSocialLinks(
        {
          instagramUrl: "https://www.instagram.com/infomountain/",
          stravaClubUrl: "https://www.strava.com/clubs/156769",
        },
        "ca",
      ),
    ).toEqual([
      {
        id: "instagram",
        labelMessageKey: "footer_social_instagram",
        url: "https://www.instagram.com/infomountain/",
      },
      {
        id: "strava",
        labelMessageKey: "footer_social_strava",
        url: "https://www.strava.com/clubs/156769",
      },
    ]);
  });

  it("omits social links without a published profile URL", () => {
    expect(getSiteSocialLinks({}, "ca")).toEqual([]);
  });
});
