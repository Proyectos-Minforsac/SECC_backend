// Servicios de ejemplo ya cerrados (solo datos, sin acceso al Excel, para poder probarlos). Sirven para que, al probar el
// sistema, la estimación por analogía y el tablero de rentabilidad tengan servicios similares con los que comparar.
//
// Se guardan como servicios del histórico (resumenProceso con origen HISTORICO), que es como el sistema ya guarda los
// servicios pasados: la estimación por analogía los usa igual que a los que cierra el propio sistema. Todo en soles, sin IGV.

const PREFIJO_REFERENCIA = 'Servicio de ejemplo';
const MARCA = 'Servicios de ejemplo';

// Tres de Aire Condicionado (alcanzan el mínimo de 3 servicios similares) y dos de Cableado estructurado (con el mínimo por
// defecto todavía muestran «sin datos suficientes»: sirven para ver los dos casos). Cada servicio salió algo distinto de lo
// estimado: uno costó más de lo previsto, otro casi lo previsto y otro menos.
const SERVICIOS = [
  { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', mesesAtras: 5, ventaSoles: 4800, costoEstimado: 3000, costoReal: 3600, imprevistos: 360 },
  { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', mesesAtras: 4, ventaSoles: 5200, costoEstimado: 3400, costoReal: 3550, imprevistos: 150 },
  { tipoServicio: 'Aire Condicionado', destino: 'GENERAL', mesesAtras: 2, ventaSoles: 3900, costoEstimado: 2700, costoReal: 2650, imprevistos: 0 },
  { tipoServicio: 'Cableado estructurado', destino: 'GENERAL', mesesAtras: 3, ventaSoles: 7500, costoEstimado: 5200, costoReal: 5900, imprevistos: 420 },
  { tipoServicio: 'Cableado estructurado', destino: 'GENERAL', mesesAtras: 1, ventaSoles: 6200, costoEstimado: 4300, costoReal: 4150, imprevistos: 0 },
];

// Fecha de cierre «hace N meses» (ISO), a mediados de mes para que no cambie de mes por la zona horaria.
function fechaHaceMeses(meses, hoy = new Date()) {
  const fecha = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - meses, 15, 12, 0, 0));
  return fecha.toISOString();
}

// Las filas listas para guardar (la misma forma que arma el importador del histórico: leerHistorico).
function construirEjemplos(hoy = new Date()) {
  return SERVICIOS.map(({ mesesAtras, ...servicio }, indice) => ({
    referencia: `${PREFIJO_REFERENCIA} ${indice + 1}`,
    ...servicio,
    fecha: fechaHaceMeses(mesesAtras, hoy),
  }));
}

const esReferenciaDeEjemplo = referencia => String(referencia ?? '').trim().toLowerCase().startsWith(PREFIJO_REFERENCIA.toLowerCase());

module.exports = { PREFIJO_REFERENCIA, MARCA, SERVICIOS, fechaHaceMeses, construirEjemplos, esReferenciaDeEjemplo };
