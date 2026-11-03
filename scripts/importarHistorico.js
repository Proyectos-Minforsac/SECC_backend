// Carga al Excel los servicios pasados de la empresa (el histórico) para que la estimación por analogía y el tablero de
// rentabilidad tengan con qué comparar desde el primer día. Cada servicio se guarda en la hoja resumenProceso marcado como
// HISTORICO.
//
//   1. Arma el archivo en Excel con las columnas de scripts/historico-plantilla.csv y guárdalo como CSV.
//   2. npm run historico:importar -- ruta/al/archivo.csv --simular   (revisa, no escribe nada)
//   3. npm run historico:importar -- ruta/al/archivo.csv             (carga)
//
// Si alguna fila tiene errores no se carga ninguna: se corrigen y se vuelve a correr. Repetir la carga es seguro: los servicios
// ya cargados (misma referencia) se omiten.
const fs = require('fs');
const path = require('path');
const { leerHistorico } = require('../services/historico');

// Excel guarda el CSV en UTF-8 solo si se elige esa opción; el «CSV» normal de Windows va en Windows-1252.
function leerArchivo(ruta) {
  const bytes = fs.readFileSync(ruta);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

(async () => {
  const argumentos = process.argv.slice(2);
  const simular = argumentos.includes('--simular');
  const archivo = argumentos.find(argumento => !argumento.startsWith('--'));

  if (!archivo) {
    console.error('Indica el archivo CSV: npm run historico:importar -- ruta/al/archivo.csv [--simular]');
    console.error(`La plantilla está en ${path.join('scripts', 'historico-plantilla.csv')}`);
    process.exit(1);
  }
  if (!fs.existsSync(archivo)) {
    console.error(`No existe el archivo ${archivo}`);
    process.exit(1);
  }

  // Los tipos válidos son los del sistema: uno mal escrito nunca se compararía con los demás
  const { TIPOS_SERVICIO } = require('../models/solicitudModel');
  const { filas, errores } = leerHistorico(leerArchivo(archivo), { tiposValidos: TIPOS_SERVICIO });

  console.log(`Servicios válidos: ${filas.length} · con errores: ${errores.length}`);
  if (errores.length > 0) {
    for (const { linea, mensaje } of errores) console.error(`  Línea ${linea}: ${mensaje}`);
    console.error('No se cargó nada. Corrige el archivo y vuelve a intentarlo.');
    process.exit(1);
  }
  if (filas.length === 0) {
    console.log('El archivo no tiene servicios.');
    process.exit(0);
  }

  if (simular) {
    console.log('Modo simulación: no se escribió nada en el Excel. Quita --simular para cargarlos.');
    process.exit(0);
  }

  const { importarHistorico } = require('../models/resumenModel');
  const { importadas, omitidas } = await importarHistorico(filas, 'Importación del histórico');
  console.log(`Cargados: ${importadas}`);
  if (omitidas.length > 0) console.log(`Omitidos por estar ya cargados (${omitidas.length}): ${omitidas.join(', ')}`);
  process.exit(0);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
