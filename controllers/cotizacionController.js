const cotizacionModel = require('../models/cotizacionModel');
const clienteModel = require('../models/clienteModel');

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
      items,
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
      items: itemsNormalizados,
    });

    console.log('Controlador: cotización creada correctamente');
    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    console.error('Controlador: error al crear cotización', error);
    res.status(500).json({ message: 'Error al crear la cotización', error: error.message });
  }
}

module.exports = {
  createCotizacion,
};
