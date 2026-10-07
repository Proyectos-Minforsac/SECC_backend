// Utilidades compartidas por los modelos que leen y escriben las hojas del Excel.

// Error con código HTTP; el controlador lo traduce a la respuesta.
function errorHttp(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const texto = valor => String(valor ?? '').trim();
const mismoId = (a, b) => texto(a) === texto(b);
const normalizar = valor => texto(valor).toLowerCase();

// En la hoja las fechas son "YYYY-MM-DD"; si alguien las edita a mano en Excel
// pueden venir como "d/m/yyyy". Ambas se aceptan y se devuelven en el formato pedido.
function partesFecha(valor) {
  const fecha = texto(valor);
  let m = fecha.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { anio: m[1], mes: m[2].padStart(2, '0'), dia: m[3].padStart(2, '0') };
  m = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { anio: m[3], mes: m[2].padStart(2, '0'), dia: m[1].padStart(2, '0') };
  return null;
}

const aISO = valor => {
  const p = partesFecha(valor);
  return p ? `${p.anio}-${p.mes}-${p.dia}` : texto(valor);
};

const aDiaMesAnio = valor => {
  const p = partesFecha(valor);
  return p ? `${p.dia}/${p.mes}/${p.anio}` : texto(valor);
};

// Fecha de hoy en Perú, "YYYY-MM-DD".
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

function siguienteId(filas, campo) {
  const ids = filas.map(f => parseInt(f.get(campo), 10)).filter(Number.isInteger);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

module.exports = {
  errorHttp,
  texto,
  mismoId,
  normalizar,
  aISO,
  aDiaMesAnio,
  hoyISO,
  siguienteId,
};
