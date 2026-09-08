const { conectar } = require('../services/sheetsService');

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
 * Crea la cotización completa: cabecera + ítems + relación + detalles de impresora.
 *
 * items: [{ tipo, nombre, descripcion, cantidad, precioUnitario, orden, detalleImpresora? }]
 * detalleImpresora: { fecha, tienda, cargo, marca, modelo, numeroSerie, casoHD }
 */
async function createCotizacionCompleta({
  clienteId,
  numeroCotizacion,
  fecha,
  solicitante,
  moneda = 'SOLES',
  estado = 'PENDIENTE',
  items = [],
}) {
  const doc = await conectar();

  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaItems = doc.sheetsByTitle['items'];
  const hojaItemsCotizacion = doc.sheetsByTitle['itemsCotizacion'];
  const hojaDetalleImpresora = doc.sheetsByTitle['detalleImpresora'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");
  if (!hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");
  if (!hojaDetalleImpresora) throw new Error("Falta la hoja 'detalleImpresora'");

  // Lectura de filas (secuencial para no forzar el estado interno de la librería)
  const filasCot = await hojaCotizaciones.getRows();
  const filasItems = await hojaItems.getRows();
  const filasIC = await hojaItemsCotizacion.getRows();
  const filasDI = await hojaDetalleImpresora.getRows();

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

  // IDs base: se calculan una sola vez y se incrementan localmente
  const cotizacionId = siguienteId(filasCot, 'cotizacionId');
  let itemIdSeq = siguienteId(filasItems, 'itemId');
  let itemCotizacionIdSeq = siguienteId(filasIC, 'itemCotizacionId');
  let detalleImpresoraIdSeq = siguienteId(filasDI, 'detalleImpresoraId');

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
  const filaCotizacion = await hojaCotizaciones.addRow({
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
  });

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

  const cotizacionCreada = {
    ...filaCotizacion.toObject(),
    cotizacionId,
    numeroCotizacion: numero,
    subtotal,
    igv,
    total,
    items: lineas,
  };

  console.log('Cotización creada:', cotizacionCreada.numeroCotizacion, `(${lineas.length} ítems)`);
  return cotizacionCreada;
}

module.exports = {
  createCotizacion: createCotizacionCompleta, // compatibilidad
  createCotizacionCompleta,
};
