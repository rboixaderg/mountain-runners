import type { Post } from "../content/models";
import type { Locale } from "../content/primitives";
import { getMadridDate } from "../content/events";
import { formatCalendarDate } from "./dates";

export const postTitleMessageKeys = {
  news: "navigation_news",
  blog: "navigation_blog",
} as const;
export const postPreviewMessageKeys = {
  draft: "posts_draft_status",
  published: "posts_published_status",
} as const;

export function getPostPreviewMessageKey(post: Post) {
  if (post.published) return postPreviewMessageKeys.published;
  return postPreviewMessageKeys.draft;
}

export function formatPostDate(value: string, locale: Locale): string {
  return formatCalendarDate(getMadridDate(new Date(value)), locale);
}

export function getPostDisplayDate(post: Post): string {
  if (post.published) return post.publishedAt!;
  return post.createdAt;
}
