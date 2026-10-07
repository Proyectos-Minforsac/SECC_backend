const visitaModel = require('../models/visitaModel');

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

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
const esTexto = valor => typeof valor === 'string' && valor.trim() !== '';

async function getVisitas(req, res) {
  console.log('Controlador: llegando a GET /visitas');
  try {
    res.status(200).json(await visitaModel.getVisitas());
  } catch (error) {
    responderError(res, 'Error al obtener las visitas técnicas', error);
  }
}

async function getVisitasProgramadas(req, res) {
  console.log('Controlador: llegando a GET /visitas-programadas');
  try {
    res.status(200).json(await visitaModel.getVisitasProgramadas());
  } catch (error) {
    responderError(res, 'Error al obtener las visitas programadas', error);
  }
}

async function guardarDiagnostico(req, res) {
  console.log('Controlador: llegando a POST /visitas/:id/diagnostico');
  try {
    const visitaId = aEntero(req.params.id);
    const { descripcion, componentes } = req.body || {};

    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });
    if (!esTexto(descripcion)) return res.status(400).json({ message: 'Ingrese la descripción del diagnóstico' });
    if (!Array.isArray(componentes) || !componentes.every(esTexto) || componentes.length === 0) {
      return res.status(400).json({ message: 'Ingrese al menos un componente necesario' });
    }

    res.status(200).json(await visitaModel.guardarDiagnostico(visitaId, {
      descripcion: descripcion.trim(),
      componentes: componentes.map(c => c.trim()),
    }));
  } catch (error) {
    responderError(res, 'Error al guardar el diagnóstico', error);
  }
}

// Responde 200 con null cuando la solicitud no tiene visita técnica.
async function activarPorSolicitud(req, res) {
  console.log('Controlador: llegando a POST /solicitudes/:id/activar-visita');
  try {
    const solicitudId = aEntero(req.params.id);
    if (!solicitudId) return res.status(400).json({ message: 'Solicitud inválida' });

    res.status(200).json(await visitaModel.activarPorSolicitud(solicitudId));
  } catch (error) {
    responderError(res, 'Error al activar el servicio', error);
  }
}

async function registrarCierre(req, res) {
  console.log('Controlador: llegando a POST /visitas/:id/cierre');
  try {
    const visitaId = aEntero(req.params.id);
    const { carpetaUrl } = req.body || {};

    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });
    if (!esTexto(carpetaUrl)) return res.status(400).json({ message: 'Falta el enlace de la carpeta del servicio' });

    res.status(200).json(await visitaModel.registrarCierre(visitaId, carpetaUrl.trim()));
  } catch (error) {
    responderError(res, 'Error al registrar el cierre del servicio', error);
  }
}

// Valida el cuerpo de programar/reprogramar. Devuelve { error } o { datos } ya normalizados.
function validarDatosProgramada(cuerpo) {
  const { fecha, horaInicio, horaFin, descripcionTareas } = cuerpo || {};

  if (!FECHA_ISO.test(fecha)) return { error: 'Selecciona la fecha de la visita' };
  if (!HORA.test(horaInicio) || !HORA.test(horaFin)) return { error: 'Ingresa la hora de inicio y de fin' };
  if (horaFin <= horaInicio) return { error: 'La hora de fin debe ser posterior a la hora de inicio' };
  if (!esTexto(descripcionTareas)) return { error: 'Describe las tareas que debe ejecutar el técnico' };

  return { datos: { fecha, horaInicio, horaFin, descripcionTareas: descripcionTareas.trim() } };
}

async function crearProgramada(req, res) {
  console.log('Controlador: llegando a POST /visitas/:id/programadas');
  try {
    const visitaId = aEntero(req.params.id);
    if (!visitaId) return res.status(400).json({ message: 'Visita inválida' });

    const { error, datos } = validarDatosProgramada(req.body);
    if (error) return res.status(400).json({ message: error });

    res.status(201).json(await visitaModel.crearProgramada(visitaId, datos));
  } catch (error) {
    responderError(res, 'Error al programar la visita', error);
  }
}

async function actualizarProgramada(req, res) {
  console.log('Controlador: llegando a PUT /visitas-programadas/:id');
  try {
    const visitaProgramadaId = aEntero(req.params.id);
    if (!visitaProgramadaId) return res.status(400).json({ message: 'Visita programada inválida' });

    const { error, datos } = validarDatosProgramada(req.body);
    if (error) return res.status(400).json({ message: error });

    res.status(200).json(await visitaModel.actualizarProgramada(visitaProgramadaId, datos));
  } catch (error) {
    responderError(res, 'Error al reprogramar la visita', error);
  }
}

async function eliminarProgramada(req, res) {
  console.log('Controlador: llegando a DELETE /visitas-programadas/:id');
  try {
    const visitaProgramadaId = aEntero(req.params.id);
    if (!visitaProgramadaId) return res.status(400).json({ message: 'Visita programada inválida' });

    await visitaModel.eliminarProgramada(visitaProgramadaId);
    res.status(200).json({ message: 'Visita programada eliminada correctamente' });
  } catch (error) {
    responderError(res, 'Error al eliminar la visita programada', error);
  }
}

async function registrarAvance(req, res) {
  console.log('Controlador: llegando a POST /visitas-programadas/:id/avance');
  try {
    const visitaProgramadaId = aEntero(req.params.id);
    const { descripcion } = req.body || {};

    if (!visitaProgramadaId) return res.status(400).json({ message: 'Visita programada inválida' });
    if (!esTexto(descripcion)) {
      return res.status(400).json({ message: 'Ingresa la descripción del avance del servicio' });
    }

    res.status(200).json(await visitaModel.registrarAvance(visitaProgramadaId, { descripcion: descripcion.trim() }));
  } catch (error) {
    responderError(res, 'Error al registrar el avance de la visita', error);
  }
}

module.exports = {
  getVisitas,
  getVisitasProgramadas,
  guardarDiagnostico,
  activarPorSolicitud,
  registrarCierre,
  crearProgramada,
  actualizarProgramada,
  eliminarProgramada,
  registrarAvance,
};
