import { createFileRoute } from "@tanstack/react-router";

const cors: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-bot-code",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      GET: () =>
        json({
          ok: true,
          service: "lantern-line",
          hint: 'POST { "code", "action": "say" | "inbox" | "start" | "stop" | "upload" | "pulse", "body"?, "filename"?, "project"? }. say and inbox use the building thread.',
        }),
      POST: async ({ request }) => {
        const text = await request.text();
        if (text.length > 4000) return json({ ok: false, error: "Request is too large." }, 413);
        let body: Record<string, unknown> = {};
        if (text.trim()) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              return json({ ok: false, error: "Body must be a JSON object." }, 400);
            }
            body = parsed as Record<string, unknown>;
          } catch {
            return json({ ok: false, error: "Body must be JSON." }, 400);
          }
        }
        const headerCode = request.headers.get("x-bot-code");
        if ((body.code == null || body.code === "") && headerCode) body.code = headerCode;
        const { pulseBot } = await import("@/lib/city.server");
        const result = await pulseBot(body);
        if (!result.ok) return json({ ok: false, error: result.error }, result.status);
        return json({
          ok: true,
          bot: result.bot,
          room: result.room,
          project: result.project,
          rooms: result.rooms,
          light: result.light,
          beam: result.beam,
          messages: "messages" in result ? result.messages : undefined,
        });
      },
    },
  },
});
