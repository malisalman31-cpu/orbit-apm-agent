import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));

  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(candidate)] || "application/octet-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  createReadStream(candidate).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Local: http://127.0.0.1:${port}`);
});
