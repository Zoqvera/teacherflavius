// Google Forms integration retired. Keep the endpoint as a permanent no-write response.
const responseBody = JSON.stringify({
  ok: false,
  status: "retired",
  service: "google-forms-exercise-sync",
  message: "A integração Google Forms foi descontinuada."
});

Deno.serve((_request: Request) => new Response(responseBody, {
  status: 410,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }
}));
