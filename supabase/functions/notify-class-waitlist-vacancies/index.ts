// Retained as an inert endpoint for obsolete callers.
const MESSAGE = "Class waitlist vacancy emails are discontinued.";

Deno.serve((_request: Request): Response => {
  return new Response(JSON.stringify({ error: MESSAGE }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
