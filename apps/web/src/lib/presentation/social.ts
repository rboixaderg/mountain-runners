export const siteSocialLinkIds = {
  instagram: "instagram",
} as const;

export type SiteSocialLinkId =
  (typeof siteSocialLinkIds)[keyof typeof siteSocialLinkIds];

export const siteSocialLinkMessageKeys = {
  instagram: "footer_social_instagram",
} as const satisfies Record<SiteSocialLinkId, string>;

export interface SiteSocialLink {
  id: SiteSocialLinkId;
  labelMessageKey: (typeof siteSocialLinkMessageKeys)[SiteSocialLinkId];
  url: string;
}

export const siteSocialLinks = [
  {
    id: siteSocialLinkIds.instagram,
    labelMessageKey: siteSocialLinkMessageKeys.instagram,
    url: "https://www.instagram.com/infomountain/",
  },
] as const satisfies readonly SiteSocialLink[];
