import type { APIRoute } from "astro";
import { getBuildPostVariants } from "../../lib/content/repository";
import { getPostLocalResources } from "../../lib/content/posts";
import {
  getPostImagePath,
  postImageWidths,
  transformPostImage,
  type PostImageWidth,
} from "../../lib/content/post-images";

export async function getStaticPaths() {
  const resources = getPostLocalResources(await getBuildPostVariants());
  return resources.flatMap((sourcePath) =>
    postImageWidths.map((width) => ({
      params: { image: getPostImagePath(sourcePath, width) },
      props: { sourcePath, width },
    })),
  );
}

export const GET: APIRoute = async ({ props }) => {
  const { sourcePath, width } = props as {
    sourcePath: string;
    width: PostImageWidth;
  };
  const { data } = await transformPostImage(sourcePath, width);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
