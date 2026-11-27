import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cacheName, previewCacheDir } from "./update-daily-poem.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..", "..");
const port = Number(process.env.PORT || 4173);
const host = process.env.PREVIEW_HOST || "127.0.0.1";
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/daily-poem.json") {
    const cache = path.join(process.env.DAILY_POEM_DIR || previewCacheDir, cacheName);
    fs.readFile(cache, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Cache-Control": "no-store" }).end();
        return;
      }
      response.writeHead(200, { "Content-Type": types[".json"], "Cache-Control": "no-cache" }).end(data);
    });
    return;
  }
  // Match the production homepage and lobby aliases. Also accept the old preview URL.
  if (pathname === "/homepage" || pathname === "/homepage/index.html") pathname = "/";
  if (pathname.startsWith("/homepage/")) pathname = pathname.slice("/homepage".length);
  if (pathname.includes("\\") || pathname.split("/").some(part => part.startsWith("."))) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (pathname === "/") pathname = "/homepage/index.html";
  else if (["/styles.css", "/app.js"].includes(pathname) || /^\/(assets|notes|lobby)\//.test(pathname)) {
    pathname = "/homepage" + pathname;
  } else if (pathname !== "/index.html" && !pathname.startsWith("/tools/")) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const filename = path.resolve(root, `.${pathname}`);
  if (!Object.hasOwn(types, path.extname(filename).toLowerCase())) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(filename).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
});

server.listen(port, host, () => {
  console.log(`Homepage preview: http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop.");
});

