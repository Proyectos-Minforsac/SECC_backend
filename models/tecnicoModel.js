const db = require('../config/database');

async function getAllTecnicos(page, limit, search) {
  console.log('Modelo: solicitando todos los técnicos');

  const offset = (page - 1) * limit;

  const tecnicos = await db.query(`
    SELECT *
    FROM "tecnicos"
    WHERE nombre ILIKE '%' || $3 || '%'
    ORDER BY tecnico_id DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset, search]);

  const total = await db.query(`
    SELECT COUNT(*) AS total
    FROM "tecnicos"
    WHERE nombre ILIKE '%' || $1 || '%'
  `, [search]);

  return {
    tecnicos: tecnicos.rows,
    total: Number(total.rows[0].total),
    page,
    limit,
    totalPages: Math.ceil(total.rows[0].total / limit)
  };
}

async function createTecnico({nombre, tipo_documento, numero_documento, telefono, ubicacion, servicio, area, calificacion}) {
  console.log('Modelo: creando técnico: ', {
  nombre, tipo_documento, numero_documento, telefono, ubicacion, servicio, area, calificacion });

  const result = await db.query(

  )
}

async function updateTecnico(tecnico_id, {
nombre, tipo_documento, numero_documento, telefono, ubicacion, servicio, area, calificacion }) {
  console.log('Modelo: actualizando técnico', tecnico_id);

  const result = await db.query(

  );
}

async function deleteTecnico(tecnico_id) {
  console.log('Modelo: eliminando técnico', tecnico_id);

  const result = await db.query(

  );

  console.log('Modelo: cliente eliminado:', result.rows[0]);
  return result.rows[0];
}

module.exports = {
  getAllTecnicos,
  createTecnico,
  updateTecnico,
  deleteTecnico,
};
