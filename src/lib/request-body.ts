export class RequestBodyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

/** Enforce the byte limit while reading, including chunked bodies without Content-Length. */
export async function readBodyBytes(
  request: Request,
  maxBytes = 16_384,
  timeoutMs = 10_000,
): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes)
    throw new RequestBodyError(413, "payload_too_large");
  if (!request.body) throw new RequestBodyError(400, "invalid_json");
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new RequestBodyError(408, "request_timeout"));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "payload_too_large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "invalid_json");
  } finally {
    clearTimeout(timeout!);
    reader.releaseLock();
  }
}

export async function readJsonBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RequestBodyError(400, "invalid_json");
  }
}
