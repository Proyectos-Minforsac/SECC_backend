const test = require('node:test');
const assert = require('node:assert/strict');
const { CRITERIO, normalizar, seleccionarSimilares, calcularAnaloga, sugerir } = require('../services/analoga');

// Un servicio cerrado: se estimó `estimado` (paramétrico) y costó `real`, con una venta de `venta`.
const caso = (extra = {}) => {
  const venta = extra.ventaSoles ?? 4800;
  const real = extra.costoReal ?? 3000;
  return {
    origen: 'SISTEMA', referencia: 'R', tipoServicio: 'Aire Condicionado', destino: 'GENERAL', cerradoEn: '2026-06-01T10:00:00.000Z',
    ventaSoles: venta, costoParametrico: 2500, costoEstimado: 2500, costoReal: real,
    margenReal: Math.round(((venta - real) / venta) * 10000) / 100, ...extra,
  };
};

test('normalizar: sin mayúsculas, tildes ni espacios de más', () => {
  assert.equal(normalizar('  Aire   CONDICIONADO '), 'aire condicionado');
  assert.equal(normalizar('Instalación'), 'instalacion');
  assert.equal(normalizar(null), '');
});

test('seleccionarSimilares: mismo tipo; el destino solo si alcanza el mínimo de casos', () => {
  const casos = [
    caso({ destino: 'Arequipa' }), caso({ destino: 'arequipa' }), caso({ destino: 'Arequipa' }),
    caso({ destino: 'GENERAL' }), caso({ tipoServicio: 'Cableado estructurado' }),
  ];
  let r = seleccionarSimilares(casos, 'aire condicionado', 'Arequipa', 3);
  assert.equal(r.criterio, CRITERIO.TIPO_Y_DESTINO); assert.equal(r.similares.length, 3);
  // No alcanza con ese destino: se usan todos los del tipo
  r = seleccionarSimilares(casos, 'Aire Condicionado', 'Cusco', 3);
  assert.equal(r.criterio, CRITERIO.TIPO); assert.equal(r.similares.length, 4);
  r = seleccionarSimilares(casos, 'Aire Condicionado', '', 3);
  assert.equal(r.criterio, CRITERIO.TIPO);
  // Sin tipo, o de un tipo sin servicios, no hay similares
  assert.deepEqual(seleccionarSimilares(casos, '', 'GENERAL', 3), { criterio: null, similares: [] });
  assert.deepEqual(seleccionarSimilares(casos, 'Impresoras', 'GENERAL', 3), { criterio: null, similares: [] });
});

test('calcularAnaloga: promedio, rango y desviación de los servicios parecidos', () => {
  // Estimados en 2,500; costaron 3,000 / 2,750 / 3,250 => desviación +20 % / +10 % / +30 % (promedio +20 %)
  const casos = [caso({ costoReal: 3000 }), caso({ costoReal: 2750 }), caso({ costoReal: 3250 })];
  const a = calcularAnaloga(casos, { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(a.n, 3); assert.equal(a.suficiente, true); assert.equal(a.criterio, CRITERIO.TIPO_Y_DESTINO);
  assert.deepEqual(a.costoReal, { promedio: 3000, min: 2750, max: 3250 });
  assert.equal(a.margenReal.promedio, 37.5); assert.equal(a.margenReal.min, 32.29); assert.equal(a.margenReal.max, 42.71);
  assert.equal(a.desviacion.casos, 3); assert.equal(a.desviacion.relativaPromedio, 20); assert.equal(a.desviacion.costoPromedio, 500);
  // Margen estimado: (4800 - 2500) / 4800 = 47.92 %; el real promedio es 37.5 % => la realidad quedó 10.42 puntos más abajo
  assert.equal(a.desviacion.margenPromedio, -10.42);
  assert.equal(a.sugerible, true); assert.equal(a.motivo, '');
  assert.equal(a.recientes.length, 3);
});

test('calcularAnaloga: bajo el mínimo de casos no promedia ni sugiere («sin datos suficientes»)', () => {
  const dos = calcularAnaloga([caso(), caso()], { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(dos.n, 2); assert.equal(dos.suficiente, false); assert.equal(dos.sugerible, false);
  assert.equal(dos.costoReal.promedio, null); assert.equal(dos.margenReal.promedio, null); assert.equal(dos.desviacion.relativaPromedio, null);
  assert.match(dos.motivo, /Hay 2 servicios similares y se necesitan al menos 3/);
  assert.equal(dos.recientes.length, 2, 'los casos se siguen listando para que el jefe los mire');

  const uno = calcularAnaloga([caso()], { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.match(uno.motivo, /Hay 1 servicio similar y se necesitan/);
  assert.match(calcularAnaloga([], { tipoServicio: 'Aire Condicionado', destino: '', minCasos: 3 }).motivo, /Todavía no hay servicios cerrados/);
  assert.match(calcularAnaloga([caso()], { tipoServicio: '', destino: '', minCasos: 3 }).motivo, /no tiene tipo de servicio/);
});

test('calcularAnaloga: un servicio sin costo con el que se estimó cuenta en el promedio pero no en la desviación', () => {
  const historicos = [
    caso({ origen: 'HISTORICO', costoParametrico: null, costoEstimado: null, costoReal: 2000 }),
    caso({ origen: 'HISTORICO', costoParametrico: null, costoEstimado: null, costoReal: 4000 }),
  ];
  const a = calcularAnaloga([...historicos, caso({ costoReal: 3000 })], { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(a.n, 3); assert.equal(a.costoReal.promedio, 3000);
  assert.equal(a.desviacion.casos, 1);
  assert.equal(a.sugerible, false);
  assert.match(a.motivo, /Solo 1 de 3 servicios traen el costo con el que se estimaron/);
  assert.equal(sugerir(a, { costoParametrico: 2500, ventaSoles: 4800 }), null);
});

test('calcularAnaloga: en un histórico sin paramétrico se mide contra el estimado que se había dado', () => {
  const historicos = [1, 2, 3].map(() => caso({ origen: 'HISTORICO', costoParametrico: null, costoEstimado: 2000, costoReal: 2400 }));
  const a = calcularAnaloga(historicos, { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.equal(a.desviacion.relativaPromedio, 20);
  assert.equal(a.sugerible, true);
});

test('sugerir: el costo paramétrico corregido con la desviación histórica', () => {
  const casos = [caso({ costoReal: 3000 }), caso({ costoReal: 2750 }), caso({ costoReal: 3250 })];
  const a = calcularAnaloga(casos, { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  // +20 % sobre 3,376.50 = 4,051.80; con una venta de 4,800 el margen queda en 15.59 %
  assert.deepEqual(sugerir(a, { costoParametrico: 3376.5, ventaSoles: 4800 }), { costo: 4051.8, margen: 15.59, casos: 3, desviacionPorcentaje: 20 });
  // Sin venta no hay margen; sin costo paramétrico no hay sugerencia
  assert.equal(sugerir(a, { costoParametrico: 3376.5, ventaSoles: 0 }).margen, null);
  assert.equal(sugerir(a, { costoParametrico: 0, ventaSoles: 4800 }), null);
  assert.equal(sugerir(null, { costoParametrico: 100, ventaSoles: 100 }), null);
  // Si los servicios costaron menos de lo estimado, la sugerencia baja
  const baratos = calcularAnaloga([2000, 2000, 2000].map(costoReal => caso({ costoReal })), { tipoServicio: 'Aire Condicionado', destino: '', minCasos: 3 });
  assert.equal(sugerir(baratos, { costoParametrico: 2500, ventaSoles: 4800 }).costo, 2000);
});

test('calcularAnaloga: los servicios recientes salen del más nuevo al más antiguo, hasta cinco', () => {
  const casos = ['2026-01-01', '2026-03-01', '2026-02-01', '2026-06-01', '2026-05-01', '2026-04-01', '2025-12-01']
    .map((cerradoEn, i) => caso({ cerradoEn, referencia: `S${i}` }));
  const a = calcularAnaloga(casos, { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', minCasos: 3 });
  assert.deepEqual(a.recientes.map(c => c.cerradoEn), ['2026-06-01', '2026-05-01', '2026-04-01', '2026-03-01', '2026-02-01']);
});
