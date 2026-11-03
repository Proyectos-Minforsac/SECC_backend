const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, normalizar, siguienteId, exigirColumnas } = require('../services/hojasUtils');

const ROLES = ['trabajador', 'jefe', 'tecnico'];
// Notificaciones que además de mostrarse habilitan una acción rápida (p.ej. "Crear cotización"). Son las que el
// navegador puede crear; las de la validación de costos las crea solo el servidor (ver TIPOS_DE_VALIDACION).
const TIPOS = ['DIAGNOSTICO_COMPLETADO', 'IMPREVISTO_AVISADO', 'GARANTIA_VENCIDA'];
// Avisos de la validación del jefe, con la cotización a la que llevan: "Revisar", "Corregir" y "Ver cotizaciones".
const TIPOS_DE_VALIDACION = ['VALIDACION_PENDIENTE', 'COTIZACION_DEVUELTA', 'COTIZACION_VALIDADA'];

// El rol del trabajador se llamaba 'empleado': las filas guardadas con ese nombre se siguen leyendo como 'trabajador'.
const ROL_ANTERIOR = { empleado: 'trabajador' };
const rolActual = rol => ROL_ANTERIOR[rol] ?? rol;

// El jefe hace también el trabajo del trabajador, así que recibe sus avisos además de los suyos.
const ROLES_QUE_RECIBE = {
  trabajador: ['trabajador'],
  jefe: ['jefe', 'trabajador'],
  tecnico: ['tecnico'],
};

async function cargarHoja() {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['notificaciones'];
  if (!hoja) throw new Error('No existe la hoja "notificaciones" en el Excel (npm run hojas:preparar la crea)');
  return hoja;
}

function armarNotificacion(fila) {
  const notificacion = {
    notificacionId: Number(texto(fila.get('notificacionId'))),
    rolDestino: rolActual(texto(fila.get('rolDestino'))),
    mensaje: texto(fila.get('mensaje')),
    fecha: texto(fila.get('fecha')),
    leida: texto(fila.get('leida')) === 'TRUE',
    solicitudId: Number(texto(fila.get('solicitudId'))),
  };

  const tecnicoDestino = texto(fila.get('tecnicoDestino'));
  if (tecnicoDestino) notificacion.tecnicoDestino = tecnicoDestino;

  const tipo = texto(fila.get('tipo'));
  if (tipo) notificacion.tipo = tipo;

  const cotizacionId = Number(texto(fila.get('cotizacionId')));
  if (cotizacionId) notificacion.cotizacionId = cotizacionId;

  return notificacion;
}

// Las del rol que, si van dirigidas a un técnico concreto, son para ese técnico. Las más recientes primero.
async function getNotificaciones(rol, nombre) {
  const filas = await (await cargarHoja()).getRows();
  const rolesQueRecibe = ROLES_QUE_RECIBE[rol] ?? [rol];

  return filas
    .filter(f => rolesQueRecibe.includes(rolActual(texto(f.get('rolDestino')))))
    .filter(f => {
      const tecnicoDestino = texto(f.get('tecnicoDestino'));
      return !tecnicoDestino || normalizar(tecnicoDestino) === normalizar(nombre);
    })
    .map(armarNotificacion)
    .sort((a, b) => b.notificacionId - a.notificacionId);
}

// Con `clave` la creación es idempotente: si ya existe una notificación con esa clave se devuelve esa.
// Sirve para los avisos que puede disparar más de una sesión a la vez (p.ej. los recordatorios).
// `cotizacionId` (opcional) deja ligado el aviso a una cotización; la columna se agrega con npm run hojas:preparar.
async function crearNotificacion({ rolDestino, tecnicoDestino, tipo, mensaje, solicitudId, cotizacionId, clave }) {
  console.log('Modelo: creando una notificación para', rolDestino, tecnicoDestino || '');

  const hoja = await cargarHoja();
  const filas = await hoja.getRows();

  if (clave) {
    const existente = filas.find(f => mismoId(f.get('clave'), clave));
    if (existente) return armarNotificacion(existente);
  }

  // Sin la columna el aviso se crearía sin su enlace y el botón no sabría adónde ir
  if (cotizacionId) exigirColumnas(hoja, ['cotizacionId'], 'notificaciones');

  const nueva = await hoja.addRow({
    notificacionId: siguienteId(filas, 'notificacionId'),
    rolDestino,
    tecnicoDestino: tecnicoDestino || '',
    tipo: tipo || '',
    mensaje,
    fecha: new Date().toISOString(),
    leida: 'FALSE',
    solicitudId: solicitudId ?? '',
    clave: clave || '',
    ...(cotizacionId ? { cotizacionId } : {}),
  }, { raw: true });

  return armarNotificacion(nueva);
}

async function marcarLeida(notificacionId) {
  console.log('Modelo: marcando como leída la notificación', notificacionId);

  const filas = await (await cargarHoja()).getRows();
  const fila = filas.find(f => mismoId(f.get('notificacionId'), notificacionId));
  if (!fila) throw errorHttp(404, 'Notificación no encontrada');

  if (texto(fila.get('leida')) !== 'TRUE') {
    fila.set('leida', 'TRUE');
    await fila.save({ raw: true });
  }

  return armarNotificacion(fila);
}

module.exports = { ROLES, TIPOS, TIPOS_DE_VALIDACION, rolActual, getNotificaciones, crearNotificacion, marcarLeida };
