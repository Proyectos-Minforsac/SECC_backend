const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const auth = new JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);

async function conectar() {
  await doc.loadInfo(); // carga metadatos y hojas
  return doc;
}

conectar().catch(console.error);

module.exports = { conectar };