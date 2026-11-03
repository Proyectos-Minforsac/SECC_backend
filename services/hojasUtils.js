// Utilidades compartidas por los modelos que leen y escriben las hojas del Excel.

// Error con código HTTP; el controlador lo traduce a la respuesta.
function errorHttp(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const texto = valor => String(valor ?? '').trim();
const mismoId = (a, b) => texto(a) === texto(b);
const normalizar = valor => texto(valor).toLowerCase();

// En la hoja las fechas son "YYYY-MM-DD"; si alguien las edita a mano en Excel
// pueden venir como "d/m/yyyy". Ambas se aceptan y se devuelven en el formato pedido.
function partesFecha(valor) {
  const fecha = texto(valor);
  let m = fecha.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { anio: m[1], mes: m[2].padStart(2, '0'), dia: m[3].padStart(2, '0') };
  m = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { anio: m[3], mes: m[2].padStart(2, '0'), dia: m[1].padStart(2, '0') };
  return null;
}

const aISO = valor => {
  const p = partesFecha(valor);
  return p ? `${p.anio}-${p.mes}-${p.dia}` : texto(valor);
};

const aDiaMesAnio = valor => {
  const p = partesFecha(valor);
  return p ? `${p.dia}/${p.mes}/${p.anio}` : texto(valor);
};

// Fecha de hoy en Perú, "YYYY-MM-DD".
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

// La librería solo conoce los encabezados de una hoja después de leerla (getRows) o de pedirlos (loadHeaderRow); antes,
// hoja.headerValues lanza "Header values are not yet loaded". Llamar esto antes de exigirColumnas cuando todavía no se
// hayan leído las filas de esa hoja. Si los encabezados ya están, no hace ninguna llamada a Sheets.
async function cargarEncabezados(...hojas) {
  for (const hoja of hojas) {
    try {
      void hoja.headerValues;
    } catch {
      await hoja.loadHeaderRow();
    }
  }
}

// Verifica que la hoja tenga las columnas que se van a escribir (evita que se pierdan datos en silencio).
// Las columnas nuevas se agregan con: npm run hojas:preparar
// Los encabezados deben estar cargados (ver cargarEncabezados).
function exigirColumnas(hoja, columnas, nombreHoja) {
  const encabezados = hoja.headerValues || [];
  const faltantes = columnas.filter(c => !encabezados.includes(c));
  if (faltantes.length) {
    throw new Error(
      `La hoja '${nombreHoja}' no tiene la(s) columna(s): ${faltantes.join(', ')} (se agregan con npm run hojas:preparar)`
    );
  }
}

function siguienteId(filas, campo) {
  const ids = filas.map(f => parseInt(f.get(campo), 10)).filter(Number.isInteger);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

// Borra varias filas de una hoja con pocas llamadas a Sheets (cada una cuenta para el límite por minuto): agrupa las
// filas consecutivas y borra de abajo hacia arriba, así los números de fila de las que faltan no se corren.
// Las filas deben venir de una lectura reciente de esa hoja (getRows con opciones lee directo, sin caché).
async function borrarFilas(hoja, filas) {
  const numeros = [...new Set(filas.map(f => f.rowNumber))].sort((a, b) => b - a);

  let i = 0;
  while (i < numeros.length) {
    const ultima = numeros[i];
    let primera = ultima;
    while (i + 1 < numeros.length && numeros[i + 1] === primera - 1) primera = numeros[++i];
    // deleteRows trabaja con índices desde 0 y el final excluido; rowNumber cuenta desde 1 (la fila 1 es el encabezado)
    await hoja.deleteRows(primera - 1, ultima);
    i++;
  }
}

module.exports = {
  errorHttp,
  texto,
  mismoId,
  normalizar,
  aISO,
  aDiaMesAnio,
  hoyISO,
  cargarEncabezados,
  exigirColumnas,
  siguienteId,
  borrarFilas,
};
