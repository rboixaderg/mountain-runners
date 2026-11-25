/** A Telegram double that records every delivered message. */
export function recordingTelegram() {
  const telegram = {
    sent: [],
    sendError: null,
    async sendMessage(message) {
      if (telegram.sendError) throw telegram.sendError;
      telegram.sent.push(message);
    },
  };
  return telegram;
}
