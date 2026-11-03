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

// Busca en la hoja "usuarios" una fila cuyo nombre y contraseña coincidan.
// El nombre no distingue mayúsculas/minúsculas; la contraseña sí.
async function buscarUsuario(nombre, contrasena) {
  const filas = await cargarFilas();
  const nombreBuscado = String(nombre).trim().toLowerCase();

  const fila = filas.find(f =>
    String(f.get('nombre') || '').trim().toLowerCase() === nombreBuscado &&
    String(f.get('contrasena') || '').trim() === String(contrasena).trim()
  );

  if (!fila) return null;

  // Nunca se devuelve la contraseña.
  return {
    usuarioId: Number(fila.get('usuarioId')),
    nombre: String(fila.get('nombre')).trim(),
    rol: String(fila.get('rol')).trim(),
  };
}

// Para identificar a quien hace una petición. El rol ya viene normalizado (null si no se reconoce).
async function buscarUsuarioPorId(usuarioId) {
  const filas = await cargarFilas();
  const fila = filas.find(f => String(f.get('usuarioId') || '').trim() === String(usuarioId));

  if (!fila) return null;

  return {
    usuarioId: Number(fila.get('usuarioId')),
    nombre: String(fila.get('nombre')).trim(),
    rol: normalizarRol(fila.get('rol')),
  };
}

module.exports = { buscarUsuario, buscarUsuarioPorId, normalizarRol };
