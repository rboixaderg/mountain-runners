import { describe, expect, it } from "vitest";
import {
  buildYoutubeEmbedUrl,
  extractYoutubeVideoId,
  youtubeVideoIds,
} from "../lib/presentation/youtube";

describe("presentation/youtube", () => {
  it("builds a privacy-enhanced embed URL", () => {
    expect(buildYoutubeEmbedUrl(youtubeVideoIds.trailSchool)).toBe(
      "https://www.youtube-nocookie.com/embed/SSaismIBl_8",
    );
  });

  it("extracts a video id from common YouTube URL formats", () => {
    expect(
      extractYoutubeVideoId("https://www.youtube.com/watch?v=dqCRDy4jpQA"),
    ).toBe("dqCRDy4jpQA");
    expect(
      extractYoutubeVideoId("https://www.youtube.com/embed/SSaismIBl_8"),
    ).toBe("SSaismIBl_8");
    expect(extractYoutubeVideoId("https://youtu.be/SSaismIBl_8")).toBe(
      "SSaismIBl_8",
    );
  });
});
