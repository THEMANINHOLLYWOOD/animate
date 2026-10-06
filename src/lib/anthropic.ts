import Anthropic from "@anthropic-ai/sdk";

// One client for every route. Organisation-level API keys must name a workspace;
// set ANTHROPIC_WORKSPACE_ID for those (workspace-scoped keys don't need it).
export function anthropicClient() {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
}
