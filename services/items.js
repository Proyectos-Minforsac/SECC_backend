// Reglas de los ítems de una cotización (solo lógica, sin acceso al Excel, para poder probarla).
//
// Todo ítem entra con un tipo y con cantidad y precio mayores que 0; un ítem vacío ya no se convierte en "Título".
// Servicio y Título ya no se pueden agregar, pero una cotización anterior que los trae se puede seguir corrigiendo.

const { tieneMaximoDosDecimales } = require('./hojasUtils');

const TIPOS_NUEVOS = ['Producto', 'Alquiler', 'Impresora'];
const TIPOS_ANTERIORES = ['Servicio', 'Título'];

// Devuelve { error } con lo que falta, o { items } ya normalizados (acepta `precio` o `precioUnitario`).
function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'La cotización debe tener al menos un ítem' };
  }

  for (const [i, it] of items.entries()) {
    if (!it || typeof it.nombre !== 'string' || !it.nombre.trim()) {
      return { error: `El ítem #${i + 1} no tiene nombre` };
    }
    const nombre = it.nombre.trim();

    if (!it.tipo) return { error: `El ítem "${nombre}" no tiene tipo` };
    if (![...TIPOS_NUEVOS, ...TIPOS_ANTERIORES].includes(it.tipo)) {
      return { error: `El ítem "${nombre}" tiene un tipo que no es válido` };
    }

    if (it.tipo !== 'Título') {
      const cantidad = Number(it.cantidad);
      const precio = Number(it.precioUnitario ?? it.precio);
      if (!(cantidad > 0) || !(precio > 0)) {
        return { error: `El ítem "${nombre}" necesita una cantidad y un precio unitario mayores que 0` };
      }
      if (!tieneMaximoDosDecimales(precio)) {
        return { error: `El precio unitario del ítem "${nombre}" solo puede tener hasta 2 decimales (por ejemplo, 182.00)` };
      }
    }

    if (it.tipo === 'Impresora' && !it.detalleImpresora) {
      return { error: `El ítem "${nombre}" es Impresora pero no trae detalles` };
    }
  }

  return {
    items: items.map((it, i) => ({
      tipo: it.tipo,
      nombre: it.nombre.trim(),
      descripcion: it.descripcion || '',
      cantidad: Number(it.cantidad) || 0,
      precioUnitario: Number(it.precioUnitario ?? it.precio) || 0,
      // Costo de compra (uso interno). Si falta se deja como está: la estimación decide si ese ítem lo necesita.
      costoUnitario: it.costoUnitario ?? null,
      orden: Number.isInteger(it.orden) ? it.orden : i,
      detalleImpresora: it.detalleImpresora || null,
    })),
  };
}

module.exports = { TIPOS_NUEVOS, TIPOS_ANTERIORES, validarItems };
