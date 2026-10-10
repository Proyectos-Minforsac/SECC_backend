// Agrega al Excel las hojas y columnas que necesita el código y que todavía no existen: la columna "tipo" de
// visitasProgramadas, "etapasFinalizadas" de visitasTecnicas y la hoja "notificaciones".
// Es seguro repetirlo: lo que ya existe se deja como está y nunca se tocan las filas de datos.
//   npm run hojas:preparar
const { conectar } = require('../services/sheetsService');

const COLUMNAS_NUEVAS = {
  visitasProgramadas: ['tipo'],
  visitasTecnicas: ['etapasFinalizadas'],
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
};

(async () => {
  const doc = await conectar();

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

  for (const [titulo, encabezados] of Object.entries(HOJAS_NUEVAS)) {
    if (doc.sheetsByTitle[titulo]) {
      console.log(`${titulo}: la hoja ya existe`);
      continue;
    }
    await doc.addSheet({ title: titulo, headerValues: encabezados });
    console.log(`${titulo}: hoja creada`);
  }

  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
