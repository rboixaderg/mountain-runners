// Sends bounded requests from mountain-preview to the preview site process.
import { connect } from "node:net";

const socketPath =
  process.env.MOUNTAIN_PREVIEW_SITE_SOCKET ?? "/run/mountain-preview-site.sock";

export function requestPreviewSite(command, pullRequestNumber, authorization) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connect(socketPath);
    let response = "";
    socket.setTimeout(60_000, () =>
      socket.destroy(new Error("Preview site manager timed out.")),
    );
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 4096)
        socket.destroy(new Error("Oversized site manager response."));
    });
    socket.on("error", rejectRequest);
    socket.on("close", () => {
      try {
        const result = JSON.parse(response);
        if (!result.ok) throw new Error(result.message);
        resolveRequest(result.message);
      } catch (error) {
        rejectRequest(error);
      }
    });
    socket.write(
      `${JSON.stringify({ command, pullRequestNumber, ...authorization })}\n`,
    );
  });
}
