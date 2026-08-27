const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;
const PREFECTURA_HOST = "https://contenidosweb.prefecturanaval.gob.ar";
const SMN_HOST = "https://ws2.smn.gob.ar";
const SMN_API = "https://ws1.smn.gob.ar/v1";

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

  if (requestUrl.pathname === "/api/smn/pronostico" || requestUrl.pathname === "/api/smn/alertas") {
    const remoteUrl = `${SMN_HOST}${requestUrl.pathname.replace("/api/smn", "")}`;
    try {
      const remote = await fetch(remoteUrl, {
        headers: { "User-Agent": "Mira-del-Parana/1.0" },
      });
      let body = await remote.text();
      if (remote.ok && /<head\b/i.test(body)) {
        body = body.replace(/<head\b[^>]*>/i, "$&<base href=\"https://ws2.smn.gob.ar/\">");
      }
      responder(res, remote.status, body, remote.headers.get("content-type") || "text/html; charset=utf-8");
    } catch (error) {
      responder(res, 502, `No se pudo consultar el SMN: ${error.message}`);
    }
    return;
  }

  if (requestUrl.pathname === "/api/smn/data") {
    try {
      const page = await fetch(`${SMN_HOST}/pronostico`);
      const pageHtml = await page.text();
      const token = pageHtml.match(/localStorage\.setItem\(['"]token['"],\s*['"]([^'"]+)/i)?.[1];
      if (!token) throw new Error("No se encontró el token del SMN");
      const authorization = { Authorization: `JWT ${token}` };
      const nombre = requestUrl.searchParams.get("name") || "Rosario";
      const lugares = await fetch(`${SMN_API}/georef/location/search?name=${encodeURIComponent(nombre)}`, { headers: authorization }).then(r => r.json());
      const lugar = lugares.find(item => item[1]?.toUpperCase() === nombre.toUpperCase() && item[3] === "Santa Fe") || lugares.find(item => item[1]?.toUpperCase() === nombre.toUpperCase()) || lugares[0];
      if (!lugar) throw new Error(`No se encontró la localidad ${nombre}`);
      const [pronostico, alertas] = await Promise.all([
        fetch(`${SMN_API}/forecast/location/${lugar[0]}`, { headers: authorization }).then(r => r.json()),
        fetch(`${SMN_API}/warning/alert/area?mode=alert&compact=true`, { headers: authorization }).then(r => r.json()),
      ]);
      responder(res, 200, JSON.stringify({ lugar: { id: lugar[0], nombre: lugar[1], provincia: lugar[3] }, pronostico, alertas }), "application/json; charset=utf-8");
    } catch (error) {
      responder(res, 502, JSON.stringify({ error: `No se pudo consultar el SMN: ${error.message}` }), "application/json; charset=utf-8");
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
