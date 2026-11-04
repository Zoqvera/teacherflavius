import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired public entrypoint. Keep the URL closed for previously cached forms.
Deno.serve(() => new Response(
  JSON.stringify({ ok: false, error: "Este formulário foi descontinuado." }),
  {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  },
));
