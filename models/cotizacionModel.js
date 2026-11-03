const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, mismoId, cargarEncabezados, exigirColumnas, siguienteId, borrarFilas } = require('../services/hojasUtils');
const { GARANTIA_MESES_DEFECTO } = require('../services/garantia');
const { ESTADO, ACCION, aNumeroONulo, motivoDeBloqueo } = require('../services/validacion');
const estimacionModel = require('./estimacionModel');
const validacionModel = require('./validacionModel');

const IGV_RATE = 0.18;

// Un ítem es "Título" si viene marcado o si cantidad y precio son 0
function esTitulo(item) {
  if (item.tipo === 'Título') return true;
  return Number(item.cantidad) === 0 && Number(item.precioUnitario) === 0;
}

function generarNumeroCotizacion(cotizacionId) {
  const anio = new Date().getFullYear();
  return `COT-${anio}-${String(cotizacionId).padStart(4, '0')}`;
}

// Las hojas que forman una cotización. Se leen de a una para no forzar el estado interno de la librería.
async function hojasDeCotizacion(doc) {
  const hojas = {
    hojaCotizaciones: doc.sheetsByTitle['cotizaciones'],
    hojaItems: doc.sheetsByTitle['items'],
    hojaItemsCotizacion: doc.sheetsByTitle['itemsCotizacion'],
    hojaDetalleImpresora: doc.sheetsByTitle['detalleImpresora'],
  };

  if (!hojas.hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");
  if (!hojas.hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojas.hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");
  if (!hojas.hojaDetalleImpresora) throw new Error("Falta la hoja 'detalleImpresora'");

  // Aún no se leyeron las filas de estas hojas, así que sus encabezados no están cargados
  await cargarEncabezados(hojas.hojaCotizaciones, hojas.hojaItemsCotizacion, hojas.hojaDetalleImpresora);

  exigirColumnas(hojas.hojaCotizaciones, ['subtotal', 'igv', 'total', 'garantiaMeses'], 'cotizaciones');
  exigirColumnas(
    hojas.hojaItemsCotizacion,
    ['itemCotizacionId', 'cotizacionId', 'itemId', 'cantidad', 'subtotal', 'orden', 'costoUnitario', 'costoSubtotal'],
    'itemsCotizacion'
  );
  exigirColumnas(
    hojas.hojaDetalleImpresora,
    ['detalleImpresoraId', 'itemCotizacionId', 'fecha', 'tienda', 'cargo', 'marca', 'modelo', 'numeroSerie', 'casoHD'],
    'detalleImpresora'
  );
  return hojas;
}

// Totales calculados en el servidor a partir de los ítems que envía el navegador
function calcularItems(items) {
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
      costoUnitario: item.costoUnitario ?? null,
      orden: Number.isInteger(item.orden) ? item.orden : indice,
      detalleImpresora: item.detalleImpresora || null,
    };
  });

  subtotal = Number(subtotal.toFixed(2));
  const igv = Number((subtotal * IGV_RATE).toFixed(2));
  const total = Number((subtotal + igv).toFixed(2));
  return { itemsCalculados, subtotal, igv, total };
}

// Escribe las líneas de una cotización: items -> itemsCotizacion -> detalleImpresora. `secuencias` trae el próximo id
// libre de cada hoja y se va incrementando. `costosItems` es el costo de compra de cada ítem (de la estimación).
async function escribirLineas({ hojaItems, hojaItemsCotizacion, hojaDetalleImpresora }, secuencias, cotizacionId, itemsCalculados, costosItems) {
  const lineas = [];
  for (const [indice, item] of itemsCalculados.entries()) {
    const itemId = secuencias.item++;
    const itemCotizacionId = secuencias.itemCotizacion++;

    // El ítem se escribe al final: si algo falla antes, queda una línea sin ítem (que al corregir la cotización se
    // reemplaza junto con las demás) y nunca un ítem huérfano que nadie vuelva a encontrar.
    await hojaItemsCotizacion.addRow({
      itemCotizacionId,
      cotizacionId,
      itemId,
      cantidad: item.titulo ? '' : item.cantidad,
      subtotal: item.titulo ? '' : item.subtotalItem,
      orden: item.orden,
      // Costo de compra (uso interno): solo los ítems que lo llevan, es decir, no los títulos ni los servicios.
      costoUnitario: costosItems[indice]?.costoUnitario ?? '',
      costoSubtotal: costosItems[indice]?.costoSubtotal ?? '',
    });

    let detalleImpresora = null;
    if (item.tipo === 'Impresora' && item.detalleImpresora) {
      const d = item.detalleImpresora;
      const detalleImpresoraId = secuencias.detalleImpresora++;
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

    await hojaItems.addRow({
      itemId,
      tipo: item.tipo,
      nombre: item.nombre,
      descripcion: item.descripcion,
      precioUnitario: item.titulo ? '' : item.precioUnitario,
    });

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
  return lineas;
}

/**
 * Crea la cotización completa: cabecera + ítems + relación + detalles de impresora
 * + estimación de costos (uso interno, no se imprime en el PDF del cliente). La estimación es obligatoria: se calcula
 * y valida antes de escribir nada, así un error no deja una cotización sin sus costos.
 *
 * La estimación espera la validación del jefe (EN REVISIÓN) y el jefe recibe el aviso; si quien crea es el jefe,
 * nace validada.
 *
 * items: [{ tipo, nombre, descripcion, cantidad, precioUnitario, costoUnitario?, orden, detalleImpresora? }]
 *   costoUnitario es el costo de compra (obligatorio en Producto e Impresora; los Servicio no lo llevan)
 * detalleImpresora: { fecha, tienda, cargo, marca, modelo, numeroSerie, casoHD }
 * estimacion: { destino, tipoCambio?, actividades } (ver services/calculoCostos.js)
 * usuario: quien crea la cotización (queda como autor de la estimación)
 * justificacion: solo si crea el jefe y el margen queda bajo el mínimo
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
  // Meses de garantía del servicio (4 a 6). El servicio la hereda de la cotización aceptada.
  garantiaMeses = GARANTIA_MESES_DEFECTO,
  items = [],
  estimacion,
  usuario,
  justificacion,
}) {
  const doc = await conectar();
  const hojas = await hojasDeCotizacion(doc);
  const { hojaCotizaciones, hojaItems, hojaItemsCotizacion, hojaDetalleImpresora } = hojas;

  // Lectura de filas (secuencial para no forzar el estado interno de la librería)
  const filasCot = await hojaCotizaciones.getRows();
  const filasItems = await hojaItems.getRows();
  const filasIC = await hojaItemsCotizacion.getRows();
  const filasDI = await hojaDetalleImpresora.getRows();

  const { itemsCalculados, subtotal, igv, total } = calcularItems(items);

  // La estimación se calcula y valida antes de escribir: si falta una tarifa o un costo de compra, no se crea nada.
  // La venta es el subtotal, sin IGV.
  const estimacionPreparada = await estimacionModel.prepararEstimacion({
    entradas: estimacion,
    items: itemsCalculados,
    ventaSinIGV: subtotal,
    moneda,
    solicitudId,
    usuario,
    justificacion,
  });
  const costosItems = estimacionPreparada.resultado.costosItems;

  // IDs base: se calculan una sola vez y se incrementan localmente. El de la cotización también mira las estimaciones:
  // si una creación anterior falló después de guardar la estimación, ese id no se reutiliza.
  const cotizacionId = Math.max(
    siguienteId(filasCot, 'cotizacionId'),
    siguienteId(estimacionPreparada.filasEstimaciones, 'cotizacionId')
  );
  const secuencias = {
    item: siguienteId(filasItems, 'itemId'),
    itemCotizacion: siguienteId(filasIC, 'itemCotizacionId'),
    detalleImpresora: siguienteId(filasDI, 'detalleImpresoraId'),
  };
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
  datosCotizacion.garantiaMeses = garantiaMeses;
  const filaCotizacion = await hojaCotizaciones.addRow(datosCotizacion);

  // 2. Estimación de costos (uso interno: viáticos, mano de obra, materiales, imprevistos y margen). Va antes que las
  // líneas porque una cotización sin estimación queda exenta de la validación: si no se pudo guardar, se retira también
  // la cabecera (si esto último falla, el error original es el que importa).
  let resumenEstimacion;
  try {
    resumenEstimacion = await estimacionModel.registrarEstimacion(estimacionPreparada, {
      cotizacionId,
      solicitudId,
      usuario,
    });
  } catch (error) {
    await borrarFilas(hojaCotizaciones, [filaCotizacion]).catch((falloAlRetirar) => {
      console.error('Cotización: no se pudo retirar la cabecera tras el error', falloAlRetirar.message);
    });
    throw error;
  }

  // 3. Líneas y aviso al jefe (con todo ya guardado)
  const lineas = await escribirLineas(hojas, secuencias, cotizacionId, itemsCalculados, costosItems);
  await validacionModel.avisarEnvio(
    { ...resumenEstimacion, cotizacionId, costoFinal: resumenEstimacion.costoTotal, margenFinal: resumenEstimacion.margen },
    usuario
  );

  const cotizacionCreada = {
    ...filaCotizacion.toObject(),
    cotizacionId,
    numeroCotizacion: numero,
    subtotal,
    igv,
    total,
    items: lineas,
    estimacion: resumenEstimacion,
  };

  console.log('Cotización creada:', cotizacionCreada.numeroCotizacion, `(${lineas.length} ítems, costo estimado ${resumenEstimacion.costoTotal}, ${resumenEstimacion.estado})`);
  return cotizacionCreada;
}

/**
 * Corrige una cotización que el jefe devolvió: reemplaza sus ítems y guarda una estimación nueva (versión siguiente) que
 * vuelve a esperar la validación. La versión anterior queda de historial; el cliente y la solicitud no cambian.
 *
 * Primero se valida todo (incluida la estimación) y recién entonces se escribe. Escribir en el Excel no es una
 * transacción: si algo falla a medias, la cotización sigue DEVUELTA y se puede guardar de nuevo, porque cada intento
 * parte de reemplazar todas las líneas actuales.
 */
async function editarCotizacionDevuelta({ cotizacionId, solicitante, moneda = 'SOLES', garantiaMeses = GARANTIA_MESES_DEFECTO, items = [], estimacion, usuario, justificacion }) {
  const doc = await conectar();
  const hojas = await hojasDeCotizacion(doc);
  const { hojaCotizaciones, hojaItems, hojaItemsCotizacion, hojaDetalleImpresora } = hojas;

  const filaCotizacion = (await hojaCotizaciones.getRows()).find(f => mismoId(f.get('cotizacionId'), cotizacionId));
  if (!filaCotizacion) return null;
  if (texto(filaCotizacion.get('estado')) !== 'PENDIENTE') {
    throw errorHttp(409, 'Solo se puede corregir una cotización que todavía está pendiente');
  }

  const vigente = await estimacionModel.getVigente(cotizacionId);
  if (!vigente || vigente.estado !== ESTADO.DEVUELTA) {
    throw errorHttp(409, 'Solo se puede corregir una cotización devuelta por el jefe');
  }

  const { itemsCalculados, subtotal, igv, total } = calcularItems(items);
  const solicitudId = texto(filaCotizacion.get('solicitudId'));
  const estimacionPreparada = await estimacionModel.prepararEstimacion({
    entradas: estimacion,
    items: itemsCalculados,
    ventaSinIGV: subtotal,
    moneda,
    solicitudId,
    usuario,
    justificacion,
  });

  // 1. Se quitan las líneas actuales. Se leen directo de la hoja (sin caché) porque se borra por número de fila.
  const [lineasActuales, itemsActuales, detallesActuales] = await Promise.all([
    hojaItemsCotizacion.getRows({ offset: 0 }),
    hojaItems.getRows({ offset: 0 }),
    hojaDetalleImpresora.getRows({ offset: 0 }),
  ]);
  const propias = lineasActuales.filter(f => mismoId(f.get('cotizacionId'), cotizacionId));
  const idsLinea = new Set(propias.map(f => texto(f.get('itemCotizacionId'))));
  // Un ítem que otra cotización también usa no se toca
  const idsItemDeOtras = new Set(lineasActuales.filter(f => !propias.includes(f)).map(f => texto(f.get('itemId'))));
  const idsItemPropios = new Set(propias.map(f => texto(f.get('itemId'))).filter(id => !idsItemDeOtras.has(id)));

  const detallesPropios = detallesActuales.filter(f => idsLinea.has(texto(f.get('itemCotizacionId'))));
  const itemsPropios = itemsActuales.filter(f => idsItemPropios.has(texto(f.get('itemId'))));

  await borrarFilas(hojaDetalleImpresora, detallesPropios);
  await borrarFilas(hojaItemsCotizacion, propias);
  await borrarFilas(hojaItems, itemsPropios);

  // 2. Las líneas nuevas, con ids que siguen a los que quedaron
  const quedan = (filas, borradas) => filas.filter(f => !borradas.includes(f));
  const secuencias = {
    item: siguienteId(quedan(itemsActuales, itemsPropios), 'itemId'),
    itemCotizacion: siguienteId(quedan(lineasActuales, propias), 'itemCotizacionId'),
    detalleImpresora: siguienteId(quedan(detallesActuales, detallesPropios), 'detalleImpresoraId'),
  };
  const lineas = await escribirLineas(hojas, secuencias, cotizacionId, itemsCalculados, estimacionPreparada.resultado.costosItems);

  // 3. Cabecera
  filaCotizacion.set('solicitante', solicitante);
  filaCotizacion.set('moneda', moneda);
  filaCotizacion.set('subtotal', subtotal);
  filaCotizacion.set('igv', igv);
  filaCotizacion.set('total', total);
  filaCotizacion.set('garantiaMeses', garantiaMeses);
  await filaCotizacion.save();

  // 4. Estimación nueva (versión siguiente) y aviso al jefe
  const resumenEstimacion = await estimacionModel.registrarEstimacion(estimacionPreparada, {
    cotizacionId,
    solicitudId,
    usuario,
    version: vigente.version + 1,
  });
  await validacionModel.avisarEnvio(
    { ...resumenEstimacion, cotizacionId, costoFinal: resumenEstimacion.costoTotal, margenFinal: resumenEstimacion.margen },
    usuario
  );

  console.log('Cotización corregida:', texto(filaCotizacion.get('numeroCotizacion')), `(versión ${resumenEstimacion.version}, ${resumenEstimacion.estado})`);
  return {
    ...filaCotizacion.toObject(),
    cotizacionId: Number(cotizacionId),
    subtotal,
    igv,
    total,
    items: lineas,
    estimacion: resumenEstimacion,
  };
}

/**
 * Lista las cotizaciones (cabecera) con el nombre del cliente resuelto y el estado de su validación,
 * paginadas y con filtro opcional por texto (cliente/número) y por estado.
 */
async function getAllCotizaciones(page, limit, search, estado) {
  const doc = await conectar();
  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaClientes = doc.sheetsByTitle['clientes'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");

  const filasCot = await hojaCotizaciones.getRows();
  const filasClientes = hojaClientes ? await hojaClientes.getRows() : [];
  const vigentes = await estimacionModel.getVigentes();
  const nombrePorClienteId = new Map(
    filasClientes.map((f) => [String(f.get('clienteId')), f.get('nombre')])
  );

  const cotizaciones = filasCot
    .map((f) => f.toObject())
    .map((c) => {
      // Las cotizaciones anteriores al control de costos no tienen estimación: validacionEstado queda vacío.
      const vigente = vigentes.get(String(c.cotizacionId));
      return {
        ...c,
        clienteNombre: nombrePorClienteId.get(String(c.clienteId)) || '',
        estimacionId: vigente?.estimacionId ?? null,
        validacionEstado: vigente?.estado ?? '',
        margen: vigente?.margenFinal ?? null,
      };
    })
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
 * Una cotización con estimación solo se decide una vez que el jefe la validó (las anteriores al control están exentas).
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

  const bloqueo = motivoDeBloqueo(await estimacionModel.getVigente(cotizacionId));
  if (bloqueo) throw errorHttp(409, bloqueo);

  if (estado === 'RECHAZADA') {
    exigirColumnas(hoja, ['motivoRechazo'], 'cotizaciones');
    fila.set('motivoRechazo', motivo);
  }

  fila.set('estado', estado);
  await fila.save();

  return fila.toObject();
}

/**
 * Cotizaciones listas para armar su PDF, con cliente e ítems (sin los costos, que son de uso interno).
 * `filtro` elige cuáles de la hoja de cotizaciones; si no hay ninguna se devuelve [] sin leer lo demás.
 */
async function cotizacionesParaPdf(filtro) {
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
    .filter(filtro);
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

/**
 * Cotizaciones ligadas a una solicitud de servicio, con cliente e ítems. Sirve para rearmar el PDF de cada
 * cotización al cerrar el servicio. Las que el jefe aún no validó (o devolvió) no se entregaron al cliente: no se incluyen.
 */
async function getCotizacionesPorSolicitud(solicitudId) {
  const cotizaciones = await cotizacionesParaPdf((c) => String(c.solicitudId ?? '') === String(solicitudId));
  if (cotizaciones.length === 0) return [];

  const vigentes = await estimacionModel.getVigentes();
  return cotizaciones.filter((c) => !motivoDeBloqueo(vigentes.get(String(c.cotizacionId))));
}

/**
 * Una cotización lista para su PDF, o null si no existe. Si el jefe aún no la validó (o la devolvió) no hay PDF: error 409.
 */
async function getCotizacionPorId(cotizacionId) {
  const [cotizacion] = await cotizacionesParaPdf((c) => mismoId(c.cotizacionId, cotizacionId));
  if (!cotizacion) return null;

  const bloqueo = motivoDeBloqueo(await estimacionModel.getVigente(cotizacionId));
  if (bloqueo) throw errorHttp(409, bloqueo);
  return cotizacion;
}

/**
 * Lo necesario para reabrir una cotización devuelta en el formulario: cabecera, cliente, ítems con su costo de compra,
 * lo que se ingresó en la estimación y el motivo por el que el jefe la devolvió.
 */
async function getCotizacionParaEdicion(cotizacionId) {
  const doc = await conectar();
  const hojaCotizaciones = doc.sheetsByTitle['cotizaciones'];
  const hojaClientes = doc.sheetsByTitle['clientes'];
  const hojaItems = doc.sheetsByTitle['items'];
  const hojaItemsCotizacion = doc.sheetsByTitle['itemsCotizacion'];
  const hojaDetalleImpresora = doc.sheetsByTitle['detalleImpresora'];

  if (!hojaCotizaciones) throw new Error("Falta la hoja 'cotizaciones'");
  if (!hojaItems) throw new Error("Falta la hoja 'items'");
  if (!hojaItemsCotizacion) throw new Error("Falta la hoja 'itemsCotizacion'");

  const cotizacion = (await hojaCotizaciones.getRows()).map((f) => f.toObject()).find((c) => mismoId(c.cotizacionId, cotizacionId));
  if (!cotizacion) return null;

  const vigente = await estimacionModel.getVigente(cotizacionId);
  if (!vigente || vigente.estado !== ESTADO.DEVUELTA) {
    throw errorHttp(409, 'Solo se puede corregir una cotización devuelta por el jefe');
  }

  const clientes = hojaClientes ? (await hojaClientes.getRows()).map((f) => f.toObject()) : [];
  const items = (await hojaItems.getRows()).map((f) => f.toObject());
  const itemsCotizacion = (await hojaItemsCotizacion.getRows()).map((f) => f.toObject());
  const detalles = hojaDetalleImpresora ? (await hojaDetalleImpresora.getRows()).map((f) => f.toObject()) : [];
  const bitacora = await validacionModel.getBitacora(doc);

  const cliente = clientes.find((cl) => mismoId(cl.clienteId, cotizacion.clienteId));
  const devolucion = bitacora.filter((a) => mismoId(a.estimacionId, vigente.estimacionId) && a.accion === ACCION.DEVOLVER).pop();

  return {
    cotizacionId: Number(cotizacion.cotizacionId),
    numeroCotizacion: cotizacion.numeroCotizacion,
    clienteId: Number(cotizacion.clienteId),
    cliente: cliente
      ? {
          clienteId: Number(cliente.clienteId),
          nombre: cliente.nombre,
          direccion: cliente.direccion,
          ruc: cliente.ruc,
          correoElectronico: cliente.correoElectronico,
          tipoPersona: cliente.tipoPersona,
        }
      : null,
    solicitante: texto(cotizacion.solicitante),
    moneda: texto(cotizacion.moneda) || 'SOLES',
    garantiaMeses: aNumeroONulo(cotizacion.garantiaMeses),
    solicitudId: aNumeroONulo(cotizacion.solicitudId),
    items: itemsCotizacion
      .filter((ic) => mismoId(ic.cotizacionId, cotizacionId))
      .sort((a, b) => Number(a.orden) - Number(b.orden))
      .map((ic) => {
        const item = items.find((i) => mismoId(i.itemId, ic.itemId)) || {};
        const detalle = detalles.find((d) => mismoId(d.itemCotizacionId, ic.itemCotizacionId));
        return {
          tipo: texto(item.tipo),
          nombre: texto(item.nombre),
          descripcion: texto(item.descripcion),
          cantidad: aNumeroONulo(ic.cantidad) ?? 0,
          precioUnitario: aNumeroONulo(item.precioUnitario) ?? 0,
          costoUnitario: aNumeroONulo(ic.costoUnitario),
          detalleImpresora: detalle
            ? {
                fecha: texto(detalle.fecha),
                tienda: texto(detalle.tienda),
                cargo: texto(detalle.cargo),
                marca: texto(detalle.marca),
                modelo: texto(detalle.modelo),
                numeroSerie: texto(detalle.numeroSerie),
                casoHD: texto(detalle.casoHD),
              }
            : null,
        };
      }),
    estimacion: { estimacionId: vigente.estimacionId, version: vigente.version, entradas: vigente.entradas },
    devolucion: devolucion ? { usuario: devolucion.usuario, fecha: devolucion.fecha, motivo: devolucion.justificacion } : null,
  };
}

module.exports = {
  createCotizacion: createCotizacionCompleta, // compatibilidad
  createCotizacionCompleta,
  editarCotizacionDevuelta,
  getAllCotizaciones,
  getCotizacionesPorSolicitud,
  getCotizacionPorId,
  getCotizacionParaEdicion,
  updateEstadoCotizacion,
};
