const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.AUTO_LOGIN_TEST_HOST || "127.0.0.1";
const PORT = Number(process.env.AUTO_LOGIN_TEST_PORT || 8787);
const ROOT_DIR = __dirname;

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}:${PORT}`);
  const rawPath = url.pathname === "/" ? "/login-demo.html" : url.pathname;
  const normalized = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(ROOT_DIR, normalized);
}

function createServer() {
  return http.createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || "/");

    if (!filePath.startsWith(ROOT_DIR)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        const statusCode = error.code === "ENOENT" ? 404 : 500;
        response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
        response.end(statusCode === 404 ? "Not Found" : "Internal Server Error");
        return;
      }

      response.writeHead(200, { "content-type": getContentType(filePath) });
      response.end(content);
    });
  });
}

module.exports = {
  HOST,
  PORT,
  ROOT_DIR,
  createServer
};

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Local test server running at http://${HOST}:${PORT}/login-demo.html`);
  });
}
