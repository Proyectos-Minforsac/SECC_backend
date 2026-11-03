const test = require('node:test');
const assert = require('node:assert/strict');
const { leerFilas, detectarSeparador, leerNumero, leerFecha, leerHistorico, aFilaResumen } = require('../services/historico');

const TIPOS = ['Aire Condicionado', 'Cableado estructurado'];

test('detectarSeparador: el que más aparece en el encabezado', () => {
  assert.equal(detectarSeparador('a;b;c\n1;2;3'), ';');
  assert.equal(detectarSeparador('a,b,c\n1,2,3'), ',');
  assert.equal(detectarSeparador('a\tb\tc'), '\t');
  assert.equal(detectarSeparador('solo'), ';');
  assert.equal(detectarSeparador('﻿a,b,c'), ',');
});

test('leerFilas: comillas, separadores dentro de un campo, saltos de línea y líneas vacías', () => {
  const filas = leerFilas('a;b;c\r\n"x;y";"dice ""hola""";"línea 1\nlínea 2"\r\n\r\n1;2;3\n', ';');
  assert.deepEqual(filas.map(f => f.campos), [['a', 'b', 'c'], ['x;y', 'dice "hola"', 'línea 1\nlínea 2'], ['1', '2', '3']]);
  assert.deepEqual(filas.map(f => f.linea), [1, 2, 5], 'el número de línea es el del archivo, contando saltos dentro de comillas');
});

test('leerNumero: puntos, comas, miles y símbolos', () => {
  const casos = { '1234.5': 1234.5, '1,234.50': 1234.5, '1.234,50': 1234.5, '1234,5': 1234.5, '1,234': 1234, 'S/ 1 234.50': 1234.5, '  900 ': 900, '0': 0 };
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(leerNumero(entrada), esperado, entrada);
  assert.equal(leerNumero(''), null);
  assert.equal(leerNumero(undefined), null);
  assert.ok(Number.isNaN(leerNumero('mucho')));
});

test('leerFecha: ISO y dd/mm/aaaa, solo fechas reales', () => {
  assert.equal(leerFecha('2025-03-14'), '2025-03-14');
  assert.equal(leerFecha('14/03/2025'), '2025-03-14');
  assert.equal(leerFecha('4-3-2025'), '2025-03-04');
  for (const mala of ['2025-02-30', '31/04/2025', '14/13/2025', 'ayer', '', '2025/03/14']) assert.equal(leerFecha(mala), null, mala);
});

const CSV = [
  'Referencia;Tipo de servicio;Destino;Fecha de cierre;Venta sin IGV;Costo real;Costo estimado;Imprevistos',
  'Oficina Miraflores;aire condicionado;;14/03/2025;4800;3600,50;3000;360',
  'Local Arequipa;Cableado Estructurado;Arequipa;2025-05-02;"2.500,00";1800;;',
].join('\n');

test('leerHistorico: lee las filas, normaliza el tipo y el destino y reconoce las variantes de los nombres', () => {
  const { filas, errores } = leerHistorico(CSV, { tiposValidos: TIPOS });
  assert.deepEqual(errores, []);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0], {
    linea: 2, referencia: 'Oficina Miraflores', tipoServicio: 'Aire Condicionado', destino: 'GENERAL', fecha: '2025-03-14',
    ventaSoles: 4800, costoReal: 3600.5, costoEstimado: 3000, imprevistos: 360,
  });
  assert.equal(filas[1].tipoServicio, 'Cableado estructurado'); assert.equal(filas[1].destino, 'Arequipa');
  assert.equal(filas[1].ventaSoles, 2500); assert.equal(filas[1].costoEstimado, null); assert.equal(filas[1].imprevistos, null);
});

test('leerHistorico: cada fila mala se reporta con su línea y no se pierde el resto de los errores', () => {
  const malo = [
    'referencia,tipoServicio,fechaCierre,ventaSinIGV,costoReal,imprevistos',
    ',Aire Condicionado,2025-03-14,4800,3000,',
    'A,Impresoras,2025-03-14,4800,3000,',
    'B,Aire Condicionado,31/04/2025,4800,3000,',
    'C,Aire Condicionado,2025-03-14,0,3000,',
    'D,Aire Condicionado,2025-03-14,4800,-5,',
    'E,Aire Condicionado,2025-03-14,4800,3000,4000',
    'F,Aire Condicionado,2025-03-14,4800,3000,100',
    'f,Aire Condicionado,2025-03-14,4800,3000,100',
  ].join('\n');
  const { filas, errores } = leerHistorico(malo, { tiposValidos: TIPOS });
  assert.deepEqual(filas.map(f => f.referencia), ['F']);
  assert.deepEqual(errores.map(e => e.linea), [2, 3, 4, 5, 6, 7, 9]);
  const mensaje = linea => errores.find(e => e.linea === linea).mensaje;
  assert.match(mensaje(2), /falta la referencia/);
  assert.match(mensaje(3), /tipo de servicio «Impresoras» no existe/);
  assert.match(mensaje(4), /fecha de cierre «31\/04\/2025» no es válida/);
  assert.match(mensaje(5), /la venta sin IGV no es válido/);
  assert.match(mensaje(6), /el costo real no es válido/);
  assert.match(mensaje(7), /imprevistos no pueden ser más que el costo real/);
  assert.match(mensaje(9), /está repetida en el archivo/);
});

test('leerHistorico: la fila de ejemplo de la plantilla no se carga por descuido', () => {
  const { filas, errores } = leerHistorico(
    'referencia;tipoServicio;fechaCierre;ventaSinIGV;costoReal\nEJEMPLO (borra esta fila);Aire Condicionado;14/03/2025;4800;3600',
    { tiposValidos: TIPOS }
  );
  assert.deepEqual(filas, []);
  assert.match(errores[0].mensaje, /fila de ejemplo de la plantilla/);
});

test('leerHistorico: archivo vacío o sin las columnas obligatorias', () => {
  assert.match(leerHistorico('', { tiposValidos: TIPOS }).errores[0].mensaje, /vacío/);
  const sinColumnas = leerHistorico('referencia;venta\nA;100', { tiposValidos: TIPOS });
  assert.deepEqual(sinColumnas.filas, []);
  assert.match(sinColumnas.errores[0].mensaje, /Faltan las columnas: tipoServicio, fechaCierre, costoReal/);
});

test('aFilaResumen: márgenes y desviaciones listos, marcado como HISTORICO', () => {
  const { filas } = leerHistorico(CSV, { tiposValidos: TIPOS });
  const completa = aFilaResumen(filas[0], { importadoPor: 'Importación' });
  assert.equal(completa.origen, 'HISTORICO'); assert.equal(completa.referencia, 'Oficina Miraflores');
  assert.equal(completa.margenReal, 24.99); assert.equal(completa.margenEstimado, 37.5); assert.equal(completa.desviacionMargen, -12.51);
  assert.equal(completa.desviacionCosto, 600.5); assert.equal(completa.costoParametrico, ''); assert.equal(completa.costoAnalogo, '');
  assert.equal(completa.cerradoEn, '2025-03-14'); assert.equal(completa.cerradoPor, 'Importación'); assert.equal(completa.visitaId, '');

  // Sin costo estimado no hay desviación
  const sinEstimado = aFilaResumen(filas[1], { importadoPor: 'Importación' });
  assert.equal(sinEstimado.margenReal, 28); assert.equal(sinEstimado.margenEstimado, ''); assert.equal(sinEstimado.desviacionCosto, ''); assert.equal(sinEstimado.desviacionMargen, '');
  assert.equal(sinEstimado.imprevistosReal, '');
});
