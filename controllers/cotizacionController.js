const cotizacionModel = require('../models/cotizacionModel');
const clienteModel = require('../models/clienteModel');
const {
  GARANTIA_MESES_MIN,
  GARANTIA_MESES_MAX,
  GARANTIA_MESES_DEFECTO,
  esGarantiaValida,
} = require('../services/garantia');

// Decisiones posibles sobre una cotización pendiente (PENDIENTE es solo el estado inicial)
const ESTADOS_DECISION = ['ACEPTADA', 'RECHAZADA'];

function esItemTitulo(it) {
  const precio = it.precioUnitario ?? it.precio;
  return it.tipo === 'Título' || (Number(it.cantidad) === 0 && Number(precio) === 0);
}

// Los errores con status (400, 404, 409...) son de negocio, como una tarifa que falta o una cotización sin validar, y su
// mensaje es seguro de mostrar.
function responderError(res, mensaje, error) {
  if (error.status) {
    console.log(`Controlador: ${mensaje} (${error.status}): ${error.message}`);
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`Controlador: ${mensaje}`, error);
  res.status(500).json({ message: mensaje, error: error.message });
}

const aEntero = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// Comprueba lo que la cotización necesita para guardarse, la misma para crearla que para corregirla. Devuelve el
// mensaje de lo que falta o los ítems ya normalizados.
function leerCuerpo({ garantiaMeses, items, estimacion }) {
  if (!esGarantiaValida(garantiaMeses)) {
    return {
      error: `La garantía debe ser un número entero de meses entre ${GARANTIA_MESES_MIN} y ${GARANTIA_MESES_MAX}`,
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'La cotización debe tener al menos un ítem' };
  }

  // Validación por ítem
  for (const [i, it] of items.entries()) {
    if (!it || typeof it.nombre !== 'string' || !it.nombre.trim()) {
      return { error: `El ítem #${i + 1} no tiene nombre` };
    }
    if (!esItemTitulo(it) && !it.tipo) {
      return { error: `El ítem "${it.nombre}" no tiene tipo` };
    }
    if (it.tipo === 'Impresora' && !it.detalleImpresora) {
      return { error: `El ítem "${it.nombre}" es Impresora pero no trae detalles` };
    }
  }

  // La estimación de costos es obligatoria; su contenido lo valida el modelo al calcularla.
  if (!estimacion || typeof estimacion !== 'object') {
    return { error: 'Falta la estimación de costos de la cotización' };
  }

  // Normalizamos: aceptamos precio o precioUnitario desde el front
  return {
    items: items.map((it, i) => ({
      tipo: it.tipo,
      nombre: it.nombre.trim(),
      descripcion: it.descripcion || '',
      cantidad: Number(it.cantidad) || 0,
      precioUnitario: Number(it.precioUnitario ?? it.precio) || 0,
      // Costo de compra (uso interno). Si falta se deja como está: el modelo decide si ese ítem lo necesita.
      costoUnitario: it.costoUnitario ?? null,
      orden: Number.isInteger(it.orden) ? it.orden : i,
      detalleImpresora: it.detalleImpresora || null,
    })),
  };
}

async function createCotizacion(req, res) {
  console.log('Controlador: llegando a POST /cotizaciones');
  console.log('Body recibido:', JSON.stringify(req.body));
  try {
    const {
      clienteId,
      numeroCotizacion,
      fecha,
      solicitante,
      moneda = 'SOLES',
      solicitudId,
      garantiaMeses = GARANTIA_MESES_DEFECTO,
      items,
      estimacion,
      justificacion,
    } = req.body;

    if (!clienteId || !fecha || !solicitante) {
      return res.status(400).json({ message: 'clienteId, fecha y solicitante son obligatorios' });
    }

    const { error, items: itemsNormalizados } = leerCuerpo({ garantiaMeses, items, estimacion });
    if (error) return res.status(400).json({ message: error });

    const clienteExistente = await clienteModel.getClienteById(String(clienteId));
    if (!clienteExistente) {
      console.log('Controlador: cliente no encontrado', clienteId);
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    const nuevaCotizacion = await cotizacionModel.createCotizacionCompleta({
      clienteId: String(clienteId),
      numeroCotizacion,
      fecha,
      solicitante,
      moneda,
      // Toda cotización nace pendiente: aceptarla o rechazarla pasa por la validación del jefe (PATCH .../estado)
      estado: 'PENDIENTE',
      solicitudId,
      garantiaMeses,
      items: itemsNormalizados,
      estimacion,
      usuario: req.usuario,
      justificacion,
    });

    console.log('Controlador: cotización creada correctamente');
    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    responderError(res, 'Error al crear la cotización', error);
  }
}

// Corrige una cotización devuelta: mismos datos que al crearla, salvo el cliente y la solicitud, que no cambian.
async function actualizarCotizacion(req, res) {
  console.log('Controlador: PUT /cotizaciones/:id');
  try {
    const cotizacionId = aEntero(req.params.id);
    if (!cotizacionId) return res.status(400).json({ message: 'Cotización inválida' });

    const {
      solicitante,
      moneda = 'SOLES',
      garantiaMeses = GARANTIA_MESES_DEFECTO,
      items,
      estimacion,
      justificacion,
    } = req.body || {};

    if (typeof solicitante !== 'string' || !solicitante.trim()) {
      return res.status(400).json({ message: 'El solicitante es obligatorio' });
    }

    const { error, items: itemsNormalizados } = leerCuerpo({ garantiaMeses, items, estimacion });
    if (error) return res.status(400).json({ message: error });

    const cotizacion = await cotizacionModel.editarCotizacionDevuelta({
      cotizacionId,
      solicitante: solicitante.trim(),
      moneda,
      garantiaMeses,
      items: itemsNormalizados,
      estimacion,
      usuario: req.usuario,
      justificacion,
    });
    if (!cotizacion) return res.status(404).json({ message: 'Cotización no encontrada' });

    res.status(200).json(cotizacion);
  } catch (error) {
    responderError(res, 'Error al corregir la cotización', error);
  }
}

async function getCotizaciones(req, res) {
  console.log('Controlador: llegando a GET /cotizaciones');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const estado = req.query.estado || '';

    const resultado = await cotizacionModel.getAllCotizaciones(page, limit, search, estado);
    res.status(200).json(resultado);
  } catch (error) {
    responderError(res, 'Error al obtener las cotizaciones', error);
  }
}

async function getCotizacionesPorSolicitud(req, res) {
  console.log('Controlador: GET /cotizaciones/solicitud/:solicitudId');
  try {
    const cotizaciones = await cotizacionModel.getCotizacionesPorSolicitud(req.params.solicitudId);
    res.status(200).json(cotizaciones);
  } catch (error) {
    responderError(res, 'Error al obtener las cotizaciones del servicio', error);
  }
}

// Una cotización para su PDF. Solo si el jefe la validó (o es anterior al control de costos).
async function getCotizacion(req, res) {
  console.log('Controlador: GET /cotizaciones/:id');
  try {
    const cotizacionId = aEntero(req.params.id);
    if (!cotizacionId) return res.status(400).json({ message: 'Cotización inválida' });

    const cotizacion = await cotizacionModel.getCotizacionPorId(cotizacionId);
    if (!cotizacion) return res.status(404).json({ message: 'Cotización no encontrada' });

    res.status(200).json(cotizacion);
  } catch (error) {
    responderError(res, 'Error al obtener la cotización', error);
  }
}

// Una cotización devuelta con todo lo necesario para corregirla.
async function getCotizacionParaEdicion(req, res) {
  console.log('Controlador: GET /cotizaciones/:id/edicion');
  try {
    const cotizacionId = aEntero(req.params.id);
    if (!cotizacionId) return res.status(400).json({ message: 'Cotización inválida' });

    const cotizacion = await cotizacionModel.getCotizacionParaEdicion(cotizacionId);
    if (!cotizacion) return res.status(404).json({ message: 'Cotización no encontrada' });

    res.status(200).json(cotizacion);
  } catch (error) {
    responderError(res, 'Error al obtener la cotización para corregirla', error);
  }
}

async function updateEstadoCotizacion(req, res) {
  console.log('Controlador: PATCH /cotizaciones/:id/estado');
  try {
    const { id } = req.params;
    const { estado, motivo } = req.body;

    if (!ESTADOS_DECISION.includes(estado)) {
      return res.status(400).json({ message: `El estado debe ser uno de: ${ESTADOS_DECISION.join(', ')}` });
    }

    const motivoLimpio = typeof motivo === 'string' ? motivo.trim() : '';
    if (estado === 'RECHAZADA' && !motivoLimpio) {
      return res.status(400).json({ message: 'Indica el motivo del rechazo' });
    }

    const cotizacionActualizada = await cotizacionModel.updateEstadoCotizacion(id, estado, motivoLimpio);

    if (!cotizacionActualizada) {
      return res.status(404).json({ message: 'Cotización no encontrada' });
    }

    res.status(200).json(cotizacionActualizada);
  } catch (error) {
    responderError(res, 'Error al actualizar la cotización', error);
  }
}

module.exports = {
  createCotizacion,
  actualizarCotizacion,
  getCotizaciones,
  getCotizacion,
  getCotizacionParaEdicion,
  getCotizacionesPorSolicitud,
  updateEstadoCotizacion,
};
