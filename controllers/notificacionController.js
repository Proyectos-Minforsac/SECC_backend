const notificacionModel = require('../models/notificacionModel');

function responderError(res, mensaje, error) {
  // Los errores con status (404...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = valor => (/^\d+$/.test(String(valor)) ? Number(valor) : null);
const esTexto = valor => typeof valor === 'string' && valor.trim() !== '';

async function getNotificaciones(req, res) {
  console.log('Controlador: llegando a GET /notificaciones');
  try {
    const { rol, nombre } = req.query;
    if (!notificacionModel.ROLES.includes(rol)) return res.status(400).json({ message: 'Rol inválido' });

    res.status(200).json(await notificacionModel.getNotificaciones(rol, typeof nombre === 'string' ? nombre : ''));
  } catch (error) {
    responderError(res, 'Error al obtener las notificaciones', error);
  }
}

async function crearNotificacion(req, res) {
  console.log('Controlador: llegando a POST /notificaciones');
  try {
    const { rolDestino, tecnicoDestino, tipo, mensaje, solicitudId, clave } = req.body || {};

    if (!notificacionModel.ROLES.includes(rolDestino)) return res.status(400).json({ message: 'Rol inválido' });
    if (!esTexto(mensaje)) return res.status(400).json({ message: 'Falta el mensaje de la notificación' });
    if (!aEntero(solicitudId)) return res.status(400).json({ message: 'Solicitud inválida' });
    if (tipo !== undefined && !notificacionModel.TIPOS.includes(tipo)) {
      return res.status(400).json({ message: 'Tipo de notificación inválido' });
    }

    res.status(201).json(await notificacionModel.crearNotificacion({
      rolDestino,
      tecnicoDestino: esTexto(tecnicoDestino) ? tecnicoDestino.trim() : '',
      tipo,
      mensaje: mensaje.trim(),
      solicitudId: aEntero(solicitudId),
      clave: esTexto(clave) ? clave.trim() : '',
    }));
  } catch (error) {
    responderError(res, 'Error al crear la notificación', error);
  }
}

async function marcarLeida(req, res) {
  console.log('Controlador: llegando a PUT /notificaciones/:id/leida');
  try {
    const notificacionId = aEntero(req.params.id);
    if (!notificacionId) return res.status(400).json({ message: 'Notificación inválida' });

    res.status(200).json(await notificacionModel.marcarLeida(notificacionId));
  } catch (error) {
    responderError(res, 'Error al marcar la notificación como leída', error);
  }
}

module.exports = { getNotificaciones, crearNotificacion, marcarLeida };
