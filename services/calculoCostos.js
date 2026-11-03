// Cálculo de la estimación de costos de una cotización (solo lógica, sin acceso al Excel, para poder probarla).
//
// Es la misma fórmula que usa el frontend (src/services/calculoCostos.ts) para mostrar el resultado mientras el
// trabajador escribe. El servidor la vuelve a calcular al guardar y esa es la que vale: si cambias una, cambia la otra.
//
// Por cada actividad (instalación, mantenimiento, soporte), con N técnicos (RN-02):
//   transporte   = N × tarifa de pasaje × viajes
//   hospedaje    = N × tarifa de noche × noches
//   alimentación = N × tarifa de alimentación × días
//   mano de obra = N × tarifa de jornada × días
// Materiales = Σ cantidad × costo de compra de los ítems (RN-03). Diagnóstico = oferta aceptada (RN-04).
// Imprevistos = tasa % × costos directos futuros, es decir, sin el diagnóstico que ya se pagó (RN-05).
// Margen = (venta sin IGV − costo total) / venta sin IGV × 100, en soles (RN-01, RN-12).

const ACTIVIDADES = ['INSTALACION', 'MANTENIMIENTO', 'SOPORTE'];

const NOMBRE_ACTIVIDAD = {
  INSTALACION: 'Instalación',
  MANTENIMIENTO: 'Mantenimiento preventivo',
  SOPORTE: 'Soporte técnico',
};

// campo del resultado, categoría que se guarda, inductor del tarifario y cómo se llama en los mensajes
const RUBROS = [
  { campo: 'transporte', categoria: 'TRANSPORTE', inductor: 'PASAJE', etiqueta: 'transporte', tarifa: 'el pasaje' },
  { campo: 'hospedaje', categoria: 'HOSPEDAJE', inductor: 'NOCHE', etiqueta: 'hospedaje', tarifa: 'la noche de hospedaje' },
  { campo: 'alimentacion', categoria: 'ALIMENTACION', inductor: 'ALIMENTACION', etiqueta: 'alimentación', tarifa: 'la alimentación diaria' },
  { campo: 'manoObra', categoria: 'MANO_OBRA', inductor: 'JORNADA', etiqueta: 'mano de obra', tarifa: 'la jornada de mano de obra' },
];

// Lo que se ingresa: máximos razonables para detectar errores de tipeo (un 300 en vez de 3).
const CAMPOS = {
  nTecnicos: { etiqueta: 'técnicos', max: 50 },
  dias: { etiqueta: 'días', max: 365 },
  noches: { etiqueta: 'noches', max: 365 },
  viajes: { etiqueta: 'viajes', max: 50 },
  visitas: { etiqueta: 'visitas', max: 50 },
  diasPorVisita: { etiqueta: 'días por visita', max: 30 },
  nochesPorVisita: { etiqueta: 'noches por visita', max: 30 },
};

const CAMPOS_DE = {
  INSTALACION: ['nTecnicos', 'dias', 'noches', 'viajes'],
  MANTENIMIENTO: ['nTecnicos', 'visitas', 'diasPorVisita', 'nochesPorVisita'],
  SOPORTE: ['nTecnicos', 'visitas', 'diasPorVisita', 'nochesPorVisita'],
};

// Los ítems Servicio no llevan costo de compra: su costo ya está en la mano de obra.
const COSTO_OBLIGATORIO = ['Producto', 'Impresora'];
const COSTO_OPCIONAL = ['Alquiler'];
const COSTO_ITEM_MAXIMO = 10000000;
const TIPO_CAMBIO_MAXIMO = 100;

const redondear = numero => Math.round((numero + Number.EPSILON) * 100) / 100;

// Margen (RN-01): (venta - costo) / venta × 100, ambos en soles y sin IGV. Sin venta no hay con qué compararlo: null.
const calcularMargen = (ventaSoles, costoTotal) =>
  ventaSoles > 0 ? redondear(((ventaSoles - costoTotal) / ventaSoles) * 100) : null;

// Número entero entre 0 y `max`, o null si no lo es. Vacío cuenta como 0.
function leerEntero(valor, max) {
  if (valor === undefined || valor === null || valor === '') return 0;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 && numero <= max ? numero : null;
}

// Mismo criterio que la cotización: un ítem es "Título" si viene marcado o si cantidad y precio son 0.
const esTitulo = item => item.tipo === 'Título' || (Number(item.cantidad) === 0 && Number(item.precioUnitario) === 0);

// Lo ingresado por actividad, limpio (enteros; 0 donde falte). Es lo que se guarda como las "entradas" de la estimación.
function normalizarActividades(actividades) {
  const resultado = {};
  for (const etapa of ACTIVIDADES) {
    resultado[etapa] = Object.fromEntries(
      CAMPOS_DE[etapa].map(campo => [campo, leerEntero(actividades?.[etapa]?.[campo], CAMPOS[campo].max) ?? 0])
    );
  }
  return resultado;
}

const INACTIVA = { activa: false, nTecnicos: 0, dias: 0, noches: 0, viajes: 0 };

// Lo ingresado en una actividad -> técnicos, días, noches y viajes totales. Sin técnicos (o, en mantenimiento y
// soporte, sin visitas) la actividad no se incluye y no cuesta nada.
function expandirActividad(etapa, datos, problemas) {
  const nombre = NOMBRE_ACTIVIDAD[etapa];
  const leer = campo => {
    const valor = leerEntero(datos?.[campo], CAMPOS[campo].max);
    if (valor === null) {
      problemas.push(`${nombre}: ${CAMPOS[campo].etiqueta} debe ser un número entero entre 0 y ${CAMPOS[campo].max}`);
    }
    return valor ?? 0;
  };

  const nTecnicos = leer('nTecnicos');
  if (nTecnicos === 0) return INACTIVA;

  if (etapa === 'INSTALACION') {
    const dias = leer('dias');
    const noches = leer('noches');
    const viajes = leer('viajes');
    if (dias < 1) problemas.push(`${nombre}: indica cuántos días`);
    if (viajes < 1) problemas.push(`${nombre}: indica cuántos viajes (1 si es uno solo)`);
    if (noches > dias) problemas.push(`${nombre}: las noches no pueden ser más que los días`);
    return { activa: true, nTecnicos, dias, noches, viajes };
  }

  const visitas = leer('visitas');
  const diasPorVisita = leer('diasPorVisita');
  const nochesPorVisita = leer('nochesPorVisita');
  if (visitas === 0) return INACTIVA;
  if (diasPorVisita < 1) problemas.push(`${nombre}: indica cuántos días dura cada visita`);
  if (nochesPorVisita > diasPorVisita) problemas.push(`${nombre}: las noches de cada visita no pueden ser más que los días`);
  return {
    activa: true,
    nTecnicos,
    dias: visitas * diasPorVisita,
    noches: visitas * nochesPorVisita,
    viajes: visitas,
  };
}

// Unidades que se cobran en cada rubro: pasajes, noches de hospedaje, días de alimentación, jornadas.
const unidadesDe = (campo, a) => {
  if (campo === 'transporte') return a.nTecnicos * a.viajes;
  if (campo === 'hospedaje') return a.nTecnicos * a.noches;
  return a.nTecnicos * a.dias;
};

// Costo de compra de un ítem -> { costoUnitario, costoSubtotal }, o null si el ítem no lleva costo (título,
// servicio) o está mal.
function costoDeItem(item, problemas) {
  const nombre = item.nombre || 'sin nombre';
  const obligatorio = COSTO_OBLIGATORIO.includes(item.tipo);
  if (esTitulo(item) || !(obligatorio || COSTO_OPCIONAL.includes(item.tipo))) return null;

  const crudo = item.costoUnitario;
  if (crudo === undefined || crudo === null || crudo === '') {
    if (obligatorio) {
      problemas.push(`El ítem «${nombre}» necesita su costo de compra`);
      return null;
    }
    return { costoUnitario: null, costoSubtotal: 0 };
  }

  const costo = Number(crudo);
  if (!Number.isFinite(costo) || costo < 0 || costo > COSTO_ITEM_MAXIMO) {
    problemas.push(`El costo de compra del ítem «${nombre}» no es válido`);
    return null;
  }
  const costoUnitario = redondear(costo);
  return { costoUnitario, costoSubtotal: redondear((Number(item.cantidad) || 0) * costoUnitario) };
}

// Calcula la estimación. Nunca falla: devuelve el resultado con lo que se pudo calcular y la lista de `problemas`
// que impiden darla por buena (falta una tarifa, un costo de compra...). El servidor rechaza al guardar si hay
// alguno; el frontend los muestra mientras el trabajador escribe.
//
// - actividades: { INSTALACION: {...}, MANTENIMIENTO: {...}, SOPORTE: {...} } tal como se ingresó
// - tarifas: lo que rige para el destino, { PASAJE: { monto, ... } | null, ... } (resolverTarifas de tarifas.js)
// - items: [{ tipo, nombre, cantidad, precioUnitario, costoUnitario }]
// - costoDiagnostico: monto de la oferta aceptada (0 si no hay)
// - tasaImprevistos: % que fijó el jefe, o null si aún no lo definió (se aplica 0 y se avisa con `sinTasaImprevistos`)
// - ventaSinIGV: subtotal de la cotización, en su moneda; con moneda "DÓLARES" hace falta el tipo de cambio
function calcularEstimacion({
  actividades,
  tarifas,
  destino = 'GENERAL',
  items = [],
  costoDiagnostico = 0,
  tasaImprevistos = null,
  ventaSinIGV = 0,
  moneda = 'SOLES',
  tipoCambio = null,
}) {
  const problemas = [];

  // 1. Actividades y su costo, con las tarifas usadas
  const detalle = {};
  const lineas = [];
  const tarifasUsadas = {};
  const tarifasFaltantes = new Set();

  for (const etapa of ACTIVIDADES) {
    const actividad = { ...expandirActividad(etapa, actividades?.[etapa], problemas) };

    for (const rubro of RUBROS) {
      const cantidad = unidadesDe(rubro.campo, actividad);
      actividad[rubro.campo] = 0;
      if (cantidad === 0) continue;

      const tarifa = tarifas?.[rubro.inductor] ?? null;
      if (!tarifa) {
        tarifasFaltantes.add(rubro.inductor);
        continue;
      }

      const subtotal = redondear(cantidad * tarifa.monto);
      actividad[rubro.campo] = subtotal;
      tarifasUsadas[rubro.inductor] = {
        tarifaId: tarifa.tarifaId,
        monto: tarifa.monto,
        destino: tarifa.destino,
        heredada: tarifa.heredada,
        vigenteDesde: tarifa.vigenteDesde,
      };
      lineas.push({
        etapa,
        categoria: rubro.categoria,
        cantidad,
        costoUnitario: tarifa.monto,
        subtotal,
        nTecnicos: actividad.nTecnicos,
        dias: actividad.dias,
        noches: actividad.noches,
        viajes: actividad.viajes,
      });
    }

    actividad.subtotal = redondear(RUBROS.reduce((total, rubro) => total + actividad[rubro.campo], 0));
    detalle[etapa] = actividad;
  }

  for (const rubro of RUBROS.filter(r => tarifasFaltantes.has(r.inductor))) {
    problemas.push(`Falta la tarifa de ${rubro.tarifa} para ${destino}: pídele al jefe que la registre en el Tarifario`);
  }

  const sumar = campo => redondear(ACTIVIDADES.reduce((total, etapa) => total + detalle[etapa][campo], 0));
  const transporte = sumar('transporte');
  const hospedaje = sumar('hospedaje');
  const alimentacion = sumar('alimentacion');
  const manoObra = sumar('manoObra');
  const viaticos = redondear(transporte + hospedaje + alimentacion);

  // 2. Materiales
  const costosItems = items.map(item => costoDeItem(item, problemas));
  const materiales = redondear(costosItems.reduce((total, costo) => total + (costo?.costoSubtotal ?? 0), 0));

  // 3. Totales
  const diagnostico = redondear(Number(costoDiagnostico) || 0);
  const directosFuturos = redondear(viaticos + manoObra + materiales);
  if (directosFuturos === 0) {
    problemas.push('La estimación no tiene costos: completa alguna actividad o el costo de compra de los materiales');
  }
  const tasa = tasaImprevistos ?? 0;
  const imprevistos = redondear((directosFuturos * tasa) / 100);
  const costoTotal = redondear(directosFuturos + diagnostico + imprevistos);

  // 4. Venta en soles y margen
  let cambio = 1;
  if (moneda === 'DÓLARES') {
    cambio = Number(tipoCambio);
    if (!(cambio > 0 && cambio <= TIPO_CAMBIO_MAXIMO)) {
      problemas.push('Ingresa el tipo de cambio (soles por dólar)');
      cambio = 0;
    }
    cambio = Math.round(cambio * 10000) / 10000;
  }
  const venta = redondear(Number(ventaSinIGV) || 0);
  const ventaSoles = redondear(venta * cambio);
  const margen = calcularMargen(ventaSoles, costoTotal);

  return {
    resultado: {
      actividades: detalle,
      lineas,
      costosItems,
      tarifasUsadas,
      transporte,
      hospedaje,
      alimentacion,
      manoObra,
      viaticos,
      materiales,
      diagnostico,
      directosFuturos,
      tasaImprevistos: tasa,
      sinTasaImprevistos: tasaImprevistos === null || tasaImprevistos === undefined,
      imprevistos,
      costoTotal,
      ventaSinIGV: venta,
      tipoCambio: cambio,
      ventaSoles,
      margen,
    },
    problemas,
  };
}

module.exports = {
  ACTIVIDADES,
  NOMBRE_ACTIVIDAD,
  RUBROS,
  CAMPOS,
  COSTO_ITEM_MAXIMO,
  redondear,
  calcularMargen,
  unidadesDe,
  normalizarActividades,
  calcularEstimacion,
};
