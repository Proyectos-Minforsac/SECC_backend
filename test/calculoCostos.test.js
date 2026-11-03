const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularEstimacion, normalizarActividades } = require('../services/calculoCostos');

// Tarifas de los ejemplos (inventadas): pasaje 60, noche 80, alimentación 45, jornada 120.
const tarifa = (monto, destino = 'GENERAL', heredada = false) => ({ tarifaId: 1, monto, destino, heredada, vigenteDesde: '2026-01-01' });
const TARIFAS = { PASAJE: tarifa(60), NOCHE: tarifa(80), ALIMENTACION: tarifa(45), JORNADA: tarifa(120) };

const SIN_ACTIVIDADES = {
  INSTALACION: { nTecnicos: 0 },
  MANTENIMIENTO: { nTecnicos: 0 },
  SOPORTE: { nTecnicos: 0 },
};
const instalacion = datos => ({ ...SIN_ACTIVIDADES, INSTALACION: datos });
const producto = (costoUnitario, cantidad = 1, extra = {}) => ({
  tipo: 'Producto', nombre: 'Equipo', cantidad, precioUnitario: 1000, costoUnitario, ...extra,
});

test('caso 1 (el ejemplo de la tesis): instalación foránea con noches', () => {
  const { resultado: r, problemas } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 2, dias: 3, noches: 2, viajes: 1 }),
    tarifas: TARIFAS,
    items: [producto(1500)],
    costoDiagnostico: 300,
    tasaImprevistos: 5,
    ventaSinIGV: 4800,
  });
  assert.deepEqual(problemas, []);
  assert.equal(r.transporte, 120);
  assert.equal(r.hospedaje, 320);
  assert.equal(r.alimentacion, 270);
  assert.equal(r.manoObra, 720);
  assert.equal(r.viaticos, 710);
  assert.equal(r.materiales, 1500);
  assert.equal(r.directosFuturos, 2930);
  assert.equal(r.imprevistos, 146.5);
  assert.equal(r.diagnostico, 300);
  assert.equal(r.costoTotal, 3376.5);
  assert.equal(r.ventaSoles, 4800);
  assert.equal(r.margen, 29.66);
  assert.equal(r.actividades.INSTALACION.subtotal, 1430);
  assert.equal(r.actividades.MANTENIMIENTO.activa, false);
});

test('caso 2: instalación local sin noches no necesita la tarifa de hospedaje', () => {
  const { resultado: r, problemas } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }),
    tarifas: { ...TARIFAS, NOCHE: null },
    items: [producto(200, 2)],
    tasaImprevistos: 0,
    ventaSinIGV: 1000,
  });
  assert.deepEqual(problemas, []);
  assert.equal(r.hospedaje, 0);
  assert.equal(r.viaticos, 105);
  assert.equal(r.manoObra, 120);
  assert.equal(r.materiales, 400);
  assert.equal(r.costoTotal, 625);
  assert.equal(r.margen, 37.5);
  assert.deepEqual(Object.keys(r.tarifasUsadas).sort(), ['ALIMENTACION', 'JORNADA', 'PASAJE']);
});

test('caso 3: mantenimiento de 3 visitas de un día, cada una es un viaje', () => {
  const { resultado: r, problemas } = calcularEstimacion({
    actividades: {
      ...SIN_ACTIVIDADES,
      MANTENIMIENTO: { nTecnicos: 2, visitas: 3, diasPorVisita: 1, nochesPorVisita: 0 },
    },
    tarifas: TARIFAS,
    ventaSinIGV: 2000,
  });
  assert.deepEqual(problemas, []);
  const m = r.actividades.MANTENIMIENTO;
  assert.deepEqual([m.nTecnicos, m.viajes, m.dias, m.noches], [2, 3, 3, 0]);
  assert.equal(m.transporte, 360);
  assert.equal(m.alimentacion, 270);
  assert.equal(m.manoObra, 720);
  assert.equal(r.costoTotal, 1350);
  assert.equal(r.margen, 32.5);
});

test('las líneas guardan la cantidad, la tarifa y los datos de cada actividad', () => {
  const { resultado: r } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 2, dias: 3, noches: 2, viajes: 1 }),
    tarifas: TARIFAS,
    items: [producto(10)],
    ventaSinIGV: 100,
  });
  const jornada = r.lineas.find(l => l.categoria === 'MANO_OBRA');
  assert.deepEqual(jornada, {
    etapa: 'INSTALACION', categoria: 'MANO_OBRA', cantidad: 6, costoUnitario: 120, subtotal: 720,
    nTecnicos: 2, dias: 3, noches: 2, viajes: 1,
  });
  assert.equal(r.lineas.length, 4);
});

test('una actividad sin técnicos, o mantenimiento sin visitas, no se incluye', () => {
  const { resultado: r } = calcularEstimacion({
    actividades: {
      INSTALACION: { nTecnicos: 0, dias: 5, noches: 4, viajes: 3 },
      MANTENIMIENTO: { nTecnicos: 2, visitas: 0, diasPorVisita: 1 },
      SOPORTE: { nTecnicos: 1, visitas: 2, diasPorVisita: 1, nochesPorVisita: 0 },
    },
    tarifas: TARIFAS,
    ventaSinIGV: 500,
  });
  assert.equal(r.actividades.INSTALACION.activa, false);
  assert.equal(r.actividades.MANTENIMIENTO.activa, false);
  assert.equal(r.actividades.SOPORTE.activa, true);
  assert.equal(r.costoTotal, 2 * 60 + 2 * 45 + 2 * 120);
});

test('sin tasa de imprevistos se aplica 0 y se avisa', () => {
  const { resultado: r } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }),
    tarifas: TARIFAS,
    tasaImprevistos: null,
    ventaSinIGV: 1000,
  });
  assert.equal(r.imprevistos, 0);
  assert.equal(r.sinTasaImprevistos, true);
  assert.equal(r.tasaImprevistos, 0);
});

test('el diagnóstico suma al costo pero no a la base de los imprevistos', () => {
  const { resultado: r } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }),
    tarifas: TARIFAS,
    costoDiagnostico: 1000,
    tasaImprevistos: 10,
    ventaSinIGV: 5000,
  });
  // directos futuros: 60 + 45 + 120 = 225 -> imprevistos 22.50 (no 122.50)
  assert.equal(r.imprevistos, 22.5);
  assert.equal(r.costoTotal, 1247.5);
});

test('dólares: la venta se convierte a soles con el tipo de cambio', () => {
  const { resultado: r, problemas } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }),
    tarifas: TARIFAS,
    moneda: 'DÓLARES',
    tipoCambio: 3.8,
    ventaSinIGV: 1000,
  });
  assert.deepEqual(problemas, []);
  assert.equal(r.tipoCambio, 3.8);
  assert.equal(r.ventaSoles, 3800);
  assert.equal(r.margen, 94.08);
});

test('dólares sin tipo de cambio es un problema y no hay margen', () => {
  for (const tipoCambio of [null, undefined, 0, -1, 'abc', 101]) {
    const { resultado: r, problemas } = calcularEstimacion({
      actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }),
      tarifas: TARIFAS,
      moneda: 'DÓLARES',
      tipoCambio,
      ventaSinIGV: 1000,
    });
    assert.ok(problemas.some(p => p.includes('tipo de cambio')), String(tipoCambio));
    assert.equal(r.margen, null);
  }
});

test('falta una tarifa que sí se necesita: se avisa y se nombra el destino', () => {
  const { problemas } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 2, dias: 3, noches: 2, viajes: 1 }),
    tarifas: { ...TARIFAS, NOCHE: null, JORNADA: null },
    destino: 'Arequipa',
    ventaSinIGV: 4800,
  });
  assert.equal(problemas.length, 2);
  assert.ok(problemas.some(p => p.includes('noche de hospedaje') && p.includes('Arequipa')));
  assert.ok(problemas.some(p => p.includes('jornada de mano de obra')));
});

test('datos de actividad inválidos', () => {
  const casos = [
    [{ nTecnicos: 2, dias: 0, noches: 0, viajes: 1 }, 'cuántos días'],
    [{ nTecnicos: 2, dias: 2, noches: 0, viajes: 0 }, 'cuántos viajes'],
    [{ nTecnicos: 2, dias: 2, noches: 3, viajes: 1 }, 'noches no pueden ser más'],
    [{ nTecnicos: 2.5, dias: 2, noches: 1, viajes: 1 }, 'técnicos debe ser un número entero'],
    [{ nTecnicos: 2, dias: -1, noches: 0, viajes: 1 }, 'días debe ser un número entero'],
    [{ nTecnicos: 51, dias: 2, noches: 1, viajes: 1 }, 'técnicos debe ser un número entero'],
    [{ nTecnicos: 'x', dias: 2, noches: 1, viajes: 1 }, 'técnicos debe ser un número entero'],
  ];
  for (const [datos, texto] of casos) {
    const { problemas } = calcularEstimacion({ actividades: instalacion(datos), tarifas: TARIFAS, items: [producto(10)], ventaSinIGV: 100 });
    assert.ok(problemas.some(p => p.includes(texto)), `${JSON.stringify(datos)} -> ${problemas}`);
  }
});

test('mantenimiento: las noches de cada visita no pueden pasar de sus días', () => {
  const { problemas } = calcularEstimacion({
    actividades: { ...SIN_ACTIVIDADES, MANTENIMIENTO: { nTecnicos: 1, visitas: 2, diasPorVisita: 1, nochesPorVisita: 2 } },
    tarifas: TARIFAS,
    ventaSinIGV: 100,
  });
  assert.ok(problemas.some(p => p.includes('Mantenimiento preventivo') && p.includes('noches de cada visita')));
});

test('materiales: Producto e Impresora exigen costo; Alquiler es opcional; Servicio y Título no llevan', () => {
  const items = [
    producto(undefined, 1, { nombre: 'Split' }),
    { tipo: 'Impresora', nombre: 'HP', cantidad: 2, precioUnitario: 900, costoUnitario: 500 },
    { tipo: 'Alquiler', nombre: 'Andamio', cantidad: 1, precioUnitario: 100 },
    { tipo: 'Servicio', nombre: 'Instalación', cantidad: 1, precioUnitario: 300, costoUnitario: 999 },
    { tipo: 'Título', nombre: 'Sección', cantidad: 0, precioUnitario: 0 },
    { tipo: 'Producto', nombre: 'Marcado como 0', cantidad: 0, precioUnitario: 0 },
  ];
  const { resultado: r, problemas } = calcularEstimacion({ actividades: SIN_ACTIVIDADES, tarifas: TARIFAS, items, ventaSinIGV: 100 });

  assert.ok(problemas.some(p => p.includes('«Split»') && p.includes('costo de compra')));
  assert.equal(problemas.filter(p => p.includes('necesita su costo')).length, 1);
  assert.equal(r.costosItems[0], null);
  assert.deepEqual(r.costosItems[1], { costoUnitario: 500, costoSubtotal: 1000 });
  assert.deepEqual(r.costosItems[2], { costoUnitario: null, costoSubtotal: 0 });
  assert.equal(r.costosItems[3], null, 'el servicio ignora el costo que le envíen');
  assert.equal(r.costosItems[4], null);
  assert.equal(r.costosItems[5], null, 'cantidad y precio 0 = título');
  assert.equal(r.materiales, 1000);
});

test('materiales: costos inválidos, y el 0 es válido', () => {
  for (const costoUnitario of [-1, 'abc', Infinity, 1e9]) {
    const { problemas } = calcularEstimacion({ actividades: SIN_ACTIVIDADES, tarifas: TARIFAS, items: [producto(costoUnitario)], ventaSinIGV: 100 });
    assert.ok(problemas.some(p => p.includes('no es válido')), String(costoUnitario));
  }
  const { resultado: r } = calcularEstimacion({ actividades: SIN_ACTIVIDADES, tarifas: TARIFAS, items: [producto(0)], ventaSinIGV: 100 });
  assert.deepEqual(r.costosItems[0], { costoUnitario: 0, costoSubtotal: 0 });
});

test('una estimación sin costos futuros es un problema', () => {
  const { problemas } = calcularEstimacion({ actividades: SIN_ACTIVIDADES, tarifas: TARIFAS, items: [], costoDiagnostico: 300, ventaSinIGV: 100 });
  assert.ok(problemas.some(p => p.includes('no tiene costos')));
});

test('sin venta no hay margen; con costo mayor que la venta el margen es negativo', () => {
  const base = { actividades: instalacion({ nTecnicos: 1, dias: 1, noches: 0, viajes: 1 }), tarifas: TARIFAS };
  assert.equal(calcularEstimacion({ ...base, ventaSinIGV: 0 }).resultado.margen, null);
  assert.equal(calcularEstimacion({ ...base, ventaSinIGV: 150 }).resultado.margen, -50);
});

test('los montos se redondean a 2 decimales', () => {
  const { resultado: r } = calcularEstimacion({
    actividades: instalacion({ nTecnicos: 3, dias: 1, noches: 0, viajes: 1 }),
    tarifas: { ...TARIFAS, PASAJE: tarifa(33.335), ALIMENTACION: tarifa(0.01), JORNADA: tarifa(0.01) },
    tasaImprevistos: 7.5,
    ventaSinIGV: 333.33,
  });
  for (const campo of ['transporte', 'alimentacion', 'manoObra', 'imprevistos', 'costoTotal', 'margen']) {
    assert.equal(r[campo], Math.round(r[campo] * 100) / 100, campo);
  }
});

test('normalizarActividades deja enteros y 0 donde falte o sea inválido', () => {
  assert.deepEqual(
    normalizarActividades({
      INSTALACION: { nTecnicos: '2', dias: 3, noches: 'x', viajes: 1, extra: 9 },
      MANTENIMIENTO: { nTecnicos: 1, visitas: 3 },
    }),
    {
      INSTALACION: { nTecnicos: 2, dias: 3, noches: 0, viajes: 1 },
      MANTENIMIENTO: { nTecnicos: 1, visitas: 3, diasPorVisita: 0, nochesPorVisita: 0 },
      SOPORTE: { nTecnicos: 0, visitas: 0, diasPorVisita: 0, nochesPorVisita: 0 },
    }
  );
});
