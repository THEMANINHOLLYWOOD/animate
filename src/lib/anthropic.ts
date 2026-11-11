import Anthropic from "@anthropic-ai/sdk";

// One client for every route. Organisation-level API keys must name a workspace;
// set ANTHROPIC_WORKSPACE_ID for those (workspace-scoped keys don't need it).
export function anthropicClient() {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
}

// The model every route uses: the most capable one. ANTHROPIC_MODEL overrides it (e.g. to a cheaper model).
export const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-fable-5-2";

// A failure talking to the model, in words for the person making a film (never the raw API error).
export function modelError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method/i.test(e.message)))
    return process.env.VERCEL
      ? "The server's Anthropic API key was rejected. Replace ANTHROPIC_API_KEY in the Vercel project settings and redeploy."
      : "No valid Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited. Try again in a moment.";
  if (e instanceof Anthropic.APIError && /credit balance/i.test(e.message)) return "The Anthropic account is out of credits. Add credits under Plans & Billing at console.anthropic.com.";
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || e instanceof Anthropic.APIUserAbortError)) return "That took too long and was stopped. Try again.";
  if (e instanceof Anthropic.APIError) return `The model service returned an error${e.status ? ` (${e.status})` : ""}. Try again in a moment.`;
  return e instanceof Error ? e.message : String(e);
}

// The JSON a structured reply holds. A reply that was declined or cut off says so, instead of
// failing as unparseable text.
export function replyJson<T = Record<string, unknown>>(r: Pick<Anthropic.Message, "content" | "stop_reason">): T {
  if (r.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (r.stop_reason === "max_tokens") throw new Error("The answer was cut off before it finished. Try again.");
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The answer came back unreadable. Try again.");
  }
}
