const fs = require("fs/promises");
const path = require("path");

const BASE = "https://contenidosweb.prefecturanaval.gob.ar/alturas/";
const outputDir = path.join(__dirname, "..", "data");
const SMN_API = "https://ws1.smn.gob.ar/v1";

async function descargar(url) {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mira-del-Parana/1.0" },
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response.text();
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
    await fs.writeFile(path.join(outputDir, nombre), html);
    console.log(`Actualizado ${nombre}`);
  } catch (error) {
    console.warn(`No se pudo actualizar ${nombre}: ${error.message}`);
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
      const lugares = await fetch(`${SMN_API}/georef/location/search?name=${encodeURIComponent(estacion.nombre)}`, { headers }).then(r => r.json());
      const lugar = lugares.find(item => item[1]?.toUpperCase() === estacion.nombre.toUpperCase() && item[3] !== "") || lugares[0];
      if (!lugar) throw new Error("sin coincidencias");
      const pronostico = await fetch(`${SMN_API}/forecast/location/${lugar[0]}`, { headers }).then(r => r.json());
      await fs.writeFile(path.join(outputDir, `smn-data-${estacion.id}.json`), JSON.stringify({ lugar: { id: lugar[0], nombre: lugar[1], provincia: lugar[3] }, pronostico }));
      console.log(`Actualizado SMN: ${estacion.nombre}`);
    } catch (error) {
      console.warn(`No se pudo actualizar SMN para ${estacion.nombre}: ${error.message}`);
    }
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  let estaciones;
  try {
    estaciones = await descargar(BASE);
    await fs.writeFile(path.join(outputDir, "estaciones.html"), estaciones);
  } catch (error) {
    console.warn(`No se pudo actualizar la tabla de estaciones: ${error.message}`);
    estaciones = await fs.readFile(path.join(outputDir, "estaciones.html"), "utf8");
  }

  const ids = [...estaciones.matchAll(/historico[^"']*id=(\d+)/gi)].map(match => match[1]);
  const estacionesUnicas = [...new Set(ids)];
  console.log(`Actualizando históricos de ${estacionesUnicas.length} estaciones`);

  for (const id of estacionesUnicas) {
    const url = `${BASE}?id=${id}&page=historico&tiempo=7`;
    try {
      const historico = await descargar(url);
      await fs.writeFile(path.join(outputDir, `historico-${id}.html`), historico);
    } catch (error) {
      console.warn(`Se conserva el histórico ${id}: ${error.message}`);
    }
  }

  await guardarPagina("https://ws2.smn.gob.ar/pronostico", "smn-pronostico.html");
  await guardarPagina("https://ws2.smn.gob.ar/alertas", "smn-alertas.html");
  await guardarPagina("https://hidrografia2.agpse.gob.ar/Rosario/marea.html", "hidrografia-rosario.html");
  try { await guardarDatosSMN(estacionesSMN(estaciones)); } catch (error) { console.warn(`No se pudo actualizar los datos del SMN: ${error.message}`); }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
