const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, normalizar, siguienteId } = require('../services/hojasUtils');

const ROLES = ['empleado', 'tecnico'];
// Notificaciones que además de mostrarse habilitan una acción rápida (p.ej. "Crear cotización").
const TIPOS = ['DIAGNOSTICO_COMPLETADO'];

async function cargarHoja() {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['notificaciones'];
  if (!hoja) throw new Error('No existe la hoja "notificaciones" en el Excel (npm run hojas:preparar la crea)');
  return hoja;
}

function armarNotificacion(fila) {
  const notificacion = {
    notificacionId: Number(texto(fila.get('notificacionId'))),
    rolDestino: texto(fila.get('rolDestino')),
    mensaje: texto(fila.get('mensaje')),
    fecha: texto(fila.get('fecha')),
    leida: texto(fila.get('leida')) === 'TRUE',
    solicitudId: Number(texto(fila.get('solicitudId'))),
  };

  const tecnicoDestino = texto(fila.get('tecnicoDestino'));
  if (tecnicoDestino) notificacion.tecnicoDestino = tecnicoDestino;

  const tipo = texto(fila.get('tipo'));
  if (tipo) notificacion.tipo = tipo;

  return notificacion;
}

// Las del rol que, si van dirigidas a un técnico concreto, son para ese técnico. Las más recientes primero.
async function getNotificaciones(rol, nombre) {
  const filas = await (await cargarHoja()).getRows();

  return filas
    .filter(f => texto(f.get('rolDestino')) === rol)
    .filter(f => {
      const tecnicoDestino = texto(f.get('tecnicoDestino'));
      return !tecnicoDestino || normalizar(tecnicoDestino) === normalizar(nombre);
    })
    .map(armarNotificacion)
    .sort((a, b) => b.notificacionId - a.notificacionId);
}

// Con `clave` la creación es idempotente: si ya existe una notificación con esa clave se devuelve esa.
// Sirve para los avisos que puede disparar más de una sesión a la vez (p.ej. los recordatorios).
async function crearNotificacion({ rolDestino, tecnicoDestino, tipo, mensaje, solicitudId, clave }) {
  console.log('Modelo: creando una notificación para', rolDestino, tecnicoDestino || '');

  const hoja = await cargarHoja();
  const filas = await hoja.getRows();

  if (clave) {
    const existente = filas.find(f => mismoId(f.get('clave'), clave));
    if (existente) return armarNotificacion(existente);
  }

  const nueva = await hoja.addRow({
    notificacionId: siguienteId(filas, 'notificacionId'),
    rolDestino,
    tecnicoDestino: tecnicoDestino || '',
    tipo: tipo || '',
    mensaje,
    fecha: new Date().toISOString(),
    leida: 'FALSE',
    solicitudId,
    clave: clave || '',
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

module.exports = { ROLES, TIPOS, getNotificaciones, crearNotificacion, marcarLeida };
