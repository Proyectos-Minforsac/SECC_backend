// Obtiene (una sola vez) el refresh token con el que el backend usa tu cuenta de Google Drive.
// Uso: npm run drive:token   (requiere DRIVE_OAUTH_CLIENT_ID y DRIVE_OAUTH_CLIENT_SECRET en .env)
const http = require('http');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const PUERTO = 53682;
const REDIRECCION = `http://localhost:${PUERTO}/oauth2callback`;

const { DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET } = process.env;
if (!DRIVE_OAUTH_CLIENT_ID || !DRIVE_OAUTH_CLIENT_SECRET) {
  console.error('Faltan DRIVE_OAUTH_CLIENT_ID y DRIVE_OAUTH_CLIENT_SECRET en el .env del backend.');
  process.exit(1);
}

const cliente = new OAuth2Client(DRIVE_OAUTH_CLIENT_ID, DRIVE_OAUTH_CLIENT_SECRET, REDIRECCION);

// access_type offline + prompt consent: sin ambos, Google no devuelve refresh token.
const enlace = cliente.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const servidor = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, REDIRECCION);
  if (pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }

  const codigo = searchParams.get('code');
  if (!codigo) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`No se recibió autorización: ${searchParams.get('error') || 'sin código'}`);
    console.error('Google no devolvió un código de autorización:', searchParams.get('error'));
    servidor.close();
    return;
  }

  try {
    const { tokens } = await cliente.getToken(codigo);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Listo. Ya puedes cerrar esta pestaña y volver a la terminal.');

    if (!tokens.refresh_token) {
      console.error(
        '\nGoogle no devolvió refresh token. Quita el acceso de esta app en https://myaccount.google.com/permissions y repite.'
      );
    } else {
      console.log('\nAgrega esta línea al .env del backend y reinicia el servidor:\n');
      console.log(`DRIVE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No se pudo obtener el token. Revisa la terminal.');
    console.error('Error al intercambiar el código por el token:', error.message);
  } finally {
    servidor.close();
  }
});

servidor.listen(PUERTO, () => {
  console.log('Abre este enlace en el navegador, con la cuenta de Google dueña del Drive:\n');
  console.log(`${enlace}\n`);
  console.log(`Esperando la autorización en ${REDIRECCION} ...`);
});
