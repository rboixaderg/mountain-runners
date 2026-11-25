/**
 * The Telegram side of a polling bridge: queued update batches, the status of
 * each member and every message sent.
 */
export function telegramStub({ batches, members = { 42: "member" } }) {
  return {
    pendingBatches: [...batches],
    sent: [],
    requestedOffsets: [],
    async getUpdates({ offset }) {
      this.requestedOffsets.push(offset);
      return this.pendingBatches.shift() ?? [];
    },
    async getChatMember({ userIdentifier }) {
      const status = members[userIdentifier];
      if (status === undefined) {
        throw new Error("unverifiable");
      }
      return { status };
    },
    async sendMessage({ chatIdentifier, messageThreadIdentifier, text }) {
      this.sent.push({ chatIdentifier, messageThreadIdentifier, text });
    },
  };
}
