const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFINICIONES,
  validarValor,
  validarParametros,
  resolverParametros,
  valoresEfectivos,
} = require('../services/parametros');

const definicion = clave => DEFINICIONES.find(d => d.clave === clave);

test('las definiciones cubren los cinco parámetros de la fase 2', () => {
  assert.deepEqual(
    DEFINICIONES.map(d => d.clave),
    ['MARGEN_MINIMO', 'TASA_IMPREVISTOS', 'TOLERANCIA_DESVIACION', 'MIN_CASOS_ANALOGA', 'GARANTIA_MESES_DEFECTO']
  );
});

test('validarValor: vacío = sin definir; números dentro del rango se aceptan', () => {
  const margen = definicion('MARGEN_MINIMO');
  for (const vacio of [null, undefined, '', '  ']) assert.deepEqual(validarValor(margen, vacio), { valor: null });
  assert.deepEqual(validarValor(margen, 18.5), { valor: 18.5 });
  assert.deepEqual(validarValor(margen, '12,345'), { valor: 12.35 });
  assert.deepEqual(validarValor(margen, 0), { valor: 0 });
  assert.deepEqual(validarValor(margen, 100), { valor: 100 });
});

test('validarValor rechaza lo que sale del rango o no es número', () => {
  const margen = definicion('MARGEN_MINIMO');
  for (const malo of [-1, 100.01, 'abc', NaN, Infinity, true, {}]) assert.ok(validarValor(margen, malo).error, String(malo));
});

test('validarValor: los parámetros enteros no admiten decimales y respetan su rango', () => {
  const casos = definicion('MIN_CASOS_ANALOGA');
  const garantia = definicion('GARANTIA_MESES_DEFECTO');
  assert.deepEqual(validarValor(casos, 3), { valor: 3 });
  assert.ok(validarValor(casos, 2.5).error);
  assert.ok(validarValor(casos, 0).error);
  assert.ok(validarValor(casos, 21).error);
  assert.deepEqual(validarValor(garantia, '5'), { valor: 5 });
  for (const fuera of [3, 7, 12, 4.5]) assert.ok(validarValor(garantia, fuera).error, String(fuera));
});

test('validarParametros normaliza varios y rechaza claves desconocidas o cuerpo vacío', () => {
  assert.deepEqual(
    validarParametros({ MARGEN_MINIMO: '20', TASA_IMPREVISTOS: null, GARANTIA_MESES_DEFECTO: 5 }),
    { valores: { MARGEN_MINIMO: 20, TASA_IMPREVISTOS: null, GARANTIA_MESES_DEFECTO: 5 } }
  );
  assert.ok(validarParametros({ OTRO: 1 }).error);
  assert.ok(validarParametros({ MARGEN_MINIMO: 200 }).error);
  for (const invalido of [undefined, null, {}, [], 'x']) assert.ok(validarParametros(invalido).error);
});

test('resolverParametros: sin filas quedan los valores por defecto y el resto sin definir', () => {
  const p = resolverParametros([]);
  assert.deepEqual(p.MARGEN_MINIMO, { valor: null, definido: false, esDefecto: false, actualizadoPor: '', actualizadoEn: '' });
  assert.equal(p.MIN_CASOS_ANALOGA.valor, 3);
  assert.equal(p.MIN_CASOS_ANALOGA.esDefecto, true);
  assert.equal(p.GARANTIA_MESES_DEFECTO.valor, 6);
});

test('resolverParametros: usa lo guardado, con quién y cuándo, y descarta lo inválido', () => {
  const p = resolverParametros([
    { clave: 'MARGEN_MINIMO', valor: '22.5', actualizadoPor: 'Beto', actualizadoEn: '2026-11-05T10:00:00.000Z' },
    { clave: 'MIN_CASOS_ANALOGA', valor: '5', actualizadoPor: 'Beto', actualizadoEn: '2026-11-05T10:00:00.000Z' },
    // Editado a mano en el Excel con un valor imposible: se ignora y vuelve el valor por defecto.
    { clave: 'GARANTIA_MESES_DEFECTO', valor: '12', actualizadoPor: 'Beto', actualizadoEn: '' },
    { clave: 'TASA_IMPREVISTOS', valor: '', actualizadoPor: 'Beto', actualizadoEn: '' },
  ]);
  assert.equal(p.MARGEN_MINIMO.valor, 22.5);
  assert.equal(p.MARGEN_MINIMO.definido, true);
  assert.equal(p.MARGEN_MINIMO.actualizadoPor, 'Beto');
  assert.equal(p.MIN_CASOS_ANALOGA.valor, 5);
  assert.equal(p.MIN_CASOS_ANALOGA.esDefecto, false);
  assert.equal(p.GARANTIA_MESES_DEFECTO.valor, 6);
  assert.equal(p.GARANTIA_MESES_DEFECTO.definido, false);
  assert.equal(p.TASA_IMPREVISTOS.valor, null);
});

test('resolverParametros: si una clave está repetida gana la última fila', () => {
  const p = resolverParametros([
    { clave: 'MARGEN_MINIMO', valor: '10' },
    { clave: 'MARGEN_MINIMO', valor: '15' },
  ]);
  assert.equal(p.MARGEN_MINIMO.valor, 15);
});

test('valoresEfectivos deja solo los números', () => {
  const valores = valoresEfectivos(resolverParametros([{ clave: 'TASA_IMPREVISTOS', valor: '5' }]));
  assert.deepEqual(valores, {
    MARGEN_MINIMO: null,
    TASA_IMPREVISTOS: 5,
    TOLERANCIA_DESVIACION: null,
    MIN_CASOS_ANALOGA: 3,
    GARANTIA_MESES_DEFECTO: 6,
  });
});
