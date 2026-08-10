export const youtubeVideoIds = {
  membersPromotional: "EUV5uETCjeo",
  trailSchool: "SSaismIBl_8",
  skimoSchool: "dqCRDy4jpQA",
} as const;

export type YoutubeVideoId =
  (typeof youtubeVideoIds)[keyof typeof youtubeVideoIds];

export function buildYoutubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

export function extractYoutubeVideoId(url: string): string | undefined {
  const match = url.match(
    /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/u,
  );
  return match?.[1];
}
