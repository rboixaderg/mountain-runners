// Session identity for the private agent.
//
// The Telegram chat plus its forum topic is the session: two people in the
// same topic share context, and two topics never share it. The session
// identifier used for the Pi session file must contain only the characters Pi
// accepts (`letters`, `numbers`, `.`, `_` and `-`).

export function parseSessionKey(sessionKey) {
  const separator = sessionKey.lastIndexOf(":");
  if (separator === -1) {
    throw new Error(`Invalid session key ${sessionKey}.`);
  }
  const chatPart = sessionKey.slice(0, separator);
  const threadPart = sessionKey.slice(separator + 1);
  const chatIdentifier = Number(chatPart);
  const threadIdentifier = Number(threadPart);
  if (
    chatPart === "" ||
    threadPart === "" ||
    !Number.isSafeInteger(chatIdentifier) ||
    !Number.isSafeInteger(threadIdentifier)
  ) {
    throw new Error(`Invalid session key ${sessionKey}.`);
  }
  return { chatIdentifier, threadIdentifier };
}

export function sessionIdentifier(sessionKey) {
  const { chatIdentifier, threadIdentifier } = parseSessionKey(sessionKey);
  const chatPart = String(chatIdentifier).replaceAll("-", "n");
  return `topic_${chatPart}_${threadIdentifier}`;
}
