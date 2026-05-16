// Placeholder Kimi client. Real API calls are intentionally not implemented yet.
export class KimiClient {
  async sendUserMessage(message = "") {
    return {
      ok: true,
      placeholder: true,
      message,
      reply: "Kimi client placeholder response."
    };
  }
}
