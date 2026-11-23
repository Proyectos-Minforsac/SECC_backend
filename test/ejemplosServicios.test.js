const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { construirEjemplos, esReferenciaDeEjemplo, fechaHaceMeses, MARCA } = require('../services/ejemplosServicios');
const { aFilaResumen } = require('../services/historico');
const { calcularAnaloga, sugerir } = require('../services/analoga');

// El modelo abre el libro de verdad al cargarse: se reemplaza por uno simulado en memoria.
const ruta = rel => path.join(__dirname, '..', rel);
const columnas = ['resumenId', 'visitaId', 'solicitudId', 'tipoServicio', 'destino', 'cotizaciones', 'ventaSoles', 'costoParametrico', 'costoAnalogo',
  'costoEstimado', 'costoReal', 'imprevistosProvision', 'imprevistosReal', 'margenEstimado', 'margenReal', 'desviacionCosto', 'desviacionMargen',
  'origen', 'cerradoPor', 'cerradoEn', 'referencia'];
const filas = [];
const hoja = {
  headerValues: columnas,
  getRows: async () => filas.map(datos => ({ get: c => datos[c] ?? '', toObject: () => datos })),
  addRows: async nuevas => { filas.push(...nuevas); },
};
require.cache[ruta('services/sheetsService.js')] = {
  id: 'sheetsService', filename: ruta('services/sheetsService.js'), loaded: true,
  exports: { conectar: async () => ({ sheetsByTitle: { resumenProceso: hoja } }), limpiarCacheFilas() {} },
};
const { importarHistorico, getCasos } = require('../models/resumenModel');

test('construirEjemplos: 5 servicios con referencia única, de dos tipos y cerrados antes de hoy', () => {
  const hoy = new Date(2026, 10, 16);
  const ejemplos = construirEjemplos(hoy);
  assert.equal(ejemplos.length, 5);
  assert.equal(new Set(ejemplos.map(e => e.referencia)).size, 5);
  assert.deepEqual([...new Set(ejemplos.map(e => e.tipoServicio))].sort(), ['Aire Acondicionado', 'Cableado estructurado']);
  for (const e of ejemplos) {
    assert.ok(esReferenciaDeEjemplo(e.referencia));
    assert.ok(e.fecha < hoy.toISOString(), 'cerrado en el pasado');
    assert.ok(e.costoReal > 0 && e.ventaSoles > e.costoReal, 'deja margen positivo');
  }
  assert.equal(fechaHaceMeses(2, hoy), '2026-09-15T12:00:00.000Z');
  assert.equal(esReferenciaDeEjemplo('Servicio real de Juan'), false);
});

test('aFilaResumen: cada ejemplo queda como servicio histórico con sus márgenes y desviaciones', () => {
  const [uno] = construirEjemplos();
  const fila = aFilaResumen(uno, { importadoPor: MARCA });
  assert.equal(fila.origen, 'HISTORICO');
  assert.equal(fila.margenReal, 25);        // (4800 − 3600) / 4800
  assert.equal(fila.margenEstimado, 37.5);  // (4800 − 3000) / 4800
  assert.equal(fila.desviacionCosto, 600);
  assert.equal(fila.desviacionMargen, -12.5);
});

test('se cargan una sola vez: repetir el script no duplica nada', async () => {
  const primera = await importarHistorico(construirEjemplos(), MARCA);
  assert.equal(primera.importadas, 5);
  const segunda = await importarHistorico(construirEjemplos(), MARCA);
  assert.equal(segunda.importadas, 0);
  assert.equal(segunda.omitidas.length, 5);
  assert.equal(filas.length, 5);
});

test('con los ejemplos, Aire Acondicionado ya tiene sugerencia análoga y Cableado estructurado todavía no', async () => {
  const casos = await getCasos();
  const aire = calcularAnaloga(casos, { tipoServicio: 'Aire Acondicionado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(aire.n, 3);
  assert.equal(aire.sugerible, true);
  assert.ok(sugerir(aire, { costoParametrico: 3000, ventaSoles: 4800 }).costo > 0);

  const cableado = calcularAnaloga(casos, { tipoServicio: 'Cableado estructurado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(cableado.n, 2);
  assert.equal(cableado.sugerible, false);
  assert.match(cableado.motivo, /se necesitan al menos 3/);
});
