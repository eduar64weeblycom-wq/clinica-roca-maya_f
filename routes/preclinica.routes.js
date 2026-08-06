const express = require("express");
const router = express.Router();
const pool = require("../database/db"); // PostgreSQL pool (pg)
const { registrarBitacora } = require("../services/bitacora.service");

router.use(express.json());

router.use((req, res, next) => {
  try {
    if (req.body && typeof req.body === "object") {
      delete req.body.IMC;
      delete req.body.imc;
    }
  } catch (e) {
    console.warn("preclinica.routes sanitizar body fallo:", e);
  }
  next();
});

function tieneInfoMinima(pre) {
  const peso = Number(pre?.PESO ?? pre?.peso ?? 0);
  const talla = Number(pre?.TALLA ?? pre?.talla ?? 0);
  return peso > 0 && talla > 0;
}

const CAMPOS_ESPERADOS_CONSULTA = [
  { key: "temperatura", label: "Temperatura" },
  { key: "presionSistolica", label: "Presión sistólica" },
  { key: "presionDiastolica", label: "Presión diastólica" },
  { key: "frecuenciaCardiaca", label: "Frecuencia cardíaca" },
  { key: "frecuenciaRespiratoria", label: "Frecuencia respiratoria" },
  { key: "saturacionOxigeno", label: "Saturación de oxígeno" },
  { key: "peso", label: "Peso" },
  { key: "talla", label: "Talla" },
];

function normalizarBooleano(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function tieneValor(value) {
  return !(value === null || value === undefined || String(value).trim() === "");
}

function obtenerCamposPendientes(datos = {}) {
  return CAMPOS_ESPERADOS_CONSULTA
    .filter((campo) => !tieneValor(datos[campo.key]))
    .map((campo) => campo.label);
}

function convertirSignosJson(signosVitalesJson) {
  if (!signosVitalesJson) return {};
  if (typeof signosVitalesJson === "object" && !Array.isArray(signosVitalesJson)) {
    return { ...signosVitalesJson };
  }
  if (typeof signosVitalesJson === "string") {
    try {
      const parsed = JSON.parse(signosVitalesJson);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.warn("No se pudo convertir signosVitalesJson:", error.message);
    }
  }
  return {};
}

function construirSignosJson({ signosVitalesJson, datos, enviarAConsulta }) {
  const base = convertirSignosJson(signosVitalesJson);
  const camposPendientes = obtenerCamposPendientes(datos);
  const incompleta = camposPendientes.length > 0;

  return {
    ...base,
    temperatura: datos.temperatura ?? null,
    presionSistolica: datos.presionSistolica ?? null,
    presionDiastolica: datos.presionDiastolica ?? null,
    frecuenciaCardiaca: datos.frecuenciaCardiaca ?? null,
    frecuenciaRespiratoria: datos.frecuenciaRespiratoria ?? null,
    saturacionOxigeno: datos.saturacionOxigeno ?? null,
    peso: datos.peso ?? null,
    talla: datos.talla ?? null,
    glucosa: datos.glucosa ?? null,
    perimetroAbdominal: datos.perimetroAbdominal ?? null,
    controlConsulta: {
      ...(base.controlConsulta || {}),
      incompleta,
      camposPendientes,
      alertaActiva: Boolean(enviarAConsulta && incompleta),
      mensaje: incompleta
        ? "La preclínica tiene datos pendientes de registrar."
        : "Preclínica completa.",
      fechaActualizacion: new Date().toISOString(),
    },
  };
}

// ============================================================
// GET /preclinica
// Mostrar vista principal
// ============================================================
router.get("/", async (req, res) => {
  try {
    await registrarBitacora({
      usuario: req.user ? req.user.USUARIO : "SISTEMA",
      accion: "ACCESO_PRECLINICA",
      descripcion: "Acceso a la vista de preclínica",
      modulo: "PRECLINICA",
      tabla: "TBL_PRECLINICA",
      estado: "EXITO",
      req,
    });
    res.render("preclinica", { title: "Preclínica - Roca Maya" });
  } catch (err) {
    console.error("GET /preclinica error:", err);
    res.status(500).send("Error interno");
  }
});

// ============================================================
// GET /preclinica/api/datos
// Obtener citas y preclínicas
// ============================================================
router.get("/api/datos", async (req, res) => {
  try {
    const { rows: citas } = await pool.query(`
      SELECT
        c.ID_CITA,
        c.ID_DOCTOR,
        CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
        p.TELEFONO,
        p.CORREO_ELECTRONICO,
        u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
        c.FECHA_CITA,
        c.ESTADO
      FROM TBL_CITAS c
      INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
      LEFT JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
      WHERE c.ESTADO IN ('PRECLINICA', 'CONSULTA_MEDICA', 'CANCELADA', 'NO_ASISTIO')
      ORDER BY c.FECHA_CITA DESC
    `);

    const { rows: preclinicas } = await pool.query(`
      SELECT
        ID_PRECLINICA,
        ID_CITA,
        PESO,
        TALLA,
        TEMPERATURA,
        ESTADO_GENERAL,
        FECHA_REGISTRO,
        OBSERVACIONES,
        PRESION_SISTOLICA,
        PRESION_DIASTOLICA,
        FRECUENCIA_CARDIACA,
        FRECUENCIA_RESPIRATORIA,
        SATURACION_OXIGENO,
        GLUCOSA,
        PERIMETRO_ABDOMINAL,
        SIGNOS_VITALES_JSON
      FROM TBL_PRECLINICA
    `);

    res.json({ citas, preclinicas });
  } catch (err) {
    console.error("GET /preclinica/api/datos error:", err);
    res.status(500).json({ citas: [], preclinicas: [], error: err.message });
  }
});

// ============================================================
// GET /preclinica/por-cita/:idCita
// Obtener una preclínica por cita
// ============================================================
router.get("/por-cita/:idCita", async (req, res) => {
  try {
    const id = Number(req.params.idCita || 0);
    if (!id) {
      return res.status(400).json({ success: false, message: "ID de cita inválido" });
    }

    const { rows } = await pool.query(
      `SELECT * FROM TBL_PRECLINICA WHERE ID_CITA = $1 LIMIT 1`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "No existe preclínica para esa cita" });
    }

    const preclinica = rows[0];
    try {
      if (preclinica.SIGNOS_VITALES_JSON && typeof preclinica.SIGNOS_VITALES_JSON === "string") {
        preclinica.SIGNOS_VITALES_JSON = JSON.parse(preclinica.SIGNOS_VITALES_JSON);
      }
    } catch (errorJson) {
      console.warn("No se pudo convertir SIGNOS_VITALES_JSON:", errorJson);
    }

    res.json({ success: true, preclinica });
  } catch (err) {
    console.error("GET /preclinica/por-cita error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// POST /preclinica/nueva
// Crear nueva preclínica
// ============================================================
router.post("/nueva", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      idCita,
      temperatura,
      presionSistolica,
      presionDiastolica,
      frecuenciaCardiaca,
      frecuenciaRespiratoria,
      saturacionOxigeno,
      peso,
      talla,
      glucosa,
      perimetroAbdominal,
      observaciones,
      estadoGeneral,
      signosVitalesJson,
      enviarAConsulta,
    } = req.body;

    const idCitaNum = Number(idCita || 0);
    if (!idCitaNum) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Falta ID de cita" });
    }

    const { rows: exists } = await client.query(
      `SELECT ID_PRECLINICA FROM TBL_PRECLINICA WHERE ID_CITA = $1`,
      [idCitaNum]
    );
    if (exists && exists.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: "Ya existe una preclínica asociada a esa cita" });
    }

    const usuarioCreacion = req.user && req.user.USUARIO ? req.user.USUARIO : "SISTEMA";
    const debeEnviarAConsulta = normalizarBooleano(enviarAConsulta);
    const datosClinicos = {
      temperatura,
      presionSistolica,
      presionDiastolica,
      frecuenciaCardiaca,
      frecuenciaRespiratoria,
      saturacionOxigeno,
      peso,
      talla,
      glucosa,
      perimetroAbdominal,
    };
    const camposPendientes = obtenerCamposPendientes(datosClinicos);
    const signosJsonStr = JSON.stringify(
      construirSignosJson({
        signosVitalesJson,
        datos: datosClinicos,
        enviarAConsulta: debeEnviarAConsulta,
      })
    );

    const { rows: result } = await client.query(
      `
      INSERT INTO TBL_PRECLINICA (
        ID_CITA,
        ID_USUARIO_ENFERMERIA,
        TEMPERATURA,
        PRESION_SISTOLICA,
        PRESION_DIASTOLICA,
        FRECUENCIA_CARDIACA,
        FRECUENCIA_RESPIRATORIA,
        SATURACION_OXIGENO,
        PESO,
        TALLA,
        GLUCOSA,
        PERIMETRO_ABDOMINAL,
        OBSERVACIONES,
        ESTADO_GENERAL,
        SIGNOS_VITALES_JSON,
        USUARIO_CREACION
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING ID_PRECLINICA
      `,
      [
        idCitaNum,
        req.user && req.user.ID_USUARIO ? req.user.ID_USUARIO : 1,
        temperatura ?? null,
        presionSistolica ?? null,
        presionDiastolica ?? null,
        frecuenciaCardiaca ?? null,
        frecuenciaRespiratoria ?? null,
        saturacionOxigeno ?? null,
        peso ?? null,
        talla ?? null,
        glucosa ?? null,
        perimetroAbdominal ?? null,
        observaciones || null,
        estadoGeneral || "BUENO",
        signosJsonStr,
        usuarioCreacion,
      ]
    );

    if (!result || result.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "No se pudo crear la preclínica" });
    }

    const idPre = result[0].id_preclinica;

    await registrarBitacora({
      usuario: usuarioCreacion,
      accion: "CREACION_PRECLINICA",
      descripcion: `Creada preclínica ID ${idPre} para cita ${idCitaNum}` +
        (camposPendientes.length ? ` con ${camposPendientes.length} dato(s) pendiente(s)` : ""),
      modulo: "PRECLINICA",
      idRegistro: idPre,
      tabla: "TBL_PRECLINICA",
      estado: "EXITO",
      req,
    });

    if (debeEnviarAConsulta) {
      await client.query(
        `
        UPDATE TBL_CITAS
        SET ESTADO = 'CONSULTA_MEDICA',
            FECHA_MODIFICACION = CURRENT_TIMESTAMP,
            USUARIO_MODIFICACION = $1
        WHERE ID_CITA = $2
        `,
        [usuarioCreacion, idCitaNum]
      );

      await registrarBitacora({
        usuario: usuarioCreacion,
        accion: "CAMBIO_ESTADO_CITA_POR_PRECLINICA",
        descripcion: `Cita ${idCitaNum} -> CONSULTA_MEDICA tras crear preclínica ${idPre}` +
          (camposPendientes.length ? ` con alerta por datos pendientes: ${camposPendientes.join(", ")}` : ""),
        modulo: "CITAS",
        idRegistro: idCitaNum,
        tabla: "TBL_CITAS",
        estado: "EXITO",
        req,
      });
    }

    await client.query('COMMIT');

    const alertaConsulta = debeEnviarAConsulta && camposPendientes.length > 0;

    return res.json({
      success: true,
      message: debeEnviarAConsulta
        ? alertaConsulta
          ? "Preclínica guardada y enviada a Consulta Médica con una alerta por datos pendientes."
          : "Preclínica guardada y enviada a Consulta Médica correctamente."
        : "Preclínica guardada correctamente. La cita permanece en Preclínica.",
      idPreclinica: idPre,
      enviadoAConsulta: debeEnviarAConsulta,
      alertaConsulta,
      camposPendientes,
      nota_estado_actualizado: debeEnviarAConsulta ? "CONSULTA_MEDICA" : "PRECLINICA",
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("POST /preclinica/nueva error:", err);

    try {
      await registrarBitacora({
        usuario: req.user ? req.user.USUARIO : "SISTEMA",
        accion: "ERROR_CREACION_PRECLINICA",
        descripcion: err.message,
        modulo: "PRECLINICA",
        tabla: "TBL_PRECLINICA",
        estado: "ERROR",
        detalleError: err.message,
        req,
      });
    } catch (errorBitacora) {
      console.error("Error registrando fallo de creación:", errorBitacora);
    }

    return res.status(500).json({ success: false, message: "Error creando preclínica: " + err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// POST /preclinica/actualizar
// Actualizar una preclínica
// ============================================================
router.post("/actualizar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      idPreclinica,
      idCita,
      temperatura,
      presionSistolica,
      presionDiastolica,
      frecuenciaCardiaca,
      frecuenciaRespiratoria,
      saturacionOxigeno,
      peso,
      talla,
      glucosa,
      perimetroAbdominal,
      observaciones,
      estadoGeneral,
      signosVitalesJson,
      enviarAConsulta,
    } = req.body;

    const idPre = Number(idPreclinica || 0);
    if (!idPre) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Falta ID preclínica" });
    }

    const { rows: registroActual } = await client.query(
      `SELECT ID_CITA FROM TBL_PRECLINICA WHERE ID_PRECLINICA = $1 LIMIT 1`,
      [idPre]
    );
    if (!registroActual || registroActual.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Preclínica no encontrada" });
    }

    const idCitaNum = Number(idCita || registroActual[0].ID_CITA || 0);
    const usuarioMod = req.user && req.user.USUARIO ? req.user.USUARIO : "SISTEMA";
    const debeEnviarAConsulta = normalizarBooleano(enviarAConsulta);
    const datosClinicos = {
      temperatura,
      presionSistolica,
      presionDiastolica,
      frecuenciaCardiaca,
      frecuenciaRespiratoria,
      saturacionOxigeno,
      peso,
      talla,
      glucosa,
      perimetroAbdominal,
    };
    const camposPendientes = obtenerCamposPendientes(datosClinicos);
    const signosJsonStr = JSON.stringify(
      construirSignosJson({
        signosVitalesJson,
        datos: datosClinicos,
        enviarAConsulta: debeEnviarAConsulta,
      })
    );

    const { rowCount } = await client.query(
      `
      UPDATE TBL_PRECLINICA
      SET
        TEMPERATURA = $1,
        PRESION_SISTOLICA = $2,
        PRESION_DIASTOLICA = $3,
        FRECUENCIA_CARDIACA = $4,
        FRECUENCIA_RESPIRATORIA = $5,
        SATURACION_OXIGENO = $6,
        PESO = $7,
        TALLA = $8,
        GLUCOSA = $9,
        PERIMETRO_ABDOMINAL = $10,
        OBSERVACIONES = $11,
        ESTADO_GENERAL = $12,
        SIGNOS_VITALES_JSON = $13,
        USUARIO_MODIFICACION = $14
      WHERE ID_PRECLINICA = $15
      `,
      [
        temperatura ?? null,
        presionSistolica ?? null,
        presionDiastolica ?? null,
        frecuenciaCardiaca ?? null,
        frecuenciaRespiratoria ?? null,
        saturacionOxigeno ?? null,
        peso ?? null,
        talla ?? null,
        glucosa ?? null,
        perimetroAbdominal ?? null,
        observaciones || null,
        estadoGeneral || "BUENO",
        signosJsonStr,
        usuarioMod,
        idPre,
      ]
    );

    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Preclínica no encontrada" });
    }

    if (debeEnviarAConsulta && idCitaNum) {
      await client.query(
        `
        UPDATE TBL_CITAS
        SET ESTADO = 'CONSULTA_MEDICA',
            FECHA_MODIFICACION = CURRENT_TIMESTAMP,
            USUARIO_MODIFICACION = $1
        WHERE ID_CITA = $2
        `,
        [usuarioMod, idCitaNum]
      );

      await registrarBitacora({
        usuario: usuarioMod,
        accion: "CAMBIO_ESTADO_CITA_POR_PRECLINICA_UPDATE",
        descripcion: `Cita ${idCitaNum} -> CONSULTA_MEDICA tras actualizar preclínica ${idPre}` +
          (camposPendientes.length ? ` con alerta por datos pendientes: ${camposPendientes.join(", ")}` : ""),
        modulo: "CITAS",
        idRegistro: idCitaNum,
        tabla: "TBL_CITAS",
        estado: "EXITO",
        req,
      });
    }

    await registrarBitacora({
      usuario: usuarioMod,
      accion: "ACTUALIZACION_PRECLINICA",
      descripcion: `Actualizada preclínica ID ${idPre}` +
        (camposPendientes.length ? ` con ${camposPendientes.length} dato(s) pendiente(s)` : ""),
      modulo: "PRECLINICA",
      idRegistro: idPre,
      tabla: "TBL_PRECLINICA",
      estado: "EXITO",
      req,
    });

    await client.query('COMMIT');

    let estadoActual = "PRECLINICA";
    if (idCitaNum) {
      const { rows: estadoRows } = await client.query(
        `SELECT ESTADO FROM TBL_CITAS WHERE ID_CITA = $1 LIMIT 1`,
        [idCitaNum]
      );
      if (estadoRows && estadoRows.length) {
        estadoActual = estadoRows[0].ESTADO || estadoActual;
      }
    }

    const alertaConsulta = debeEnviarAConsulta && camposPendientes.length > 0;

    return res.json({
      success: true,
      message: debeEnviarAConsulta
        ? alertaConsulta
          ? "Preclínica actualizada y enviada a Consulta Médica con una alerta por datos pendientes."
          : "Preclínica actualizada y enviada a Consulta Médica correctamente."
        : "Preclínica actualizada correctamente sin cambiar el estado de la cita.",
      enviadoAConsulta: debeEnviarAConsulta,
      alertaConsulta,
      camposPendientes,
      nota_estado_actualizado: estadoActual,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("POST /preclinica/actualizar error:", err);

    try {
      await registrarBitacora({
        usuario: req.user ? req.user.USUARIO : "SISTEMA",
        accion: "ERROR_ACTUALIZACION_PRECLINICA",
        descripcion: err.message,
        modulo: "PRECLINICA",
        tabla: "TBL_PRECLINICA",
        estado: "ERROR",
        detalleError: err.message,
        req,
      });
    } catch (errorBitacora) {
      console.error("Error registrando fallo de actualización:", errorBitacora);
    }

    return res.status(500).json({ success: false, message: "Error actualizando preclínica: " + err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE /preclinica/eliminar/:idCita
// Eliminar una preclínica por ID de cita
// ============================================================
router.delete("/eliminar/:idCita", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const idCita = Number(req.params.idCita || 0);
    if (!idCita || !Number.isInteger(idCita)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "El ID de la cita no es válido" });
    }

    const { rows } = await client.query(
      `
      SELECT p.ID_PRECLINICA, p.ID_CITA, c.ESTADO AS ESTADO_CITA
      FROM TBL_PRECLINICA p
      INNER JOIN TBL_CITAS c ON c.ID_CITA = p.ID_CITA
      WHERE p.ID_CITA = $1
      LIMIT 1
      FOR UPDATE
      `,
      [idCita]
    );

    if (!rows || rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "No existe una preclínica asociada a esta cita" });
    }

    const preclinica = rows[0];
    const idPreclinica = Number(preclinica.ID_PRECLINICA);
    const estadoAnterior = String(preclinica.ESTADO_CITA || "").toUpperCase();

    const { rowCount } = await client.query(
      `DELETE FROM TBL_PRECLINICA WHERE ID_PRECLINICA = $1 AND ID_CITA = $2`,
      [idPreclinica, idCita]
    );

    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "No se encontró la preclínica para eliminar" });
    }

    const usuario = req.user && req.user.USUARIO ? req.user.USUARIO : "SISTEMA";
    let nuevoEstado = estadoAnterior;

    if (estadoAnterior === "CONSULTA_MEDICA") {
      nuevoEstado = "PRECLINICA";
      await client.query(
        `
        UPDATE TBL_CITAS
        SET ESTADO = 'PRECLINICA',
            FECHA_MODIFICACION = CURRENT_TIMESTAMP,
            USUARIO_MODIFICACION = $1
        WHERE ID_CITA = $2
        `,
        [usuario, idCita]
      );
    }

    await client.query('COMMIT');

    try {
      await registrarBitacora({
        usuario,
        accion: "ELIMINACION_PRECLINICA",
        descripcion: `Eliminada preclínica ID ${idPreclinica} asociada a la cita ${idCita}`,
        modulo: "PRECLINICA",
        idRegistro: idPreclinica,
        tabla: "TBL_PRECLINICA",
        estado: "EXITO",
        req,
      });

      if (estadoAnterior !== nuevoEstado) {
        await registrarBitacora({
          usuario,
          accion: "CAMBIO_ESTADO_CITA_POR_ELIMINACION_PRECLINICA",
          descripcion: `Cita ${idCita}: ${estadoAnterior} -> ${nuevoEstado} tras eliminar la preclínica ${idPreclinica}`,
          modulo: "CITAS",
          idRegistro: idCita,
          tabla: "TBL_CITAS",
          estado: "EXITO",
          req,
        });
      }
    } catch (errorBitacora) {
      console.error("Error registrando eliminación en bitácora:", errorBitacora);
    }

    return res.status(200).json({
      success: true,
      message: "Preclínica eliminada correctamente",
      idPreclinica,
      idCita,
      estadoAnterior,
      nuevoEstado,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("DELETE /preclinica/eliminar/:idCita error:", err);

    if (err.code === '23503') {
      return res.status(409).json({
        success: false,
        message: "No se puede eliminar la preclínica porque tiene registros médicos relacionados.",
      });
    }

    try {
      await registrarBitacora({
        usuario: req.user && req.user.USUARIO ? req.user.USUARIO : "SISTEMA",
        accion: "ERROR_ELIMINACION_PRECLINICA",
        descripcion: err.message,
        modulo: "PRECLINICA",
        tabla: "TBL_PRECLINICA",
        estado: "ERROR",
        detalleError: err.message,
        req,
      });
    } catch (errorBitacora) {
      console.error("Error registrando fallo de eliminación en bitácora:", errorBitacora);
    }

    return res.status(500).json({ success: false, message: "Error eliminando preclínica: " + err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// POST /preclinica/pasar-a-consulta
// Pasar cita a consulta médica, incluso si hay datos pendientes
// ============================================================
router.post("/pasar-a-consulta", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const id = Number(req.body.idCita || 0);
    if (!id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "ID de cita inválido" });
    }

    const { rows } = await client.query(
      `
      SELECT
        ID_PRECLINICA,
        TEMPERATURA,
        PRESION_SISTOLICA,
        PRESION_DIASTOLICA,
        FRECUENCIA_CARDIACA,
        FRECUENCIA_RESPIRATORIA,
        SATURACION_OXIGENO,
        PESO,
        TALLA,
        GLUCOSA,
        PERIMETRO_ABDOMINAL,
        SIGNOS_VITALES_JSON
      FROM TBL_PRECLINICA
      WHERE ID_CITA = $1
      LIMIT 1
      `,
      [id]
    );

    if (!rows || rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "No existe preclínica para esta cita" });
    }

    const registro = rows[0];
    const datosClinicos = {
      temperatura: registro.TEMPERATURA,
      presionSistolica: registro.PRESION_SISTOLICA,
      presionDiastolica: registro.PRESION_DIASTOLICA,
      frecuenciaCardiaca: registro.FRECUENCIA_CARDIACA,
      frecuenciaRespiratoria: registro.FRECUENCIA_RESPIRATORIA,
      saturacionOxigeno: registro.SATURACION_OXIGENO,
      peso: registro.PESO,
      talla: registro.TALLA,
      glucosa: registro.GLUCOSA,
      perimetroAbdominal: registro.PERIMETRO_ABDOMINAL,
    };
    const camposPendientes = obtenerCamposPendientes(datosClinicos);
    const signosJsonStr = JSON.stringify(
      construirSignosJson({
        signosVitalesJson: registro.SIGNOS_VITALES_JSON,
        datos: datosClinicos,
        enviarAConsulta: true,
      })
    );
    const usuario = req.user && req.user.USUARIO ? req.user.USUARIO : "SISTEMA";

    await client.query(
      `
      UPDATE TBL_PRECLINICA
      SET SIGNOS_VITALES_JSON = $1,
          USUARIO_MODIFICACION = $2
      WHERE ID_PRECLINICA = $3
      `,
      [signosJsonStr, usuario, registro.ID_PRECLINICA]
    );

    await client.query(
      `
      UPDATE TBL_CITAS
      SET ESTADO = 'CONSULTA_MEDICA',
          FECHA_MODIFICACION = CURRENT_TIMESTAMP,
          USUARIO_MODIFICACION = $1
      WHERE ID_CITA = $2
      `,
      [usuario, id]
    );

    await client.query('COMMIT');

    await registrarBitacora({
      usuario,
      accion: "PASAR_PRECLINICA_A_CONSULTA",
      descripcion: `Cita ${id} pasada a CONSULTA_MEDICA` +
        (camposPendientes.length ? ` con alerta por datos pendientes: ${camposPendientes.join(", ")}` : " con preclínica completa"),
      modulo: "CITAS",
      idRegistro: id,
      tabla: "TBL_CITAS",
      estado: "EXITO",
      req,
    });

    return res.json({
      success: true,
      message: camposPendientes.length
        ? "Cita enviada a Consulta Médica con una alerta por datos pendientes."
        : "Cita enviada a Consulta Médica correctamente.",
      alertaConsulta: camposPendientes.length > 0,
      camposPendientes,
      nuevoEstado: "CONSULTA_MEDICA",
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("POST /preclinica/pasar-a-consulta error:", err);
    return res.status(500).json({ success: false, message: "Error: " + err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// GET /preclinica/alertas-consulta/:idCita
// Devuelve las alertas que Consulta Médica debe mostrar
// ============================================================
router.get("/alertas-consulta/:idCita", async (req, res) => {
  try {
    const idCita = Number(req.params.idCita || 0);
    if (!idCita) {
      return res.status(400).json({ success: false, message: "ID de cita inválido" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        TEMPERATURA,
        PRESION_SISTOLICA,
        PRESION_DIASTOLICA,
        FRECUENCIA_CARDIACA,
        FRECUENCIA_RESPIRATORIA,
        SATURACION_OXIGENO,
        PESO,
        TALLA,
        GLUCOSA,
        PERIMETRO_ABDOMINAL,
        SIGNOS_VITALES_JSON
      FROM TBL_PRECLINICA
      WHERE ID_CITA = $1
      LIMIT 1
      `,
      [idCita]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "No existe preclínica para esta cita" });
    }

    const registro = rows[0];
    const datosClinicos = {
      temperatura: registro.TEMPERATURA,
      presionSistolica: registro.PRESION_SISTOLICA,
      presionDiastolica: registro.PRESION_DIASTOLICA,
      frecuenciaCardiaca: registro.FRECUENCIA_CARDIACA,
      frecuenciaRespiratoria: registro.FRECUENCIA_RESPIRATORIA,
      saturacionOxigeno: registro.SATURACION_OXIGENO,
      peso: registro.PESO,
      talla: registro.TALLA,
      glucosa: registro.GLUCOSA,
      perimetroAbdominal: registro.PERIMETRO_ABDOMINAL,
    };
    const camposPendientes = obtenerCamposPendientes(datosClinicos);
    const signosJson = convertirSignosJson(registro.SIGNOS_VITALES_JSON);
    const alertasClinicas = Array.isArray(signosJson?.controlConsulta?.alertasClinicas)
      ? signosJson.controlConsulta.alertasClinicas
      : [];
    const alertaActiva = camposPendientes.length > 0 || alertasClinicas.length > 0;

    return res.json({
      success: true,
      idCita,
      alertaActiva,
      preclinicaIncompleta: camposPendientes.length > 0,
      camposPendientes,
      alertasClinicas,
      message: camposPendientes.length
        ? `Faltan datos de preclínica: ${camposPendientes.join(", ")}.`
        : alertasClinicas.length
          ? "La preclínica contiene advertencias clínicas."
          : "La preclínica está completa y sin alertas pendientes.",
    });
  } catch (err) {
    console.error("GET /preclinica/alertas-consulta/:idCita error:", err);
    return res.status(500).json({ success: false, message: "Error consultando alertas: " + err.message });
  }
});

// ============================================================
// GET /preclinica/excel
// Descargar reporte de Excel
// ============================================================
router.get("/excel", async (req, res) => {
  try {
    console.log("Generando Excel de Preclínica...");

    const { rows: preclinicas } = await pool.query(`
      SELECT
        p.ID_PRECLINICA,
        c.ID_CITA,
        CONCAT(pa.NOMBRES, ' ', pa.APELLIDOS) AS NOMBRE_PACIENTE,
        pa.NUMERO_DOCUMENTO_IDENTIDAD AS IDENTIDAD_PACIENTE,
        pa.TELEFONO,
        p.FECHA_REGISTRO,
        p.TEMPERATURA,
        p.PRESION_SISTOLICA,
        p.PRESION_DIASTOLICA,
        p.FRECUENCIA_CARDIACA,
        p.FRECUENCIA_RESPIRATORIA,
        p.SATURACION_OXIGENO,
        p.PESO,
        p.TALLA,
        p.IMC,
        p.GLUCOSA,
        p.PERIMETRO_ABDOMINAL,
        p.ESTADO_GENERAL,
        p.OBSERVACIONES,
        u.NOMBRE_USUARIO AS ENFERMERA,
        c.ESTADO AS ESTADO_CITA
      FROM TBL_PRECLINICA p
      INNER JOIN TBL_CITAS c ON p.ID_CITA = c.ID_CITA
      INNER JOIN TBL_PACIENTE pa ON c.ID_PACIENTE = pa.ID_PACIENTE
      LEFT JOIN TBL_MS_USUARIO u ON p.ID_USUARIO_ENFERMERIA = u.ID_USUARIO
      ORDER BY p.FECHA_REGISTRO DESC
    `);

    console.log(`Preclínicas encontradas: ${preclinicas.length}`);

    if (!preclinicas || preclinicas.length === 0) {
      return res.status(404).json({ success: false, message: "No hay registros de preclínica para exportar" });
    }

    try {
      await registrarBitacora({
        usuario: req.user?.USUARIO || "SISTEMA",
        accion: "EXPORTAR_EXCEL_PRECLINICA",
        descripcion: `Exportados ${preclinicas.length} registros de preclínica a Excel`,
        modulo: "PRECLINICA",
        tabla: "TBL_PRECLINICA",
        estado: "EXITO",
        req,
      });
    } catch (bitError) {
      console.error("Error registrando bitácora:", bitError);
    }

    const { generarExcelPreclinica } = require("../services/excel.service");
    await generarExcelPreclinica(preclinicas, res);
  } catch (error) {
    console.error("Error exportando Excel de preclínica:", error);
    res.status(500).json({ success: false, message: "Error al generar el archivo Excel: " + error.message });
  }
});

module.exports = router;