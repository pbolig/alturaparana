const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 8787;
const ROOT = __dirname;
const PREFECTURA_HOST = "https://contenidosweb.prefecturanaval.gob.ar";

function responder(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/prefectura") {
    const remoteUrl = requestUrl.searchParams.get("url");
    if (!remoteUrl || !remoteUrl.startsWith(`${PREFECTURA_HOST}/alturas`)) {
      responder(res, 400, "URL de Prefectura no válida");
      return;
    }

    try {
      const remote = await fetch(remoteUrl, {
        headers: { "User-Agent": "Mira-del-Parana/1.0" },
      });
      const body = await remote.text();
      responder(res, remote.status, body, remote.headers.get("content-type") || "text/html; charset=utf-8");
    } catch (error) {
      responder(res, 502, `No se pudo consultar Prefectura: ${error.message}`);
    }
    return;
  }

  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(ROOT)) {
    responder(res, 403, "Acceso denegado");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      responder(res, error.code === "ENOENT" ? 404 : 500, "Archivo no encontrado");
      return;
    }
    const type = filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
    responder(res, 200, content, type);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mira del Paraná: http://${HOST}:${PORT}`);
});
