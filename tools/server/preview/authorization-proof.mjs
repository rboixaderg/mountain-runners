import { sign, verify } from "node:crypto";

function message({ pullRequestNumber, commit, actor, issuedAt }) {
  return Buffer.from(
    JSON.stringify([pullRequestNumber, commit, actor, issuedAt]),
  );
}

export function signPreviewAuthorization(authorization, privateKey) {
  return sign(null, message(authorization), privateKey).toString("base64");
}

export function verifyPreviewAuthorization(
  authorization,
  signature,
  publicKey,
  now = Date.now(),
) {
  if (
    !Number.isSafeInteger(authorization.pullRequestNumber) ||
    authorization.pullRequestNumber < 1 ||
    !/^[0-9a-f]{40}$/u.test(authorization.commit) ||
    !/^[A-Za-z0-9-]{1,39}$/u.test(authorization.actor) ||
    !Number.isSafeInteger(authorization.issuedAt) ||
    authorization.issuedAt > now ||
    now - authorization.issuedAt > 120_000 ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(signature)
  ) {
    throw new Error("Invalid preview authorization proof.");
  }
  if (
    !verify(
      null,
      message(authorization),
      publicKey,
      Buffer.from(signature, "base64"),
    )
  ) {
    throw new Error("Invalid preview authorization signature.");
  }
}
