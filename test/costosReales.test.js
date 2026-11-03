const test = require('node:test');
const assert = require('node:assert/strict');
const {
  etapasPorLiquidar,
  etapaLiquidada,
  ejecutadoDe,
  construirPlan,
  proponerEntradas,
  proponerPrecios,
  lineasDeEtapa,
  validarLiquidacion,
  validarImprevisto,
  validarAviso,
  totalesDeCostos,
  agregarEstimaciones,
  calcularResumen,
} = require('../services/costosReales');

const falla = (fn, status, texto) =>
  assert.throws(fn, error => {
    assert.equal(error.status, status, error.message);
    if (texto) assert.match(error.message, texto);
    return true;
  });

// El caso de la tesis: 2 técnicos, 3 días, 2 noches, 1 viaje; pasaje 60, noche 80, alimentación 45, jornada 120.
const lineaPlan = (categoria, cantidad, costoUnitario, extra = {}) => ({
  estimacionId: '1', etapa: 'INSTALACION', categoria, nTecnicos: 2, dias: 3, noches: 2, viajes: 1,
  cantidad, costoUnitario, subtotal: cantidad * costoUnitario, ...extra,
});
const lineasInstalacion = [
  lineaPlan('TRANSPORTE', 2, 60),
  lineaPlan('HOSPEDAJE', 4, 80),
  lineaPlan('ALIMENTACION', 6, 45),
  lineaPlan('MANO_OBRA', 6, 120),
];
const estimacion = { estimacionId: '1', costoMateriales: 1500, costoDiagnostico: 300, costoImprevistos: 146.5 };
const tarifas = { PASAJE: 55, NOCHE: 75, ALIMENTACION: 40, JORNADA: 110 };

test('etapasPorLiquidar: la final completa lo anterior si la instalación no se liquidó', () => {
  assert.deepEqual(etapasPorLiquidar('INSTALACION', false), ['DIAGNOSTICO', 'INSTALACION']);
  assert.deepEqual(etapasPorLiquidar('FINAL', true), ['MANTENIMIENTO', 'SOPORTE']);
  assert.deepEqual(etapasPorLiquidar('FINAL', false), ['DIAGNOSTICO', 'INSTALACION', 'MANTENIMIENTO', 'SOPORTE']);
  falla(() => etapasPorLiquidar('OTRA', true), 400, /Fase/);
});

test('etapaLiquidada: la liquidación final también confirma el diagnóstico y la instalación', () => {
  const nada = { liquidacionInstalacionEn: '', liquidacionFinalEn: '' };
  const instalada = { liquidacionInstalacionEn: '2026-11-02T10:00:00Z', liquidacionFinalEn: '' };
  const final = { liquidacionInstalacionEn: '', liquidacionFinalEn: '2026-12-02T10:00:00Z' };
  for (const etapa of ['DIAGNOSTICO', 'INSTALACION', 'MANTENIMIENTO', 'SOPORTE']) assert.equal(etapaLiquidada(etapa, nada), false);
  assert.deepEqual(['DIAGNOSTICO', 'INSTALACION', 'MANTENIMIENTO', 'SOPORTE'].map(e => etapaLiquidada(e, instalada)), [true, true, false, false]);
  assert.deepEqual(['DIAGNOSTICO', 'INSTALACION', 'MANTENIMIENTO', 'SOPORTE'].map(e => etapaLiquidada(e, final)), [true, true, true, true]);
});

test('ejecutadoDe: cuenta visitas completadas y días distintos por etapa', () => {
  const ejecutado = ejecutadoDe([
    { tipo: 'INSTALACION', fecha: '2026-11-03', completada: true },
    { tipo: 'INSTALACION', fecha: '2026-11-03', completada: true }, // dos visitas el mismo día: un solo día
    { tipo: 'INSTALACION', fecha: '2026-11-04', completada: true },
    { tipo: 'INSTALACION', fecha: '2026-11-05', completada: false }, // pendiente: no cuenta
    { tipo: 'MANTENIMIENTO', fecha: '2027-01-10', completada: true },
    { tipo: 'DESCONOCIDA', fecha: '2027-01-11', completada: true },
  ]);
  assert.deepEqual(ejecutado.INSTALACION, { visitas: 3, dias: 2 });
  assert.deepEqual(ejecutado.MANTENIMIENTO, { visitas: 1, dias: 1 });
  assert.deepEqual(ejecutado.SOPORTE, { visitas: 0, dias: 0 });
  assert.deepEqual(ejecutado.DIAGNOSTICO, { visitas: 0, dias: 0 });
});

test('construirPlan: lo planificado por etapa y rubro, con materiales y diagnóstico', () => {
  const plan = construirPlan(lineasInstalacion, [estimacion]);
  assert.deepEqual(plan.INSTALACION.entradas, { nTecnicos: 2, dias: 3, noches: 2, viajes: 1 });
  assert.equal(plan.INSTALACION.activa, true);
  assert.deepEqual(plan.INSTALACION.rubros.HOSPEDAJE, { cantidad: 4, costoUnitario: 80, subtotal: 320 });
  assert.equal(plan.materiales, 1500);
  assert.equal(plan.diagnostico, 300);
  // 120 + 320 + 270 + 720 + 1,500 de materiales
  assert.equal(plan.INSTALACION.subtotal, 2930);
  assert.equal(plan.MANTENIMIENTO.activa, false);
  assert.equal(plan.MANTENIMIENTO.entradas, null);
  assert.equal(plan.SOPORTE.subtotal, 0);
});

test('construirPlan: con dos cotizaciones suma lo planificado y cuenta el diagnóstico una sola vez', () => {
  const segunda = lineasInstalacion.map(l => ({ ...l, estimacionId: '2', nTecnicos: 3, dias: 1, noches: 0, viajes: 1 }));
  const plan = construirPlan([...lineasInstalacion, ...segunda], [estimacion, { ...estimacion, estimacionId: '2', costoMateriales: 200 }]);
  assert.deepEqual(plan.INSTALACION.entradas, { nTecnicos: 3, dias: 4, noches: 2, viajes: 2 });
  assert.equal(plan.INSTALACION.rubros.MANO_OBRA.cantidad, 12);
  assert.equal(plan.INSTALACION.rubros.MANO_OBRA.subtotal, 1440);
  assert.equal(plan.INSTALACION.rubros.MANO_OBRA.costoUnitario, 120);
  assert.equal(plan.materiales, 1700);
  assert.equal(plan.diagnostico, 300);
});

test('proponerEntradas: instalación parte del plan y de los días ejecutados', () => {
  const plan = construirPlan(lineasInstalacion, [estimacion]);
  // Se planificaron 3 días y la obra llevó 4: las noches no pasan de los días y los viajes siguen el plan
  assert.deepEqual(proponerEntradas('INSTALACION', plan.INSTALACION, { visitas: 4, dias: 4 }), { nTecnicos: 2, dias: 4, noches: 2, viajes: 1 });
  // Si terminó en 1 día no puede haber más noches que días
  assert.deepEqual(proponerEntradas('INSTALACION', plan.INSTALACION, { visitas: 1, dias: 1 }), { nTecnicos: 2, dias: 1, noches: 1, viajes: 1 });
  // Sin plan: un técnico, un viaje, lo ejecutado
  assert.deepEqual(proponerEntradas('INSTALACION', plan.MANTENIMIENTO, { visitas: 2, dias: 2 }), { nTecnicos: 1, dias: 2, noches: 0, viajes: 1 });
});

test('proponerEntradas: en mantenimiento y soporte cada visita completada es un viaje', () => {
  const lineas = [
    { estimacionId: '1', etapa: 'MANTENIMIENTO', categoria: 'TRANSPORTE', nTecnicos: 1, dias: 6, noches: 3, viajes: 3, cantidad: 3, costoUnitario: 60, subtotal: 180 },
  ];
  const plan = construirPlan(lineas, [estimacion]);
  // 3 visitas previstas con 1 noche cada una; se hicieron 2 en 2 días
  assert.deepEqual(proponerEntradas('MANTENIMIENTO', plan.MANTENIMIENTO, { visitas: 2, dias: 2 }), { nTecnicos: 1, dias: 2, noches: 2, viajes: 2 });
  // El soporte no se planificó: arranca con un técnico y lo ejecutado
  assert.deepEqual(proponerEntradas('SOPORTE', plan.SOPORTE, { visitas: 1, dias: 1 }), { nTecnicos: 1, dias: 1, noches: 0, viajes: 1 });
  assert.deepEqual(proponerEntradas('SOPORTE', plan.SOPORTE, { visitas: 0, dias: 0 }), { nTecnicos: 1, dias: 0, noches: 0, viajes: 0 });
});

test('proponerPrecios: el que se usó al estimar o, si no hubo, la tarifa vigente', () => {
  const plan = construirPlan(lineasInstalacion, [estimacion]);
  assert.deepEqual(proponerPrecios(plan.INSTALACION, tarifas), { TRANSPORTE: 60, HOSPEDAJE: 80, ALIMENTACION: 45, MANO_OBRA: 120 });
  assert.deepEqual(proponerPrecios(plan.SOPORTE, tarifas), { TRANSPORTE: 55, HOSPEDAJE: 75, ALIMENTACION: 40, MANO_OBRA: 110 });
  assert.deepEqual(proponerPrecios(null, undefined), { TRANSPORTE: 0, HOSPEDAJE: 0, ALIMENTACION: 0, MANO_OBRA: 0 });
});

test('lineasDeEtapa: técnicos × unidades × precio, igual que al estimar', () => {
  const lineas = lineasDeEtapa('INSTALACION', {
    nTecnicos: 2, dias: 4, noches: 3, viajes: 1,
    precios: { TRANSPORTE: 60, HOSPEDAJE: 90, ALIMENTACION: 45, MANO_OBRA: 120 }, materiales: 1600,
  }, 300);
  assert.deepEqual(lineas.map(l => [l.rubro, l.cantidad, l.costoUnitario, l.subtotal]), [
    ['TRANSPORTE', 2, 60, 120],
    ['HOSPEDAJE', 6, 90, 540],
    ['ALIMENTACION', 8, 45, 360],
    ['MANO_OBRA', 8, 120, 960],
    ['MATERIALES', 1, 1600, 1600],
  ]);
  assert.ok(lineas.every(l => l.etapa === 'INSTALACION'));

  const diagnostico = lineasDeEtapa('DIAGNOSTICO', null, 300);
  assert.deepEqual(diagnostico.map(l => [l.rubro, l.cantidad, l.subtotal]), [['DIAGNOSTICO', 1, 300]]);

  // Mantenimiento no lleva materiales
  const mantenimiento = lineasDeEtapa('MANTENIMIENTO', { nTecnicos: 1, dias: 2, noches: 0, viajes: 2, precios: { TRANSPORTE: 60, ALIMENTACION: 45, MANO_OBRA: 120 } }, 300);
  assert.equal(mantenimiento.length, 4);
  assert.equal(mantenimiento.find(l => l.rubro === 'HOSPEDAJE').subtotal, 0);
});

const instalacionEnviada = (extra = {}) => ({
  etapa: 'INSTALACION', nTecnicos: 2, dias: 4, noches: 3, viajes: 1,
  precios: { TRANSPORTE: 60, HOSPEDAJE: 90, ALIMENTACION: 45, MANO_OBRA: 120 }, materiales: 1600, ...extra,
});

test('validarLiquidacion: calcula todo en el servidor y toma el diagnóstico de los hechos', () => {
  // El navegador intenta fijar el diagnóstico y los subtotales: se ignora
  const lineas = validarLiquidacion(['DIAGNOSTICO', 'INSTALACION'], [
    { etapa: 'DIAGNOSTICO', costoUnitario: 1, subtotal: 1 },
    instalacionEnviada({ subtotal: 1, lineas: [{ subtotal: 1 }] }),
  ], 300);
  assert.deepEqual(lineas.map(l => [l.etapa, l.rubro, l.subtotal]), [
    ['DIAGNOSTICO', 'DIAGNOSTICO', 300],
    ['INSTALACION', 'TRANSPORTE', 120],
    ['INSTALACION', 'HOSPEDAJE', 540],
    ['INSTALACION', 'ALIMENTACION', 360],
    ['INSTALACION', 'MANO_OBRA', 960],
    ['INSTALACION', 'MATERIALES', 1600],
  ]);
  // El diagnóstico no hace falta enviarlo
  assert.equal(validarLiquidacion(['DIAGNOSTICO', 'INSTALACION'], [instalacionEnviada()], 300).length, 6);
});

test('validarLiquidacion: rechaza lo que no cuadra', () => {
  const esperadas = ['DIAGNOSTICO', 'INSTALACION'];
  falla(() => validarLiquidacion(esperadas, undefined, 300), 400, /Falta la liquidación/);
  falla(() => validarLiquidacion(esperadas, [], 300), 400, /Falta la liquidación de «Instalación»/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada(), instalacionEnviada()], 300), 400, /repetida/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada(), { etapa: 'SOPORTE' }], 300), 400, /no se liquida en este paso/);
  falla(() => validarLiquidacion(esperadas, [{ etapa: 'OTRA' }], 300), 400, /desconocida/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ noches: 5, dias: 4 })], 300), 400, /noches no pueden ser más que los días/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ nTecnicos: 2.5 })], 300), 400, /técnicos debe ser un número entero/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ dias: 400 })], 300), 400, /días debe ser un número entero entre 0 y 365/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ materiales: undefined })], 300), 400, /costo real de los materiales/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ materiales: -5 })], 300), 400, /materiales no es válido/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ precios: { TRANSPORTE: 60 } })], 300), 400, /precio de la noche de hospedaje/);
  falla(() => validarLiquidacion(esperadas, [instalacionEnviada({ precios: { ...instalacionEnviada().precios, MANO_OBRA: 'caro' } })], 300), 400, /precio de la jornada/);
});

test('validarLiquidacion: sin unidades en un rubro su precio puede faltar', () => {
  const lineas = validarLiquidacion(['MANTENIMIENTO'], [
    { etapa: 'MANTENIMIENTO', nTecnicos: 1, dias: 2, noches: 0, viajes: 2, precios: { TRANSPORTE: 60, ALIMENTACION: 45, MANO_OBRA: 120 } },
  ], 300);
  assert.equal(lineas.find(l => l.rubro === 'HOSPEDAJE').subtotal, 0);
  assert.equal(lineas.find(l => l.rubro === 'MANO_OBRA').subtotal, 240);
  // Con noches sí hace falta el precio
  falla(() => validarLiquidacion(['MANTENIMIENTO'], [
    { etapa: 'MANTENIMIENTO', nTecnicos: 1, dias: 2, noches: 1, viajes: 2, precios: { TRANSPORTE: 60, ALIMENTACION: 45, MANO_OBRA: 120 } },
  ], 300), 400, /precio de la noche/);
});

test('validarImprevisto: etapa, tipo, monto y motivo', () => {
  const ok = validarImprevisto({ etapa: 'INSTALACION', concepto: 'DOBLE_PASAJE', monto: '120.456', motivo: '  El cliente no abrió; hubo que volver.  ' });
  assert.deepEqual(ok, { etapa: 'INSTALACION', concepto: 'DOBLE_PASAJE', monto: 120.46, motivo: 'El cliente no abrió; hubo que volver.' });

  const base = { etapa: 'SOPORTE', concepto: 'OTRO', monto: 50, motivo: 'Motivo suficientemente largo.' };
  falla(() => validarImprevisto({ ...base, etapa: 'OTRA' }), 400, /etapa/);
  falla(() => validarImprevisto({ ...base, concepto: 'ROBO' }), 400, /tipo de imprevisto/);
  for (const malo of ['', 0, -3, 'abc', 2e7, null]) falla(() => validarImprevisto({ ...base, monto: malo }), 400, /monto/);
  falla(() => validarImprevisto({ ...base, motivo: '' }), 400, /Motivo/);
  falla(() => validarImprevisto({ ...base, motivo: 'corto' }), 400, /al menos 10/);
});

test('validarAviso: el técnico dice qué pasó, sin monto', () => {
  assert.deepEqual(validarAviso({ concepto: 'MATERIAL_FALTANTE', descripcion: 'Faltó un tramo de tubería.' }), {
    concepto: 'MATERIAL_FALTANTE',
    descripcion: 'Faltó un tramo de tubería.',
  });
  falla(() => validarAviso({ concepto: 'X', descripcion: 'Faltó un tramo de tubería.' }), 400, /tipo de imprevisto/);
  falla(() => validarAviso({ concepto: 'OTRO', descripcion: '' }), 400, /Descripción/);
});

test('totalesDeCostos: los pendientes no suman y se cuentan aparte', () => {
  const totales = totalesDeCostos([
    { clase: 'DIRECTO', estado: 'REGISTRADO', subtotal: '300' },
    { clase: 'DIRECTO', estado: 'REGISTRADO', subtotal: 120.5 },
    { clase: 'IMPREVISTO', estado: 'REGISTRADO', subtotal: '200' },
    { clase: 'IMPREVISTO', estado: 'PENDIENTE', subtotal: '' },
  ]);
  assert.deepEqual(totales, { directos: 420.5, imprevistos: 200, pendientes: 1 });
  assert.deepEqual(totalesDeCostos([]), { directos: 0, imprevistos: 0, pendientes: 0 });
});

test('agregarEstimaciones: una sola cotización es lo validado; con varias el diagnóstico va una vez', () => {
  const una = { ventaSoles: 4800, costoParametrico: 3376.5, costoFinal: 3376.5, costoDiagnostico: 300, costoImprevistos: 146.5 };
  assert.deepEqual(agregarEstimaciones([una]), { ventaSoles: 4800, costoParametrico: 3376.5, costoAnalogo: null, costoEstimado: 3376.5, provision: 146.5 });

  // Con costo análogo en todas las cotizaciones se suma igual (el diagnóstico una vez); si falta en una, no se conoce
  const analoga = { ...una, costoAnalogo: 4051.8 };
  assert.equal(agregarEstimaciones([analoga]).costoAnalogo, 4051.8);
  assert.equal(agregarEstimaciones([analoga, { ...analoga, costoParametrico: 1300, costoFinal: 1300, costoAnalogo: 1500 }]).costoAnalogo, 4051.8 + 1500 - 300);
  assert.equal(agregarEstimaciones([analoga, { ...analoga, costoAnalogo: null }]).costoAnalogo, null);

  // El jefe ajustó el costo de la primera a 3,900; la segunda cuesta 1,300 con el mismo diagnóstico de 300
  const ajustada = { ...una, costoFinal: 3900 };
  const segunda = { ventaSoles: 2000, costoParametrico: 1300, costoFinal: 1300, costoDiagnostico: 300, costoImprevistos: 50 };
  assert.deepEqual(agregarEstimaciones([ajustada, segunda]), {
    ventaSoles: 6800,
    costoParametrico: 3376.5 + 1300 - 300,
    costoAnalogo: null,
    costoEstimado: 3900 + 1300 - 300,
    provision: 196.5,
  });
});

test('calcularResumen: márgenes y desviaciones (ΔC en soles, ΔM en puntos)', () => {
  // Venta 4,800; se estimó 3,376.50 (29.66 %) y costó 4,080 (15 %)
  assert.deepEqual(calcularResumen({ ventaSoles: 4800, costoEstimado: 3376.5, costoReal: 4080 }), {
    margenEstimado: 29.66,
    margenReal: 15,
    desviacionCosto: 703.5,
    desviacionMargen: -14.66,
  });
  // Costó menos de lo previsto: desviación negativa en costo y positiva en margen
  const mejor = calcularResumen({ ventaSoles: 4800, costoEstimado: 3376.5, costoReal: 3000 });
  assert.equal(mejor.desviacionCosto, -376.5);
  assert.equal(mejor.margenReal, 37.5);
  assert.equal(mejor.desviacionMargen, 7.84);
  // Sin venta no hay margen que comparar
  assert.deepEqual(calcularResumen({ ventaSoles: 0, costoEstimado: 100, costoReal: 120 }), {
    margenEstimado: null,
    margenReal: null,
    desviacionCosto: 20,
    desviacionMargen: null,
  });
});
