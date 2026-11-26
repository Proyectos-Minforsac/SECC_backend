const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, normalizar, siguienteId, cargarEncabezados, exigirColumnas } = require('../services/hojasUtils');
const { AMBITO, validarArchivo, exigirCupo, armarEvidencia, evidenciasDe } = require('../services/evidencias');
const driveService = require('../services/driveService');
const solicitudModel = require('./solicitudModel');

// Evidencias (imágenes, PDF y Word) que el técnico adjunta al diagnóstico o al avance de una visita. El archivo vive en Drive,
// dentro de la carpeta del servicio:
//   Clientes/<Cliente>/Servicio N° X - <fecha>/Evidencias/Diagnóstico/
//   Clientes/<Cliente>/Servicio N° X - <fecha>/Evidencias/Visita N° <id>/
// y la hoja `evidencias` guarda quién lo subió, cuándo y su id en Drive. Se suben antes de guardar el texto del diagnóstico
// o del avance: mientras ese diagnóstico o visita no esté registrado, el técnico puede agregar y quitar archivos.

const COLUMNAS = ['evidenciaId', 'visitaId', 'visitaProgramadaId', 'ambito', 'nombre', 'tipo', 'archivoId', 'subidoPor', 'subidoEn'];
const CARPETA_EVIDENCIAS = 'Evidencias';

function exigirHoja(doc, nombre) {
  const hoja = doc.sheetsByTitle[nombre];
  if (!hoja) throw new Error(`No existe la hoja "${nombre}" en el Excel (npm run hojas:preparar la crea)`);
  return hoja;
}

async function cargarDatos() {
  const doc = await conectar();
  const hojas = {
    evidencias: exigirHoja(doc, 'evidencias'),
    visitas: exigirHoja(doc, 'visitasTecnicas'),
    programadas: exigirHoja(doc, 'visitasProgramadas'),
    tecnicos: exigirHoja(doc, 'tecnicos'),
  };
  const [evidencias, visitas, programadas, tecnicos] = await Promise.all([
    hojas.evidencias.getRows(),
    hojas.visitas.getRows(),
    hojas.programadas.getRows(),
    hojas.tecnicos.getRows(),
  ]);
  return { hojas, filas: { evidencias, visitas, programadas, tecnicos } };
}

// El destino de una evidencia: el diagnóstico de un servicio o una de sus visitas programadas. Comprueba que exista, que el
// servicio siga abierto, que aún admita archivos y que quien sube sea el técnico del servicio.
function resolverDestino(datos, { visitaId, visitaProgramadaId }, usuario) {
  const visita = datos.filas.visitas.find(f => mismoId(f.get('visitaId'), visitaId));
  if (!visita) throw errorHttp(404, 'Visita técnica no encontrada');
  if (texto(visita.get('cierreFecha'))) throw errorHttp(409, 'El servicio ya fue cerrado');
  if (texto(visita.get('estado')) === 'CANCELADA') throw errorHttp(409, 'El servicio fue cancelado');

  if (usuario?.rol === 'tecnico') {
    const tecnico = datos.filas.tecnicos.find(f => mismoId(f.get('tecnicoId'), visita.get('tecnicoId')));
    // La hoja de técnicos guarda el nombre completo, no el nombre de usuario
    if (!tecnico || normalizar(tecnico.get('nombre')) !== normalizar(usuario.nombreCompleto)) {
      throw errorHttp(403, 'Este servicio no está asignado a tu usuario');
    }
  }

  if (visitaProgramadaId === undefined || visitaProgramadaId === null) {
    if (texto(visita.get('estado')) !== 'AUTORIZADA') throw errorHttp(409, 'El diagnóstico de esta visita ya fue registrado');
    return { ambito: AMBITO.DIAGNOSTICO, visita, visitaProgramadaId: '', subcarpeta: 'Diagnóstico' };
  }

  const programada = datos.filas.programadas.find(f => mismoId(f.get('visitaProgramadaId'), visitaProgramadaId));
  if (!programada) throw errorHttp(404, 'Visita programada no encontrada');
  if (!mismoId(programada.get('visitaId'), visitaId)) throw errorHttp(400, 'La visita no pertenece a ese servicio');
  if (texto(programada.get('completadaEn'))) throw errorHttp(409, 'Esta visita ya fue completada');
  if (texto(visita.get('estado')) !== 'ACTIVO') throw errorHttp(409, 'El servicio todavía no está activo');
  return { ambito: AMBITO.AVANCE, visita, visitaProgramadaId: texto(visitaProgramadaId), subcarpeta: `Visita N° ${texto(visitaProgramadaId)}` };
}

const destinoDeFila = fila => ({
  visitaId: texto(fila.get('visitaId')),
  visitaProgramadaId: texto(fila.get('ambito')) === AMBITO.AVANCE ? texto(fila.get('visitaProgramadaId')) : undefined,
});

// Sube un archivo del técnico a la carpeta del servicio y lo registra. El archivo se sube a Drive antes de escribir la hoja: si
// la subida falla no queda una evidencia sin archivo.
//   entrada: { visitaId, visitaProgramadaId?, nombre, tipo, contenidoBase64 }
async function subirEvidencia(entrada, usuario) {
  console.log('Modelo: subiendo una evidencia de la visita', entrada.visitaId, entrada.visitaProgramadaId ?? '(diagnóstico)');

  const archivo = validarArchivo(entrada);
  const datos = await cargarDatos();
  const destino = resolverDestino(datos, entrada, usuario);

  const existentes = evidenciasDe(datos.filas.evidencias, {
    ambito: destino.ambito,
    visitaId: entrada.visitaId,
    visitaProgramadaId: destino.visitaProgramadaId,
  });
  exigirCupo(existentes.length);

  await cargarEncabezados(datos.hojas.evidencias);
  exigirColumnas(datos.hojas.evidencias, COLUMNAS, 'evidencias');

  const evidenciaId = siguienteId(datos.filas.evidencias, 'evidenciaId');
  const { carpetaId: carpetaServicio } = await solicitudModel.getCarpetaServicio(destino.visita.get('solicitudId'));
  const { carpetaId: carpetaEvidencias } = await driveService.buscarOCrearCarpeta(CARPETA_EVIDENCIAS, carpetaServicio);
  const { carpetaId } = await driveService.buscarOCrearCarpeta(destino.subcarpeta, carpetaEvidencias);
  // El número delante evita que dos archivos con el mismo nombre se pisen en la carpeta
  const archivoId = await driveService.subirArchivo(carpetaId, `${evidenciaId} - ${archivo.nombre}`, archivo.tipo, archivo.contenido);

  const fila = await datos.hojas.evidencias.addRow({
    evidenciaId,
    visitaId: texto(entrada.visitaId),
    visitaProgramadaId: destino.visitaProgramadaId,
    ambito: destino.ambito,
    nombre: archivo.nombre,
    tipo: archivo.tipo,
    archivoId,
    subidoPor: usuario?.nombre ?? '',
    subidoEn: new Date().toISOString(),
  }, { raw: true });

  return armarEvidencia(fila);
}

// Quita una evidencia mientras su diagnóstico o visita aún no esté registrado. El archivo va a la papelera de Drive
// (recuperable), sin bloquear: la hoja es la fuente de verdad.
async function quitarEvidencia(evidenciaId, usuario) {
  console.log('Modelo: quitando la evidencia', evidenciaId);

  const datos = await cargarDatos();
  const fila = datos.filas.evidencias.find(f => mismoId(f.get('evidenciaId'), evidenciaId));
  if (!fila) throw errorHttp(404, 'Evidencia no encontrada');

  resolverDestino(datos, destinoDeFila(fila), usuario);
  const archivoId = texto(fila.get('archivoId'));
  await fila.delete();

  try {
    if (archivoId) await driveService.enviarArchivoAPapelera(archivoId);
  } catch (error) {
    console.error('Modelo: no se pudo enviar a la papelera el archivo', archivoId, error.message);
  }
  return { evidenciaId: Number(evidenciaId) };
}

// Datos para servir el archivo: su id en Drive y su nombre.
async function getArchivo(evidenciaId) {
  const datos = await cargarDatos();
  const fila = datos.filas.evidencias.find(f => mismoId(f.get('evidenciaId'), evidenciaId));
  if (!fila) throw errorHttp(404, 'Evidencia no encontrada');

  const archivoId = texto(fila.get('archivoId'));
  if (!archivoId) throw errorHttp(404, 'La evidencia no tiene archivo');
  return { archivoId, nombre: texto(fila.get('nombre')), tipo: texto(fila.get('tipo')) };
}

module.exports = { COLUMNAS, subirEvidencia, quitarEvidencia, getArchivo };
