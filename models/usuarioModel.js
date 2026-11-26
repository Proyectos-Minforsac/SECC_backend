const { conectar } = require('../services/sheetsService');

async function cargarFilas() {
  const doc = await conectar();
  const hojaUsuarios = doc.sheetsByTitle['usuarios'];

  if (!hojaUsuarios) {
    throw new Error('No existe la hoja "usuarios" en el Excel');
  }

  return hojaUsuarios.getRows();
}

// Roles de la hoja "usuarios" -> roles que entiende el sistema. Devuelve null si el rol no se reconoce.
function normalizarRol(rol) {
  const valor = String(rol || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (valor === 'trabajador') return 'trabajador';
  if (valor === 'jefe') return 'jefe';
  if (valor === 'tecnico') return 'tecnico';
  return null;
}

// Los datos de la persona que ya se identificó. Nunca incluye la contraseña.
//   nombre          el nombre de usuario (con el que inicia sesión); es el que queda registrado en el Excel como autor
//   nombreCompleto  lo que se muestra en pantalla. En un técnico debe ser igual a su `nombre` en la hoja tecnicos: así se
//                   le reconoce en las solicitudes, visitas, evidencias y avisos. Si falta, vale el nombre de usuario
function datosDeUsuario(fila, rol) {
  const nombreUsuario = String(fila.get('nombreUsuario') || '').trim();
  return {
    usuarioId: Number(fila.get('usuarioId')),
    nombre: nombreUsuario,
    nombreCompleto: String(fila.get('nombreCompleto') || '').trim() || nombreUsuario,
    rol,
  };
}

// Busca en la hoja "usuarios" una fila cuyo nombre de usuario y contraseña coincidan.
// El nombre de usuario no distingue mayúsculas/minúsculas; la contraseña sí.
async function buscarUsuario(nombreUsuario, contrasena) {
  const filas = await cargarFilas();
  const nombreBuscado = String(nombreUsuario).trim().toLowerCase();

  const fila = filas.find(f =>
    String(f.get('nombreUsuario') || '').trim().toLowerCase() === nombreBuscado &&
    String(f.get('contrasena') || '').trim() === String(contrasena).trim()
  );

  if (!fila) return null;

  return datosDeUsuario(fila, String(fila.get('rol')).trim());
}

// Para identificar a quien hace una petición. El rol ya viene normalizado (null si no se reconoce).
async function buscarUsuarioPorId(usuarioId) {
  const filas = await cargarFilas();
  const fila = filas.find(f => String(f.get('usuarioId') || '').trim() === String(usuarioId));

  if (!fila) return null;

  return datosDeUsuario(fila, normalizarRol(fila.get('rol')));
}

module.exports = { buscarUsuario, buscarUsuarioPorId, normalizarRol };
