const test = require('node:test');
const assert = require('node:assert/strict');
const { periodoDe, anioDe, filtrar, resumir, agruparPor, marcarServicios, compararMetodos } = require('../services/rentabilidad');

// Un servicio cerrado con venta 4,800
const caso = (extra = {}) => ({
  origen: 'SISTEMA', referencia: 'R', tipoServicio: 'Aire Condicionado', destino: 'GENERAL', cerradoEn: '2026-06-15T10:00:00.000Z',
  ventaSoles: 4800, costoParametrico: 3000, costoAnalogo: null, costoEstimado: 3000, costoReal: 3600,
  imprevistosProvision: 150, imprevistosReal: 360, margenReal: 25, ...extra,
});

test('periodoDe y anioDe: salen de la fecha de cierre, con o sin hora', () => {
  assert.equal(periodoDe(caso()), '2026-06');
  assert.equal(periodoDe({ cerradoEn: '2025-12-31' }), '2025-12');
  assert.equal(anioDe(caso()), '2026');
  assert.equal(periodoDe({}), '');
});

test('filtrar: por tipo (sin importar tildes), año y origen', () => {
  const casos = [
    caso({ referencia: 'A' }),
    caso({ referencia: 'B', tipoServicio: 'Cableado estructurado', cerradoEn: '2025-03-01' }),
    caso({ referencia: 'C', origen: 'HISTORICO', cerradoEn: '2025-08-01' }),
  ];
  assert.equal(filtrar(casos).length, 3);
  assert.deepEqual(filtrar(casos, { tipoServicio: 'cableado ESTRUCTURADO' }).map(c => c.referencia), ['B']);
  assert.deepEqual(filtrar(casos, { anio: '2025' }).map(c => c.referencia), ['B', 'C']);
  assert.deepEqual(filtrar(casos, { origen: 'HISTORICO' }).map(c => c.referencia), ['C']);
  assert.deepEqual(filtrar(casos, { anio: '2025', origen: 'SISTEMA' }).map(c => c.referencia), ['B']);
  assert.deepEqual(filtrar(casos, { tipoServicio: '', anio: '', origen: '' }).length, 3);
});

test('resumir: márgenes ponderados sobre el total, comparación estimado vs real e imprevistos', () => {
  // Servicio 1: venta 4,800, estimado 3,000, real 3,600. Servicio 2: venta 2,000, estimado 1,000, real 1,200.
  const r = resumir([
    caso({ imprevistosReal: 360, imprevistosProvision: 150 }),
    caso({ ventaSoles: 2000, costoParametrico: 1000, costoEstimado: 1000, costoReal: 1200, imprevistosReal: 40, imprevistosProvision: 50 }),
  ]);
  assert.equal(r.servicios, 2); assert.equal(r.sistema, 2); assert.equal(r.historicos, 0);
  assert.equal(r.ventaSoles, 6800); assert.equal(r.costoReal, 4800);
  assert.equal(r.margenReal, 29.41);                       // (6800 − 4800) / 6800
  assert.equal(r.margenEstimado, 41.18);                   // (6800 − 4000) / 6800
  assert.equal(r.margenRealComparable, 29.41);
  assert.equal(r.desviacionMargen, -11.77);
  assert.equal(r.desviacionCostoPorcentaje, 20);           // (4800 − 4000) / 4000
  // Imprevistos: 400 sobre directos de 4,400
  assert.deepEqual(r.imprevistos, { real: 400, porcentajeDeDirectos: 9.09, provision: 200, realConProvision: 400, serviciosConProvision: 2 });
});

test('resumir: los históricos sin costo estimado cuentan en lo real pero no en la comparación', () => {
  const r = resumir([
    caso(),
    caso({ origen: 'HISTORICO', costoEstimado: null, costoParametrico: null, imprevistosReal: null, imprevistosProvision: null, ventaSoles: 3000, costoReal: 2400 }),
  ]);
  assert.equal(r.servicios, 2); assert.equal(r.historicos, 1);
  assert.equal(r.ventaSoles, 7800); assert.equal(r.costoReal, 6000); assert.equal(r.margenReal, 23.08);
  assert.equal(r.comparables, 1); assert.equal(r.margenEstimado, 37.5); assert.equal(r.margenRealComparable, 25);
  assert.equal(r.desviacionMargen, -12.5);
  assert.equal(r.imprevistos.serviciosConProvision, 1);
});

test('resumir: sin servicios o sin datos no inventa números', () => {
  const vacio = resumir([]);
  assert.equal(vacio.servicios, 0); assert.equal(vacio.margenReal, null); assert.equal(vacio.margenEstimado, null);
  assert.equal(vacio.desviacionMargen, null); assert.equal(vacio.imprevistos.porcentajeDeDirectos, null);
  // Sin venta no hay margen
  assert.equal(resumir([caso({ ventaSoles: 0 })]).margenReal, null);
});

test('agruparPor: un renglón por tipo o por mes, en orden', () => {
  const casos = [
    caso({ cerradoEn: '2026-07-01' }),
    caso({ cerradoEn: '2026-06-01', tipoServicio: 'Cableado estructurado', ventaSoles: 1000, costoReal: 600, costoEstimado: 500 }),
    caso({ cerradoEn: '2026-06-20' }),
  ];
  const porTipo = agruparPor(casos, c => c.tipoServicio);
  assert.deepEqual(porTipo.map(g => [g.clave, g.servicios]), [['Aire Condicionado', 2], ['Cableado estructurado', 1]]);
  assert.equal(porTipo[1].margenReal, 40);
  const porMes = agruparPor(casos, periodoDe);
  assert.deepEqual(porMes.map(g => [g.clave, g.servicios]), [['2026-06', 2], ['2026-07', 1]]);
});

test('marcarServicios: semáforo del margen mínimo y de la tolerancia (null si falta el parámetro o el dato)', () => {
  const [bueno, malo, sinEstimado] = marcarServicios(
    [caso({ margenReal: 30, costoEstimado: 3000, costoReal: 3100 }), caso({ margenReal: 10, costoEstimado: 3000, costoReal: 3900 }), caso({ margenReal: 25, costoEstimado: null })],
    { margenMinimo: 20, tolerancia: 10 }
  );
  assert.equal(bueno.cumpleMargenMinimo, true); assert.equal(bueno.desviacionCostoPorcentaje, 3.33); assert.equal(bueno.dentroTolerancia, true);
  assert.equal(malo.cumpleMargenMinimo, false); assert.equal(malo.desviacionCostoPorcentaje, 30); assert.equal(malo.dentroTolerancia, false);
  assert.equal(sinEstimado.dentroTolerancia, null); assert.equal(sinEstimado.desviacionCostoPorcentaje, null);

  const [sinParametros] = marcarServicios([caso()], { margenMinimo: null, tolerancia: null });
  assert.equal(sinParametros.cumpleMargenMinimo, null); assert.equal(sinParametros.dentroTolerancia, null);
});

// Real 3,600. Paramétrico 3,000 (−16.67 %), análogo 3,500 (−2.78 %), final 3,800 (+5.56 %)
const conLosTres = (extra = {}) => caso({ costoParametrico: 3000, costoAnalogo: 3500, costoEstimado: 3800, costoReal: 3600, ...extra });

test('compararMetodos: error medio, sesgo y tolerancia de cada método, y el más exacto', () => {
  const r = compararMetodos([conLosTres()], 10);
  const [parametrico, analogo, final] = r.metodos;
  assert.deepEqual(parametrico, { clave: 'PARAMETRICO', etiqueta: 'Paramétrico', n: 1, errorMedioAbsoluto: 600, errorPorcentualMedio: 16.67, sesgoPorcentual: -16.67, dentroTolerancia: 0 });
  assert.equal(analogo.errorMedioAbsoluto, 100); assert.equal(analogo.errorPorcentualMedio, 2.78); assert.equal(analogo.dentroTolerancia, 100);
  assert.equal(final.errorMedioAbsoluto, 200); assert.equal(final.sesgoPorcentual, 5.56);
  assert.equal(r.mejor, 'ANALOGO'); assert.equal(r.basadoEn, 'COMUNES'); assert.equal(r.comunes.n, 1);
});

test('compararMetodos: promedia sobre varios servicios y distingue sobreestimar de subestimar', () => {
  // Paramétrico: −16.67 % y +25 % => error medio 20.83 %, sesgo +4.17 %
  const r = compararMetodos([conLosTres(), conLosTres({ costoParametrico: 4500, costoAnalogo: 3600, costoEstimado: 3600 })], null);
  const parametrico = r.metodos[0];
  assert.equal(parametrico.n, 2); assert.equal(parametrico.errorPorcentualMedio, 20.83); assert.equal(parametrico.sesgoPorcentual, 4.17);
  assert.equal(parametrico.dentroTolerancia, null, 'sin tolerancia definida no se calcula');
  assert.equal(r.mejor, 'ANALOGO');
});

test('compararMetodos: cada método se mide con los servicios que lo tienen y el más exacto sale de los que traen los tres', () => {
  const sinAnalogo = caso({ costoParametrico: 3600, costoAnalogo: null, costoEstimado: 3600, costoReal: 3600 });
  const r = compararMetodos([sinAnalogo, conLosTres()], 10);
  assert.deepEqual(r.metodos.map(m => m.n), [2, 1, 2]);
  assert.equal(r.comunes.n, 1);
  assert.equal(r.mejor, 'ANALOGO');
});

test('compararMetodos: sin datos o con un solo método no se nombra a un mejor', () => {
  const vacio = compararMetodos([], 10);
  assert.deepEqual(vacio.metodos.map(m => m.n), [0, 0, 0]); assert.equal(vacio.mejor, null); assert.equal(vacio.basadoEn, null);
  // Solo el final: un método no se compara con nadie
  const soloFinal = compararMetodos([caso({ costoParametrico: null, costoAnalogo: null })], 10);
  assert.equal(soloFinal.mejor, null);
  // Sin los tres en un mismo servicio, se comparan los dos métodos con sus propios servicios
  const sinComunes = compararMetodos([caso({ costoAnalogo: null }), caso({ costoParametrico: null, costoAnalogo: 3700, costoEstimado: null })], 10);
  assert.equal(sinComunes.comunes.n, 0); assert.equal(sinComunes.basadoEn, 'PROPIOS'); assert.ok(sinComunes.mejor);
});
