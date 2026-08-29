/** JSON request parsing with a hard byte ceiling. */

export type ReadJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

function payloadTooLarge(maxBytes: number): Response {
  return Response.json(
    { error: `Request body too large (max ${maxBytes} bytes)` },
    { status: 413 },
  );
}

function invalidJson(): Response {
  return Response.json({ error: "Invalid JSON body" }, { status: 400 });
}

/**
 * `Content-Length` is only a fast reject: it may be absent under chunked
 * encoding and is client-controlled either way, so the stream is counted as it
 * is consumed and abandoned the moment it goes over.
 */
async function readLimited(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = req.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function readJsonBody<T>(
  req: Request,
  maxBytes: number,
): Promise<ReadJsonResult<T>> {
  const bytes = await readLimited(req, maxBytes);
  if (!bytes) return { ok: false, response: payloadTooLarge(maxBytes) };
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(bytes)) as T };
  } catch {
    return { ok: false, response: invalidJson() };
  }
}
