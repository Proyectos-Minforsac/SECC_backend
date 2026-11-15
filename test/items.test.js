const test = require('node:test');
const assert = require('node:assert/strict');
const { validarItems } = require('../services/items');

const producto = extra => ({ tipo: 'Producto', nombre: 'Split', cantidad: 2, precioUnitario: 182, costoUnitario: 100, ...extra });
const mensaje = items => validarItems(items).error;

test('validarItems: un ítem correcto entra normalizado (acepta precio o precioUnitario)', () => {
  const { items, error } = validarItems([producto({ nombre: '  Split  ' }), { tipo: 'Alquiler', nombre: 'Andamio', cantidad: 1, precio: 50.5 }]);
  assert.equal(error, undefined);
  assert.equal(items[0].nombre, 'Split');
  assert.equal(items[1].precioUnitario, 50.5);
  assert.equal(items[1].orden, 1);
});

test('validarItems: sin tipo el ítem no entra, y tampoco con un tipo que no existe', () => {
  assert.match(mensaje([producto({ tipo: '' })]), /no tiene tipo/);
  assert.match(mensaje([producto({ tipo: undefined })]), /no tiene tipo/);
  assert.match(mensaje([producto({ tipo: 'Regalo' })]), /tipo que no es válido/);
});

test('validarItems: un ítem sin cantidad ni precio ya no se convierte en título: se rechaza', () => {
  assert.match(mensaje([producto({ cantidad: 0, precioUnitario: 0 })]), /mayores que 0/);
  assert.match(mensaje([producto({ cantidad: '', precioUnitario: '' })]), /mayores que 0/);
  assert.match(mensaje([producto({ cantidad: 0 })]), /mayores que 0/);
  assert.match(mensaje([producto({ precioUnitario: 0 })]), /mayores que 0/);
});

test('validarItems: el precio lleva como máximo 2 decimales', () => {
  assert.equal(mensaje([producto({ precioUnitario: 182.5 })]), undefined);
  assert.match(mensaje([producto({ precioUnitario: 182.555 })]), /2 decimales/);
});

test('validarItems: los ítems Servicio y Título de cotizaciones anteriores se siguen aceptando al corregirlas', () => {
  const { items, error } = validarItems([
    { tipo: 'Título', nombre: 'Sección', cantidad: 0, precioUnitario: 0 },
    { tipo: 'Servicio', nombre: 'Instalación', cantidad: 1, precioUnitario: 300 },
  ]);
  assert.equal(error, undefined);
  assert.equal(items.length, 2);
});

test('validarItems: una impresora trae sus detalles; hace falta al menos un ítem con nombre', () => {
  assert.match(mensaje([{ tipo: 'Impresora', nombre: 'HP', cantidad: 1, precioUnitario: 900 }]), /no trae detalles/);
  assert.match(mensaje([]), /al menos un ítem/);
  assert.match(mensaje([producto({ nombre: '  ' })]), /no tiene nombre/);
});
