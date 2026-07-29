const db = require('../config/database');

async function getAllTecnicos(page, limit, search) {
  // console.log('Modelo: solicitando todos los técnicos');

  const offset = (page - 1) * limit;

  const tecnicos = await db.query(
    `
    SELECT
      t.*,
      COALESCE(
        json_agg(
          json_build_object(
            'precio_aire_id', pa.precio_aire_id,
            'tipo_aire', pa.tipo_aire,
            'precio', pa.precio
          )
          ORDER BY pa.tipo_aire
        ) FILTER (WHERE pa.precio_aire_id IS NOT NULL),
        '[]'
      ) AS precios
    FROM "tecnicos" t
    LEFT JOIN "precios_aire" pa
      ON t.tecnico_id = pa.tecnico_id
    WHERE t.nombre ILIKE '%' || $3 || '%'
    GROUP BY t.tecnico_id
    ORDER BY t.tecnico_id ASC
    LIMIT $1 OFFSET $2
  `, [limit, offset, search]);

  console.log(JSON.stringify(tecnicos.rows, null, 2))

  const total = await db.query(`
    SELECT COUNT(*) AS total
    FROM "tecnicos"
    WHERE nombre ILIKE '%' || $1 || '%'
  `, [search]);

  const tecnicosConPrecios = tecnicos.rows.map((tecnico) => ({
    ...tecnico,
    precios: typeof tecnico.precios === 'string' ? JSON.parse(tecnico.precios) : tecnico.precios,
  }));

  return {
    tecnicos: tecnicosConPrecios,
    total: Number(total.rows[0].total),
    page,
    limit,
    totalPages: Math.ceil(total.rows[0].total / limit)
  };
}

async function createTecnico({ nombre, tipo_documento, numero_documento, telefono, ubicacion, servicio, area, calificacion }) {
  console.log('Modelo: creando técnico: ', {
    nombre, tipo_documento, numero_documento, telefono, ubicacion, servicio, area, calificacion
  });

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
