const { conectar } = require('../services/sheetsService');
const { errorHttp, texto } = require('../services/hojasUtils');

const IGV_RATE = 0.18;

// max(id) + 1 sobre una hoja ya leída
function siguienteId(filas, campo) {
  const ids = filas
    .map(f => parseInt(f.get(campo), 10))
    .filter(n => Number.isInteger(n));
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

// Un ítem es "Título" si viene marcado o si cantidad y precio son 0
function esTitulo(item) {
  if (item.tipo === 'Título') return true;
  return Number(item.cantidad) === 0 && Number(item.precioUnitario) === 0;
}

// Verifica que la hoja tenga las columnas necesarias (evita errores crípticos de addRow)
function exigirColumnas(hoja, columnas, nombreHoja) {
  const headers = hoja.headerValues || [];
  const faltantes = columnas.filter(c => !headers.includes(c));
  if (faltantes.length) {
    throw new Error(
      `La hoja '${nombreHoja}' no tiene la(s) columna(s): ${faltantes.join(', ')}`
    );
  }
}

function generarNumeroCotizacion(cotizacionId) {
  const anio = new Date().getFullYear();
  return `COT-${anio}-${String(cotizacionId).padStart(4, '0')}`;
}

/**
 * Crea la cotización completa: cabecera + ítems + relación + detalles de impresora
 * + inductores de costo (uso interno, no se imprimen en el PDF del cliente).
 *
 * items: [{ tipo, nombre, descripcion, cantidad, precioUnitario, orden, detalleImpresora? }]
 * detalleImpresora: { fecha, tienda, cargo, marca, modelo, numeroSerie, casoHD }
 * costos: [{ categoria, descripcion, cantidad, costoUnitario }]
 */
async function createCotizacionCompleta({
  clienteId,
  numeroCotizacion,
  fecha,
  solicitante,
  moneda = 'SOLES',
  estado = 'PENDIENTE',
  // Solicitud de servicio de origen (opcional): permite, al aceptar la cotización,
  // activar la visita técnica correspondiente. Vive en el frontend por ahora,
  // así que aquí solo se guarda como referencia si la hoja tiene la columna.
  solicitudId,
  items = [],
  costos = [],
}) {
  const doc = await conectar();

  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaItems = doc.sheetsByTitle['items'];
  const hojaItemsCotizacion = doc.sheetsByTitle['itemsCotizacion'];
  const hojaDetalleImpresora = doc.sheetsByTitle['detalleImpresora'];
  const hojaInductores = doc.sheetsByTitle['inductoresCosto'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");
  if (!hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");
  if (!hojaDetalleImpresora) throw new Error("Falta la hoja 'detalleImpresora'");

  // Inductores de costo: solo se exige la hoja si el empleado realmente registró alguno
  const costosNormalizados = (costos || [])
    .map((c) => ({
      categoria: c.categoria,
      descripcion: c.descripcion || '',
      cantidad: Number(c.cantidad) || 0,
      costoUnitario: Number(c.costoUnitario) || 0,
    }))
    .filter((c) => c.categoria && c.cantidad > 0 && c.costoUnitario > 0)
    .map((c) => ({ ...c, subtotal: Number((c.cantidad * c.costoUnitario).toFixed(2)) }));

  if (costosNormalizados.length > 0 && !hojaInductores) {
    throw new Error(
      "Falta la hoja 'inductoresCosto' (columnas: inductorCostoId, cotizacionId, categoria, descripcion, cantidad, costoUnitario, subtotal)"
    );
  }

  // Lectura de filas (secuencial para no forzar el estado interno de la librería)
  const filasCot = await hojaCotizaciones.getRows();
  const filasItems = await hojaItems.getRows();
  const filasIC = await hojaItemsCotizacion.getRows();
  const filasDI = await hojaDetalleImpresora.getRows();
  const filasInductores = hojaInductores ? await hojaInductores.getRows() : [];

  exigirColumnas(hojaCotizaciones, ['subtotal', 'igv', 'total'], 'cotizaciones');
  exigirColumnas(
    hojaItemsCotizacion,
    ['itemCotizacionId', 'cotizacionId', 'itemId', 'cantidad', 'subtotal', 'orden'],
    'itemsCotizacion'
  );
  exigirColumnas(
    hojaDetalleImpresora,
    ['detalleImpresoraId', 'itemCotizacionId', 'fecha', 'tienda', 'cargo', 'marca', 'modelo', 'numeroSerie', 'casoHD'],
    'detalleImpresora'
  );
  if (costosNormalizados.length > 0) {
    exigirColumnas(
      hojaInductores,
      ['inductorCostoId', 'cotizacionId', 'categoria', 'descripcion', 'cantidad', 'costoUnitario', 'subtotal'],
      'inductoresCosto'
    );
  }

  // IDs base: se calculan una sola vez y se incrementan localmente
  const cotizacionId = siguienteId(filasCot, 'cotizacionId');
  let itemIdSeq = siguienteId(filasItems, 'itemId');
  let itemCotizacionIdSeq = siguienteId(filasIC, 'itemCotizacionId');
  let detalleImpresoraIdSeq = siguienteId(filasDI, 'detalleImpresoraId');
  let inductorCostoIdSeq = siguienteId(filasInductores, 'inductorCostoId');

  // Totales calculados en el servidor
  let subtotal = 0;
  const itemsCalculados = items.map((item, indice) => {
    const titulo = esTitulo(item);
    const cantidad = titulo ? 0 : Number(item.cantidad) || 0;
    const precioUnitario = titulo ? 0 : Number(item.precioUnitario) || 0;
    const subtotalItem = titulo ? 0 : Number((cantidad * precioUnitario).toFixed(2));
    subtotal += subtotalItem;
    return {
      titulo,
      tipo: titulo ? 'Título' : item.tipo,
      nombre: item.nombre,
      descripcion: item.descripcion || '',
      cantidad,
      precioUnitario,
      subtotalItem,
      orden: Number.isInteger(item.orden) ? item.orden : indice,
      detalleImpresora: item.detalleImpresora || null,
    };
  });

  subtotal = Number(subtotal.toFixed(2));
  const igv = Number((subtotal * IGV_RATE).toFixed(2));
  const total = Number((subtotal + igv).toFixed(2));
  const numero = numeroCotizacion || generarNumeroCotizacion(cotizacionId);

  // 1. Cabecera
  const datosCotizacion = {
    cotizacionId,
    clienteId,
    numeroCotizacion: numero,
    fecha,
    solicitante,
    moneda,
    estado,
    subtotal,
    igv,
    total,
  };
  // Solo se persiste si la hoja ya tiene la columna (ver nota en createCotizacionCompleta)
  if ((hojaCotizaciones.headerValues || []).includes('solicitudId')) {
    datosCotizacion.solicitudId = solicitudId || '';
  }
  const filaCotizacion = await hojaCotizaciones.addRow(datosCotizacion);

  // 2. Líneas: items -> itemsCotizacion -> detalleImpresora
  const lineas = [];
  for (const item of itemsCalculados) {
    const itemId = itemIdSeq++;
    await hojaItems.addRow({
      itemId,
      tipo: item.tipo,
      nombre: item.nombre,
      descripcion: item.descripcion,
      precioUnitario: item.titulo ? '' : item.precioUnitario,
    });

    const itemCotizacionId = itemCotizacionIdSeq++;
    await hojaItemsCotizacion.addRow({
      itemCotizacionId,
      cotizacionId,
      itemId,
      cantidad: item.titulo ? '' : item.cantidad,
      subtotal: item.titulo ? '' : item.subtotalItem,
      orden: item.orden,
    });

    let detalleImpresora = null;
    if (item.tipo === 'Impresora' && item.detalleImpresora) {
      const d = item.detalleImpresora;
      const detalleImpresoraId = detalleImpresoraIdSeq++;
      await hojaDetalleImpresora.addRow({
        detalleImpresoraId,
        itemCotizacionId,
        fecha: d.fecha || '',
        tienda: d.tienda || '',
        cargo: d.cargo || '',
        marca: d.marca || '',
        modelo: d.modelo || '',
        numeroSerie: d.numeroSerie || '',
        casoHD: d.casoHD || '',
      });
      detalleImpresora = { detalleImpresoraId, itemCotizacionId, ...d };
    }

    lineas.push({
      itemCotizacionId,
      itemId,
      tipo: item.tipo,
      nombre: item.nombre,
      descripcion: item.descripcion,
      cantidad: item.titulo ? 0 : item.cantidad,
      precioUnitario: item.titulo ? 0 : item.precioUnitario,
      subtotal: item.titulo ? 0 : item.subtotalItem,
      orden: item.orden,
      esTitulo: item.titulo,
      detalleImpresora,
    });
  }

  // 3. Inductores de costo (uso interno: materiales, viáticos, horas-hombre, etc.)
  let costoInternoTotal = 0;
  const inductoresGuardados = [];
  for (const costo of costosNormalizados) {
    const inductorCostoId = inductorCostoIdSeq++;
    await hojaInductores.addRow({
      inductorCostoId,
      cotizacionId,
      categoria: costo.categoria,
      descripcion: costo.descripcion,
      cantidad: costo.cantidad,
      costoUnitario: costo.costoUnitario,
      subtotal: costo.subtotal,
    });
    costoInternoTotal += costo.subtotal;
    inductoresGuardados.push({ inductorCostoId, cotizacionId, ...costo });
  }
  costoInternoTotal = Number(costoInternoTotal.toFixed(2));

  const cotizacionCreada = {
    ...filaCotizacion.toObject(),
    cotizacionId,
    numeroCotizacion: numero,
    subtotal,
    igv,
    total,
    items: lineas,
    costos: inductoresGuardados,
    costoInternoTotal,
  };

  console.log('Cotización creada:', cotizacionCreada.numeroCotizacion, `(${lineas.length} ítems, ${inductoresGuardados.length} inductores de costo)`);
  return cotizacionCreada;
}

/**
 * Lista las cotizaciones (cabecera) con el nombre del cliente resuelto,
 * paginadas y con filtro opcional por texto (cliente/número) y por estado.
 */
async function getAllCotizaciones(page, limit, search, estado) {
  const doc = await conectar();
  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaClientes = doc.sheetsByTitle['clientes'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");

  const filasCot = await hojaCotizaciones.getRows();
  const filasClientes = hojaClientes ? await hojaClientes.getRows() : [];
  const nombrePorClienteId = new Map(
    filasClientes.map((f) => [String(f.get('clienteId')), f.get('nombre')])
  );

  const cotizaciones = filasCot
    .map((f) => f.toObject())
    .map((c) => ({ ...c, clienteNombre: nombrePorClienteId.get(String(c.clienteId)) || '' }))
    .sort((a, b) => Number(b.cotizacionId) - Number(a.cotizacionId));

  const busqueda = (search || '').trim().toLowerCase();
  const estadoFiltro = (estado || '').trim().toLowerCase();

  const filtradas = cotizaciones
    .filter(
      (c) =>
        !busqueda ||
        (c.clienteNombre || '').toLowerCase().includes(busqueda) ||
        (c.numeroCotizacion || '').toLowerCase().includes(busqueda)
    )
    .filter((c) => !estadoFiltro || (c.estado || '').toLowerCase() === estadoFiltro);

  const total = filtradas.length;
  const offset = (page - 1) * limit;
  const paginadas = filtradas.slice(offset, offset + limit);

  return {
    cotizaciones: paginadas,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

/**
 * Decide una cotización pendiente: PENDIENTE -> ACEPTADA | RECHAZADA. Una cotización ya decidida no
 * cambia (revertir una decisión no está contemplado). Al rechazar se guarda el motivo.
 */
async function updateEstadoCotizacion(cotizacionId, estado, motivo = '') {
  const doc = await conectar();
  const hoja = doc.sheetsByTitle['cotizaciones'];
  if (!hoja) throw new Error("Falta la hoja 'cotizaciones'");

  const filas = await hoja.getRows();
  const fila = filas.find((f) => String(f.get('cotizacionId')) === String(cotizacionId));

  if (!fila) return null;

  const estadoActual = texto(fila.get('estado'));
  if (estadoActual !== 'PENDIENTE') {
    throw errorHttp(409, `La cotización ya fue ${estadoActual === 'ACEPTADA' ? 'aceptada' : 'rechazada'}`);
  }

  if (estado === 'RECHAZADA') {
    exigirColumnas(hoja, ['motivoRechazo'], 'cotizaciones');
    fila.set('motivoRechazo', motivo);
  }

  fila.set('estado', estado);
  await fila.save();

  return fila.toObject();
}

/**
 * Cotizaciones ligadas a una solicitud de servicio, con cliente e ítems (sin los inductores de
 * costo, que son de uso interno). Sirve para rearmar el PDF de cada cotización al cerrar el servicio.
 */
async function getCotizacionesPorSolicitud(solicitudId) {
  const doc = await conectar();
  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaClientes = doc.sheetsByTitle['clientes'];
  const hojaItems = doc.sheetsByTitle['items'];
  const hojaItemsCotizacion = doc.sheetsByTitle['itemsCotizacion'];
  const hojaDetalleImpresora = doc.sheetsByTitle['detalleImpresora'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");
  if (!hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");

  const cotizaciones = (await hojaCotizaciones.getRows())
    .map((f) => f.toObject())
    .filter((c) => String(c.solicitudId ?? '') === String(solicitudId));
  if (cotizaciones.length === 0) return [];

  const clientes = hojaClientes ? (await hojaClientes.getRows()).map((f) => f.toObject()) : [];
  const items = (await hojaItems.getRows()).map((f) => f.toObject());
  const itemsCotizacion = (await hojaItemsCotizacion.getRows()).map((f) => f.toObject());
  const detalles = hojaDetalleImpresora ? (await hojaDetalleImpresora.getRows()).map((f) => f.toObject()) : [];

  return cotizaciones.map((c) => {
    const cliente = clientes.find((cl) => String(cl.clienteId) === String(c.clienteId));
    const lineas = itemsCotizacion
      .filter((ic) => String(ic.cotizacionId) === String(c.cotizacionId))
      .sort((a, b) => Number(a.orden) - Number(b.orden))
      .map((ic) => {
        const item = items.find((i) => String(i.itemId) === String(ic.itemId)) || {};
        const detalle = detalles.find((d) => String(d.itemCotizacionId) === String(ic.itemCotizacionId));
        return {
          tipo: item.tipo || '',
          nombre: item.nombre || '',
          descripcion: item.descripcion || '',
          cantidad: Number(ic.cantidad) || 0,
          precioUnitario: Number(item.precioUnitario) || 0,
          subtotal: Number(ic.subtotal) || 0,
          detalleImpresora: detalle || null,
        };
      });

    return {
      cotizacionId: c.cotizacionId,
      numeroCotizacion: c.numeroCotizacion,
      fecha: c.fecha,
      solicitante: c.solicitante,
      moneda: c.moneda,
      estado: c.estado,
      subtotal: Number(c.subtotal) || 0,
      igv: Number(c.igv) || 0,
      total: Number(c.total) || 0,
      cliente: cliente
        ? { nombre: cliente.nombre, ruc: cliente.ruc, direccion: cliente.direccion, correoElectronico: cliente.correoElectronico }
        : null,
      items: lineas,
    };
  });
}

module.exports = {
  createCotizacion: createCotizacionCompleta, // compatibilidad
  createCotizacionCompleta,
  getAllCotizaciones,
  getCotizacionesPorSolicitud,
  updateEstadoCotizacion,
};
