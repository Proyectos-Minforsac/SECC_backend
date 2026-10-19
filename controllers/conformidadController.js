const nodemailer = require('nodemailer');

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escaparHtml = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function crearTransporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  const port = parseInt(SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Envía al correo del cliente el documento de conformidad (PDF adjunto).
// Reply-To apunta a la empresa, así que la respuesta del cliente le llega a quien gestiona el servicio.
async function enviarConformidad(req, res) {
  console.log('Controlador: llegando a POST /conformidad/enviar');
  try {
    const { correoDestino, clienteNombre, nombreVisita, nombreArchivo, pdfBase64 } = req.body;

    if (!correoDestino || !clienteNombre || !nombreVisita || !nombreArchivo || !pdfBase64) {
      return res.status(400).json({ message: 'Faltan datos para enviar el documento de conformidad' });
    }
    if (!CORREO_VALIDO.test(correoDestino)) {
      return res.status(400).json({ message: 'El cliente no tiene un correo electrónico válido' });
    }
    if (!nombreArchivo.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ message: 'El archivo adjunto debe ser un PDF' });
    }

    const pdf = Buffer.from(pdfBase64, 'base64');
    if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) {
      return res.status(400).json({ message: 'El PDF está vacío o supera el tamaño permitido' });
    }

    const transporte = crearTransporte();
    if (!transporte) {
      return res.status(503).json({ message: 'El servicio de correo no está configurado en el servidor' });
    }

    const remitente = process.env.MAIL_FROM || process.env.SMTP_USER;
    await transporte.sendMail({
      from: remitente,
      to: correoDestino,
      replyTo: process.env.MAIL_REPLY_TO || remitente,
      subject: `Documento de conformidad - ${nombreVisita} - Multiservicios Informáticos S.A.C`,
      text:
        `Estimado cliente ${clienteNombre}:\n\n` +
        `Adjuntamos el documento de conformidad de la visita realizada (${nombreVisita}). ` +
        `Le pedimos completar la encuesta y responder a este correo con su visto bueno.\n\n` +
        `Gracias por confiar en Multiservicios Informáticos S.A.C.`,
      html:
        `<p>Estimado cliente <strong>${escaparHtml(clienteNombre)}</strong>:</p>` +
        `<p>Adjuntamos el documento de conformidad de la visita realizada (${escaparHtml(nombreVisita)}). ` +
        `Le pedimos completar la encuesta y <strong>responder a este correo</strong> con su visto bueno.</p>` +
        `<p>Gracias por confiar en Multiservicios Informáticos S.A.C.</p>`,
      attachments: [{ filename: nombreArchivo, content: pdf, contentType: 'application/pdf' }],
    });

    console.log('Controlador: conformidad enviada a', correoDestino);
    res.status(200).json({ message: 'Documento de conformidad enviado' });
  } catch (error) {
    console.error('Controlador: error al enviar conformidad', error);
    res.status(500).json({ message: 'No se pudo enviar el correo', error: error.message });
  }
}

module.exports = { enviarConformidad };
