const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const db = require("../database/db");
const { registrarBitacora } = require("../services/bitacora.service");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const { enviarCorreo } = require("../services/email.service");

console.log(" Cargando auth.routes.js");

// ============================================================
// RUTAS PRINCIPALES
// ============================================================

router.get("/", (req, res) => {
  console.log(" GET /auth/ - Redirigiendo a /login");
  res.redirect("/login");
});

router.get("/login", (req, res) => {
  console.log(" GET /auth/login - Mostrando formulario");
  console.log("   Query params:", req.query);
  res.render("index", { error: req.query.error, success: req.query.success });
});

// ============================================================
// REGISTRO API - Para el modal (responde en JSON)
// ============================================================
router.post("/api/register", async (req, res) => {
  console.log(" POST /auth/api/register - Body recibido:", req.body);
  
  try {
    const { nombre_completo, usuario, contrasena, confirm_contrasena, correo_electronico, id_rol } = req.body;

    console.log(" Validando contraseña:", contrasena);
    console.log(" Longitud:", contrasena ? contrasena.length : 0);
    console.log(" ID_Rol recibido:", id_rol);
    
    // 1. Validar campos requeridos
    if (!nombre_completo || !usuario || !contrasena || !confirm_contrasena || !correo_electronico) {
      console.log(" Campos faltantes");
      return res.status(400).json({ success: false, error: "Todos los campos son requeridos" });
    }

    // 2. Validar que las contraseñas coincidan
    if (contrasena !== confirm_contrasena) {
      console.log(" Contraseñas no coinciden");
      return res.status(400).json({ success: false, error: "Las contraseñas no coinciden" });
    }

    // 3. Validar longitud de la contraseña (9-20 caracteres)
    if (contrasena.length < 9) {
      console.log(" Contraseña corta:", contrasena.length);
      return res.status(400).json({ 
        success: false, 
        error: "La contraseña debe tener al menos 9 caracteres" 
      });
    }
    
    if (contrasena.length > 20) {
      console.log(" Contraseña larga:", contrasena.length);
      return res.status(400).json({ 
        success: false, 
        error: "La contraseña no puede tener más de 20 caracteres" 
      });
    }

    // 4. Validar formato de la contraseña (letras, números y símbolos)
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[@$!%*#?&._-])[A-Za-z\d@$!%*#?&._-]{9,20}$/;
    if (!passwordRegex.test(contrasena)) {
      console.log(" Formato de contraseña inválido");
      return res.status(400).json({ 
        success: false, 
        error: "La contraseña debe incluir al menos una letra, un número y un símbolo (@$!%*#?&._-)" 
      });
    }

    console.log(" Contraseña válida");

    // 5. Verificar si el usuario ya existe (INSENSIBLE a mayúsculas)
    const userExistsResult = await db.query(
      "SELECT ID_USUARIO FROM TBL_MS_USUARIO WHERE UPPER(USUARIO) = UPPER($1)",
      [usuario]
    );
    if (userExistsResult.rows.length > 0) {
      console.log(" Usuario ya existe:", usuario);
      return res.status(400).json({ success: false, error: "El usuario ya existe" });
    }

    // 6. Verificar si el correo ya existe
    const emailExistsResult = await db.query(
      "SELECT ID_USUARIO FROM TBL_MS_USUARIO WHERE CORREO_ELECTRONICO = $1",
      [correo_electronico]
    );
    if (emailExistsResult.rows.length > 0) {
      console.log(" Correo ya existe:", correo_electronico);
      return res.status(400).json({ success: false, error: "El correo ya está registrado" });
    }

    // 7. Hashear la contraseña
    const hashedPassword = await bcrypt.hash(contrasena, 10);

    // ============================================================
    // INSERTAR USUARIO - CON ESTADO 'NUEVO'
    // ============================================================
    const rol = id_rol ? parseInt(id_rol) : 5;
    console.log(" Rol a asignar:", rol);

    const insertResult = await db.query(
      `INSERT INTO TBL_MS_USUARIO 
       (USUARIO, NOMBRE_USUARIO, CONTRASENA, CORREO_ELECTRONICO, ESTADO, ID_ROL)
       VALUES ($1, $2, $3, $4, 'NUEVO', $5) RETURNING ID_USUARIO`,
      [usuario, nombre_completo, hashedPassword, correo_electronico, rol]
    );

    const insertId = insertResult.rows[0].id_usuario || insertResult.rows[0].ID_USUARIO;
    console.log(" Usuario insertado con ID:", insertId, "Rol:", rol, "Estado: NUEVO");

    // ============================================================
    // ENVIAR CORREO ELECTRÓNICO CON CREDENCIALES
    // ============================================================
    let emailSent = false;
    try {
      const subject = ' Bienvenido a Clínicas Roca Maya - Credenciales de acceso';
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #1a5276; margin: 0;"> Clínicas Roca Maya</h2>
            <p style="color: #2e86c1; font-size: 16px; margin: 5px 0;">Tu salud es nuestra seguridad</p>
          </div>
          <div style="background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <p style="font-size: 16px; color: #333;">Estimado(a) <strong>${nombre_completo}</strong>,</p>
            <p style="color: #555; font-size: 15px; line-height: 1.6;">
              Se ha creado su cuenta en el sistema <strong>Clínicas Roca Maya</strong>. 
              A continuación, encontrará sus credenciales de acceso:
            </p>
            <div style="background: #f0f7ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #1a5276;">
              <p style="margin: 5px 0; font-size: 14px;"><strong> Usuario:</strong> <span style="color: #1a5276;">${usuario}</span></p>
              <p style="margin: 5px 0; font-size: 14px;"><strong> Contraseña:</strong> <span style="color: #1a5276; font-weight: bold;">${contrasena}</span></p>
            </div>
            <div style="background: #d4edda; padding: 12px; border-radius: 8px; border-left: 4px solid #28a745; margin: 15px 0;">
              <p style="margin: 0; font-size: 14px; color: #155724;">
                <strong> Cuenta activa:</strong> 
                Ya puedes iniciar sesión con tus credenciales.
              </p>
            </div>
            <p style="color: #555; font-size: 14px; line-height: 1.6; margin-top: 15px;">
              <strong>Para iniciar sesión:</strong>
              <br>1. Visite: <a href="http://localhost:3000/auth/login" style="color: #1a5276; text-decoration: none;">http://localhost:3000/auth/login</a>
              <br>2. Ingrese su usuario y contraseña
            </p>
            <div style="border-top: 1px solid #e9ecef; margin-top: 20px; padding-top: 15px; text-align: center;">
              <p style="color: #6c757d; font-size: 12px; margin: 0;">
                Este es un mensaje automático, por favor no responda a este correo.
                <br>© ${new Date().getFullYear()} Clínicas Roca Maya - Todos los derechos reservados.
              </p>
            </div>
          </div>
        </div>
      `;

      emailSent = await enviarCorreo(correo_electronico, subject, html);
    } catch (emailError) {
      console.error(' Error al enviar correo:', emailError);
    }

    // Registrar en bitácora
    try {
      await registrarBitacora({
        usuario: usuario,
        accion: "REGISTRO_MODAL",
        descripcion: `Nuevo usuario registrado desde modal: ${usuario} con rol ${rol}`,
        modulo: "AUTENTICACION",
        idRegistro: insertId,
        tabla: "TBL_MS_USUARIO",
        estado: "EXITO",
        req
      });
    } catch (bitError) {
      console.error(" Error registrando bitácora:", bitError);
    }

    let mensaje = "Usuario registrado correctamente";
    if (emailSent) {
      mensaje += ". Se ha enviado un correo con las credenciales.";
    } else {
      mensaje += ". No se pudo enviar el correo, pero el usuario fue registrado.";
    }

    return res.status(200).json({ 
      success: true, 
      message: mensaje,
      email_enviado: emailSent,
      data: {
        id: insertId,
        usuario: usuario,
        rol: rol
      }
    });

  } catch (err) {
    console.error(" Error en API registro:", err);
    return res.status(500).json({ 
      success: false, 
      error: "Error interno del servidor: " + err.message 
    });
  }
});

// ================================
// REGISTRO - Página de registro
// ================================
router.get("/register", (req, res) => {
  console.log(" GET /auth/register - Mostrando formulario de registro");
  res.render("register", { error: req.query.error, success: req.query.success });
});

router.post("/register", async (req, res) => {
  console.log(" POST /register - Iniciando registro");
  
  try {
    const { nombre_completo, usuario, contrasena, confirm_contrasena, correo_electronico } = req.body;
    
    if (!nombre_completo || !usuario || !contrasena || !confirm_contrasena || !correo_electronico) {
      return res.redirect("/auth/register?error=Todos los campos son requeridos");
    }

    if (contrasena !== confirm_contrasena) {
      return res.redirect("/auth/register?error=Las contraseñas no coinciden");
    }

    if (contrasena.length < 9 || contrasena.length > 20) {
      return res.redirect("/auth/register?error=La contraseña debe tener entre 9 y 20 caracteres");
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[@$!%*#?&._-])[A-Za-z\d@$!%*#?&._-]{9,20}$/;
    if (!passwordRegex.test(contrasena)) {
      return res.redirect("/auth/register?error=La contraseña debe incluir letras, números y un símbolo");
    }

    const userExistsResult = await db.query("SELECT * FROM TBL_MS_USUARIO WHERE UPPER(USUARIO) = UPPER($1)", [usuario]);
    if (userExistsResult.rows.length > 0) {
      return res.redirect("/auth/register?error=El usuario ya existe");
    }

    const emailExistsResult = await db.query("SELECT * FROM TBL_MS_USUARIO WHERE CORREO_ELECTRONICO = $1", [correo_electronico]);
    if (emailExistsResult.rows.length > 0) {
      return res.redirect("/auth/register?error=El correo ya está registrado");
    }

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    const ID_ROL = 5; // PACIENTE

    await db.query(
      `INSERT INTO TBL_MS_USUARIO 
       (USUARIO, NOMBRE_USUARIO, CONTRASENA, CORREO_ELECTRONICO, ESTADO, ID_ROL)
       VALUES ($1, $2, $3, $4, 'NUEVO', $5)`,
      [usuario, nombre_completo, hashedPassword, correo_electronico, ID_ROL]
    );

    try {
      const subject = ' Bienvenido a Clínicas Roca Maya - Credenciales de acceso';
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #1a5276; margin: 0;"> Clínicas Roca Maya</h2>
          </div>
          <div style="background: white; padding: 25px; border-radius: 10px;">
            <p>Estimado(a) <strong>${nombre_completo}</strong>,</p>
            <p>Se ha creado su cuenta en el sistema <strong>Clínicas Roca Maya</strong>.</p>
            <p><strong>Usuario:</strong> ${usuario}</p>
            <p><strong>Contraseña:</strong> ${contrasena}</p>
          </div>
        </div>
      `;
      await enviarCorreo(correo_electronico, subject, html);
    } catch (emailError) {
      console.error(' Error al enviar correo:', emailError);
    }

    await registrarBitacora({
      usuario,
      accion: "REGISTRO",
      descripcion: `Nuevo usuario registrado: ${usuario} con rol PACIENTE`,
    });
    
    return res.redirect("/auth/login?success=Registro exitoso. Se ha enviado un correo con sus credenciales.");
    
  } catch (err) {
    console.error(" ERROR EN REGISTRO:", err);
    return res.redirect("/auth/register?error=Error interno del servidor: " + err.message);
  }
});

// ================================
// LOGIN
// ================================
router.post("/login", async (req, res) => {
  console.log(" POST /login - Iniciando sesión");
  
  try {
    const { nombre_usuario, password } = req.body;

    if (!nombre_usuario || !password) {
      return res.redirect("/auth/login?error=Usuario y contraseña son requeridos");
    }

    const result = await db.query(
      "SELECT * FROM TBL_MS_USUARIO WHERE UPPER(USUARIO) = UPPER($1)",
      [nombre_usuario]
    );
    
    const rows = result.rows;
    if (rows.length === 0) {
      return res.redirect("/auth/login?error=Usuario no encontrado");
    }

    const user = rows[0];
    console.log("Usuario encontrado:", user.usuario || user.USUARIO, "Estado:", user.estado || user.ESTADO);

    const estadoUser = user.estado || user.ESTADO;
    const idUsuario = user.id_usuario || user.ID_USUARIO;
    const passwordHash = user.contrasena || user.CONTRASENA;
    const usernameReal = user.usuario || user.USUARIO;

    if (estadoUser === 'INACTIVO') {
      return res.redirect("/auth/login?error=Usuario inactivo. Contacte al administrador.");
    }

    if (estadoUser === 'BLOQUEADO') {
      return res.redirect("/auth/login?error=Usuario bloqueado por intentos fallidos.");
    }

    if (estadoUser !== 'ACTIVO' && estadoUser !== 'NUEVO') {
      return res.redirect("/auth/login?error=Estado de usuario no válido.");
    }

    const validPassword = await bcrypt.compare(password, passwordHash);

    if (!validPassword) {
      await db.query(
        "UPDATE TBL_MS_USUARIO SET INTENTOS_FALLIDOS = COALESCE(INTENTOS_FALLIDOS, 0) + 1 WHERE ID_USUARIO = $1",
        [idUsuario]
      );
      
      const intentosResult = await db.query(
        "SELECT INTENTOS_FALLIDOS FROM TBL_MS_USUARIO WHERE ID_USUARIO = $1",
        [idUsuario]
      );
      
      const intentosFallidos = intentosResult.rows[0]?.intentos_fallidos ?? intentosResult.rows[0]?.INTENTOS_FALLIDOS ?? 0;
      
      if (intentosFallidos >= 3) {
        await db.query(
          "UPDATE TBL_MS_USUARIO SET ESTADO = 'BLOQUEADO' WHERE ID_USUARIO = $1",
          [idUsuario]
        );
        return res.redirect("/auth/login?error=Usuario bloqueado por exceso de intentos");
      }
      
      return res.redirect("/auth/login?error=Contraseña incorrecta");
    }

    // Resetear intentos y actualizar última conexión (usando NOW() compatible con PostgreSQL)
    await db.query(
      "UPDATE TBL_MS_USUARIO SET INTENTOS_FALLIDOS = 0, FECHA_ULTIMA_CONEXION = NOW() WHERE ID_USUARIO = $1",
      [idUsuario]
    );

    // Establecer cookie
    res.cookie("user", usernameReal, {
      httpOnly: false,
      maxAge: 1000 * 60 * 60 * 8 // 8 horas
    });

    console.log("Cookie establecida para:", usernameReal);

    await registrarBitacora({
      usuario: usernameReal,
      accion: "LOGIN",
      descripcion: "Inicio de sesión exitoso",
    });

    res.redirect("/dashboard");
    
  } catch (err) {
    console.error(" ERROR EN LOGIN:", err);
    res.redirect("/auth/login?error=Error interno del servidor");
  }
});

// ================================
// 2FA - Configuración y verificación
// ================================
router.get("/setup/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const secret = speakeasy.generateSecret({ 
      name: `Roca Maya (${userId})`, 
      issuer: "Sistema Roca Maya" 
    });

    await db.query(
      "UPDATE TBL_MS_USUARIO SET SECRET_2FA=$1, ACTIVO_2FA=1 WHERE UPPER(USUARIO)=UPPER($2)",
      [secret.base32, userId]
    );

    const qr = await QRCode.toDataURL(secret.otpauth_url);
    res.render("setup-2fa", { userId, data_url: qr, secret: secret.base32 });
    
  } catch (error) {
    console.error("❌ Error en setup 2FA:", error);
    res.redirect("/auth/login?error=Error al configurar 2FA");
  }
});

router.post("/verify-2fa", async (req, res) => {
  try {
    const { userId, token } = req.body;
    
    const result = await db.query(
      "SELECT SECRET_2FA FROM TBL_MS_USUARIO WHERE UPPER(USUARIO)=UPPER($1)",
      [userId]
    );
    
    if (!result.rows.length) {
      return res.render("login-2fa", { userId, error: "Usuario no encontrado" });
    }

    const secretValue = result.rows[0].secret_2fa || result.rows[0].SECRET_2FA;
    const valid = speakeasy.totp.verify({ 
      secret: secretValue, 
      encoding: "base32", 
      token, 
      window: 1 
    });
    
    if (valid) {
      req.session = req.session || {};
      req.session.userId = userId;
      return res.redirect("/dashboard");
    }
    
    res.render("login-2fa", { userId, error: "Código incorrecto" });
    
  } catch (error) {
    console.error(" Error en verify-2fa:", error);
    res.render("login-2fa", { userId, error: "Error al verificar código" });
  }
});

// ================================
// RECUPERACIÓN DE CONTRASEÑA
// ================================
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { error: null, success: null });
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { correo } = req.body;
    const result = await db.query("SELECT * FROM TBL_MS_USUARIO WHERE CORREO_ELECTRONICO=$1", [correo]);

    if (result.rows.length === 0) {
      return res.render("forgot-password", { error: "El correo no existe", success: null });
    }

    const codigo = crypto.randomInt(100000, 999999);
    const usuario = result.rows[0].usuario || result.rows[0].USUARIO;

    // Uso de INTERVAL compatible con PostgreSQL
    await db.query(
      "UPDATE TBL_MS_USUARIO SET CODIGO_RECUPERACION=$1, EXPIRA_CODIGO=NOW() + INTERVAL '10 minutes' WHERE UPPER(USUARIO)=UPPER($2)",
      [codigo, usuario]
    );

    const correoHtml = `
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"></head>
      <body style="margin: 0; padding: 0; background-color: #f4f7f6; font-family: sans-serif;">
        <div style="padding: 40px; background: #fff; max-width: 600px; margin: auto; border-radius: 10px;">
          <h2 style="color: #2c3e50;">Recuperación de acceso</h2>
          <p>Tu código de seguridad es:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="font-size: 32px; font-weight: bold; color: #0d6efd; background: #f8f9fa; padding: 10px 20px; border-radius: 8px;">
              ${codigo}
            </span>
          </div>
          <p>Este código expira en 10 minutos.</p>
        </div>
      </body>
      </html>
    `;

    await enviarCorreo(correo, "Código de recuperación - Sistema Roca Maya", correoHtml);
    res.render("verify-code", { userId: usuario, error: null });
    
  } catch (err) {
    console.error(" Error en forgot-password:", err);
    res.render("forgot-password", { error: "Error interno del servidor", success: null });
  }
});

router.post("/verify-code", async (req, res) => {
  try {
    const { userId, codigo } = req.body;
    const result = await db.query(
      "SELECT CODIGO_RECUPERACION, EXPIRA_CODIGO FROM TBL_MS_USUARIO WHERE UPPER(USUARIO)=UPPER($1)",
      [userId]
    );

    if (!result.rows.length) {
      return res.render("verify-code", { userId, error: "Usuario no encontrado" });
    }

    const data = result.rows[0];
    const codRecuperacion = data.codigo_recuperacion || data.CODIGO_RECUPERACION;
    const expiraCodigo = data.expira_codigo || data.EXPIRA_CODIGO;

    if (codRecuperacion != codigo) {
      return res.render("verify-code", { userId, error: "Código incorrecto" });
    }

    if (new Date() > new Date(expiraCodigo)) {
      return res.render("verify-code", { userId, error: "El código ha expirado" });
    }

    res.render("reset-password", { userId, error: null });
    
  } catch (error) {
    console.error(" Error en verify-code:", error);
    res.render("verify-code", { userId, error: "Error interno del servidor" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { userId, pass1, pass2 } = req.body;

    if (pass1 !== pass2) {
      return res.render("reset-password", { userId, error: "Las contraseñas no coinciden" });
    }

    if (pass1.length < 9 || pass1.length > 20) {
      return res.render("reset-password", { userId, error: "La contraseña debe tener entre 9 y 20 caracteres" });
    }

    const hashed = await bcrypt.hash(pass1, 10);

    await db.query(
      "UPDATE TBL_MS_USUARIO SET CONTRASENA=$1, CODIGO_RECUPERACION=NULL, EXPIRA_CODIGO=NULL WHERE UPPER(USUARIO)=UPPER($2)",
      [hashed, userId]
    );

    res.redirect("/auth/login?success=Contraseña actualizada correctamente");
    
  } catch (error) {
    console.error(" Error en reset-password:", error);
    res.render("reset-password", { userId, error: "Error interno del servidor" });
  }
});

router.get("/logout", (req, res) => {
  console.log(" GET /auth/logout - Cerrando sesión para usuario:", req.cookies?.user);
  res.clearCookie("user");
  if (req.session) {
    req.session.destroy();
  }
  res.redirect("/auth/login");
});

console.log(" auth.routes.js cargado correctamente");

module.exports = router;