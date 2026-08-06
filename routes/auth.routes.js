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

router.get("/", (req, res) => {
  res.redirect("/login");
});

router.get("/login", (req, res) => {
  res.render("index", { error: req.query.error, success: req.query.success });
});

// ============================================================
// REGISTRO API - Para el modal (responde en JSON)
// ============================================================
router.post("/api/register", async (req, res) => {
  try {
    const { nombre_completo, usuario, contrasena, confirm_contrasena, correo_electronico, id_rol } = req.body;
    
    if (!nombre_completo || !usuario || !contrasena || !confirm_contrasena || !correo_electronico) {
      return res.status(400).json({ success: false, error: "Todos los campos son requeridos" });
    }

    if (contrasena !== confirm_contrasena) {
      return res.status(400).json({ success: false, error: "Las contraseñas no coinciden" });
    }

    if (contrasena.length < 9 || contrasena.length > 20) {
      return res.status(400).json({ success: false, error: "La contraseña debe tener entre 9 y 20 caracteres" });
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[@$!%*#?&._-])[A-Za-z\d@$!%*#?&._-]{9,20}$/;
    if (!passwordRegex.test(contrasena)) {
      return res.status(400).json({ success: false, error: "La contraseña debe incluir al menos una letra, un número y un símbolo" });
    }

    const userExistsResult = await db.query(
      `SELECT id_usuario FROM tbl_ms_usuario WHERE UPPER(usuario) = UPPER($1)`,
      [usuario]
    );
    if (userExistsResult.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El usuario ya existe" });
    }

    const emailExistsResult = await db.query(
      `SELECT id_usuario FROM tbl_ms_usuario WHERE correo_electronico = $1`,
      [correo_electronico]
    );
    if (emailExistsResult.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El correo ya está registrado" });
    }

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    const rol = id_rol ? parseInt(id_rol) : 5;

    const insertResult = await db.query(
      `INSERT INTO tbl_ms_usuario 
       (usuario, nombre_usuario, contrasena, correo_electronico, estado, id_rol)
       VALUES ($1, $2, $3, $4, 'NUEVO', $5) RETURNING id_usuario`,
      [usuario, nombre_completo, hashedPassword, correo_electronico, rol]
    );

    const insertId = insertResult.rows[0].id_usuario || insertResult.rows[0].ID_USUARIO;

    let emailSent = false;
    try {
      const subject = ' Bienvenido a Clínicas Roca Maya - Credenciales de acceso';
      const html = `<p>Estimado(a) <strong>${nombre_completo}</strong>, sus credenciales son Usuario: <b>${usuario}</b> y Contraseña: <b>${contrasena}</b></p>`;
      emailSent = await enviarCorreo(correo_electronico, subject, html);
    } catch (emailError) {
      console.error(' Error al enviar correo:', emailError);
    }

    try {
      await registrarBitacora({
        usuario: usuario,
        accion: "REGISTRO_MODAL",
        descripcion: `Nuevo usuario registrado desde modal: ${usuario}`,
        modulo: "AUTENTICACION",
        idRegistro: insertId,
        tabla: "tbl_ms_usuario",
        estado: "EXITO",
        req
      });
    } catch (bitError) {
      console.error(" Error registrando bitácora:", bitError);
    }

    return res.status(200).json({ 
      success: true, 
      message: "Usuario registrado correctamente",
      email_enviado: emailSent
    });

  } catch (err) {
    console.error(" Error en API registro:", err);
    return res.status(500).json({ success: false, error: "Error interno del servidor: " + err.message });
  }
});

// ================================
// REGISTRO - Página web
// ================================
router.get("/register", (req, res) => {
  res.render("register", { error: req.query.error, success: req.query.success });
});

router.post("/register", async (req, res) => {
  try {
    const { nombre_completo, usuario, contrasena, confirm_contrasena, correo_electronico } = req.body;
    
    if (!nombre_completo || !usuario || !contrasena || !confirm_contrasena || !correo_electronico) {
      return res.redirect("/auth/register?error=Todos los campos son requeridos");
    }

    if (contrasena !== confirm_contrasena) {
      return res.redirect("/auth/register?error=Las contraseñas no coinciden");
    }

    const userExistsResult = await db.query(`SELECT * FROM tbl_ms_usuario WHERE UPPER(usuario) = UPPER($1)`, [usuario]);
    if (userExistsResult.rows.length > 0) {
      return res.redirect("/auth/register?error=El usuario ya existe");
    }

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    await db.query(
      `INSERT INTO tbl_ms_usuario (usuario, nombre_usuario, contrasena, correo_electronico, estado, id_rol) VALUES ($1, $2, $3, $4, 'NUEVO', 5)`,
      [usuario, nombre_completo, hashedPassword, correo_electronico]
    );

    return res.redirect("/auth/login?success=Registro exitoso");
  } catch (err) {
    console.error(" ERROR EN REGISTRO:", err);
    return res.redirect(`/auth/register?error=Error interno del servidor: ${encodeURIComponent(err.message)}`);
  }
});

// ================================
// LOGIN
// ================================
router.post("/login", async (req, res) => {
  try {
    const { nombre_usuario, password } = req.body;

    if (!nombre_usuario || !password) {
      return res.redirect("/auth/login?error=Usuario y contraseña son requeridos");
    }

    const result = await db.query(
      `SELECT * FROM tbl_ms_usuario WHERE UPPER(usuario) = UPPER($1)`,
      [nombre_usuario]
    );
    
    const rows = result.rows;
    if (rows.length === 0) {
      return res.redirect("/auth/login?error=Usuario no encontrado");
    }

    const user = rows[0];
    const estadoUser = user.estado || user.ESTADO;
    const idUsuario = user.id_usuario || user.ID_USUARIO;
    const passwordHash = user.contrasena || user.CONTRASENA;
    const usernameReal = user.usuario || user.USUARIO;

    if (estadoUser === 'INACTIVO') return res.redirect("/auth/login?error=Usuario inactivo");
    if (estadoUser === 'BLOQUEADO') return res.redirect("/auth/login?error=Usuario bloqueado");

    const validPassword = await bcrypt.compare(password, passwordHash);

    if (!validPassword) {
      await db.query(
        `UPDATE tbl_ms_usuario SET intentos_fallidos = COALESCE(intentos_fallidos, 0) + 1 WHERE id_usuario = $1`,
        [idUsuario]
      );
      
      const intentosResult = await db.query(
        `SELECT intentos_fallidos FROM tbl_ms_usuario WHERE id_usuario = $1`,
        [idUsuario]
      );
      
      const intentosFallidos = intentosResult.rows[0]?.intentos_fallidos ?? intentosResult.rows[0]?.INTENTOS_FALLIDOS ?? 0;
      
      if (intentosFallidos >= 3) {
        await db.query(
          `UPDATE tbl_ms_usuario SET estado = 'BLOQUEADO' WHERE id_usuario = $1`,
          [idUsuario]
        );
        return res.redirect("/auth/login?error=Usuario bloqueado por exceso de intentos");
      }
      
      return res.redirect("/auth/login?error=Contraseña incorrecta");
    }

    await db.query(
      `UPDATE tbl_ms_usuario SET intentos_fallidos = 0, fecha_ultima_conexion = NOW() WHERE id_usuario = $1`,
      [idUsuario]
    );

    res.cookie("user", usernameReal, { httpOnly: false, maxAge: 1000 * 60 * 60 * 8 });

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
// RECUPERACIÓN DE CONTRASEÑA
// ================================
router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { error: null, success: null });
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { correo } = req.body;
    const result = await db.query(`SELECT * FROM tbl_ms_usuario WHERE correo_electronico=$1`, [correo]);

    if (result.rows.length === 0) {
      return res.render("forgot-password", { error: "El correo no existe", success: null });
    }

    const codigo = crypto.randomInt(100000, 999999);
    const usuario = result.rows[0].usuario || result.rows[0].USUARIO;

    await db.query(
      `UPDATE tbl_ms_usuario SET codigo_recuperacion=$1, expira_codigo=NOW() + INTERVAL '10 minutes' WHERE UPPER(usuario)=UPPER($2)`,
      [codigo, usuario]
    );

    await enviarCorreo(correo, "Código de recuperación - Sistema Roca Maya", `Tu código es: ${codigo}`);
    res.render("verify-code", { userId: usuario, error: null });
  } catch (err) {
    console.error(" Error en forgot-password:", err);
    res.render("forgot-password", { error: "Error interno del servidor", success: null });
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("user");
  if (req.session) req.session.destroy();
  res.redirect("/auth/login");
});

module.exports = router;