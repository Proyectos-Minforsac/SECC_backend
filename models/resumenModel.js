const { conectar } = require('../services/sheetsService');
const { texto, cargarEncabezados, exigirColumnas, siguienteId } = require('../services/hojasUtils');
const { normalizar } = require('../services/analoga');
const { aNumeroONulo } = require('../services/validacion');
const { aFilaResumen } = require('../services/historico');

// Los servicios cerrados (hoja resumenProceso): los que cerró el sistema y los que se cargaron del histórico. Son la base de
// la estimación por analogía y del tablero de rentabilidad.

const COLUMNAS_RESUMEN = [
  'resumenId', 'visitaId', 'solicitudId', 'tipoServicio', 'destino', 'cotizaciones', 'ventaSoles', 'costoParametrico',
  'costoAnalogo', 'costoEstimado', 'costoReal', 'imprevistosProvision', 'imprevistosReal', 'margenEstimado', 'margenReal',
  'desviacionCosto', 'desviacionMargen', 'origen', 'cerradoPor', 'cerradoEn', 'referencia',
];

// Una fila de la hoja, con los números como números (null si el dato no existe). Los servicios anteriores a la columna
// «origen» los cerró el sistema.
function armarCaso(fila) {
  const numero = campo => aNumeroONulo(fila[campo]);
  return {
    resumenId: numero('resumenId'),
    visitaId: numero('visitaId'),
    solicitudId: texto(fila.solicitudId),
    origen: texto(fila.origen) || 'SISTEMA',
    referencia: texto(fila.referencia),
    tipoServicio: texto(fila.tipoServicio),
    destino: texto(fila.destino),
    cotizaciones: texto(fila.cotizaciones),
    cerradoEn: texto(fila.cerradoEn),
    cerradoPor: texto(fila.cerradoPor),
    ventaSoles: numero('ventaSoles'),
    costoParametrico: numero('costoParametrico'),
    costoAnalogo: numero('costoAnalogo'),
    costoEstimado: numero('costoEstimado'),
    costoReal: numero('costoReal'),
    imprevistosProvision: numero('imprevistosProvision'),
    imprevistosReal: numero('imprevistosReal'),
    margenEstimado: numero('margenEstimado'),
    margenReal: numero('margenReal'),
    desviacionCosto: numero('desviacionCosto'),
    desviacionMargen: numero('desviacionMargen'),
  };
}

// Todos los servicios cerrados. Sin la hoja (el Excel aún no se preparó) no hay ninguno.
async function getCasos() {
  const hoja = (await conectar()).sheetsByTitle['resumenProceso'];
  if (!hoja) return [];
  return (await hoja.getRows()).map(f => armarCaso(f.toObject()));
}

// Guarda los servicios del histórico ya validados (HU-33). Los que ya se cargaron antes (misma referencia) se omiten, así
// repetir la carga con el archivo corregido no duplica nada. Devuelve cuántos se guardaron y cuáles se omitieron.
async function importarHistorico(filas, importadoPor) {
  const hoja = (await conectar()).sheetsByTitle['resumenProceso'];
  if (!hoja) throw new Error('No existe la hoja "resumenProceso" en el Excel (npm run hojas:preparar la crea)');
  await cargarEncabezados(hoja);
  exigirColumnas(hoja, COLUMNAS_RESUMEN, 'resumenProceso');

  const existentes = await hoja.getRows();
  const yaCargadas = new Set(
    existentes.filter(f => texto(f.get('origen')) === 'HISTORICO').map(f => normalizar(f.get('referencia')))
  );
  const nuevas = filas.filter(fila => !yaCargadas.has(normalizar(fila.referencia)));
  const omitidas = filas.filter(fila => yaCargadas.has(normalizar(fila.referencia))).map(fila => fila.referencia);

  if (nuevas.length > 0) {
    const primerId = siguienteId(existentes, 'resumenId');
    await hoja.addRows(
      nuevas.map((fila, indice) => ({ resumenId: primerId + indice, ...aFilaResumen(fila, { importadoPor }) })),
      { raw: true }
    );
  }
  return { importadas: nuevas.length, omitidas };
}

module.exports = { COLUMNAS_RESUMEN, armarCaso, getCasos, importarHistorico };
