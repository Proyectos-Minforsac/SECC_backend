// Borra todos los servicios hechos hasta ahora para empezar de cero con el proceso completo: solicitudes, ofertas, visitas,
// cotizaciones, estimaciones, costos reales, resúmenes y avisos. Los ids vuelven a empezar en 1.
//
// Se conservan: usuarios, clientes, técnicos y sus precios, el tarifario, los parámetros de costo, los servicios históricos
// importados por CSV (resumenProceso con origen HISTORICO) y los archivos de Google Drive (no se tocan).
//
//   npm run servicios:borrar               simulacro: muestra qué se borraría y no cambia nada
//   npm run servicios:borrar -- --confirmar  guarda un respaldo en CSV y borra (pide escribir el nombre del libro)
//   npm run servicios:borrar -- --confirmar --nombre="Nombre del libro"   lo mismo sin teclado: el nombre hace de confirmación
//
//   --incluir-historicos   borra también los servicios históricos (resumenProceso con origen HISTORICO), p. ej. para
//                          reemplazarlos por históricos reales. Se puede combinar con --confirmar.
//
// Antes de borrar siempre se guarda un respaldo de cada hoja en respaldos/AAAA-MM-DD_HHMM/. Si el respaldo falla, no se borra
// nada. Con el servidor encendido, reinícialo después: guarda las filas en memoria unos segundos.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { HOJAS_DE_SERVICIOS, HOJAS_CONSERVADAS, repartirFilas, aCsv, nombreDeRespaldo } = require('../services/borradoServicios');
const { borrarFilas } = require('../services/hojasUtils');

// Lee cada hoja y reparte sus filas entre las que se borran y las que se conservan.
async function planificar(doc, opciones = {}) {
  const plan = [];
  for (const definicion of HOJAS_DE_SERVICIOS) {
    const hoja = doc.sheetsByTitle[definicion.titulo];
    if (!hoja) {
      plan.push({ definicion, hoja: null, encabezados: [], filas: [], borrar: [], conservadas: [] });
      continue;
    }
    await hoja.loadHeaderRow();
    const encabezados = [...hoja.headerValues];
    // Lectura directa de la hoja (con opciones, la librería no usa el caché)
    const filas = (await hoja.getRows({ offset: 0 })).map(fila => ({
      rowNumber: fila.rowNumber,
      datos: Object.fromEntries(encabezados.map(columna => [columna, fila.get(columna)])),
    }));
    plan.push({ definicion, hoja, encabezados, filas, ...repartirFilas(definicion, filas, opciones) });
  }
  return plan;
}

function mostrarPlan(plan, log) {
  log('');
  log('Hoja'.padEnd(22) + 'Filas'.padStart(7) + 'Se borran'.padStart(11) + 'Se conservan'.padStart(14));
  for (const { definicion, hoja, filas, borrar, conservadas } of plan) {
    if (!hoja) {
      log(`${definicion.titulo.padEnd(22)}  (no existe en el libro: se omite)`);
      continue;
    }
    const nota = conservadas.length > 0 ? `  ← ${definicion.queSeConserva}` : '';
    log(definicion.titulo.padEnd(22) + String(filas.length).padStart(7) + String(borrar.length).padStart(11) + String(conservadas.length).padStart(14) + nota);
  }
  log('');
  log(`No se tocan: ${HOJAS_CONSERVADAS.join(', ')} y los archivos de Google Drive.`);
}

// Un CSV por hoja con todas sus filas tal como estaban, antes de borrar nada.
function guardarRespaldo(plan, carpetaBase, ahora) {
  const carpeta = path.join(carpetaBase, nombreDeRespaldo(ahora));
  fs.mkdirSync(carpeta, { recursive: true });
  const guardados = [];
  for (const { definicion, hoja, encabezados, filas } of plan) {
    if (!hoja || filas.length === 0) continue;
    const archivo = path.join(carpeta, `${definicion.titulo}.csv`);
    // BOM: Excel abre el CSV en UTF-8 y respeta las tildes
    fs.writeFileSync(archivo, '﻿' + aCsv(encabezados, filas.map(f => f.datos)), 'utf8');
    if (!fs.existsSync(archivo)) throw new Error(`No se pudo guardar el respaldo ${archivo}`);
    guardados.push(archivo);
  }
  return { carpeta, guardados };
}

// `preguntar(texto)` devuelve lo que escribe la persona; se recibe como parámetro para poder probar el script sin teclado.
async function ejecutar({ doc, confirmado, preguntar, carpetaBase, ahora = new Date(), log = console.log, incluirHistoricos = false }) {
  const plan = await planificar(doc, { incluirHistoricos });
  mostrarPlan(plan, log);

  const aBorrar = plan.reduce((total, p) => total + p.borrar.length, 0);
  if (aBorrar === 0) {
    log('No hay servicios que borrar.');
    return { borradas: 0, respaldo: null };
  }
  if (!confirmado) {
    const opcion = incluirHistoricos ? ' --incluir-historicos' : '';
    log(`Simulacro: se borrarían ${aBorrar} filas. Para hacerlo: npm run servicios:borrar -- --confirmar${opcion}`);
    return { borradas: 0, respaldo: null };
  }

  const nombre = String(doc.title ?? '').trim();
  const respuesta = await preguntar(`Se borrarán ${aBorrar} filas. Para confirmar, escribe el nombre del libro (${nombre}): `);
  if (respuesta.trim() !== nombre) {
    log('El nombre no coincide: no se borró nada.');
    return { borradas: 0, respaldo: null };
  }

  const respaldo = guardarRespaldo(plan, carpetaBase, ahora);
  log(`Respaldo guardado en ${respaldo.carpeta} (${respaldo.guardados.length} archivos).`);

  for (const { definicion, hoja, borrar, conservadas } of plan) {
    if (!hoja || borrar.length === 0) continue;
    // Si no se conserva ninguna fila se limpia el contenido (así no falla con el encabezado inmovilizado); si se conserva
    // alguna, se borran solo las demás, en rangos de abajo hacia arriba.
    if (conservadas.length === 0) await hoja.clearRows();
    else await borrarFilas(hoja, borrar);
    log(`  ${definicion.titulo}: ${borrar.length} filas borradas`);
  }

  log(`Listo: ${aBorrar} filas borradas. Reinicia el servidor si estaba encendido.`);
  return { borradas: aBorrar, respaldo };
}

module.exports = { planificar, guardarRespaldo, ejecutar };

if (require.main === module) {
  (async () => {
    const confirmado = process.argv.includes('--confirmar');
    const conNombre = process.argv.find(argumento => argumento.startsWith('--nombre='));
    if (confirmado && !conNombre && !process.stdin.isTTY) {
      console.error('Para confirmar hay que escribir el nombre del libro: ejecútalo desde una terminal o pasa --nombre="Nombre del libro".');
      process.exit(1);
    }

    const { conectar } = require('../services/sheetsService');
    const doc = await conectar();
    const preguntar = conNombre ? async () => conNombre.slice('--nombre='.length) : texto =>
      new Promise(resolver => {
        const lector = readline.createInterface({ input: process.stdin, output: process.stdout });
        lector.question(texto, respuesta => {
          lector.close();
          resolver(respuesta);
        });
      });

    const incluirHistoricos = process.argv.includes('--incluir-historicos');
    await ejecutar({ doc, confirmado, preguntar, incluirHistoricos, carpetaBase: path.resolve(__dirname, '../respaldos') });
    process.exit(0);
  })().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
