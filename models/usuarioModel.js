const { conectar } = require('../services/sheetsService');

// Busca en la hoja "usuarios" una fila cuyo nombre y contraseña coincidan.
// El nombre no distingue mayúsculas/minúsculas; la contraseña sí.
async function buscarUsuario(nombre, contrasena) {
  const doc = await conectar();
  const hojaUsuarios = doc.sheetsByTitle['usuarios'];

  if (!hojaUsuarios) {
    throw new Error('No existe la hoja "usuarios" en el Excel');
  }

  const filas = await hojaUsuarios.getRows();
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

module.exports = { buscarUsuario };
