const nodemailer = require("nodemailer");

// Configuración del transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "serviciotecnico.rocamaya@gmail.com",
    pass: "tgui yfce ezjd ghxq", // Contraseña de aplicación de Gmail
  },
});

/**
 * Envía un correo electrónico
 * @param {string} to - Correo del destinatario
 * @param {string} subject - Asunto del correo
 * @param {string} html - Contenido HTML del correo
 * @returns {Promise<boolean>} - True si se envió correctamente
 */
async function enviarCorreo(to, subject, html) {
  try {
    // Validar que el destinatario existe
    if (!to) {
      console.error(" Error: Destinatario no especificado");
      return false;
    }

    const mailOptions = {
      from: '"Clínicas Roca Maya" <serviciotecnico.rocamaya@gmail.com>',
      to: to,
      subject: subject,
      html: html,
    };

    console.log(` Enviando correo a: ${to}`);
    console.log(` Asunto: ${subject}`);

    const info = await transporter.sendMail(mailOptions);
    console.log(` Correo enviado exitosamente a: ${to}`);
    console.log(` ID del mensaje: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(" Error enviando correo:", error);
    console.error(" Detalles del error:", error.message);
    return false;
  }
}

module.exports = { enviarCorreo };