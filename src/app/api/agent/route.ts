import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic";
import { AGENT_SYSTEM, AGENT_TOOLS, runTool, summarizeDoc } from "@/editor/ai/tools";
import { Doc } from "@/editor/doc/schema";
import { requireUser, unauthorized } from "@/lib/store";

export const maxDuration = 300;

const client = anthropicClient();
const MAX_TURNS = 24;

type Body = {
  doc: unknown;
  time: number;
  selection: string[];
  messages: { role: "user" | "assistant"; text: string }[];
};

// The editor agent: Claude edits a copy of the document with the same ops the
// UI uses, streaming each action; the client applies the final doc as one undo step.
export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();

  const body = (await req.json()) as Body;
  let doc: Doc;
  try {
    doc = Doc.parse(body.doc);
  } catch {
    return Response.json({ error: "The document is invalid." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let playhead = body.time;
      const history = body.messages.slice(-12);
      const last = history.pop();
      const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));
      const selected = body.selection.map((id) => doc.layers.find((l) => l.id === id)?.name ?? id);
      messages.push({
        role: "user",
        content: `${summarizeDoc(doc, playhead)}\n\nPlayhead: ${playhead.toFixed(2)}s. Selected: ${selected.length ? selected.join(", ") : "nothing"}.\n\nRequest: ${last?.text ?? ""}`,
      });

      let changes = 0;
      // Stop a little before the 300s function limit and hand back what's done.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 285_000);
      const signal = AbortSignal.any([req.signal, deadline.signal]);
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const s = client.messages.stream(
            {
              model: "claude-opus-5-5",
              max_tokens: 16000,
              thinking: { type: "adaptive", display: "summarized" },
              output_config: { effort: "medium" },
              system: [{ type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } }],
              tools: AGENT_TOOLS,
              messages,
            },
            { signal },
          );
          // Text written before a tool call is a progress note; only the final turn's text is the reply.
          let turnText = "";
          s.on("text", (t) => (turnText += t));
          s.on("thinking", (t) => send({ type: "thinking", text: t }));
          const msg = await s.finalMessage();
          if (turnText.trim()) send({ type: msg.stop_reason === "tool_use" ? "progress" : "text", text: turnText });
          messages.push({ role: "assistant", content: msg.content });

          if (msg.stop_reason === "refusal") {
            send({ type: "error", message: "Claude declined this request." });
            break;
          }
          if (msg.stop_reason !== "tool_use") break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== "tool_use") continue;
            const out = runTool(doc, block.name, block.input as Record<string, unknown>, playhead);
            if (out.doc !== doc) changes++;
            doc = out.doc;
            if (out.seek !== undefined) playhead = out.seek;
            send({ type: "action", label: out.label, error: !!out.isError });
            results.push({ type: "tool_result", tool_use_id: block.id, content: out.result, is_error: out.isError });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done", doc, changes, seek: playhead });
      } catch (e) {
        if (deadline.signal.aborted) {
          send({ type: "text", text: changes ? "\n\nI ran out of time; here's what I finished." : "" });
          send(changes ? { type: "done", doc, changes, seek: playhead } : { type: "error", message: "That took longer than the 5-minute limit. Try a smaller request." });
          return;
        }
        const message =
          e instanceof Anthropic.APIError && /credit balance/i.test(e.message)
            ? "The Anthropic account is out of credits. Add credits under Plans & Billing at console.anthropic.com."
            : e instanceof Anthropic.RateLimitError
              ? "Rate limited. Try again in a moment."
              : e instanceof Error
                ? e.message
                : String(e);
        // Return whatever was already applied so work isn't lost.
        send({ type: "error", message, doc: changes ? doc : undefined });
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
