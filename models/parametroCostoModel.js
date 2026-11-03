const { conectar } = require('../services/sheetsService');
const { errorHttp, texto, cargarEncabezados, exigirColumnas } = require('../services/hojasUtils');
const { DEFINICIONES, validarParametros, resolverParametros, valoresEfectivos } = require('../services/parametros');

const COLUMNAS = ['clave', 'valor', 'actualizadoPor', 'actualizadoEn'];

async function buscarHoja() {
  const doc = await conectar();
  return doc.sheetsByTitle['parametrosCosto'] ?? null;
}

const aParametro = fila => ({
  clave: texto(fila.get('clave')),
  valor: texto(fila.get('valor')),
  actualizadoPor: texto(fila.get('actualizadoPor')),
  actualizadoEn: texto(fila.get('actualizadoEn')),
});

// Definiciones (etiqueta, unidad, rango) y estado actual de cada parámetro.
async function getParametros() {
  const hoja = await buscarHoja();
  if (!hoja) throw new Error('No existe la hoja "parametrosCosto" en el Excel (npm run hojas:preparar la crea)');

  return { definiciones: DEFINICIONES, valores: resolverParametros((await hoja.getRows()).map(aParametro)) };
}

// Solo los números efectivos ({ CLAVE: valor o null }), para otros módulos. A diferencia de getParametros no falla
// si la hoja aún no existe: usa los valores por defecto, para no frenar el trabajo mientras se prepara el Excel.
async function getValores() {
  const hoja = await buscarHoja();
  const filas = hoja ? (await hoja.getRows()).map(aParametro) : [];
  return valoresEfectivos(resolverParametros(filas));
}

// Guarda solo lo que cambió, con quién y cuándo. Un valor vacío (null) deja el parámetro sin definir.
async function guardarParametros(entrada, usuario) {
  console.log('Modelo: guardando parámetros de costo');

  const { error, valores } = validarParametros(entrada);
  if (error) throw errorHttp(400, error);

  const hoja = await buscarHoja();
  if (!hoja) throw new Error('No existe la hoja "parametrosCosto" en el Excel (npm run hojas:preparar la crea)');
  await cargarEncabezados(hoja);
  exigirColumnas(hoja, COLUMNAS, 'parametrosCosto');

  const filas = await hoja.getRows();
  const actuales = resolverParametros(filas.map(aParametro));
  const ahora = new Date().toISOString();
  const nuevas = [];

  for (const [clave, valor] of Object.entries(valores)) {
    const guardado = actuales[clave].definido ? actuales[clave].valor : null;
    if (guardado === valor) continue;

    const fila = filas.find(f => texto(f.get('clave')) === clave);
    if (fila) {
      fila.set('valor', valor ?? '');
      fila.set('actualizadoPor', usuario.nombre);
      fila.set('actualizadoEn', ahora);
      await fila.save({ raw: true });
    } else {
      nuevas.push({ clave, valor: valor ?? '', actualizadoPor: usuario.nombre, actualizadoEn: ahora });
    }
  }
  if (nuevas.length > 0) await hoja.addRows(nuevas, { raw: true });

  return getParametros();
}

module.exports = { getParametros, getValores, guardarParametros };
