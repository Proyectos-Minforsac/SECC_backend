// Agrega 5 servicios de ejemplo ya cerrados para probar el sistema con servicios similares: la estimación por analogía y el
// tablero de rentabilidad necesitan servicios cerrados con los que comparar. Se guardan en resumenProceso como servicios del
// histórico (origen HISTORICO), con la referencia «Servicio de ejemplo N».
//
//   npm run servicios:ejemplo                 agrega los 5 servicios (los que ya están se omiten)
//   npm run servicios:ejemplo -- --simular    muestra qué agregaría, sin escribir nada
//   npm run servicios:ejemplo -- --quitar     quita los servicios de ejemplo
//
// Ojo: como son históricos, npm run servicios:borrar NO los borra; para quitarlos usa --quitar.
const { construirEjemplos, esReferenciaDeEjemplo, MARCA } = require('../services/ejemplosServicios');
const { aFilaResumen } = require('../services/historico');
const { borrarFilas } = require('../services/hojasUtils');

const dosDecimales = valor => Number(valor).toFixed(2);

function mostrar(ejemplos) {
  console.log('Referencia'.padEnd(22) + 'Tipo'.padEnd(24) + 'Cierre'.padEnd(12) + 'Venta'.padStart(9) + 'C est.'.padStart(9) + 'C real'.padStart(9) + 'M real'.padStart(9));
  for (const e of ejemplos) {
    const fila = aFilaResumen(e, { importadoPor: MARCA });
    console.log(
      e.referencia.padEnd(22) + e.tipoServicio.padEnd(24) + e.fecha.slice(0, 10).padEnd(12) +
      dosDecimales(e.ventaSoles).padStart(9) + dosDecimales(e.costoEstimado).padStart(9) + dosDecimales(e.costoReal).padStart(9) +
      `${fila.margenReal} %`.padStart(9)
    );
  }
}

(async () => {
  const argumentos = process.argv.slice(2);
  const ejemplos = construirEjemplos();

  if (argumentos.includes('--quitar')) {
    const { conectar } = require('../services/sheetsService');
    const hoja = (await conectar()).sheetsByTitle['resumenProceso'];
    if (!hoja) throw new Error('No existe la hoja "resumenProceso" en el Excel (npm run hojas:preparar la crea)');
    await hoja.loadHeaderRow();
    const filas = (await hoja.getRows({ offset: 0 })).filter(
      fila => String(fila.get('origen')).trim() === 'HISTORICO' && esReferenciaDeEjemplo(fila.get('referencia'))
    );
    if (filas.length === 0) console.log('No hay servicios de ejemplo que quitar.');
    else {
      await borrarFilas(hoja, filas);
      console.log(`Servicios de ejemplo quitados: ${filas.length}`);
    }
    process.exit(0);
  }

  mostrar(ejemplos);
  if (argumentos.includes('--simular')) {
    console.log('\nModo simulación: no se escribió nada en el Excel. Quita --simular para agregarlos.');
    process.exit(0);
  }

  const { importarHistorico } = require('../models/resumenModel');
  const { importadas, omitidas } = await importarHistorico(ejemplos, MARCA);
  console.log(`\nAgregados: ${importadas}`);
  if (omitidas.length > 0) console.log(`Omitidos por estar ya cargados (${omitidas.length}): ${omitidas.join(', ')}`);
  process.exit(0);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
