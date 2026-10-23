const PUBLIC_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com"
]);

function permittedOrigin(origin) {
  if (!origin) return null;

  try {
    const url = new URL(origin);
    if (PUBLIC_ORIGINS.has(url.origin)) return url.origin;

    const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (isLocalDevelopment && url.protocol === "http:") return url.origin;
  } catch {
    return null;
  }

  return null;
}

function responseHeaders(origin) {
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
  }

  return headers;
}

export function createPublicCatalog(rows) {
  const lessons = [];
  const seenNumbers = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const number = row?.roadmap_lesson_number;
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    const objective = typeof row?.objective === "string"
      ? row.objective.replace(/\s+/g, " ").trim()
      : "";

    if (!Number.isSafeInteger(number) || number <= 0 || !title || seenNumbers.has(number)) {
      continue;
    }

    seenNumbers.add(number);
    lessons.push({ number, title, objective });
  }

  lessons.sort((first, second) => first.number - second.number);
  return { total: lessons.length, lessons };
}

export async function servePublicCatalog(request, loadLessons) {
  const requestedOrigin = request.headers.get("origin");
  const origin = permittedOrigin(requestedOrigin);
  const headers = responseHeaders(origin);

  if (requestedOrigin && !origin) {
    return new Response(null, { status: 403, headers });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: {
      ...headers,
      "Allow": "GET, HEAD, OPTIONS"
    } });
  }

  try {
    const catalog = createPublicCatalog(await loadLessons());
    return new Response(request.method === "HEAD" ? null : JSON.stringify(catalog), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
    });
  } catch {
    return new Response(request.method === "HEAD" ? null : JSON.stringify({
      error: "Não foi possível carregar o conteúdo programático."
    }), {
      status: 503,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
