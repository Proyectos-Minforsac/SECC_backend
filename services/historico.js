// Carga del histórico de servicios pasados (HU-33), sin acceso al Excel para poder probarla.
//
// El histórico es un CSV que se arma desde el Excel de la empresa (Guardar como → CSV). Cada fila es un servicio ya cerrado,
// con lo mínimo para compararlo: tipo, destino, fecha de cierre, venta sin IGV y costo real. Si se conserva el costo con el
// que se había estimado, también sirve para medir la desviación. Todo en soles, sin IGV.
//
// Columnas (el orden no importa; los nombres admiten variantes y tildes):
//   referencia*, tipoServicio*, destino, fechaCierre*, ventaSinIGV*, costoReal*, costoEstimado, imprevistos
// (* obligatorias). `imprevistos` es la parte del costo real que fue imprevisto y ya está incluida en `costoReal`.

const { texto } = require('./hojasUtils');
const { redondear, calcularMargen } = require('./calculoCostos');
const { normalizar } = require('./analoga');

const COLUMNAS = ['referencia', 'tipoServicio', 'destino', 'fechaCierre', 'ventaSinIGV', 'costoReal', 'costoEstimado', 'imprevistos'];
const OBLIGATORIAS = ['referencia', 'tipoServicio', 'fechaCierre', 'ventaSinIGV', 'costoReal'];

// Nombres con los que puede venir cada columna, ya sin tildes, mayúsculas ni símbolos
const ALIAS = {
  referencia: ['referencia', 'ref', 'nombre', 'descripcion'],
  tipoServicio: ['tiposervicio', 'tipodeservicio', 'tipo'],
  destino: ['destino', 'ciudad', 'lugar'],
  fechaCierre: ['fechacierre', 'fechadecierre', 'fecha', 'cierre'],
  ventaSinIGV: ['ventasinigv', 'venta', 'ventasoles', 'precio'],
  costoReal: ['costoreal', 'costo', 'costototal'],
  costoEstimado: ['costoestimado', 'estimado'],
  imprevistos: ['imprevistos', 'imprevistosreal'],
};

const MONTO_MAXIMO = 1000000000;
const REFERENCIA_LARGO_MAXIMO = 120;
const DESTINO_LARGO_MAXIMO = 60;

const claveDeEncabezado = valor => normalizar(valor).replace(/[^a-z0-9]/g, '');

// Parte el texto del CSV en filas de campos, con su número de línea. Respeta las comillas (un campo entre comillas puede llevar
// el separador, saltos de línea y comillas dobles escapadas) y descarta las líneas vacías.
function leerFilas(contenido, separador) {
  const filas = [];
  let campo = '';
  let campos = [];
  let entreComillas = false;
  let linea = 1;
  let lineaInicio = 1;
  const texto0 = contenido.replace(/^﻿/, '');

  const cerrarFila = () => {
    campos.push(campo);
    if (campos.some(c => c.trim() !== '')) filas.push({ linea: lineaInicio, campos });
    campo = '';
    campos = [];
  };

  for (let i = 0; i < texto0.length; i += 1) {
    const caracter = texto0[i];

    if (entreComillas) {
      if (caracter === '"' && texto0[i + 1] === '"') { campo += '"'; i += 1; }
      else if (caracter === '"') entreComillas = false;
      else { campo += caracter; if (caracter === '\n') linea += 1; }
    } else if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === separador) {
      campos.push(campo);
      campo = '';
    } else if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && texto0[i + 1] === '\n') i += 1;
      cerrarFila();
      linea += 1;
      lineaInicio = linea;
    } else {
      campo += caracter;
    }
  }
  if (campo !== '' || campos.length > 0) cerrarFila();
  return filas;
}

// El separador es el que más aparece en la primera línea (Excel usa «;» o «,» según la región del equipo).
function detectarSeparador(contenido) {
  const primera = contenido.replace(/^﻿/, '').split(/\r?\n/).find(linea => linea.trim() !== '') ?? '';
  const cuenta = separador => primera.split(separador).length - 1;
  return [';', ',', '\t'].reduce((mejor, separador) => (cuenta(separador) > cuenta(mejor) ? separador : mejor), ';');
}

// «1,234.50», «1.234,50», «1234,5», «S/ 1 234.50»... En Perú el decimal es el punto; una coma seguida de 1 o 2 dígitos al
// final se toma como decimal (estilo europeo) y las demás comas como separador de miles.
function leerNumero(valor) {
  let t = texto(valor).replace(/s\/\.?|us\$|\$|soles/gi, '').replace(/\s/g, '');
  if (t === '') return null;

  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (coma >= 0) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');

  const numero = Number(t);
  return Number.isFinite(numero) ? numero : NaN;
}

// «2025-03-14», «14/03/2025» o «14-03-2025» -> «2025-03-14», o null si no es una fecha real.
function leerFecha(valor) {
  const t = texto(valor);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let anio, mes, dia;
  if (m) [, anio, mes, dia] = m;
  else if ((m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [, dia, mes, anio] = m;
  else return null;

  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  const real = fecha.getUTCFullYear() === Number(anio) && fecha.getUTCMonth() === Number(mes) - 1 && fecha.getUTCDate() === Number(dia);
  return real ? `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : null;
}

// Convierte el contenido del CSV en servicios válidos y en la lista de errores por línea. No escribe nada: el que importa
// decide si guarda cuando no hay errores.
//   tiposValidos: los tipos de servicio del sistema; uno mal escrito no se compararía nunca con los demás.
function leerHistorico(contenido, { tiposValidos }) {
  const filas = leerFilas(contenido, detectarSeparador(contenido));
  const errores = [];
  if (filas.length === 0) return { filas: [], errores: [{ linea: 1, mensaje: 'El archivo está vacío' }] };

  // Qué posición ocupa cada columna
  const posicion = {};
  filas[0].campos.forEach((encabezado, indice) => {
    const clave = claveDeEncabezado(encabezado);
    const columna = COLUMNAS.find(c => ALIAS[c].includes(clave));
    if (columna && posicion[columna] === undefined) posicion[columna] = indice;
  });
  const faltantes = OBLIGATORIAS.filter(columna => posicion[columna] === undefined);
  if (faltantes.length > 0) {
    return { filas: [], errores: [{ linea: filas[0].linea, mensaje: `Faltan las columnas: ${faltantes.join(', ')}` }] };
  }

  const validas = [];
  const referencias = new Set();
  for (const { linea, campos } of filas.slice(1)) {
    const dato = columna => (posicion[columna] === undefined ? '' : texto(campos[posicion[columna]]));
    const problemas = [];

    const referencia = dato('referencia').replace(/\s+/g, ' ');
    if (referencia === '') problemas.push('falta la referencia');
    else if (referencia.length > REFERENCIA_LARGO_MAXIMO) problemas.push(`la referencia supera los ${REFERENCIA_LARGO_MAXIMO} caracteres`);
    else if (normalizar(referencia).startsWith('ejemplo')) problemas.push('es la fila de ejemplo de la plantilla: bórrala o reemplázala por un servicio real');
    else if (referencias.has(normalizar(referencia))) problemas.push(`la referencia «${referencia}» está repetida en el archivo`);

    const tipoServicio = tiposValidos.find(tipo => normalizar(tipo) === normalizar(dato('tipoServicio')));
    if (!tipoServicio) problemas.push(`el tipo de servicio «${dato('tipoServicio')}» no existe (usa: ${tiposValidos.join(' o ')})`);

    const destinoCrudo = dato('destino').replace(/\s+/g, ' ');
    if (destinoCrudo.length > DESTINO_LARGO_MAXIMO) problemas.push(`el destino supera los ${DESTINO_LARGO_MAXIMO} caracteres`);
    const destino = destinoCrudo === '' || normalizar(destinoCrudo) === 'general' ? 'GENERAL' : destinoCrudo;

    const fecha = leerFecha(dato('fechaCierre'));
    if (!fecha) problemas.push(`la fecha de cierre «${dato('fechaCierre')}» no es válida (usa dd/mm/aaaa o aaaa-mm-dd)`);

    const monto = (columna, etiqueta, { obligatorio, permiteCero = false }) => {
      const valor = leerNumero(dato(columna));
      if (valor === null) {
        if (obligatorio) problemas.push(`falta ${etiqueta}`);
        return null;
      }
      if (Number.isNaN(valor) || valor > MONTO_MAXIMO || valor < 0 || (valor === 0 && !permiteCero)) {
        problemas.push(`${etiqueta} no es válido (debe ser un monto${permiteCero ? '' : ' mayor que cero'})`);
        return null;
      }
      return redondear(valor);
    };
    const ventaSoles = monto('ventaSinIGV', 'la venta sin IGV', { obligatorio: true });
    const costoReal = monto('costoReal', 'el costo real', { obligatorio: true });
    const costoEstimado = monto('costoEstimado', 'el costo estimado', { obligatorio: false });
    const imprevistos = monto('imprevistos', 'el monto de imprevistos', { obligatorio: false, permiteCero: true });
    if (imprevistos !== null && costoReal !== null && imprevistos > costoReal) problemas.push('los imprevistos no pueden ser más que el costo real');

    if (problemas.length > 0) {
      errores.push({ linea, mensaje: problemas.join('; ') });
      continue;
    }
    referencias.add(normalizar(referencia));
    validas.push({ linea, referencia, tipoServicio, destino, fecha, ventaSoles, costoReal, costoEstimado, imprevistos });
  }
  return { filas: validas, errores };
}

// La fila de resumenProceso de un servicio del histórico, con los márgenes y desviaciones ya calculados. El sistema todavía
// no conoce su paramétrico ni su análogo: solo el costo estimado, si el histórico lo trae.
function aFilaResumen(fila, { importadoPor }) {
  const margenReal = calcularMargen(fila.ventaSoles, fila.costoReal);
  const margenEstimado = fila.costoEstimado === null ? null : calcularMargen(fila.ventaSoles, fila.costoEstimado);

  return {
    visitaId: '',
    solicitudId: '',
    tipoServicio: fila.tipoServicio,
    destino: fila.destino,
    cotizaciones: '',
    ventaSoles: fila.ventaSoles,
    costoParametrico: '',
    costoAnalogo: '',
    costoEstimado: fila.costoEstimado ?? '',
    costoReal: fila.costoReal,
    imprevistosProvision: '',
    imprevistosReal: fila.imprevistos ?? '',
    margenEstimado: margenEstimado ?? '',
    margenReal: margenReal ?? '',
    desviacionCosto: fila.costoEstimado === null ? '' : redondear(fila.costoReal - fila.costoEstimado),
    desviacionMargen: margenEstimado !== null && margenReal !== null ? redondear(margenReal - margenEstimado) : '',
    origen: 'HISTORICO',
    cerradoPor: importadoPor,
    cerradoEn: fila.fecha,
    referencia: fila.referencia,
  };
}

module.exports = { COLUMNAS, OBLIGATORIAS, leerFilas, detectarSeparador, leerNumero, leerFecha, leerHistorico, aFilaResumen };
