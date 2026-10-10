const cotizacionModel = require('../models/cotizacionModel');
const clienteModel = require('../models/clienteModel');

// Decisiones posibles sobre una cotización pendiente (PENDIENTE es solo el estado inicial)
const ESTADOS_DECISION = ['ACEPTADA', 'RECHAZADA'];

function esItemTitulo(it) {
  const precio = it.precioUnitario ?? it.precio;
  return it.tipo === 'Título' || (Number(it.cantidad) === 0 && Number(precio) === 0);
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
      estado = 'PENDIENTE',
      solicitudId,
      items,
      costos,
    } = req.body;

    if (!clienteId || !fecha || !solicitante) {
      return res.status(400).json({ message: 'clienteId, fecha y solicitante son obligatorios' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'La cotización debe tener al menos un ítem' });
    }

    // Validación por ítem
    for (const [i, it] of items.entries()) {
      if (!it || typeof it.nombre !== 'string' || !it.nombre.trim()) {
        return res.status(400).json({ message: `El ítem #${i + 1} no tiene nombre` });
      }
      if (!esItemTitulo(it) && !it.tipo) {
        return res.status(400).json({ message: `El ítem "${it.nombre}" no tiene tipo` });
      }
      if (it.tipo === 'Impresora' && !it.detalleImpresora) {
        return res.status(400).json({ message: `El ítem "${it.nombre}" es Impresora pero no trae detalles` });
      }
    }

    // Validación de inductores de costo (opcionales)
    if (costos !== undefined && !Array.isArray(costos)) {
      return res.status(400).json({ message: 'Los inductores de costo deben ser una lista' });
    }
    for (const [i, c] of (costos || []).entries()) {
      if (c && (c.cantidad || c.costoUnitario) && !c.categoria) {
        return res.status(400).json({ message: `El inductor de costo #${i + 1} no tiene categoría` });
      }
    }

    const clienteExistente = await clienteModel.getClienteById(String(clienteId));
    if (!clienteExistente) {
      console.log('Controlador: cliente no encontrado', clienteId);
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Normalizamos: aceptamos precio o precioUnitario desde el front
    const itemsNormalizados = items.map((it, i) => ({
      tipo: it.tipo,
      nombre: it.nombre.trim(),
      descripcion: it.descripcion || '',
      cantidad: Number(it.cantidad) || 0,
      precioUnitario: Number(it.precioUnitario ?? it.precio) || 0,
      orden: Number.isInteger(it.orden) ? it.orden : i,
      detalleImpresora: it.detalleImpresora || null,
    }));

    const nuevaCotizacion = await cotizacionModel.createCotizacionCompleta({
      clienteId: String(clienteId),
      numeroCotizacion,
      fecha,
      solicitante,
      moneda,
      estado,
      solicitudId,
      items: itemsNormalizados,
      costos: costos || [],
    });

    console.log('Controlador: cotización creada correctamente');
    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    console.error('Controlador: error al crear cotización', error);
    res.status(500).json({ message: 'Error al crear la cotización', error: error.message });
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
    console.error('Controlador: error al obtener cotizaciones', error);
    res.status(500).json({ message: 'Error al obtener las cotizaciones', error: error.message });
  }
}

async function getCotizacionesPorSolicitud(req, res) {
  console.log('Controlador: GET /cotizaciones/solicitud/:solicitudId');
  try {
    const cotizaciones = await cotizacionModel.getCotizacionesPorSolicitud(req.params.solicitudId);
    res.status(200).json(cotizaciones);
  } catch (error) {
    console.error('Controlador: error al obtener cotizaciones de la solicitud', error);
    res.status(500).json({ message: 'Error al obtener las cotizaciones del servicio', error: error.message });
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
    // Los errores con status (409...) son de negocio y su mensaje es seguro de mostrar.
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Controlador: error al actualizar estado de cotización', error);
    res.status(500).json({ message: 'Error al actualizar la cotización', error: error.message });
  }
}

module.exports = {
  createCotizacion,
  getCotizaciones,
  getCotizacionesPorSolicitud,
  updateEstadoCotizacion,
};
