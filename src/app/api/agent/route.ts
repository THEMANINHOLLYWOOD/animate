import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, MODEL, modelError } from "@/lib/anthropic";
import { errorResponse, limit } from "@/lib/limits";
import { AGENT_SYSTEM, AGENT_TOOLS, MAX_AGENT_BODY, cleanHistory, runTool, summarizeDoc } from "@/editor/ai/tools";
import { Doc } from "@/editor/doc/schema";

export const maxDuration = 300;

const client = anthropicClient();
const MAX_TURNS = 24;
const MAX_HISTORY = 12;
const MAX_MESSAGE = 20_000;
const MAX_SUMMARY = 200_000; // the document as the model first sees it
const TOO_LARGE = "This film is too large to send to the editing agent (the limit is 4 MB). Make this change in the editor instead.";

type Body = {
  doc?: unknown;
  time?: unknown;
  selection?: unknown;
  messages?: unknown;
  // The client replays the edits from the action events itself, so the final doc isn't sent back.
  replay?: unknown;
};

// The editor agent: Claude edits a copy of the document with the same ops the UI uses, streaming
// each action (with the call that made it, so the editor can replay it onto the doc as it is by then);
// the client applies the result as one undo step.
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AGENT_BODY) return errorResponse(TOO_LARGE, 413);
  const limited = await limit(req, "agent");
  if (limited) return limited;
  const bytes = await req.arrayBuffer().catch(() => null);
  if (bytes && bytes.byteLength > MAX_AGENT_BODY) return errorResponse(TOO_LARGE, 413);
  let body: Body = {};
  try {
    body = (bytes && JSON.parse(new TextDecoder().decode(bytes))) || {};
  } catch {}
  let doc: Doc;
  try {
    doc = Doc.parse(body.doc);
  } catch {
    return errorResponse("The document is invalid.", 400);
  }
  // Errors go out as NDJSON error lines too, so the editor's stream readers show them.
  const history = cleanHistory(body.messages, MAX_MESSAGE, MAX_HISTORY);
  const request = history.pop();
  if (!request) return errorResponse("No request.", 400);
  if (summarizeDoc(doc, 0).length > MAX_SUMMARY) return errorResponse("This film has too many layers for the editing agent.", 400);
  const ids = new Set((Array.isArray(body.selection) ? body.selection : []).filter((id): id is string => typeof id === "string"));
  const selected = doc.layers.filter((l) => ids.has(l.id)).map((l) => `${l.id} "${l.name}" (${l.type})`);
  const replay = body.replay === true;
  const time = typeof body.time === "number" && Number.isFinite(body.time) ? Math.max(0, Math.min(body.time, doc.meta.duration)) : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // The client may have gone (stopped); nothing more to tell it then.
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {}
      };
      let playhead = time;
      const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));
      messages.push({
        role: "user",
        content: `${summarizeDoc(doc, playhead)}\n\nPlayhead: ${playhead.toFixed(2)}s. Selected: ${selected.length ? selected.join(", ") : "nothing"}.\n\nRequest: ${request.text}`,
      });

      let changes = 0;
      const result = () => ({ changes, ...(replay ? {} : { doc }) });
      // Stop a little before the 300s function limit and hand back what's done.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 285_000);
      const signal = AbortSignal.any([req.signal, deadline.signal]);
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const s = client.messages.stream(
            {
              model: MODEL,
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
            send({ type: "error", message: "Claude declined this request.", ...(changes ? result() : {}) });
            return;
          }
          if (msg.stop_reason !== "tool_use") break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== "tool_use") continue;
            const input = block.input as Record<string, unknown>;
            const out = runTool(doc, block.name, input, playhead);
            // An edit goes out with the call that made it, at the playhead it ran at.
            const call = out.doc !== doc ? { name: block.name, input, t: playhead, ...(out.created ? { created: out.created } : {}) } : undefined;
            if (call) changes++;
            doc = out.doc;
            if (out.seek !== undefined) playhead = out.seek;
            send({ type: "action", label: out.label, error: !!out.isError, ...(call ? { call } : {}) });
            results.push({ type: "tool_result", tool_use_id: block.id, content: out.result, is_error: out.isError });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done", seek: playhead, ...result() });
      } catch (e) {
        if (req.signal.aborted) return;
        if (deadline.signal.aborted) {
          if (changes) {
            send({ type: "text", text: "\n\nI ran out of time; here's what I finished." });
            send({ type: "done", seek: playhead, ...result() });
          } else send({ type: "error", message: "That took longer than the 5-minute limit. Try a smaller request." });
          return;
        }
        const message = modelError(e);
        // Hand back whatever was already done so work isn't lost.
        send({ type: "error", message, ...(changes ? result() : {}) });
      } finally {
        clearTimeout(timer);
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
