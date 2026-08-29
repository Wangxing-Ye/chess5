import {
  canSpectate,
  extractPlayToken,
  extractSpectateToken,
  toClientMatch,
} from "@/lib/match/auth";
import { matchNotFoundPayload } from "@/lib/match/notFound";
import { getMatch } from "@/lib/match/store";
import { acquireStreamSlot } from "@/lib/match/streams";

export const runtime = "nodejs";

const POLL_MS = 800;
/** Idle connections still need traffic or proxies will reap them. */
const KEEPALIVE_MS = 20_000;

type Ctx = { params: Promise<{ id: string }> };

function jsonError(
  status: number,
  body: { error: string; code?: string },
  headers?: HeadersInit,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token =
    extractSpectateToken(req, url) || extractPlayToken(req);

  const initial = getMatch(id);
  if (!initial) {
    const miss = matchNotFoundPayload(id);
    return jsonError(miss.status, miss.body);
  }
  if (!canSpectate(initial, token)) {
    return jsonError(403, { error: "Forbidden" });
  }

  const release = acquireStreamSlot(id);
  if (!release) {
    return jsonError(
      503,
      { error: "Too many open streams" },
      { "Retry-After": "30" },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  let close = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let lastPayload = "";
      let lastSentAt = 0;

      const write = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
        lastSentAt = Date.now();
      };

      const send = () => {
        if (closed) return;
        const match = getMatch(id);
        // Terminal states end the stream; leaving it open would repeat the
        // error every tick and hold the slot forever.
        if (!match) {
          write(`event: error\ndata: ${JSON.stringify({ error: "not found" })}\n\n`);
          close();
          return;
        }
        if (!canSpectate(match, token)) {
          write(`event: error\ndata: ${JSON.stringify({ error: "forbidden" })}\n\n`);
          close();
          return;
        }

        const payload = JSON.stringify({ match: toClientMatch(match) });
        if (payload !== lastPayload) {
          lastPayload = payload;
          write(`event: match\ndata: ${payload}\n\n`);
          return;
        }
        if (Date.now() - lastSentAt >= KEEPALIVE_MS) write(": keepalive\n\n");
      };

      const interval = setInterval(send, POLL_MS);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", close);
      send();
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
