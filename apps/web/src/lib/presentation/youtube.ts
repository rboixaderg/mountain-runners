export function buildYoutubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

export function extractYoutubeVideoId(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    if (["youtube.com", "www.youtube.com"].includes(parsedUrl.hostname)) {
      const videoId = parsedUrl.searchParams.get("v") ?? undefined;
      return videoId && /^[A-Za-z0-9_-]{11}$/u.test(videoId)
        ? videoId
        : undefined;
    }

    if (parsedUrl.hostname === "youtu.be") {
      const videoId = parsedUrl.pathname.replace(/^\//u, "");
      return /^[A-Za-z0-9_-]{11}$/u.test(videoId) ? videoId : undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
