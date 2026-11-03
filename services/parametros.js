// Parámetros de control de costos que fija el jefe (solo lógica, sin acceso al Excel, para poder probarla).
// Los que no tienen valor por defecto quedan "sin definir" hasta que el jefe los ingrese: el sistema no inventa
// márgenes ni tasas del negocio.
const { GARANTIA_MESES_MIN, GARANTIA_MESES_MAX, GARANTIA_MESES_DEFECTO } = require('./garantia');

const DEFINICIONES = [
  {
    clave: 'MARGEN_MINIMO',
    etiqueta: 'Margen mínimo aceptable',
    unidad: '%',
    min: 0,
    max: 100,
    entero: false,
    defecto: null,
    ayuda: 'Si el margen estimado queda por debajo, la cotización se marca en rojo y validarla exige justificación.',
  },
  {
    clave: 'TASA_IMPREVISTOS',
    etiqueta: 'Tasa de imprevistos',
    unidad: '%',
    min: 0,
    max: 100,
    entero: false,
    defecto: null,
    ayuda: 'Provisión por doble pasaje, traslado de material faltante y otros imprevistos, sobre los costos directos futuros.',
  },
  {
    clave: 'TOLERANCIA_DESVIACION',
    etiqueta: 'Tolerancia de desviación del costo',
    unidad: '%',
    min: 0,
    max: 100,
    entero: false,
    defecto: null,
    ayuda: 'Diferencia aceptable entre el costo real y el estimado; fuera de ella el servicio se marca en rojo.',
  },
  {
    clave: 'MIN_CASOS_ANALOGA',
    etiqueta: 'Mínimo de servicios similares',
    unidad: 'servicios',
    min: 1,
    max: 20,
    entero: true,
    defecto: 3,
    ayuda: 'Con menos servicios similares que este número, la estimación análoga muestra «sin datos suficientes».',
  },
  {
    clave: 'GARANTIA_MESES_DEFECTO',
    etiqueta: 'Garantía por defecto',
    unidad: 'meses',
    min: GARANTIA_MESES_MIN,
    max: GARANTIA_MESES_MAX,
    entero: true,
    defecto: GARANTIA_MESES_DEFECTO,
    ayuda: 'Se propone al cotizar y se aplica a los servicios que no tienen una garantía guardada.',
  },
];

const definicionDe = clave => DEFINICIONES.find(definicion => definicion.clave === clave);

// Un valor ingresado -> { valor } (null = sin definir) o { error }.
function validarValor(definicion, ingresado) {
  if (ingresado === null || ingresado === undefined || String(ingresado).trim() === '') return { valor: null };

  const numero = typeof ingresado === 'number' ? ingresado : Number(String(ingresado).trim().replace(',', '.'));
  const rango = `entre ${definicion.min} y ${definicion.max}`;
  if (!Number.isFinite(numero) || numero < definicion.min || numero > definicion.max) {
    return { error: `${definicion.etiqueta} debe ser un número ${rango}` };
  }
  if (definicion.entero && !Number.isInteger(numero)) {
    return { error: `${definicion.etiqueta} debe ser un número entero ${rango}` };
  }

  return { valor: definicion.entero ? numero : Math.round(numero * 100) / 100 };
}

// Lo que envía el jefe: { CLAVE: número o null }. Devuelve { error } o { valores } ya normalizados.
function validarParametros(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || Object.keys(entrada).length === 0) {
    return { error: 'Indique los parámetros a guardar' };
  }

  const valores = {};
  for (const [clave, ingresado] of Object.entries(entrada)) {
    const definicion = definicionDe(clave);
    if (!definicion) return { error: `El parámetro ${clave} no existe` };

    const { valor, error } = validarValor(definicion, ingresado);
    if (error) return { error };
    valores[clave] = valor;
  }
  return { valores };
}

// Filas guardadas ({ clave, valor, actualizadoPor, actualizadoEn }) -> estado de cada parámetro. Un valor guardado
// que no sea válido (alguien lo editó a mano en el Excel) se trata como sin definir.
function resolverParametros(filas = []) {
  const resultado = {};
  for (const definicion of DEFINICIONES) {
    const fila = [...filas].reverse().find(f => String(f.clave ?? '').trim() === definicion.clave);
    const guardado = fila ? validarValor(definicion, fila.valor) : { valor: null };
    const definido = !guardado.error && guardado.valor !== null;

    resultado[definicion.clave] = {
      valor: definido ? guardado.valor : definicion.defecto,
      definido,
      esDefecto: !definido && definicion.defecto !== null,
      actualizadoPor: fila ? String(fila.actualizadoPor ?? '').trim() : '',
      actualizadoEn: fila ? String(fila.actualizadoEn ?? '').trim() : '',
    };
  }
  return resultado;
}

// { CLAVE: valor efectivo o null }, para quien solo necesita los números.
const valoresEfectivos = parametros =>
  Object.fromEntries(Object.entries(parametros).map(([clave, { valor }]) => [clave, valor]));

module.exports = {
  DEFINICIONES,
  definicionDe,
  validarValor,
  validarParametros,
  resolverParametros,
  valoresEfectivos,
};
