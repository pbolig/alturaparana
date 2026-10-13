const fs = require("fs/promises");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const axios = require("axios");

const outputDir = path.join(__dirname, "..", "data");

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

function extractFirstFileFromZip(buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("No es un archivo ZIP válido");
  const compressionMethod = buffer.readUInt16LE(8);
  const compressedSize = buffer.readUInt32LE(18);
  const fileNameLength = buffer.readUInt16LE(26);
  const extraFieldLength = buffer.readUInt16LE(28);

  const fileName = buffer.slice(30, 30 + fileNameLength).toString("utf8");
  const dataOffset = 30 + fileNameLength + extraFieldLength;
  const fileData = buffer.slice(dataOffset, dataOffset + compressedSize);

  let content;
  if (compressionMethod === 0) content = fileData;
  else if (compressionMethod === 8) content = zlib.inflateRawSync(fileData);
  else throw new Error("Compresión no soportada: " + compressionMethod);

  return { fileName, text: content.toString("latin1") };
}

function parsearViento(str) {
  if (!str) return { direccion: "Calma", velocidad: 0, texto: "Calma" };
  const limpia = str.replace(/\s+/g, " ").trim();
  if (limpia.toLowerCase() === "calma") return { direccion: "Calma", velocidad: 0, texto: "Calma" };
  const partes = limpia.split(" ");
  if (partes.length >= 2) {
    const dir = partes[0];
    const vel = parseFloat(partes[1]) || 0;
    return { direccion: dir, velocidad: vel, texto: `${dir} ${vel} km/h` };
  }
  return { direccion: limpia, velocidad: 0, texto: limpia };
}

function descripcionWeatherCode(code) {
  const mapa = {
    0: "Cielo despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla con escarcha",
    51: "Llovizna leve",
    53: "Llovizna moderada",
    55: "Llovizna densa",
    61: "Lluvia leve",
    63: "Lluvia moderada",
    65: "Lluvia fuerte",
    71: "Nevada leve",
    73: "Nevada moderada",
    75: "Nevada fuerte",
    80: "Chubascos leves",
    81: "Chubascos moderados",
    82: "Chubascos violentos",
    95: "Tormenta eléctrica",
    96: "Tormenta con granizo leve",
    99: "Tormenta con granizo fuerte"
  };
  return mapa[code] || "Algo nublado";
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

async function actualizarDatosSMN() {
  console.log("Consultando observaciones oficiales del SMN (Tiempo Presente)...");
  let estaciones = {};
  try {
    const resSmn = await axiosClient.get("https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=tiepre", {
      responseType: "arraybuffer",
    });
    const zipBuf = Buffer.from(resSmn.data);
    const { fileName, text } = extractFirstFileFromZip(zipBuf);
    console.log(`Descargado ${fileName} del SMN`);

    const lineas = text.split("\n").map(l => l.trim()).filter(Boolean);
    for (const linea of lineas) {
      const partes = linea.split(";").map(p => p.trim());
      if (partes.length < 8) continue;
      const nombre = partes[0];
      const fecha = partes[1];
      const hora = partes[2];
      const tiempo = partes[3];
      const visibilidad = partes[4];
      const tempNum = parseFloat(partes[5].replace(",", "."));
      const stNum = partes[6].toLowerCase().includes("no se calcula") ? null : parseFloat(partes[6].replace(",", "."));
      const humedad = parseInt(partes[7], 10) || null;
      const viento = parsearViento(partes[8]);
      const presion = partes[9] ? parseFloat(partes[9].replace("/", "").trim().replace(",", ".")) : null;

      estaciones[nombre.toUpperCase()] = {
        nombre,
        estacion: `${nombre} (Aero)`,
        fuente: "Servicio Meteorológico Nacional (SMN)",
        fecha,
        hora,
        tiempo,
        visibilidad,
        temperatura: isNaN(tempNum) ? null : tempNum,
        sensacionTermica: isNaN(stNum) ? null : stNum,
        humedad,
        viento,
        presion: isNaN(presion) ? null : presion,
      };
    }

    await fs.writeFile(path.join(outputDir, "smn-actual.json"), JSON.stringify(estaciones, null, 2), "utf8");
    console.log(`Actualizado smn-actual.json (${Object.keys(estaciones).length} estaciones SMN)`);
  } catch (error) {
    console.warn(`No se pudo descargar datos de tiempo presente del SMN: ${error.message}`);
  }

  // Pronóstico extendido para Rosario y zonas del Paraná
  const rosarioActual = estaciones["ROSARIO"] || null;

  try {
    const resForecast = await axiosClient.get(
      "https://api.open-meteo.com/v1/forecast?latitude=-32.9468&longitude=-60.6393&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant&timezone=America%2FArgentina%2FBuenos_Aires"
    );
    const daily = resForecast.data.daily;

    const forecast = daily.time.map((date, idx) => ({
      date,
      temp_min: Math.round(daily.temperature_2m_min[idx]),
      temp_max: Math.round(daily.temperature_2m_max[idx]),
      humidity_min: null,
      humidity_max: null,
      weather: {
        description: descripcionWeatherCode(daily.weathercode[idx]),
        id: daily.weathercode[idx],
      },
      morning: {
        weather: { description: descripcionWeatherCode(daily.weathercode[idx]) },
        rain_prob_range: [daily.precipitation_probability_max[idx], daily.precipitation_probability_max[idx]],
        wind: {
          speed_range: [Math.round(daily.wind_speed_10m_max[idx] * 0.7), Math.round(daily.wind_speed_10m_max[idx])],
          direction: "",
        },
      },
      afternoon: {
        weather: { description: descripcionWeatherCode(daily.weathercode[idx]) },
        rain_prob_range: [daily.precipitation_probability_max[idx], daily.precipitation_probability_max[idx]],
        wind: {
          speed_range: [Math.round(daily.wind_speed_10m_max[idx] * 0.7), Math.round(daily.wind_speed_10m_max[idx])],
          direction: "",
        },
      },
      night: null,
    }));

    const smnDataRosario = {
      lugar: {
        id: 280,
        nombre: "Rosario",
        provincia: "Santa Fe",
      },
      actual: rosarioActual,
      actualizado: new Date().toISOString(),
      pronostico: {
        updated: new Date().toISOString(),
        source: "SMN (Estación Rosario Aero) + Modelo Meteorológico",
        forecast,
      },
    };

    // Actualizar smn-data-280.json y smn-data.json
    await fs.writeFile(path.join(outputDir, "smn-data-280.json"), JSON.stringify(smnDataRosario, null, 2), "utf8");
    await fs.writeFile(path.join(outputDir, "smn-data.json"), JSON.stringify(smnDataRosario, null, 2), "utf8");
    console.log(`Actualizado smn-data-280.json con medición oficial SMN (${rosarioActual ? `${rosarioActual.temperatura}°C ${rosarioActual.tiempo}` : "sin estación"}) y pronóstico 7 días`);

    // Mapeo de otras estaciones ribereñas del Paraná a sus IDs
    const estacionesRibera = [
      { id: 20, clave: "PARANÁ", nombre: "Paraná", prov: "Entre Ríos" },
      { id: 30, clave: "SANTA FE", nombre: "Santa Fe", prov: "Santa Fe" },
      { id: 300, clave: "SAN NICOLÁS", nombre: "San Nicolás", prov: "Buenos Aires" },
      { id: 500, clave: "CORRIENTES", nombre: "Corrientes", prov: "Corrientes" },
      { id: 520, clave: "RESISTENCIA", nombre: "Resistencia", prov: "Chaco" },
      { id: 700, clave: "POSADAS", nombre: "Posadas", prov: "Misiones" },
    ];

    for (const st of estacionesRibera) {
      const act = estaciones[st.clave] || null;
      const dataSt = {
        lugar: { id: st.id, nombre: st.nombre, provincia: st.prov },
        actual: act,
        actualizado: new Date().toISOString(),
        pronostico: smnDataRosario.pronostico,
      };
      await fs.writeFile(path.join(outputDir, `smn-data-${st.id}.json`), JSON.stringify(dataSt, null, 2), "utf8");
    }
  } catch (error) {
    console.warn(`No se pudo actualizar pronóstico SMN: ${error.message}`);
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await actualizarHidrografiaRosario();
  await actualizarDatosSMN();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
