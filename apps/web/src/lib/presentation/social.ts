export const siteSocialLinkIds = {
  instagram: "instagram",
  strava: "strava",
} as const;

export type SiteSocialLinkId =
  (typeof siteSocialLinkIds)[keyof typeof siteSocialLinkIds];

export const siteSocialLinkMessageKeys = {
  instagram: "footer_social_instagram",
  strava: "footer_social_strava",
} as const satisfies Record<SiteSocialLinkId, string>;

export interface SiteSocialLink {
  id: SiteSocialLinkId;
  labelMessageKey: (typeof siteSocialLinkMessageKeys)[SiteSocialLinkId];
  url: string;
}

export interface SiteSocialProfiles {
  instagramUrl?: string;
  stravaClubUrl?: string;
}

export function getSiteSocialLinks(
  profiles: SiteSocialProfiles,
): SiteSocialLink[] {
  const links: SiteSocialLink[] = [];

  if (profiles.instagramUrl !== undefined) {
    links.push({
      id: siteSocialLinkIds.instagram,
      labelMessageKey: siteSocialLinkMessageKeys.instagram,
      url: profiles.instagramUrl,
    });
  }

  if (profiles.stravaClubUrl !== undefined) {
    links.push({
      id: siteSocialLinkIds.strava,
      labelMessageKey: siteSocialLinkMessageKeys.strava,
      url: profiles.stravaClubUrl,
    });
  }

  return links;
}
