const test = require('node:test');
const assert = require('node:assert/strict');
const { borrarFilas } = require('../services/hojasUtils');

// Hoja que anota los rangos que se le piden borrar (índices desde 0, final excluido, como la API de Sheets)
const hojaQueAnota = () => {
  const hoja = { rangos: [] };
  hoja.deleteRows = async (inicio, fin) => { hoja.rangos.push([inicio, fin]); };
  return hoja;
};
const filas = (...numeros) => numeros.map(rowNumber => ({ rowNumber }));

test('borrarFilas: una sola fila es un rango de un elemento (la fila 2 es el índice 1)', async () => {
  const hoja = hojaQueAnota();
  await borrarFilas(hoja, filas(2));
  assert.deepEqual(hoja.rangos, [[1, 2]]);
});

test('borrarFilas: las filas consecutivas se borran en una sola llamada', async () => {
  const hoja = hojaQueAnota();
  await borrarFilas(hoja, filas(5, 6, 7, 8));
  assert.deepEqual(hoja.rangos, [[4, 8]]);
});

test('borrarFilas: las separadas se borran de abajo hacia arriba para no correr los números de fila', async () => {
  const hoja = hojaQueAnota();
  await borrarFilas(hoja, filas(3, 10, 4, 11, 12, 20));
  assert.deepEqual(hoja.rangos, [[19, 20], [9, 12], [2, 4]]);
});

test('borrarFilas: ignora repetidas y no hace nada sin filas', async () => {
  const hoja = hojaQueAnota();
  await borrarFilas(hoja, filas(6, 6, 7));
  assert.deepEqual(hoja.rangos, [[5, 7]]);

  const vacia = hojaQueAnota();
  await borrarFilas(vacia, []);
  assert.deepEqual(vacia.rangos, []);
});
