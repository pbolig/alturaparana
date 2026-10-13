const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 8788;
const ROOT = __dirname;

// Configurar axios con mejor manejo de HTTPS
const axiosClient = axios.create({
  timeout: 10000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  },
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  httpAgent: new http.Agent({
    keepAlive: true
  })
});

// Localidades disponibles en AGPSE
const AGPSE_LOCALIDADES = {
  Rosario: "https://hidrografia2.agpse.gob.ar/Rosario/marea.html",
  SanLorenzo: "https://hidrografia2.agpse.gob.ar/SanLorenzo/marea.html",
  SanNicolas: "https://hidrografia2.agpse.gob.ar/SanNicolas/marea.html",
};

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
    responder(res, 410, "La fuente de datos de Prefectura Naval ya no está disponible. Use Hidrografía AGPSE.");
    return;
  }

  if (requestUrl.pathname.startsWith("/api/hidrografia/")) {
    const localidad = requestUrl.pathname.replace("/api/hidrografia/", "").replace(/\/$/, "");
    
    if (localidad.toLowerCase() === "rosario") {
      try {
        console.log(`[AGPSE] Consultando ROSARIO.dat en vivo...`);
        const response = await axiosClient.get("https://hidrografia2.agpse.gob.ar/histdat/ROSARIO.dat");
        const lineas = response.data.trim().split("\n");
        const registros = [];
        
        for (let i = lineas.length - 1; i >= 0 && registros.length < 1000; i--) {
          const linea = lineas[i].trim();
          if (!linea) continue;
          const partes = linea.split(",");
          if (partes.length >= 4) {
            const fecha = partes[0].replace(/['"]+/g, "").trim();
            const rawAlt = partes[3].trim();
            if (rawAlt !== "NAN") {
              const alt = parseFloat(rawAlt);
              if (fecha && !isNaN(alt)) {
                registros.push({ fecha, altura: alt.toFixed(2) });
              }
            }
          }
        }

        if (registros.length > 0) {
          const filasHtml = registros
            .map(r => `        <tr>\n            <td>${r.fecha}</td>\n            <td>${r.altura} m</td>\n        </tr>`)
            .join("\n");
          const html = `<!DOCTYPE html>\n<html>\n<head>\n    <title>Hidrografía AGPSE - Rosario</title>\n</head>\n<body>\n<table border="1">\n    <thead>\n        <tr>\n            <th>TimeStamp</th>\n            <th>Altura</th>\n        </tr>\n    </thead>\n    <tbody>\n${filasHtml}\n    </tbody>\n</table>\n</body>\n</html>\n`;
          responder(res, 200, html, "text/html; charset=utf-8");
          return;
        }
      } catch (error) {
        console.error(`[AGPSE] Error al consultar ROSARIO.dat:`, error.message);
      }

      // Fallback: intentar cargar archivo local
      try {
        const fallbackPath = path.join(ROOT, "data", "hidrografia-rosario.html");
        const fallbackContent = fs.readFileSync(fallbackPath, "utf-8");
        console.log(`[AGPSE] Fallback a archivo local data/hidrografia-rosario.html OK`);
        responder(res, 200, fallbackContent, "text/html; charset=utf-8");
      } catch (fallbackError) {
        responder(res, 502, `No se pudo consultar Hidrografía AGPSE ni cargar el archivo local.`);
      }
      return;
    }

    responder(res, 400, `Localidad no válida: ${localidad}`);
    return;
  }

  if (requestUrl.pathname === "/api/smn/pronostico" || requestUrl.pathname === "/api/smn/alertas") {
    const destino = requestUrl.pathname === "/api/smn/alertas" ? "https://www.smn.gob.ar/alertas" : "https://www.smn.gob.ar/pronostico";
    res.writeHead(302, { Location: destino });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api/smn/data") {
    try {
      const filePath = path.join(ROOT, "data", "smn-data-280.json");
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        responder(res, 200, content, "application/json; charset=utf-8");
        return;
      }
      responder(res, 404, JSON.stringify({ error: "Datos del SMN no encontrados" }), "application/json; charset=utf-8");
    } catch (error) {
      responder(res, 500, JSON.stringify({ error: `Error interno: ${error.message}` }), "application/json; charset=utf-8");
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
