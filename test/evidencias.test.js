const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validarArchivo, exigirCupo, nombreSeguro, MAX_BYTES, MAX_POR_DESTINO, evidenciasDe, AMBITO } = require('../services/evidencias');

const falla = (fn, status, texto) =>
  assert.throws(fn, error => {
    assert.equal(error.status, status, error.message);
    if (texto) assert.match(error.message, texto);
    return true;
  });

const b64 = bytes => Buffer.from(bytes).toString('base64');
const JPG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2];
const DOCX = [0x50, 0x4b, 0x03, 0x04, 1, 2];

test('validarArchivo: imágenes, PDF y Word correctos entran con su contenido', () => {
  const jpg = validarArchivo({ nombre: 'Foto 1.JPG', tipo: 'image/jpeg', contenidoBase64: b64(JPG) });
  assert.equal(jpg.nombre, 'Foto 1.JPG');
  assert.equal(jpg.contenido.length, JPG.length);

  assert.equal(validarArchivo({ nombre: 'acta.pdf', tipo: 'application/pdf', contenidoBase64: b64(PDF) }).tipo, 'application/pdf');
  const docx = validarArchivo({
    nombre: 'informe.docx',
    tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    contenidoBase64: b64(DOCX),
  });
  assert.equal(docx.nombre, 'informe.docx');
  validarArchivo({ nombre: 'a.png', tipo: 'image/png', contenidoBase64: b64([0x89, 0x50, 0x4e, 0x47, 1]) });
  validarArchivo({ nombre: 'a.doc', tipo: 'application/msword', contenidoBase64: b64([0xd0, 0xcf, 0x11, 0xe0, 1]) });
});

test('validarArchivo: otros tipos, extensión que no corresponde o contenido falso se rechazan', () => {
  falla(() => validarArchivo({ nombre: 'hoja.xlsx', tipo: 'application/vnd.ms-excel', contenidoBase64: b64(DOCX) }), 400, /solo se aceptan/);
  falla(() => validarArchivo({ nombre: 'virus.exe', tipo: 'application/pdf', contenidoBase64: b64(PDF) }), 400, /solo se aceptan/);
  falla(() => validarArchivo({ nombre: 'foto', tipo: 'image/jpeg', contenidoBase64: b64(JPG) }), 400, /solo se aceptan/);
  // Dice ser JPG pero sus bytes son de otra cosa
  falla(() => validarArchivo({ nombre: 'falso.jpg', tipo: 'image/jpeg', contenidoBase64: b64(PDF) }), 400, /no corresponde a un archivo JPG/);
  falla(() => validarArchivo({ nombre: 'vacio.pdf', tipo: 'application/pdf', contenidoBase64: '' }), 400, /vacío/);
  falla(() => validarArchivo({ nombre: '  ', tipo: 'application/pdf', contenidoBase64: b64(PDF) }), 400, /nombre/);
  falla(() => validarArchivo(undefined), 400);
});

test('validarArchivo: hasta 8 MB entra; más, no (413)', () => {
  const justo = Buffer.alloc(MAX_BYTES, 0);
  Buffer.from(PDF).copy(justo);
  assert.equal(validarArchivo({ nombre: 'justo.pdf', tipo: 'application/pdf', contenidoBase64: justo.toString('base64') }).contenido.length, MAX_BYTES);

  const grande = Buffer.alloc(MAX_BYTES + 1, 0);
  Buffer.from(PDF).copy(grande);
  falla(() => validarArchivo({ nombre: 'grande.pdf', tipo: 'application/pdf', contenidoBase64: grande.toString('base64') }), 413, /8 MB/);
});

test('nombreSeguro: sin separadores de ruta y con largo acotado que conserva la extensión', () => {
  assert.equal(nombreSeguro('../../etc/passwd.pdf'), '..-..-etc-passwd.pdf');
  assert.equal(nombreSeguro('a\\b/c.jpg'), 'a-b-c.jpg');
  const largo = nombreSeguro(`${'x'.repeat(300)}.pdf`);
  assert.equal(largo.length, 120);
  assert.ok(largo.endsWith('.pdf'));
});

test('exigirCupo: hasta 10 por diagnóstico o visita', () => {
  exigirCupo(MAX_POR_DESTINO - 1);
  falla(() => exigirCupo(MAX_POR_DESTINO), 409, /hasta 10/);
});

test('evidenciasDe: separa el diagnóstico de cada visita programada y ordena por fecha', () => {
  const fila = datos => ({ get: c => datos[c] ?? '' });
  const filas = [
    fila({ evidenciaId: 3, ambito: 'AVANCE', visitaId: 1, visitaProgramadaId: 7, nombre: 'b.pdf', tipo: 'application/pdf', subidoEn: '2026-11-02' }),
    fila({ evidenciaId: 1, ambito: 'DIAGNOSTICO', visitaId: 1, nombre: 'a.jpg', tipo: 'image/jpeg', subidoEn: '2026-11-01' }),
    fila({ evidenciaId: 2, ambito: 'AVANCE', visitaId: 1, visitaProgramadaId: 7, nombre: 'c.jpg', tipo: 'image/jpeg', subidoEn: '2026-11-01' }),
    fila({ evidenciaId: 4, ambito: 'AVANCE', visitaId: 1, visitaProgramadaId: 8, nombre: 'd.jpg', tipo: 'image/jpeg', subidoEn: '2026-11-03' }),
    fila({ evidenciaId: 5, ambito: 'DIAGNOSTICO', visitaId: 2, nombre: 'otro.jpg', tipo: 'image/jpeg', subidoEn: '2026-11-03' }),
  ];
  assert.deepEqual(evidenciasDe(filas, { ambito: AMBITO.DIAGNOSTICO, visitaId: 1 }).map(e => e.evidenciaId), [1]);
  const avance = evidenciasDe(filas, { ambito: AMBITO.AVANCE, visitaId: 1, visitaProgramadaId: 7 });
  assert.deepEqual(avance.map(e => e.evidenciaId), [2, 3]);
  assert.deepEqual(avance.map(e => e.esImagen), [true, false]);
  assert.equal(avance[0].url, '/evidencias/2/archivo');
});

// --- El modelo, con hojas y Drive simulados ----------------------------------------------------------------------------------

const ruta = rel => path.join(__dirname, '..', rel);
const hojaFalsa = (encabezados, filas = []) => {
  const crear = datos => {
    const fila = { get: c => datos[c] ?? '', delete: async () => { hoja.filas.splice(hoja.filas.indexOf(fila), 1); } };
    return fila;
  };
  const hoja = {
    headerValues: encabezados,
    filas: [],
    getRows: async () => [...hoja.filas],
    addRow: async datos => { const fila = crear(datos); hoja.filas.push(fila); return fila; },
  };
  hoja.filas.push(...filas.map(crear));
  return hoja;
};

const evidencias = hojaFalsa(['evidenciaId', 'visitaId', 'visitaProgramadaId', 'ambito', 'nombre', 'tipo', 'archivoId', 'subidoPor', 'subidoEn']);
const visitas = hojaFalsa(['visitaId', 'solicitudId', 'tecnicoId', 'estado', 'cierreFecha'], [
  { visitaId: 1, solicitudId: 7, tecnicoId: 1, estado: 'AUTORIZADA' },
  { visitaId: 2, solicitudId: 8, tecnicoId: 1, estado: 'ACTIVO' },
  { visitaId: 3, solicitudId: 9, tecnicoId: 2, estado: 'AUTORIZADA' },
  { visitaId: 4, solicitudId: 10, tecnicoId: 1, estado: 'ACTIVO', cierreFecha: '2026-11-01' },
]);
const programadas = hojaFalsa(['visitaProgramadaId', 'visitaId', 'completadaEn'], [
  { visitaProgramadaId: 20, visitaId: 2 },
  { visitaProgramadaId: 21, visitaId: 2, completadaEn: '2026-11-02T10:00:00.000Z' },
]);
const tecnicos = hojaFalsa(['tecnicoId', 'nombre'], [{ tecnicoId: 1, nombre: 'Carlos Ramírez' }, { tecnicoId: 2, nombre: 'Otro Técnico' }]);

const subidas = [];
const papelera = [];
const carpetas = [];
require.cache[ruta('services/sheetsService.js')] = {
  id: 's', filename: ruta('services/sheetsService.js'), loaded: true,
  exports: { conectar: async () => ({ sheetsByTitle: { evidencias, visitasTecnicas: visitas, visitasProgramadas: programadas, tecnicos } }), limpiarCacheFilas() {} },
};
require.cache[ruta('services/driveService.js')] = {
  id: 'd', filename: ruta('services/driveService.js'), loaded: true,
  exports: {
    buscarOCrearCarpeta: async (nombre, padre) => { carpetas.push(`${padre}/${nombre}`); return { carpetaId: `${padre}/${nombre}` }; },
    subirArchivo: async (carpetaId, nombre) => { subidas.push(`${carpetaId}::${nombre}`); return `drive-${subidas.length}`; },
    enviarArchivoAPapelera: async id => { papelera.push(id); },
  },
};
require.cache[ruta('models/solicitudModel.js')] = {
  id: 'm', filename: ruta('models/solicitudModel.js'), loaded: true,
  exports: { getCarpetaServicio: async solicitudId => ({ carpetaId: `servicio-${solicitudId}` }) },
};
const { subirEvidencia, quitarEvidencia, getArchivo } = require('../models/evidenciaModel');

const CARLOS = { usuarioId: 3, nombre: 'Carlos Ramírez', rol: 'tecnico' };
const pdf = extra => ({ nombre: 'acta.pdf', tipo: 'application/pdf', contenidoBase64: b64(PDF), ...extra });

test('el técnico sube una evidencia del diagnóstico: va a Drive (Evidencias/Diagnóstico) y se registra', async () => {
  const guardada = await subirEvidencia({ visitaId: 1, ...pdf() }, CARLOS);
  assert.equal(guardada.evidenciaId, 1);
  assert.equal(guardada.url, '/evidencias/1/archivo');
  assert.equal(guardada.esImagen, false);

  assert.deepEqual(carpetas.slice(-2), ['servicio-7/Evidencias', 'servicio-7/Evidencias/Diagnóstico']);
  assert.equal(subidas.at(-1), 'servicio-7/Evidencias/Diagnóstico::1 - acta.pdf');
  const fila = evidencias.filas[0];
  assert.equal(fila.get('ambito'), 'DIAGNOSTICO');
  assert.equal(fila.get('subidoPor'), 'Carlos Ramírez');
  assert.equal(fila.get('archivoId'), 'drive-1');
  assert.deepEqual(await getArchivo(1), { archivoId: 'drive-1', nombre: 'acta.pdf', tipo: 'application/pdf' });
});

test('una evidencia de avance va a la carpeta de su visita', async () => {
  const guardada = await subirEvidencia({ visitaId: 2, visitaProgramadaId: 20, ...pdf({ nombre: 'foto.jpg', tipo: 'image/jpeg', contenidoBase64: b64(JPG) }) }, CARLOS);
  assert.equal(guardada.esImagen, true);
  assert.equal(subidas.at(-1), 'servicio-8/Evidencias/Visita N° 20::2 - foto.jpg');
  assert.equal(evidencias.filas.at(-1).get('ambito'), 'AVANCE');
});

test('rechaza lo que no corresponde: otro técnico, servicio cerrado, visita completada, diagnóstico ya registrado', async () => {
  const antes = evidencias.filas.length;
  const rechaza = async (entrada, usuario, status, texto) =>
    assert.rejects(subirEvidencia(entrada, usuario), error => { assert.equal(error.status, status, error.message); assert.match(error.message, texto); return true; });

  await rechaza({ visitaId: 3, ...pdf() }, CARLOS, 403, /no está asignado/);
  await rechaza({ visitaId: 4, ...pdf() }, CARLOS, 409, /ya fue cerrado/);
  await rechaza({ visitaId: 2, visitaProgramadaId: 21, ...pdf() }, CARLOS, 409, /ya fue completada/);
  await rechaza({ visitaId: 2, ...pdf() }, CARLOS, 409, /diagnóstico de esta visita ya fue registrado/);
  await rechaza({ visitaId: 1, visitaProgramadaId: 20, ...pdf() }, CARLOS, 400, /no pertenece/);
  await rechaza({ visitaId: 99, ...pdf() }, CARLOS, 404, /no encontrada/);
  await rechaza({ visitaId: 1, ...pdf({ tipo: 'application/zip', nombre: 'a.zip' }) }, CARLOS, 400, /solo se aceptan/);
  assert.equal(evidencias.filas.length, antes, 'nada se guardó');
});

test('cada diagnóstico o visita admite hasta 10 archivos', async () => {
  // Ya hay 1 en el diagnóstico de la visita 1: se completan las 10 y la 11 se rechaza
  for (let i = 0; i < 9; i++) await subirEvidencia({ visitaId: 1, ...pdf({ nombre: `acta ${i}.pdf` }) }, CARLOS);
  await assert.rejects(subirEvidencia({ visitaId: 1, ...pdf({ nombre: 'otra.pdf' }) }, CARLOS), error => error.status === 409 && /hasta 10/.test(error.message));
});

test('quitar una evidencia la borra de la hoja y manda su archivo a la papelera', async () => {
  const total = evidencias.filas.length;
  const resultado = await quitarEvidencia(1, CARLOS);
  assert.equal(resultado.evidenciaId, 1);
  assert.equal(evidencias.filas.length, total - 1);
  assert.deepEqual(papelera, ['drive-1']);

  await assert.rejects(quitarEvidencia(999, CARLOS), error => error.status === 404);
  await assert.rejects(getArchivo(1), error => error.status === 404);
});
