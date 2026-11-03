// La garantía del servicio la acuerda la cotización y puede ser de 4 a 6 meses.
const GARANTIA_MESES_MIN = 4;
const GARANTIA_MESES_MAX = 6;
// Se usa cuando el servicio no tiene una garantía guardada (servicios anteriores a este campo).
const GARANTIA_MESES_DEFECTO = 6;

const esGarantiaValida = valor =>
  Number.isInteger(valor) && valor >= GARANTIA_MESES_MIN && valor <= GARANTIA_MESES_MAX;

// Lo que haya en la hoja ("5", "", undefined...) -> meses válidos, o el valor por defecto. El jefe puede cambiar
// ese valor en los parámetros de costo; si el que llega no es válido se usa el de siempre.
function garantiaGuardada(valor, defecto = GARANTIA_MESES_DEFECTO) {
  const meses = Number(String(valor ?? '').trim());
  if (esGarantiaValida(meses)) return meses;
  return esGarantiaValida(defecto) ? defecto : GARANTIA_MESES_DEFECTO;
}

module.exports = {
  GARANTIA_MESES_MIN,
  GARANTIA_MESES_MAX,
  GARANTIA_MESES_DEFECTO,
  esGarantiaValida,
  garantiaGuardada,
};
