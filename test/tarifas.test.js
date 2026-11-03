const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DESTINO_GENERAL,
  normalizarDestino,
  esFechaISOValida,
  validarTarifa,
  elegirVigente,
  rechazarSiNoCambia,
  marcarEstados,
  resolverTarifas,
  destinosDe,
  vigentesPorDestino,
} = require('../services/tarifas');

const tarifa = (tarifaId, inductor, destino, monto, vigenteDesde) => ({ tarifaId, inductor, destino, monto, vigenteDesde });

// Pasaje general: 50 desde enero y 60 desde junio. Pasaje de Arequipa: 90 desde marzo. Noche general: 80.
const tarifas = [
  tarifa(1, 'PASAJE', 'GENERAL', 50, '2026-01-01'),
  tarifa(2, 'PASAJE', 'GENERAL', 60, '2026-06-01'),
  tarifa(3, 'PASAJE', 'Arequipa', 90, '2026-03-01'),
  tarifa(4, 'NOCHE', 'GENERAL', 80, '2026-01-01'),
];

test('normalizarDestino: GENERAL en cualquier escritura y misma escritura para un destino repetido', () => {
  assert.equal(normalizarDestino('  general '), DESTINO_GENERAL);
  assert.equal(normalizarDestino('GeNeRaL'), DESTINO_GENERAL);
  assert.equal(normalizarDestino('arequipa', ['GENERAL', 'Arequipa']), 'Arequipa');
  assert.equal(normalizarDestino('  Santa   Cruz ', []), 'Santa Cruz');
  assert.equal(normalizarDestino('   '), '');
  assert.equal(normalizarDestino(undefined), '');
});

test('esFechaISOValida rechaza fechas imposibles y otros formatos', () => {
  assert.equal(esFechaISOValida('2026-11-05'), true);
  assert.equal(esFechaISOValida('2028-02-29'), true);
  for (const invalida of ['2026-02-31', '2027-02-29', '5/11/2026', '2026-11-5', '', null, 20261105]) {
    assert.equal(esFechaISOValida(invalida), false);
  }
});

test('validarTarifa normaliza lo válido', () => {
  const { datos, error } = validarTarifa(
    { inductor: 'NOCHE', destino: 'arequipa', monto: '85,555', vigenteDesde: '2026-11-05' },
    ['GENERAL', 'Arequipa']
  );
  assert.equal(error, undefined);
  assert.deepEqual(datos, { inductor: 'NOCHE', destino: 'Arequipa', monto: 85.56, vigenteDesde: '2026-11-05' });
});

test('validarTarifa rechaza datos incompletos o inválidos', () => {
  const base = { inductor: 'PASAJE', destino: 'GENERAL', monto: 60, vigenteDesde: '2026-11-05' };
  const casos = [
    { ...base, inductor: 'HORAS' },
    { ...base, inductor: undefined },
    { ...base, destino: '  ' },
    { ...base, destino: 'x'.repeat(61) },
    { ...base, monto: 0 },
    { ...base, monto: -5 },
    { ...base, monto: 'abc' },
    { ...base, monto: null },
    { ...base, monto: 100001 },
    { ...base, vigenteDesde: '2026-13-01' },
    { ...base, vigenteDesde: undefined },
  ];
  for (const caso of casos) assert.ok(validarTarifa(caso).error, JSON.stringify(caso));
  assert.ok(validarTarifa(undefined).error);
});

test('elegirVigente toma la más reciente que ya empezó', () => {
  assert.equal(elegirVigente(tarifas, 'PASAJE', 'GENERAL', '2025-12-31'), null);
  assert.equal(elegirVigente(tarifas, 'PASAJE', 'GENERAL', '2026-01-01').monto, 50);
  assert.equal(elegirVigente(tarifas, 'PASAJE', 'GENERAL', '2026-05-31').monto, 50);
  assert.equal(elegirVigente(tarifas, 'PASAJE', 'GENERAL', '2026-06-01').monto, 60);
  assert.equal(elegirVigente(tarifas, 'PASAJE', 'arequipa', '2026-06-01').monto, 90);
});

test('elegirVigente: con la misma fecha de inicio gana la registrada después', () => {
  const conCorreccion = [...tarifas, tarifa(5, 'PASAJE', 'GENERAL', 65, '2026-06-01')];
  assert.equal(elegirVigente(conCorreccion, 'PASAJE', 'GENERAL', '2026-07-01').monto, 65);
});

test('rechazarSiNoCambia avisa solo cuando rige el mismo monto', () => {
  const nueva = (monto, vigenteDesde) => ({ inductor: 'PASAJE', destino: 'GENERAL', monto, vigenteDesde });
  assert.ok(rechazarSiNoCambia(tarifas, nueva(60, '2026-07-01')));
  assert.equal(rechazarSiNoCambia(tarifas, nueva(70, '2026-07-01')), null);
  // Antes de junio rige 50: volver a poner 60 desde mayo sí es un cambio.
  assert.equal(rechazarSiNoCambia(tarifas, nueva(60, '2026-05-01')), null);
  // Un destino sin tarifa propia no hereda para este control: registrar la primera siempre es un cambio.
  assert.equal(rechazarSiNoCambia(tarifas, { ...nueva(60, '2026-07-01'), destino: 'Cusco' }), null);
});

test('marcarEstados: vigente, reemplazada y programada', () => {
  const estados = Object.fromEntries(
    marcarEstados([...tarifas, tarifa(6, 'NOCHE', 'GENERAL', 95, '2026-12-01')], '2026-08-15').map(t => [t.tarifaId, t.estado])
  );
  assert.deepEqual(estados, {
    1: 'REEMPLAZADA',
    2: 'VIGENTE',
    3: 'VIGENTE',
    4: 'VIGENTE',
    6: 'PROGRAMADA',
  });
});

test('resolverTarifas: la propia manda, si no rige la GENERAL y si tampoco hay, null', () => {
  const arequipa = resolverTarifas(tarifas, 'Arequipa', '2026-08-15');
  assert.deepEqual(arequipa.PASAJE, { tarifaId: 3, monto: 90, vigenteDesde: '2026-03-01', destino: 'Arequipa', heredada: false });
  assert.deepEqual(arequipa.NOCHE, { tarifaId: 4, monto: 80, vigenteDesde: '2026-01-01', destino: 'GENERAL', heredada: true });
  assert.equal(arequipa.ALIMENTACION, null);
  assert.equal(arequipa.JORNADA, null);

  const general = resolverTarifas(tarifas, 'GENERAL', '2026-08-15');
  assert.equal(general.PASAJE.monto, 60);
  assert.equal(general.PASAJE.heredada, false);

  // Un destino que aún no tiene nada usa todo lo general; antes de que empiece la general, no hay tarifa.
  assert.equal(resolverTarifas(tarifas, 'Cusco', '2026-08-15').PASAJE.monto, 60);
  assert.equal(resolverTarifas(tarifas, 'Cusco', '2025-01-01').PASAJE, null);
});

test('destinosDe: GENERAL primero, los demás en orden y sin repetir mayúsculas', () => {
  const variados = [...tarifas, tarifa(7, 'NOCHE', 'AREQUIPA', 70, '2026-01-01'), tarifa(8, 'NOCHE', 'Cusco', 75, '2026-01-01')];
  assert.deepEqual(destinosDe(variados), ['GENERAL', 'Arequipa', 'Cusco']);
  assert.deepEqual(destinosDe([]), ['GENERAL']);
});

test('vigentesPorDestino arma el cuadro de lo que rige hoy en cada destino', () => {
  const cuadro = vigentesPorDestino(tarifas, '2026-08-15');
  assert.deepEqual(Object.keys(cuadro), ['GENERAL', 'Arequipa']);
  assert.equal(cuadro.GENERAL.PASAJE.monto, 60);
  assert.equal(cuadro.Arequipa.PASAJE.monto, 90);
  assert.equal(cuadro.Arequipa.NOCHE.heredada, true);
});
