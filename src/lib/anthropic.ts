import Anthropic from "@anthropic-ai/sdk";

// One client for every route. Organisation-level API keys must name a workspace;
// set ANTHROPIC_WORKSPACE_ID for those (workspace-scoped keys don't need it).
export function anthropicClient() {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
}

// The model every route uses: the most capable one. ANTHROPIC_MODEL overrides it (e.g. to a cheaper model).
export const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-fable-5-2";
