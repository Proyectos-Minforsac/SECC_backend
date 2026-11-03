// Reglas del tarifario (solo lógica, sin acceso al Excel, para poder probarla).
//
// Una tarifa es el monto de un inductor de costo para un destino, desde una fecha de vigencia. Nunca se modifica ni
// se borra: un cambio es una tarifa nueva, y la que rige es la más reciente que ya empezó (RN-07). Si un destino no
// tiene tarifa propia para un inductor, rige la del destino GENERAL.

const INDUCTORES = ['PASAJE', 'NOCHE', 'ALIMENTACION', 'JORNADA'];
const DESTINO_GENERAL = 'GENERAL';
const MONTO_MAXIMO = 100000;
const DESTINO_LARGO_MAXIMO = 60;

const ESTADO_VIGENTE = 'VIGENTE';
const ESTADO_REEMPLAZADA = 'REEMPLAZADA';
const ESTADO_PROGRAMADA = 'PROGRAMADA';

const limpiarDestino = destino => String(destino ?? '').trim().replace(/\s+/g, ' ');
const esGeneral = destino => limpiarDestino(destino).toUpperCase() === DESTINO_GENERAL;
const mismoDestino = (a, b) => limpiarDestino(a).toLowerCase() === limpiarDestino(b).toLowerCase();

// Destino tal como se guarda: "GENERAL", o con la misma escritura que ya tenga ese destino en el tarifario
// (así "arequipa" y "Arequipa" no se vuelven dos destinos).
function normalizarDestino(destino, existentes = []) {
  const limpio = limpiarDestino(destino);
  if (!limpio) return '';
  if (esGeneral(limpio)) return DESTINO_GENERAL;
  return existentes.find(existente => mismoDestino(existente, limpio)) ?? limpio;
}

// "2026-11-05" -> true; "2026-02-31" o "5/11/2026" -> false.
function esFechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// Valida lo que envía el jefe. Devuelve { error } o { datos } ya normalizados.
function validarTarifa({ inductor, destino, monto, vigenteDesde } = {}, destinosExistentes = []) {
  if (!INDUCTORES.includes(inductor)) return { error: 'Seleccione el inductor de costo' };

  const destinoFinal = normalizarDestino(destino, destinosExistentes);
  if (!destinoFinal) return { error: 'Ingrese el destino (o GENERAL para todos)' };
  if (destinoFinal.length > DESTINO_LARGO_MAXIMO) {
    return { error: `El destino no puede pasar de ${DESTINO_LARGO_MAXIMO} caracteres` };
  }

  const valor = typeof monto === 'string' ? Number(monto.trim().replace(',', '.')) : monto;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > MONTO_MAXIMO) {
    return { error: `Ingrese un monto mayor a 0 y hasta ${MONTO_MAXIMO}` };
  }

  if (!esFechaISOValida(vigenteDesde)) return { error: 'Ingrese una fecha de vigencia válida' };

  return { datos: { inductor, destino: destinoFinal, monto: Math.round(valor * 100) / 100, vigenteDesde } };
}

// De varias tarifas del mismo inductor y destino, la que rige en `fecha`: la de vigencia más reciente que ya
// empezó; si dos empiezan el mismo día, la registrada después (así un error se corrige registrando otra).
function elegirVigente(tarifas, inductor, destino, fecha) {
  return tarifas
    .filter(t => t.inductor === inductor && mismoDestino(t.destino, destino) && t.vigenteDesde <= fecha)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde) || b.tarifaId - a.tarifaId)[0] ?? null;
}

// Evita registrar ruido: si ya rige ese mismo monto en la fecha pedida, no hay cambio que guardar.
// Devuelve el mensaje de error, o null si la tarifa sí cambia algo.
function rechazarSiNoCambia(tarifas, { inductor, destino, monto, vigenteDesde }) {
  const vigente = elegirVigente(tarifas, inductor, destino, vigenteDesde);
  return vigente && vigente.monto === monto ? 'Esa tarifa ya rige con el mismo monto en esa fecha' : null;
}

// Marca cada tarifa como VIGENTE (la que rige hoy), REEMPLAZADA (otra más reciente la sustituyó) o
// PROGRAMADA (su vigencia aún no empieza).
function marcarEstados(tarifas, hoy) {
  return tarifas.map(tarifa => {
    if (tarifa.vigenteDesde > hoy) return { ...tarifa, estado: ESTADO_PROGRAMADA };
    const vigente = elegirVigente(tarifas, tarifa.inductor, tarifa.destino, hoy);
    return { ...tarifa, estado: vigente?.tarifaId === tarifa.tarifaId ? ESTADO_VIGENTE : ESTADO_REEMPLAZADA };
  });
}

// Tarifa de cada inductor para un destino en una fecha. Si el destino no tiene la suya rige la GENERAL (`heredada`);
// si tampoco existe, null.
function resolverTarifas(tarifas, destino, fecha) {
  const resultado = {};
  for (const inductor of INDUCTORES) {
    const propia = elegirVigente(tarifas, inductor, destino, fecha);
    const tarifa = propia ?? (esGeneral(destino) ? null : elegirVigente(tarifas, inductor, DESTINO_GENERAL, fecha));
    resultado[inductor] = tarifa
      ? {
          tarifaId: tarifa.tarifaId,
          monto: tarifa.monto,
          vigenteDesde: tarifa.vigenteDesde,
          destino: tarifa.destino,
          heredada: !propia,
        }
      : null;
  }
  return resultado;
}

// GENERAL primero y luego los demás destinos con tarifa, en orden alfabético y sin repetir mayúsculas.
function destinosDe(tarifas) {
  const escrituras = new Map();
  for (const { destino } of tarifas) {
    const clave = limpiarDestino(destino).toLowerCase();
    if (!escrituras.has(clave)) escrituras.set(clave, limpiarDestino(destino));
  }
  const otros = [...escrituras.values()].filter(destino => !esGeneral(destino)).sort((a, b) => a.localeCompare(b, 'es'));
  return [DESTINO_GENERAL, ...otros];
}

// Lo que rige hoy en cada destino: { GENERAL: {PASAJE: {...}, ...}, Arequipa: {...} }.
function vigentesPorDestino(tarifas, fecha) {
  return Object.fromEntries(destinosDe(tarifas).map(destino => [destino, resolverTarifas(tarifas, destino, fecha)]));
}

module.exports = {
  INDUCTORES,
  DESTINO_GENERAL,
  ESTADO_VIGENTE,
  ESTADO_REEMPLAZADA,
  ESTADO_PROGRAMADA,
  normalizarDestino,
  esFechaISOValida,
  validarTarifa,
  elegirVigente,
  rechazarSiNoCambia,
  marcarEstados,
  resolverTarifas,
  destinosDe,
  vigentesPorDestino,
};
