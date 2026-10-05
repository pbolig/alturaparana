const fs = require("fs/promises");
const path = require("path");
const https = require("https");
const axios = require("axios");

const BASE = "https://contenidosweb.prefecturanaval.gob.ar/alturas/";
const outputDir = path.join(__dirname, "..", "data");
const SMN_API = "https://ws1.smn.gob.ar/v1";

const axiosClient = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mira-del-Parana/1.0",
  },
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
  }),
});

async function descargar(url) {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await axiosClient.get(url, { responseType: "text" });
      return response.data;
    } catch (error) {
      ultimoError = error;
      if (intento < 3) await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  throw ultimoError;
}

async function guardarPagina(url, nombre) {
  try {
    let html = await descargar(url);
    html = html.replace(/<head\b[^>]*>/i, '$&<base href="https://ws2.smn.gob.ar/">');
    await fs.writeFile(path.join(outputDir, nombre), html, "utf8");
    console.log(`Actualizado ${nombre}`);
  } catch (error) {
    console.warn(`No se pudo actualizar ${nombre}: ${error.message}`);
  }
}

async function actualizarHidrografiaRosario() {
  try {
    const url = "https://hidrografia2.agpse.gob.ar/histdat/ROSARIO.dat";
    const res = await axiosClient.get(url, { responseType: "text" });
    const lineas = res.data.trim().split("\n");
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

    if (!registros.length) {
      throw new Error("No se encontraron registros válidos en ROSARIO.dat");
    }

    const filasHtml = registros
      .map(r => `        <tr>\n            <td>${r.fecha}</td>\n            <td>${r.altura} m</td>\n        </tr>`)
      .join("\n");

    const html = `<!DOCTYPE html>\n<html>\n<head>\n    <title>Hidrografía AGPSE - Rosario</title>\n</head>\n<body>\n<table border="1">\n    <thead>\n        <tr>\n            <th>TimeStamp</th>\n            <th>Altura</th>\n        </tr>\n    </thead>\n    <tbody>\n${filasHtml}\n    </tbody>\n</table>\n</body>\n</html>\n`;

    await fs.writeFile(path.join(outputDir, "hidrografia-rosario.html"), html, "utf8");
    console.log(`Actualizado hidrografia-rosario.html (${registros.length} registros, último: ${registros[0].fecha} - ${registros[0].altura} m)`);
  } catch (error) {
    console.warn(`No se pudo actualizar hidrografia-rosario.html: ${error.message}`);
  }
}

async function obtenerTokenSMN() {
  const html = await descargar("https://ws2.smn.gob.ar/pronostico");
  const token = html.match(/localStorage\.setItem\(['"]token['"],\s*['"]([^'"]+)/i)?.[1];
  if (!token) throw new Error("No se encontró el token del SMN");
  return { Authorization: `JWT ${token}` };
}

function estacionesSMN(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(match => {
    const fila = match[1];
    const nombre = fila.match(/data-label=["']Puerto:["'][^>]*>\s*([^<]+)/i)?.[1]?.trim();
    const id = fila.match(/historico[^"']*id=(\d+)/i)?.[1];
    return nombre && id ? [{ nombre, id }] : [];
  });
}

async function guardarDatosSMN(estaciones) {
  const headers = await obtenerTokenSMN();
  for (const estacion of estaciones) {
    try {
      const resLugares = await axiosClient.get(`${SMN_API}/georef/location/search?name=${encodeURIComponent(estacion.nombre)}`, { headers });
      const lugares = resLugares.data;
      const lugar = lugares.find(item => item[1]?.toUpperCase() === estacion.nombre.toUpperCase() && item[3] !== "") || lugares[0];
      if (!lugar) throw new Error("sin coincidencias");
      const resPronostico = await axiosClient.get(`${SMN_API}/forecast/location/${lugar[0]}`, { headers });
      const pronostico = resPronostico.data;
      await fs.writeFile(path.join(outputDir, `smn-data-${estacion.id}.json`), JSON.stringify({ lugar: { id: lugar[0], nombre: lugar[1], provincia: lugar[3] }, pronostico }), "utf8");
      console.log(`Actualizado SMN: ${estacion.nombre}`);
    } catch (error) {
      console.warn(`No se pudo actualizar SMN para ${estacion.nombre}: ${error.message}`);
    }
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await actualizarHidrografiaRosario();
  await guardarPagina("https://ws2.smn.gob.ar/pronostico", "smn-pronostico.html");
  await guardarPagina("https://ws2.smn.gob.ar/alertas", "smn-alertas.html");

  let estaciones = "";
  try {
    estaciones = await descargar(BASE);
    await fs.writeFile(path.join(outputDir, "estaciones.html"), estaciones, "utf8");
  } catch (error) {
    console.warn(`No se pudo consultar Prefectura Naval: ${error.message}`);
    try {
      estaciones = await fs.readFile(path.join(outputDir, "estaciones.html"), "utf8");
    } catch {
      estaciones = "";
    }
  }

  if (estaciones) {
    try {
      await guardarDatosSMN(estacionesSMN(estaciones));
    } catch (error) {
      console.warn(`No se pudo actualizar los datos del SMN: ${error.message}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
