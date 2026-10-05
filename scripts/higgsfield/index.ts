// Seedance 2.5 text-to-video via the official Higgsfield SDK.
// Run: npm run higgsfield:example   (loads HF_CREDENTIALS from .env.local at runtime)
import { APIError, AuthenticationError, config, CredentialsMissedError, higgsfield, NotEnoughCreditsError, ValidationError } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

async function main() {
  if (!process.env.HF_CREDENTIALS) {
    console.error("HF_CREDENTIALS is not set. Add it to .env.local as key-id:key-secret.");
    process.exit(1);
  }
  config({ credentials: process.env.HF_CREDENTIALS });

  console.log(`Submitting to ${MODEL}… (this can take a few minutes)`);
  const result = await higgsfield.subscribe(MODEL, {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // Only a completed request with a video URL counts as success.
  const status = String(result.status);
  if (status === "completed" && result.video?.url) {
    console.log(`Completed · request ${result.request_id}`);
    console.log(`Video URL: ${result.video.url}`);
    return;
  }
  const reason =
    status === "nsfw"
      ? "The request was blocked by content moderation."
      : status === "failed"
        ? "The generation failed."
        : status === "canceled" || status === "cancelled"
          ? "The request was canceled."
          : status === "completed"
            ? "The request completed but returned no video URL."
            : `The request ended with status "${status}".`;
  console.error(`${reason} (request ${result.request_id})`);
  process.exit(1);
}

main().catch((e) => {
  const message =
    e instanceof CredentialsMissedError || e instanceof AuthenticationError
      ? "Authentication failed. Check that HF_CREDENTIALS is a valid key-id:key-secret pair."
      : e instanceof NotEnoughCreditsError
        ? "Not enough Higgsfield credits for this generation."
        : e instanceof ValidationError || (e instanceof APIError && e.message)
          ? `Higgsfield API error: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
  console.error(message);
  process.exit(1);
});
