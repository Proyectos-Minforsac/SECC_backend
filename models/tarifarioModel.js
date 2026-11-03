const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, aISO, hoyISO, cargarEncabezados, exigirColumnas, siguienteId } = require('../services/hojasUtils');
const {
  INDUCTORES,
  normalizarDestino,
  esFechaISOValida,
  validarTarifa,
  rechazarSiNoCambia,
  marcarEstados,
  destinosDe,
  vigentesPorDestino,
} = require('../services/tarifas');

const COLUMNAS = ['tarifaId', 'inductor', 'destino', 'monto', 'vigenteDesde', 'registradoPor', 'registradoEn'];

async function cargarHoja() {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['tarifario'];
  if (!hoja) throw new Error('No existe la hoja "tarifario" en el Excel (npm run hojas:preparar la crea)');
  return hoja;
}

const aTarifa = fila => ({
  tarifaId: Number(texto(fila.get('tarifaId'))),
  inductor: texto(fila.get('inductor')),
  destino: normalizarDestino(fila.get('destino')),
  monto: Number(texto(fila.get('monto'))),
  vigenteDesde: aISO(fila.get('vigenteDesde')),
  registradoPor: texto(fila.get('registradoPor')),
  registradoEn: texto(fila.get('registradoEn')),
});

// Una fila editada a mano en el Excel que ya no se entiende se ignora, para que no rompa el cálculo de las demás.
const esTarifaValida = t =>
  Number.isInteger(t.tarifaId) && INDUCTORES.includes(t.inductor) && t.destino !== '' &&
  Number.isFinite(t.monto) && t.monto > 0 && esFechaISOValida(t.vigenteDesde);

const leerTarifas = filas => filas.map(aTarifa).filter(esTarifaValida);

// Todas las tarifas (las más recientes primero) con su estado, los destinos que hay y lo que rige hoy en cada uno.
async function getTarifas() {
  const hoja = await cargarHoja();
  const tarifas = leerTarifas(await hoja.getRows());
  const hoy = hoyISO();

  return {
    tarifas: marcarEstados(tarifas, hoy).sort((a, b) => b.tarifaId - a.tarifaId),
    destinos: destinosDe(tarifas),
    vigentes: vigentesPorDestino(tarifas, hoy),
  };
}

// Registra una tarifa nueva. Nunca modifica las anteriores: quedan en el historial.
async function crearTarifa(entrada, usuario) {
  console.log('Modelo: registrando una tarifa', entrada?.inductor, entrada?.destino);

  const hoja = await cargarHoja();
  await cargarEncabezados(hoja);
  exigirColumnas(hoja, COLUMNAS, 'tarifario');

  const filas = await hoja.getRows();
  const tarifas = leerTarifas(filas);

  const { error, datos } = validarTarifa(entrada, destinosDe(tarifas));
  if (error) throw errorHttp(400, error);

  const sinCambio = rechazarSiNoCambia(tarifas, datos);
  if (sinCambio) throw errorHttp(409, sinCambio);

  // raw: evita que Sheets reinterprete el texto (fechas, números) al guardarlo.
  const nueva = await hoja.addRow({
    tarifaId: siguienteId(filas, 'tarifaId'),
    ...datos,
    registradoPor: usuario.nombre,
    registradoEn: new Date().toISOString(),
  }, { raw: true });

  // Se devuelve con su estado (la nueva puede quedar vigente, programada o ya reemplazada por otra del mismo día).
  const creada = aTarifa(nueva);
  return marcarEstados([...tarifas, creada], hoyISO()).find(t => t.tarifaId === creada.tarifaId);
}

module.exports = { getTarifas, crearTarifa };
