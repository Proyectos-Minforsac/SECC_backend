const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ESTADO,
  ACCION,
  margenBajoMinimo,
  estadoAlCrear,
  decidir,
  vigentePorCotizacion,
  motivoDeBloqueo,
} = require('../services/validacion');

// El caso de la tesis: costo 3,376.50 sobre una venta de 4,800 => margen 29.66 %.
const enRevision = (extra = {}) => ({
  estado: ESTADO.EN_REVISION,
  costoFinal: 3376.5,
  ventaSoles: 4800,
  margenFinal: 29.66,
  ...extra,
});

const falla = (fn, status, texto) =>
  assert.throws(fn, error => {
    assert.equal(error.status, status, error.message);
    if (texto) assert.match(error.message, texto);
    return true;
  });

test('margenBajoMinimo: sin mínimo no se exige nada; un margen que no existe tampoco se da por bueno', () => {
  assert.equal(margenBajoMinimo(10, null), false);
  assert.equal(margenBajoMinimo(null, null), false);
  assert.equal(margenBajoMinimo(19.99, 20), true);
  assert.equal(margenBajoMinimo(20, 20), false);
  assert.equal(margenBajoMinimo(29.66, 20), false);
  assert.equal(margenBajoMinimo(null, 20), true);
  assert.equal(margenBajoMinimo(-5, 20), true);
});

test('validar con el margen en rango: un clic, sin justificación', () => {
  const r = decidir(ACCION.VALIDAR, enRevision(), 20);
  assert.equal(r.estado, ESTADO.VALIDADA);
  assert.equal(r.costoDespues, 3376.5);
  assert.equal(r.margenDespues, 29.66);
  assert.equal(r.justificacion, null);
});

test('validar sin margen mínimo definido tampoco pide justificación', () => {
  assert.equal(decidir(ACCION.VALIDAR, enRevision({ margenFinal: 1 }), null).estado, ESTADO.VALIDADA);
});

test('validar con el margen bajo el mínimo exige justificación (HU-20)', () => {
  const bajo = enRevision({ margenFinal: 12 });
  falla(() => decidir(ACCION.VALIDAR, bajo, 20), 400, /Justificación/);
  falla(() => decidir(ACCION.VALIDAR, bajo, 20, { justificacion: '   ' }), 400, /Justificación/);
  falla(() => decidir(ACCION.VALIDAR, bajo, 20, { justificacion: 'corto' }), 400, /al menos 10/);

  const r = decidir(ACCION.VALIDAR, bajo, 20, { justificacion: '  Cliente estratégico, se acepta menos margen.  ' });
  assert.equal(r.estado, ESTADO.VALIDADA);
  assert.equal(r.justificacion, 'Cliente estratégico, se acepta menos margen.');
});

test('ajustar: nuevo costo, margen recalculado y justificación siempre obligatoria', () => {
  // 3,900 sobre 4,800 => (4800 - 3900) / 4800 = 18.75 %
  falla(() => decidir(ACCION.AJUSTAR, enRevision(), 20, { costoNuevo: 3900 }), 400, /Justificación del ajuste/);

  const r = decidir(ACCION.AJUSTAR, enRevision(), 20, {
    costoNuevo: '3900',
    justificacion: 'El transporte de material subió por el flete de la zona.',
  });
  assert.equal(r.estado, ESTADO.VALIDADA);
  assert.equal(r.costoDespues, 3900);
  assert.equal(r.margenDespues, 18.75);
  assert.match(r.justificacion, /flete/);
});

test('ajustar rechaza costos que no sirven', () => {
  const datos = costoNuevo => ({ costoNuevo, justificacion: 'Justificación suficiente.' });
  for (const malo of ['', null, undefined, 'abc', 0, -10, Infinity, 2e9]) {
    falla(() => decidir(ACCION.AJUSTAR, enRevision(), 20, datos(malo)), 400, /costo total ajustado/);
  }
  // Igual al estimado: no hay nada que ajustar
  falla(() => decidir(ACCION.AJUSTAR, enRevision(), 20, datos(3376.5)), 400, /usa Validar/);
  falla(() => decidir(ACCION.AJUSTAR, enRevision(), 20, datos('3376.50')), 400, /usa Validar/);
});

test('ajustar sobre una cotización sin venta deja el margen sin calcular', () => {
  const r = decidir(ACCION.AJUSTAR, enRevision({ ventaSoles: 0, margenFinal: null }), null, {
    costoNuevo: 100,
    justificacion: 'Se ajusta por criterio del jefe.',
  });
  assert.equal(r.margenDespues, null);
});

test('devolver: el motivo es obligatorio y el costo no cambia', () => {
  falla(() => decidir(ACCION.DEVOLVER, enRevision(), 20), 400, /Motivo/);
  const r = decidir(ACCION.DEVOLVER, enRevision(), 20, { justificacion: 'Falta el costo del traslado del material.' });
  assert.equal(r.estado, ESTADO.DEVUELTA);
  assert.equal(r.costoDespues, 3376.5);
  assert.equal(r.margenDespues, 29.66);
  assert.match(r.justificacion, /traslado/);
});

test('una estimación ya decidida no se vuelve a decidir (409)', () => {
  const datos = { costoNuevo: 3900, justificacion: 'Justificación suficiente.' };
  for (const estado of [ESTADO.VALIDADA, ESTADO.DEVUELTA]) {
    for (const accion of Object.values(ACCION)) {
      falla(() => decidir(accion, enRevision({ estado }), 20, datos), 409, /ya fue/);
    }
  }
  falla(() => decidir('BORRAR', enRevision(), 20), 400, /desconocida/);
});

test('estadoAlCrear: el trabajador envía a revisión; el jefe valida en el mismo paso (HU-26)', () => {
  assert.deepEqual(estadoAlCrear({ rol: 'trabajador', margen: 5, margenMinimo: 20 }), {
    estado: ESTADO.EN_REVISION,
    justificacion: null,
  });
  assert.deepEqual(estadoAlCrear({ rol: 'jefe', margen: 29.66, margenMinimo: 20 }), {
    estado: ESTADO.VALIDADA,
    justificacion: null,
  });
  // Con margen bajo el mínimo el jefe también justifica
  falla(() => estadoAlCrear({ rol: 'jefe', margen: 12, margenMinimo: 20 }), 400, /Justificación/);
  assert.equal(
    estadoAlCrear({ rol: 'jefe', margen: 12, margenMinimo: 20, justificacion: 'Obra de referencia para el cliente.' }).estado,
    ESTADO.VALIDADA
  );
  assert.equal(estadoAlCrear({ rol: 'jefe', margen: 12, margenMinimo: null }).estado, ESTADO.VALIDADA);
});

test('vigentePorCotizacion: rige la versión más reciente; sin versión cuenta como la 1', () => {
  const filas = [
    { estimacionId: '1', cotizacionId: '7', version: '1', estado: ESTADO.DEVUELTA },
    { estimacionId: '2', cotizacionId: '7', version: '2', estado: ESTADO.EN_REVISION },
    { estimacionId: '3', cotizacionId: '8', version: '', estado: ESTADO.VALIDADA },
    { estimacionId: '4', cotizacionId: '7', version: '10', estado: ESTADO.VALIDADA },
  ];
  assert.equal(vigentePorCotizacion(filas, 7).estimacionId, '4');
  assert.equal(vigentePorCotizacion(filas, '8').estimacionId, '3');
  assert.equal(vigentePorCotizacion(filas, 99), null);
  assert.equal(vigentePorCotizacion([], 7), null);
});

test('motivoDeBloqueo: solo una estimación validada deja decidir y ver el PDF; sin estimación está exento', () => {
  assert.equal(motivoDeBloqueo(null), null);
  assert.equal(motivoDeBloqueo({ estado: ESTADO.VALIDADA }), null);
  assert.match(motivoDeBloqueo({ estado: ESTADO.EN_REVISION }), /aún no fue validada/);
  assert.match(motivoDeBloqueo({ estado: ESTADO.DEVUELTA }), /devolvió/);
});
