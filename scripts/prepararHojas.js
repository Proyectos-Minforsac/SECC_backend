// Agrega al Excel las hojas y columnas que necesita el código y que todavía no existen: la columna "tipo" de
// visitasProgramadas, "etapasFinalizadas" y "garantiaMeses" de visitasTecnicas, "tipoServicio" de solicitudes,
// "garantiaMeses" de cotizaciones, "costoUnitario" y "costoSubtotal" de itemsCotizacion, las columnas de la estimación
// de inductoresCosto, "cotizacionId" de notificaciones, "liquidacionInstalacionEn" y "liquidacionFinalEn" de visitasTecnicas
// "referencia" de resumenProceso y las hojas "notificaciones", "tarifario", "parametrosCosto", "estimacionesCosto",
// "ajustesCosto", "costosReales" y "resumenProceso".
// Es seguro repetirlo: lo que ya existe se deja como está y nunca se tocan las filas de datos.
//   npm run hojas:preparar
const { conectar } = require('../services/sheetsService');

const COLUMNAS_NUEVAS = {
  visitasProgramadas: ['tipo'],
  // Cuándo se liquidaron los costos reales: de diagnóstico e instalación (al finalizar la instalación) y de mantenimiento y
  // soporte (al cerrar el servicio).
  visitasTecnicas: ['etapasFinalizadas', 'garantiaMeses', 'liquidacionInstalacionEn', 'liquidacionFinalEn'],
  solicitudes: ['tipoServicio'],
  cotizaciones: ['garantiaMeses'],
  // Costo de compra de cada ítem (uso interno): no aparece en el PDF del cliente.
  itemsCotizacion: ['costoUnitario', 'costoSubtotal'],
  // Líneas de la estimación por actividad y rubro. La hoja ya existía con las 7 primeras columnas.
  inductoresCosto: ['estimacionId', 'etapa', 'nTecnicos', 'dias', 'noches', 'viajes'],
  // Cotización a la que lleva el aviso (revisar una validación, corregir una devolución...).
  notificaciones: ['cotizacionId'],
  // La hoja resumenProceso ya existía si se preparó el Excel en la fase anterior: se le agrega la referencia del servicio.
  resumenProceso: ['referencia'],
};

const HOJAS_NUEVAS = {
  notificaciones: [
    'notificacionId',
    'rolDestino',
    'tecnicoDestino',
    'tipo',
    'mensaje',
    'fecha',
    'leida',
    'solicitudId',
    'clave',
  ],
  // Tarifas de los inductores de costo. Solo se agregan filas: un cambio es una tarifa nueva (queda el historial).
  tarifario: [
    'tarifaId',
    'inductor',
    'destino',
    'monto',
    'vigenteDesde',
    'registradoPor',
    'registradoEn',
  ],
  // Parámetros de control de costos que fija el jefe (margen mínimo, tasa de imprevistos...).
  parametrosCosto: [
    'clave',
    'valor',
    'actualizadoPor',
    'actualizadoEn',
  ],
  // Una fila por cotización: costos por rubro, margen, tarifas usadas y quién la creó y validó. Queda congelada.
  estimacionesCosto: [
    'estimacionId',
    'cotizacionId',
    'solicitudId',
    'version',
    'estado',
    'tipoServicio',
    'destino',
    'moneda',
    'tipoCambio',
    'costoDiagnostico',
    'costoTransporte',
    'costoHospedaje',
    'costoAlimentacion',
    'costoManoObra',
    'costoMateriales',
    'costoImprevistos',
    'tasaImprevistos',
    'costoParametrico',
    'ventaSinIGV',
    'ventaSoles',
    'margenParametrico',
    'costoAnalogo',
    'casosAnalogo',
    'costoFinal',
    'margenFinal',
    'entradas',
    'tarifasUsadas',
    'creadaPor',
    'creadaEn',
    'enviadaEn',
    'validadaPor',
    'validadaEn',
  ],
  // Bitácora de la validación del jefe: una fila por envío o decisión. Solo se agregan filas, nunca se modifican.
  ajustesCosto: [
    'ajusteId',
    'estimacionId',
    'cotizacionId',
    'version',
    'accion',
    'costoAntes',
    'costoDespues',
    'margenAntes',
    'margenDespues',
    'justificacion',
    'usuarioId',
    'usuario',
    'rol',
    'fecha',
  ],
  // Costos reales del servicio por etapa y rubro: los directos que se confirman en cada liquidación y los imprevistos
  // que se registran durante el servicio (doble pasaje, material faltante...).
  costosReales: [
    'costoRealId',
    'visitaId',
    'etapa',
    'rubro',
    'clase',
    'concepto',
    'cantidad',
    'costoUnitario',
    'subtotal',
    'motivo',
    'estado',
    'visitaProgramadaId',
    'registradoPor',
    'registradoEn',
    'confirmadoPor',
  ],
  // Una fila por servicio cerrado: venta, costo estimado y real, márgenes y desviaciones. Es lo que alimenta el indicador.
  resumenProceso: [
    'resumenId',
    'visitaId',
    'solicitudId',
    'tipoServicio',
    'destino',
    'cotizaciones',
    'ventaSoles',
    'costoParametrico',
    'costoAnalogo',
    'costoEstimado',
    'costoReal',
    'imprevistosProvision',
    'imprevistosReal',
    'margenEstimado',
    'margenReal',
    'desviacionCosto',
    'desviacionMargen',
    'origen',
    'cerradoPor',
    'cerradoEn',
    // Nombre con el que se reconoce el servicio: el cliente en los del sistema, la referencia del Excel en los históricos
    'referencia',
  ],
  // Solo se crea si no existía (en ese caso ya tenía estas 7 columnas); las nuevas se agregan arriba.
  inductoresCosto: [
    'inductorCostoId',
    'cotizacionId',
    'categoria',
    'descripcion',
    'cantidad',
    'costoUnitario',
    'subtotal',
    'estimacionId',
    'etapa',
    'nTecnicos',
    'dias',
    'noches',
    'viajes',
  ],
};

(async () => {
  const doc = await conectar();

  // Primero las hojas nuevas: así las columnas que se agregan a continuación también alcanzan a las recién creadas.
  for (const [titulo, encabezados] of Object.entries(HOJAS_NUEVAS)) {
    if (doc.sheetsByTitle[titulo]) {
      console.log(`${titulo}: la hoja ya existe`);
      continue;
    }
    await doc.addSheet({ title: titulo, headerValues: encabezados });
    console.log(`${titulo}: hoja creada`);
  }

  for (const [titulo, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
    const hoja = doc.sheetsByTitle[titulo];
    if (!hoja) {
      console.error(`${titulo}: no existe la hoja, se omite`);
      continue;
    }

    await hoja.loadHeaderRow();
    const faltantes = columnas.filter(c => !hoja.headerValues.includes(c));
    if (faltantes.length === 0) {
      console.log(`${titulo}: ya tiene ${columnas.join(', ')}`);
      continue;
    }

    const encabezados = [...hoja.headerValues, ...faltantes];
    if (hoja.columnCount < encabezados.length) {
      await hoja.resize({ rowCount: hoja.rowCount, columnCount: encabezados.length });
    }
    await hoja.setHeaderRow(encabezados);
    console.log(`${titulo}: columna(s) agregada(s): ${faltantes.join(', ')}`);
  }

  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
