// Reglas de la limpieza de servicios (solo lógica, sin acceso al Excel, para poder probarla). La usa scripts/borrarServicios.js.
//
// "Empezar de cero" vacía todo lo que genera el recorrido de un servicio, de la solicitud a la rentabilidad. Se conservan los
// datos maestros (usuarios, clientes, técnicos y sus precios) y las reglas del jefe (tarifario y parámetros), y en
// resumenProceso los servicios históricos que se importaron por CSV, que son la base del método análogo y del tablero.

const { texto } = require('./hojasUtils');

const esHistorico = fila => texto(fila.origen).toUpperCase() === 'HISTORICO';

// Hojas que se vacían. `conservar` decide qué filas se salvan (por defecto, ninguna).
const HOJAS_DE_SERVICIOS = [
  { titulo: 'solicitudes' },
  { titulo: 'solicitudTecnicos' },
  { titulo: 'ofertas' },
  { titulo: 'visitasTecnicas' },
  { titulo: 'visitasProgramadas' },
  { titulo: 'cotizaciones' },
  { titulo: 'itemsCotizacion' },
  { titulo: 'items' },
  { titulo: 'detalleImpresora' },
  { titulo: 'inductoresCosto' },
  { titulo: 'estimacionesCosto' },
  { titulo: 'ajustesCosto' },
  { titulo: 'costosReales' },
  { titulo: 'resumenProceso', conservar: esHistorico, queSeConserva: 'los servicios históricos (origen HISTORICO)' },
  { titulo: 'evidencias' },
  { titulo: 'notificaciones' },
];

// Lo que nunca se toca; el script lo muestra para que se vea qué queda.
const HOJAS_CONSERVADAS = ['usuarios', 'clientes', 'tecnicos', 'preciosAire', 'tarifario', 'parametrosCosto'];

// Reparte las filas de una hoja entre las que se borran y las que se conservan.
//   filas: [{ rowNumber, datos }] con `datos` = objeto columna -> valor
//   incluirHistoricos: true borra también lo que la hoja conservaría (los servicios históricos)
function repartirFilas(definicion, filas, { incluirHistoricos = false } = {}) {
  const conservar = incluirHistoricos ? () => false : (definicion.conservar ?? (() => false));
  const borrar = [];
  const conservadas = [];
  for (const fila of filas) (conservar(fila.datos) ? conservadas : borrar).push(fila);
  return { borrar, conservadas };
}

// CSV que Excel abre bien: comillas dobles cuando hace falta y saltos de línea de Windows.
function celdaCsv(valor) {
  const t = String(valor ?? '');
  return /[",;\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function aCsv(encabezados, filas) {
  const lineas = [encabezados.map(celdaCsv).join(',')];
  for (const fila of filas) lineas.push(encabezados.map(columna => celdaCsv(fila[columna])).join(','));
  return lineas.join('\r\n') + '\r\n';
}

// Nombre de carpeta del respaldo: 2026-11-16_1530
function nombreDeRespaldo(fecha = new Date()) {
  const dos = n => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}_${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
}

module.exports = { HOJAS_DE_SERVICIOS, HOJAS_CONSERVADAS, esHistorico, repartirFilas, celdaCsv, aCsv, nombreDeRespaldo };
