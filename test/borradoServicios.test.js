const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HOJAS_DE_SERVICIOS,
  HOJAS_CONSERVADAS,
  repartirFilas,
  celdaCsv,
  aCsv,
  nombreDeRespaldo,
} = require('../services/borradoServicios');
const { ejecutar } = require('../scripts/borrarServicios');

test('la limpieza nunca incluye los datos maestros ni las reglas del jefe', () => {
  const vaciadas = HOJAS_DE_SERVICIOS.map(h => h.titulo);
  for (const protegida of HOJAS_CONSERVADAS) assert.ok(!vaciadas.includes(protegida), protegida);
  assert.deepEqual(HOJAS_CONSERVADAS, ['usuarios', 'clientes', 'tecnicos', 'preciosAire', 'tarifario', 'parametrosCosto']);
  for (const necesaria of ['solicitudes', 'ofertas', 'visitasTecnicas', 'cotizaciones', 'estimacionesCosto', 'costosReales', 'resumenProceso', 'notificaciones']) {
    assert.ok(vaciadas.includes(necesaria), necesaria);
  }
});

test('repartirFilas: todo se borra salvo lo que la hoja manda conservar (los históricos de resumenProceso)', () => {
  const filas = [
    { rowNumber: 2, datos: { origen: 'SISTEMA' } },
    { rowNumber: 3, datos: { origen: 'HISTORICO' } },
    { rowNumber: 4, datos: { origen: '' } },
    { rowNumber: 5, datos: { origen: ' historico ' } },
  ];
  const resumen = HOJAS_DE_SERVICIOS.find(h => h.titulo === 'resumenProceso');
  const { borrar, conservadas } = repartirFilas(resumen, filas);
  assert.deepEqual(borrar.map(f => f.rowNumber), [2, 4]);
  assert.deepEqual(conservadas.map(f => f.rowNumber), [3, 5]);

  const otra = repartirFilas({ titulo: 'ofertas' }, filas);
  assert.equal(otra.borrar.length, 4);
  assert.equal(otra.conservadas.length, 0);
});

test('aCsv: comillas, separadores y saltos de línea no rompen el archivo', () => {
  assert.equal(celdaCsv('simple'), 'simple');
  assert.equal(celdaCsv('a,b'), '"a,b"');
  assert.equal(celdaCsv('dice "hola"'), '"dice ""hola"""');
  assert.equal(celdaCsv('línea 1\nlínea 2'), '"línea 1\nlínea 2"');
  assert.equal(celdaCsv(undefined), '');
  assert.equal(aCsv(['id', 'nota'], [{ id: 1, nota: 'x,y' }, { id: 2 }]), 'id,nota\r\n1,"x,y"\r\n2,\r\n');
});

test('nombreDeRespaldo: fecha y hora', () => {
  assert.equal(nombreDeRespaldo(new Date(2026, 10, 16, 9, 5)), '2026-11-16_0905');
});

// --- El script completo, con un libro simulado ---------------------------------------------------------------------------

// Una hoja que se comporta como la de la librería: filas con número (el encabezado es la 1), lectura, limpieza y borrado.
function hojaFalsa(titulo, encabezados, filas) {
  const hoja = {
    title: titulo,
    headerValues: encabezados,
    filas: [],
    llamadas: [],
    loadHeaderRow: async () => {},
    getRows: async () => hoja.filas.map((datos, i) => ({ rowNumber: i + 2, get: c => datos[c] })),
    clearRows: async () => { hoja.llamadas.push('clearRows'); hoja.filas.length = 0; },
    deleteRows: async (inicio, fin) => { hoja.llamadas.push(`deleteRows ${inicio}-${fin}`); hoja.filas.splice(inicio - 1, fin - inicio); },
  };
  hoja.filas.push(...filas);
  return hoja;
}

function libro() {
  return {
    title: 'SECC Minforsac',
    sheetsByTitle: {
      solicitudes: hojaFalsa('solicitudes', ['solicitudId', 'descripcion'], [{ solicitudId: 1, descripcion: 'Aire, oficina' }, { solicitudId: 2, descripcion: 'Red' }]),
      ofertas: hojaFalsa('ofertas', ['ofertaId'], []),
      resumenProceso: hojaFalsa('resumenProceso', ['resumenId', 'origen'], [
        { resumenId: 1, origen: 'HISTORICO' },
        { resumenId: 2, origen: 'SISTEMA' },
        { resumenId: 3, origen: 'SISTEMA' },
        { resumenId: 4, origen: 'HISTORICO' },
      ]),
      clientes: hojaFalsa('clientes', ['clienteId'], [{ clienteId: 1 }]),
      tarifario: hojaFalsa('tarifario', ['tarifaId'], [{ tarifaId: 1 }]),
    },
  };
}

const callado = () => {};

test('simulacro: no pregunta, no respalda y no borra nada', async () => {
  const doc = libro();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  const resultado = await ejecutar({
    doc, confirmado: false, carpetaBase: carpeta, log: callado,
    preguntar: async () => assert.fail('no debe preguntar en un simulacro'),
  });
  assert.equal(resultado.borradas, 0);
  assert.equal(doc.sheetsByTitle.solicitudes.filas.length, 2);
  assert.deepEqual(fs.readdirSync(carpeta), []);
});

test('un nombre de libro equivocado cancela todo', async () => {
  const doc = libro();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  const resultado = await ejecutar({ doc, confirmado: true, carpetaBase: carpeta, log: callado, preguntar: async () => 'otro libro' });
  assert.equal(resultado.borradas, 0);
  assert.equal(doc.sheetsByTitle.solicitudes.filas.length, 2);
  assert.deepEqual(fs.readdirSync(carpeta), []);
});

test('confirmado: respalda cada hoja, vacía las de servicios y conserva históricos, clientes y tarifas', async () => {
  const doc = libro();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  const resultado = await ejecutar({
    doc, confirmado: true, carpetaBase: carpeta, ahora: new Date(2026, 10, 16, 15, 30), log: callado,
    preguntar: async () => ' SECC Minforsac ',
  });

  assert.equal(resultado.borradas, 4);
  const { solicitudes, ofertas, resumenProceso, clientes, tarifario } = doc.sheetsByTitle;

  // Hoja sin nada que conservar: se limpia de una vez
  assert.equal(solicitudes.filas.length, 0);
  assert.deepEqual(solicitudes.llamadas, ['clearRows']);
  assert.deepEqual(ofertas.llamadas, [], 'una hoja vacía no se toca');

  // resumenProceso: quedan solo los históricos; los del sistema se borran en un rango (filas 3 y 4 de la hoja)
  assert.deepEqual(resumenProceso.filas.map(f => f.resumenId), [1, 4]);
  assert.deepEqual(resumenProceso.llamadas, ['deleteRows 2-4']);

  // Lo demás queda intacto
  assert.equal(clientes.filas.length, 1);
  assert.equal(tarifario.filas.length, 1);

  // Respaldo con las filas originales (también las conservadas), en UTF-8 con BOM
  const carpetaRespaldo = path.join(carpeta, '2026-11-16_1530');
  assert.deepEqual(fs.readdirSync(carpetaRespaldo).sort(), ['resumenProceso.csv', 'solicitudes.csv']);
  const csv = fs.readFileSync(path.join(carpetaRespaldo, 'solicitudes.csv'), 'utf8');
  assert.equal(csv, '﻿solicitudId,descripcion\r\n1,"Aire, oficina"\r\n2,Red\r\n');
  assert.match(fs.readFileSync(path.join(carpetaRespaldo, 'resumenProceso.csv'), 'utf8'), /1,HISTORICO[\s\S]*2,SISTEMA[\s\S]*3,SISTEMA[\s\S]*4,HISTORICO/);
});

test('si el respaldo falla no se borra nada', async () => {
  const doc = libro();
  // Una "carpeta base" que en realidad es un archivo: crear el respaldo falla
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resp-')), 'no-es-carpeta');
  fs.writeFileSync(archivo, 'x');
  await assert.rejects(ejecutar({ doc, confirmado: true, carpetaBase: archivo, log: callado, preguntar: async () => 'SECC Minforsac' }));
  assert.equal(doc.sheetsByTitle.solicitudes.filas.length, 2);
  assert.equal(doc.sheetsByTitle.resumenProceso.filas.length, 4);
});

test('repetirlo no hace nada: sin servicios que borrar no pregunta ni respalda', async () => {
  const doc = libro();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  const opciones = { doc, confirmado: true, carpetaBase: carpeta, log: callado, preguntar: async () => 'SECC Minforsac' };
  await ejecutar(opciones);
  const segunda = await ejecutar({ ...opciones, preguntar: async () => assert.fail('no debe preguntar') });
  assert.equal(segunda.borradas, 0);
});
