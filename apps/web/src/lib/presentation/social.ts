import type { Locale } from "../content/primitives";

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

// The link labels are identical in every language and the footer resolves
// them with its own locale. The locale parameter keeps the ADR 0006 contract
// that every presentation helper accepts the locale.
export function getSiteSocialLinks(
  profiles: SiteSocialProfiles,
  locale: Locale,
): SiteSocialLink[] {
  void locale;
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
