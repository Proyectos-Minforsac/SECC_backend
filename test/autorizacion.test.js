const test = require('node:test');
const assert = require('node:assert/strict');
const { leerUsuarioId, crearExigirRol } = require('../services/autorizacion');

const peticion = authorization => ({ headers: authorization === undefined ? {} : { authorization } });

// Respuesta falsa que recuerda el código y el cuerpo que se le pidió enviar.
function respuesta() {
  const res = { status(codigo) { res.codigo = codigo; return res; }, json(cuerpo) { res.cuerpo = cuerpo; return res; } };
  return res;
}

const usuarios = {
  1: { usuarioId: 1, nombre: 'Ana', rol: 'trabajador' },
  2: { usuarioId: 2, nombre: 'Beto', rol: 'jefe' },
  3: { usuarioId: 3, nombre: 'Carlos', rol: 'tecnico' },
  4: { usuarioId: 4, nombre: 'Dora', rol: null },
};
const exigirRol = crearExigirRol(async usuarioId => usuarios[usuarioId] ?? null);

async function ejecutar(authorization, ...roles) {
  const req = peticion(authorization);
  const res = respuesta();
  let siguio = false;
  await exigirRol(...roles)(req, res, () => { siguio = true; });
  return { req, res, siguio };
}

test('leerUsuarioId acepta solo "Usuario <número>"', () => {
  assert.equal(leerUsuarioId(peticion('Usuario 12')), 12);
  assert.equal(leerUsuarioId(peticion('usuario   7')), 7);
  for (const invalido of [undefined, '', 'Bearer 12', 'Usuario', 'Usuario abc', 'Usuario 1 2']) {
    assert.equal(leerUsuarioId(peticion(invalido)), null);
  }
});

test('sin sesión o con un usuario desconocido responde 401', async () => {
  for (const authorization of [undefined, 'Usuario 99', 'Bearer x']) {
    const { res, siguio } = await ejecutar(authorization, 'trabajador', 'jefe');
    assert.equal(res.codigo, 401);
    assert.equal(siguio, false);
  }
});

test('un rol no permitido responde 403, también si el rol de la hoja no se reconoce', async () => {
  for (const authorization of ['Usuario 3', 'Usuario 4']) {
    const { res, siguio } = await ejecutar(authorization, 'trabajador', 'jefe');
    assert.equal(res.codigo, 403);
    assert.equal(siguio, false);
  }
});

test('trabajador y jefe pasan, y la petición queda con su usuario', async () => {
  for (const [authorization, nombre] of [['Usuario 1', 'Ana'], ['Usuario 2', 'Beto']]) {
    const { req, res, siguio } = await ejecutar(authorization, 'trabajador', 'jefe');
    assert.equal(siguio, true);
    assert.equal(res.codigo, undefined);
    assert.equal(req.usuario.nombre, nombre);
  }
});

test('el jefe puede quedar como único rol permitido', async () => {
  assert.equal((await ejecutar('Usuario 1', 'jefe')).res.codigo, 403);
  assert.equal((await ejecutar('Usuario 2', 'jefe')).siguio, true);
});

test('si falla la consulta de usuarios responde 500 sin dejar pasar', async () => {
  const exigirConFallo = crearExigirRol(async () => { throw new Error('sin conexión'); });
  const res = respuesta();
  let siguio = false;
  const silencio = console.error;
  console.error = () => {};
  try {
    await exigirConFallo('jefe')(peticion('Usuario 2'), res, () => { siguio = true; });
  } finally {
    console.error = silencio;
  }
  assert.equal(res.codigo, 500);
  assert.equal(siguio, false);
});
