const { GoogleSpreadsheet, GoogleSpreadsheetRow, GoogleSpreadsheetWorksheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const auth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);

// La API de Sheets permite 60 lecturas por minuto. Para no agotarlas, los metadatos del libro
// y las filas de cada hoja se guardan en memoria unos segundos; toda escritura vacía el caché de filas.
const METADATOS_TTL_MS = 5 * 60 * 1000;
const FILAS_TTL_MS = Number(process.env.SHEETS_CACHE_TTL_MS ?? 30 * 1000);

let metadatos = null; // { promesa, expira }

async function conectar() {
  if (!metadatos || Date.now() > metadatos.expira) {
    const promesa = doc.loadInfo(); // carga metadatos y hojas
    metadatos = { promesa, expira: Date.now() + METADATOS_TTL_MS };
    // Si falla no se guarda el error: la siguiente petición lo reintenta.
    promesa.catch(() => {
      if (metadatos?.promesa === promesa) metadatos = null;
    });
  }
  await metadatos.promesa;
  return doc;
}

conectar().catch(console.error);

// --- Caché de filas -------------------------------------------------------------------------------
// Se guarda la promesa, así las peticiones simultáneas a la misma hoja comparten una sola lectura.
const cacheFilas = new Map(); // sheetId -> { promesa, expira }

// Sin argumento vacía todo el caché; con un sheetId, solo esa hoja (escribir en una no obliga a releer las demás).
const limpiarCacheFilas = sheetId => (sheetId === undefined ? cacheFilas.clear() : cacheFilas.delete(sheetId));

const getRowsOriginal = GoogleSpreadsheetWorksheet.prototype.getRows;

GoogleSpreadsheetWorksheet.prototype.getRows = function getRowsConCache(...args) {
  // Con opciones (offset/limit) se consulta directo a la hoja.
  if (args.length > 0 || FILAS_TTL_MS <= 0) return getRowsOriginal.apply(this, args);

  let entrada = cacheFilas.get(this.sheetId);
  if (!entrada || Date.now() > entrada.expira) {
    const promesa = getRowsOriginal.call(this);
    entrada = { promesa, expira: Date.now() + FILAS_TTL_MS };
    cacheFilas.set(this.sheetId, entrada);
    promesa.catch(() => {
      if (cacheFilas.get(this.sheetId) === entrada) cacheFilas.delete(this.sheetId);
    });
  }
  // Copia del arreglo: los modelos hacen push/filter sobre lo que reciben.
  return entrada.promesa.then(filas => [...filas]);
};

// Cualquier escritura invalida el caché de su hoja (al terminar, y también al empezar por si hay lecturas en curso).
// `hojaDe` devuelve la hoja afectada a partir de `this`.
function invalidarAlEscribir(prototipo, metodos, hojaDe) {
  for (const nombre of metodos) {
    const original = prototipo[nombre];
    if (typeof original !== 'function') continue;
    prototipo[nombre] = async function (...args) {
      const sheetId = hojaDe(this)?.sheetId;
      limpiarCacheFilas(sheetId);
      try {
        return await original.apply(this, args);
      } finally {
        limpiarCacheFilas(sheetId);
      }
    };
  }
}

invalidarAlEscribir(GoogleSpreadsheetRow.prototype, ['save', 'delete'], fila => fila._worksheet);
invalidarAlEscribir(GoogleSpreadsheetWorksheet.prototype, [
  'addRow',
  'addRows',
  'clearRows',
  'setHeaderRow',
  'saveUpdatedCells',
  'saveCells',
  'deleteRows',
  'clear',
  'delete',
], hoja => hoja);

module.exports = { conectar, limpiarCacheFilas };
