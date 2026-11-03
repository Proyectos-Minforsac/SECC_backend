const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GARANTIA_MESES_DEFECTO,
  esGarantiaValida,
  garantiaGuardada,
} = require('../services/garantia');

test('la garantía válida es un entero de 4 a 6 meses', () => {
  for (const meses of [4, 5, 6]) assert.equal(esGarantiaValida(meses), true);
  for (const meses of [3, 7, 12, 5.5, '5', null, undefined, NaN]) assert.equal(esGarantiaValida(meses), false);
});

test('garantiaGuardada devuelve lo guardado si es válido', () => {
  assert.equal(garantiaGuardada('4'), 4);
  assert.equal(garantiaGuardada(' 5 '), 5);
  assert.equal(garantiaGuardada(6), 6);
});

test('garantiaGuardada usa el valor por defecto cuando falta o no es válido', () => {
  for (const guardado of ['', undefined, null, 'abc', '12', '3']) {
    assert.equal(garantiaGuardada(guardado), GARANTIA_MESES_DEFECTO);
  }
});

test('garantiaGuardada usa la garantía por defecto que fijó el jefe, si es válida', () => {
  assert.equal(garantiaGuardada('', 4), 4);
  assert.equal(garantiaGuardada(undefined, 5), 5);
  // Lo guardado en el servicio manda sobre el valor por defecto.
  assert.equal(garantiaGuardada('6', 4), 6);
  // Un valor por defecto inválido no se usa.
  for (const invalido of [null, undefined, 12, 3, 'x']) assert.equal(garantiaGuardada('', invalido), GARANTIA_MESES_DEFECTO);
});
