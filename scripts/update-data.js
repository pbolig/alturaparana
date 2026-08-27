const fs = require("fs/promises");
const path = require("path");

const BASE = "https://contenidosweb.prefecturanaval.gob.ar/alturas/";
const outputDir = path.join(__dirname, "..", "data");

async function descargar(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mira-del-Parana/1.0" },
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
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

  const ids = ["280"];
  console.log("Actualizando histórico predeterminado: Rosario (280)");

  for (const id of ids) {
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
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
