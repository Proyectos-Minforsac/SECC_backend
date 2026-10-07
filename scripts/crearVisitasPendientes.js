// Crea la visita técnica de las solicitudes que se autorizaron antes de que autorizarViaje la creara.
// Es seguro repetirlo: las solicitudes que ya tienen visita se omiten.
//   npm run visitas:pendientes
const { conectar } = require('../services/sheetsService');
const { crearVisitaDeSolicitud } = require('../models/visitaModel');

(async () => {
  const doc = await conectar();
  const solicitudes = await doc.sheetsByTitle['solicitudes'].getRows();
  const autorizadas = solicitudes.filter(f => String(f.get('estado')).trim() === 'AUTORIZADO');

  let creadas = 0;
  for (const fila of autorizadas) {
    const solicitudId = String(fila.get('solicitudId')).trim();
    const visitasAntes = (await doc.sheetsByTitle['visitasTecnicas'].getRows()).length;
    try {
      const visita = await crearVisitaDeSolicitud(solicitudId);
      const visitasDespues = (await doc.sheetsByTitle['visitasTecnicas'].getRows()).length;
      if (visitasDespues > visitasAntes) {
        creadas++;
        console.log(`Solicitud ${solicitudId}: visita N° ${visita.visitaId} creada`);
      } else {
        console.log(`Solicitud ${solicitudId}: ya tenía la visita N° ${visita.visitaId}`);
      }
    } catch (error) {
      console.error(`Solicitud ${solicitudId}: no se pudo crear la visita (${error.message})`);
    }
  }

  console.log(`Listo: ${creadas} visita(s) creada(s) de ${autorizadas.length} solicitud(es) autorizada(s).`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
