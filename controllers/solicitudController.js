const solicitudModel = require('../models/solicitudModel');
const driveService = require('../services/driveService');

const EXTENSIONES_OFERTA = /\.(pdf|doc|docx)$/i;
// El cuerpo JSON admite 12 MB (app.js) y base64 pesa un tercio más que el archivo.
const MAX_BYTES_OFERTA = 8 * 1024 * 1024;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function responderError(res, mensaje, error) {
  // Los errores con status (404, 409...) son de negocio y su mensaje es seguro de mostrar.
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = valor => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

async function getSolicitudes(req, res) {
  console.log('Controlador: llegando a GET /solicitudes');
  try {
    res.status(200).json(await solicitudModel.getAllSolicitudes());
  } catch (error) {
    responderError(res, 'Error al obtener las solicitudes', error);
  }
}

// Valida el cuerpo de crear/editar. Devuelve { error } o { datos } ya normalizados.
function validarDatosSolicitud(cuerpo) {
  const { clienteId, descripcion, tecnicoIds } = cuerpo || {};

  if (!aEntero(clienteId)) return { error: 'Seleccione un cliente' };
  if (typeof descripcion !== 'string' || !descripcion.trim()) return { error: 'Ingrese una descripción' };
  if (!Array.isArray(tecnicoIds) || tecnicoIds.length === 0 || !tecnicoIds.every(aEntero)) {
    return { error: 'Seleccione al menos un técnico' };
  }

  return {
    datos: {
      clienteId: aEntero(clienteId),
      descripcion: descripcion.trim(),
      tecnicoIds: tecnicoIds.map(aEntero),
    },
  };
}

async function createSolicitud(req, res) {
  console.log('Controlador: llegando a POST /solicitudes');
  try {
    const { error, datos } = validarDatosSolicitud(req.body);
    if (error) return res.status(400).json({ message: error });

    res.status(201).json(await solicitudModel.createSolicitud(datos));
  } catch (error) {
    responderError(res, 'Error al crear la solicitud', error);
  }
}

async function updateSolicitud(req, res) {
  console.log('Controlador: llegando a PUT /solicitudes/:id');
  try {
    const solicitudId = aEntero(req.params.id);
    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });

    const { error, datos } = validarDatosSolicitud(req.body);
    if (error) return res.status(400).json({ message: error });

    res.status(200).json(await solicitudModel.updateSolicitud(solicitudId, datos));
  } catch (error) {
    responderError(res, 'Error al actualizar la solicitud', error);
  }
}

async function deleteSolicitud(req, res) {
  console.log('Controlador: llegando a DELETE /solicitudes/:id');
  try {
    const solicitudId = aEntero(req.params.id);
    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });

    await solicitudModel.deleteSolicitud(solicitudId);
    res.status(200).json({ message: 'Solicitud eliminada correctamente' });
  } catch (error) {
    responderError(res, 'Error al eliminar la solicitud', error);
  }
}

// Crea o edita la oferta del técnico. El archivo llega en base64 dentro del JSON.
async function enviarOferta(req, res) {
  console.log('Controlador: llegando a PUT /solicitudes/:id/ofertas');
  try {
    const solicitudId = aEntero(req.params.id);
    const { tecnicoNombre, montoVisita, archivoNombre, archivoTipo, archivoBase64 } = req.body || {};

    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });
    if (typeof tecnicoNombre !== 'string' || !tecnicoNombre.trim()) {
      return res.status(400).json({ message: 'Falta el técnico' });
    }
    const monto = Number(montoVisita);
    if (!Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ message: 'Ingrese un monto válido para la visita' });
    }

    let archivo = null;
    if (archivoBase64) {
      if (typeof archivoNombre !== 'string' || !EXTENSIONES_OFERTA.test(archivoNombre) || archivoNombre.length > 200) {
        return res.status(400).json({ message: 'El archivo debe ser doc, docx o pdf' });
      }
      const contenido = Buffer.from(String(archivoBase64), 'base64');
      if (contenido.length === 0) return res.status(400).json({ message: 'El archivo está vacío' });
      if (contenido.length > MAX_BYTES_OFERTA) {
        return res.status(413).json({ message: 'El archivo supera los 8 MB permitidos' });
      }
      archivo = {
        nombre: archivoNombre.trim(),
        tipo: typeof archivoTipo === 'string' && archivoTipo ? archivoTipo : 'application/octet-stream',
        contenido,
      };
    }

    const solicitud = await solicitudModel.enviarOferta(solicitudId, {
      tecnicoNombre: tecnicoNombre.trim(),
      montoVisita: monto,
      archivo,
    });
    res.status(200).json(solicitud);
  } catch (error) {
    responderError(res, 'Error al enviar la oferta', error);
  }
}

const decidirOferta = decision => async (req, res) => {
  console.log(`Controlador: llegando a POST /solicitudes/:id/ofertas/:ofertaId (${decision})`);
  try {
    const solicitudId = aEntero(req.params.id);
    const ofertaId = aEntero(req.params.ofertaId);
    if (!solicitudId || !ofertaId) return res.status(400).json({ message: 'Solicitud u oferta inválida' });

    res.status(200).json(await solicitudModel.decidirOferta(solicitudId, ofertaId, decision));
  } catch (error) {
    responderError(res, 'Error al registrar la decisión sobre la oferta', error);
  }
};

async function autorizarViaje(req, res) {
  console.log('Controlador: llegando a POST /solicitudes/:id/autorizar');
  try {
    const solicitudId = aEntero(req.params.id);
    const { instrucciones, fechaInicio, fechaFin } = req.body || {};

    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });
    if (typeof instrucciones !== 'string' || !instrucciones.trim()) {
      return res.status(400).json({ message: 'Ingrese las instrucciones del viaje' });
    }
    if (!FECHA_ISO.test(fechaInicio) || !FECHA_ISO.test(fechaFin)) {
      return res.status(400).json({ message: 'Las fechas del viaje no son válidas' });
    }
    if (fechaFin < fechaInicio) {
      return res.status(400).json({ message: 'La fecha de fin no puede ser anterior a la de inicio' });
    }

    const solicitud = await solicitudModel.autorizarViaje(solicitudId, {
      instrucciones: instrucciones.trim(),
      fechaInicio,
      fechaFin,
    });
    res.status(200).json(solicitud);
  } catch (error) {
    responderError(res, 'Error al autorizar el viaje', error);
  }
}

// Crea (o reutiliza) la carpeta de Drive del servicio y devuelve su enlace.
async function crearCarpetaServicio(req, res) {
  console.log('Controlador: llegando a POST /solicitudes/:id/carpeta-servicio');
  try {
    const solicitudId = aEntero(req.params.id);
    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });

    res.status(201).json(await solicitudModel.getCarpetaServicio(solicitudId));
  } catch (error) {
    responderError(res, 'No se pudo crear la carpeta del servicio en Google Drive', error);
  }
}

// Sirve la cotización de una oferta desde Drive. El id sale siempre de la hoja "ofertas".
async function descargarArchivoOferta(req, res) {
  console.log('Controlador: llegando a GET /ofertas/:ofertaId/archivo');
  try {
    const ofertaId = aEntero(req.params.ofertaId);
    if (!ofertaId) return res.status(400).json({ message: 'Oferta inválida' });

    const { archivoId, archivoNombre } = await solicitudModel.getArchivoOferta(ofertaId);
    const { nombre, tipo, stream } = await driveService.descargarArchivo(archivoId);

    res.setHeader('Content-Type', tipo || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(archivoNombre || nombre)}`
    );
    stream.on('error', error => {
      console.error('Controlador: error al transmitir el archivo', error);
      res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    responderError(res, 'No se pudo descargar el archivo', error);
  }
}

module.exports = {
  getSolicitudes,
  createSolicitud,
  updateSolicitud,
  deleteSolicitud,
  enviarOferta,
  aceptarOferta: decidirOferta('ACEPTADA'),
  rechazarOferta: decidirOferta('RECHAZADA'),
  autorizarViaje,
  crearCarpetaServicio,
  descargarArchivoOferta,
};
