import { handler } from "./dist/lib/http.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default {
  async fetch(request) {
    const req = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      async *[Symbol.asyncIterator]() {
        const buffer = await request.arrayBuffer();
        if (buffer.byteLength > 0) yield Buffer.from(buffer);
      },
    };

    let status = 200;
    let headers = {};
    const chunks = [];

    const res = {
      writeHead(code, nextHeaders = {}) {
        status = code;
        headers = { ...headers, ...nextHeaders };
      },
      end(body) {
        if (body !== undefined && body !== null) chunks.push(body);
      },
    };

    await handler(req, res);

    if (status === 204) return new Response(null, { status, headers });

    const data = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))));
    return new Response(data, { status, headers });
  },
};
