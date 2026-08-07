const express = require('express');
const router = express.Router();
const pool = require('../database/db');

const { registrarBitacora } = require('../services/bitacora.service');

// Función auxiliar para obtener o crear un medicamento
async function getOrCreateMedicamento(nombreMedicamento, usuario) {
  if (!nombreMedicamento || !nombreMedicamento.trim()) return null;
  const nombreLimpio = nombreMedicamento.trim().toUpperCase();

  const [existing] = await pool.query(
    "SELECT ID_MEDICAMENTO FROM TBL_MEDICAMENTO WHERE UPPER(NOMBRE_MEDICAMENTO) = ?",
    [nombreLimpio]
  );

  if (existing.length > 0) {
    return existing[0].ID_MEDICAMENTO;
  }

  const [result] = await pool.query(
    "INSERT INTO TBL_MEDICAMENTO (NOMBRE_MEDICAMENTO, USUARIO_CREACION, FECHA_CREACION) VALUES (?, ?, CURRENT_TIMESTAMP)",
    [nombreLimpio, usuario || 'SISTEMA']
  );
  return result.insertId;
}

router.get("/", async (req, res) => {
  try {
    const usuario = req.user || null;
    let citas = [];

    if (usuario && usuario.ROL === 'ADMINISTRADOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
        ORDER BY c.FECHA_CITA DESC
      `);
      citas = rows;
    } else if (usuario && usuario.ROL === 'DOCTOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
          AND c.ID_DOCTOR = ?
        ORDER BY c.FECHA_CITA DESC
      `, [usuario.ID_USUARIO]);
      citas = rows;
    }

    const [doctores] = await pool.query(`
      SELECT 
        u.ID_USUARIO, 
        u.NOMBRE_USUARIO 
      FROM TBL_MS_USUARIO u
      WHERE u.ESTADO = 'ACTIVO' 
        AND u.ID_ROL = (SELECT ID_ROL FROM TBL_MS_ROLES WHERE ROL = 'DOCTOR')
      GROUP BY u.ID_USUARIO, u.NOMBRE_USUARIO
      ORDER BY u.NOMBRE_USUARIO
    `);

    res.render("consultaMedica", {
      citas: citas || [],
      doctores: doctores || [],
      user: usuario,
      nombreUsuario: usuario ? usuario.NOMBRE_USUARIO : 'Usuario',
      rol: usuario ? usuario.ROL : 'DOCTOR',
      title: "Consulta Médica - Clínicas Roca Maya"
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica:", err);
    res.status(500).render("consultaMedica", {
      citas: [],
      doctores: [],
      user: null,
      nombreUsuario: 'Usuario',
      rol: 'DOCTOR',
      error: "Error al cargar los datos de consulta médica",
      title: "Consulta Médica - Clínicas Roca Maya"
    });
  }
});

router.get("/api/calendario", async (req, res) => {
  try {
    const usuario = req.user || null;
    let citas = [];

    if (usuario && usuario.ROL === 'ADMINISTRADOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          p.TELEFONO AS TELEFONO_PACIENTE,
          p.CORREO_ELECTRONICO AS CORREO_PACIENTE,
          u.ID_USUARIO AS ID_DOCTOR,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          DATE_FORMAT(c.FECHA_CITA, '%H:%i') AS HORA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA,
          c.DURACION_ESTIMADA_MIN
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
        ORDER BY c.FECHA_CITA ASC
      `);
      citas = rows;
    } else if (usuario && usuario.ROL === 'DOCTOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          p.TELEFONO AS TELEFONO_PACIENTE,
          p.CORREO_ELECTRONICO AS CORREO_PACIENTE,
          u.ID_USUARIO AS ID_DOCTOR,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          DATE_FORMAT(c.FECHA_CITA, '%H:%i') AS HORA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA,
          c.DURACION_ESTIMADA_MIN
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
          AND c.ID_DOCTOR = ?
        ORDER BY c.FECHA_CITA ASC
      `, [usuario.ID_USUARIO]);
      citas = rows;
    }

    const [doctores] = await pool.query(`
      SELECT 
        u.ID_USUARIO AS ID_DOCTOR,
        u.NOMBRE_USUARIO AS NOMBRE,
        GROUP_CONCAT(DISTINCT COALESCE(e.NOMBRE_ESPECIALIDAD, 'Medicina General') SEPARATOR ', ') AS ESPECIALIDAD,
        u.CORREO_ELECTRONICO
      FROM TBL_MS_USUARIO u
      LEFT JOIN TBL_DOCTOR_ESPECIALIDAD de ON u.ID_USUARIO = de.ID_DOCTOR
      LEFT JOIN TBL_ESPECIALIDADES e ON de.ID_ESPECIALIDAD = e.ID_ESPECIALIDAD
      WHERE u.ESTADO = 'ACTIVO' 
        AND u.ID_ROL = (SELECT ID_ROL FROM TBL_MS_ROLES WHERE ROL = 'DOCTOR')
      GROUP BY u.ID_USUARIO, u.NOMBRE_USUARIO, u.CORREO_ELECTRONICO
      ORDER BY u.NOMBRE_USUARIO
    `);
    res.json({
      success: true,
      citas: citas || [],
      doctores: doctores || []
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica/api/calendario:", err);
    res.status(500).json({
      success: false,
      error: "Error al obtener datos del calendario: " + err.message,
      citas: [],
      doctores: []
    });
  }
});

router.get("/api/cita-detalle/:idCita", async (req, res) => {
  const { idCita } = req.params;

  try {
    const [citaRows] = await pool.query(`
      SELECT 
        c.ID_CITA,
        c.ID_PACIENTE,
        c.ID_DOCTOR,
        c.FECHA_CITA,
        c.ESTADO,
        c.MOTIVO_CONSULTA,
        c.PRIORIDAD,
        c.TIPO_CITA,
        c.DURACION_ESTIMADA_MIN,
        c.OBSERVACIONES,
        CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
        p.TELEFONO,
        p.CORREO_ELECTRONICO,
        u.NOMBRE_USUARIO AS NOMBRE_DOCTOR
      FROM TBL_CITAS c
      INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
      INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
      WHERE c.ID_CITA = ?
    `, [idCita]);

    if (citaRows.length === 0) {
      return res.status(404).json({ success: false, error: "Cita no encontrada" });
    }

    const cita = citaRows[0];

    const usuario = req.user || null;
    if (usuario && usuario.ROL === 'DOCTOR' && String(cita.ID_DOCTOR) !== String(usuario.ID_USUARIO)) {
      return res.status(403).json({ success: false, error: "No tienes permiso para ver esta cita" });
    }

    res.json({
      success: true,
      cita: cita
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica/api/cita-detalle/:idCita:", err);
    res.status(500).json({ success: false, error: "Error al obtener detalle de la cita" });
  }
});

router.get("/api/historial-rapido/:idPaciente", async (req, res) => {
  const { idPaciente } = req.params;

  try {
    const [consultas] = await pool.query(`
      SELECT 
        cm.ID_CONSULTA,
        cm.FECHA_CONSULTA,
        cm.DIAGNOSTICO_PRINCIPAL,
        cm.TRATAMIENTO,
        cm.OBSERVACIONES,
        cm.TIPO_CONSULTA,
        cm.ID_PACIENTE,
        u.NOMBRE_USUARIO AS DOCTOR
      FROM TBL_CONSULTA_MEDICA cm
      INNER JOIN TBL_MS_USUARIO u ON cm.ID_DOCTOR = u.ID_USUARIO
      WHERE cm.ID_PACIENTE = ?
      ORDER BY cm.FECHA_CONSULTA DESC
      LIMIT 5
    `, [idPaciente]);

    const [historial] = await pool.query(`
      SELECT 
        ALERGIAS,
        MEDICAMENTOS_ACTUALES,
        ENFERMEDADES_CRONICAS,
        NOTAS_IMPORTANTES
      FROM TBL_HISTORIAL_MEDICO
      WHERE ID_PACIENTE = ?
    `, [idPaciente]);

    res.json({
      success: true,
      consultas: consultas || [],
      historial: historial.length > 0 ? historial[0] : null
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica/api/historial-rapido/:idPaciente:", err);
    res.status(500).json({
      success: false,
      error: "Error al obtener historial rápido: " + err.message
    });
  }
});

router.get("/api/imprimir-consulta/:idConsulta", async (req, res) => {
  const { idConsulta } = req.params;

  try {
    const [rows] = await pool.query(`
      SELECT 
        cm.*,
        CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
        p.TELEFONO,
        p.CORREO_ELECTRONICO,
        p.FECHA_NACIMIENTO,
        p.GENERO,
        u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
        c.FECHA_CITA,
        c.ESTADO AS ESTADO_CITA
      FROM TBL_CONSULTA_MEDICA cm
      INNER JOIN TBL_PACIENTE p ON cm.ID_PACIENTE = p.ID_PACIENTE
      INNER JOIN TBL_MS_USUARIO u ON cm.ID_DOCTOR = u.ID_USUARIO
      INNER JOIN TBL_CITAS c ON cm.ID_CITA = c.ID_CITA
      WHERE cm.ID_CONSULTA = ?
    `, [idConsulta]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Consulta no encontrada" });
    }

    const consulta = rows[0];

    if (consulta.SINTOMAS && typeof consulta.SINTOMAS === 'string') {
      try { consulta.SINTOMAS = JSON.parse(consulta.SINTOMAS); } catch (e) { consulta.SINTOMAS = []; }
    }
    if (consulta.EXAMEN_FISICO && typeof consulta.EXAMEN_FISICO === 'string') {
      try { consulta.EXAMEN_FISICO = JSON.parse(consulta.EXAMEN_FISICO); } catch (e) { consulta.EXAMEN_FISICO = []; }
    }

    const [preclinica] = await pool.query(`
      SELECT 
        TEMPERATURA,
        PRESION_SISTOLICA,
        PRESION_DIASTOLICA,
        FRECUENCIA_CARDIACA,
        FRECUENCIA_RESPIRATORIA,
        SATURACION_OXIGENO,
        PESO,
        TALLA,
        IMC,
        GLUCOSA,
        PERIMETRO_ABDOMINAL,
        ESTADO_GENERAL
      FROM TBL_PRECLINICA
      WHERE ID_CITA = ?
      ORDER BY FECHA_REGISTRO DESC
      LIMIT 1
    `, [consulta.ID_CITA]);

    res.json({
      success: true,
      consulta: consulta,
      preclinica: preclinica.length > 0 ? preclinica[0] : null
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica/api/imprimir-consulta/:idConsulta:", err);
    res.status(500).json({
      success: false,
      error: "Error al obtener datos para imprimir: " + err.message
    });
  }
});

router.get("/api/datos", async (req, res) => {
  try {
    const usuario = req.user || null;
    let citas = [];

    if (usuario && usuario.ROL === 'ADMINISTRADOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          p.TELEFONO AS TELEFONO_PACIENTE,
          p.CORREO_ELECTRONICO AS CORREO_PACIENTE,
          u.ID_USUARIO AS ID_DOCTOR,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          DATE_FORMAT(c.FECHA_CITA, '%H:%i') AS HORA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA,
          c.DURACION_ESTIMADA_MIN,
          c.OBSERVACIONES
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
        ORDER BY c.FECHA_CITA ASC
      `);
      citas = rows;
    } else if (usuario && usuario.ROL === 'DOCTOR') {
      const [rows] = await pool.query(`
        SELECT 
          c.ID_CITA,
          CONCAT(p.NOMBRES, ' ', p.APELLIDOS) AS NOMBRE_PACIENTE,
          p.ID_PACIENTE,
          p.TELEFONO AS TELEFONO_PACIENTE,
          p.CORREO_ELECTRONICO AS CORREO_PACIENTE,
          u.ID_USUARIO AS ID_DOCTOR,
          u.NOMBRE_USUARIO AS NOMBRE_DOCTOR,
          c.FECHA_CITA,
          DATE_FORMAT(c.FECHA_CITA, '%H:%i') AS HORA_CITA,
          c.ESTADO,
          c.MOTIVO_CONSULTA,
          c.PRIORIDAD,
          c.TIPO_CITA,
          c.DURACION_ESTIMADA_MIN,
          c.OBSERVACIONES
        FROM TBL_CITAS c
        INNER JOIN TBL_PACIENTE p ON c.ID_PACIENTE = p.ID_PACIENTE
        INNER JOIN TBL_MS_USUARIO u ON c.ID_DOCTOR = u.ID_USUARIO
        WHERE c.ESTADO IN ('CONSULTA_MEDICA', 'PRECLINICA')
          AND c.ID_DOCTOR = ?
        ORDER BY c.FECHA_CITA ASC
      `, [usuario.ID_USUARIO]);
      citas = rows;
    }

    const [doctores] = await pool.query(`
      SELECT 
        u.ID_USUARIO,
        u.NOMBRE_USUARIO,
        u.CORREO_ELECTRONICO,
        GROUP_CONCAT(DISTINCT COALESCE(e.NOMBRE_ESPECIALIDAD, 'Medicina General') SEPARATOR ', ') AS ESPECIALIDAD
      FROM TBL_MS_USUARIO u
      LEFT JOIN TBL_DOCTOR_ESPECIALIDAD de ON u.ID_USUARIO = de.ID_DOCTOR
      LEFT JOIN TBL_ESPECIALIDADES e ON de.ID_ESPECIALIDAD = e.ID_ESPECIALIDAD
      WHERE u.ESTADO = 'ACTIVO' 
        AND u.ID_ROL = (SELECT ID_ROL FROM TBL_MS_ROLES WHERE ROL = 'DOCTOR')
      GROUP BY u.ID_USUARIO, u.NOMBRE_USUARIO, u.CORREO_ELECTRONICO
      ORDER BY u.NOMBRE_USUARIO
    `);

    const [pacientes] = await pool.query(`
      SELECT ID_PACIENTE, NOMBRES, APELLIDOS, TELEFONO, CORREO_ELECTRONICO
      FROM TBL_PACIENTE
      WHERE ESTADO = 'ACTIVO'
      ORDER BY NOMBRES, APELLIDOS
    `);

    const [consultasExistentes] = await pool.query(`
      SELECT ID_CONSULTA, ID_CITA 
      FROM TBL_CONSULTA_MEDICA
    `);

    const tipos = ["PRIMERA_VEZ", "CONTROL", "EMERGENCIA", "PROCEDIMIENTO"];
    const prioridades = ["NORMAL", "URGENTE", "ALTA"];
    const duraciones = [15, 20, 30, 45, 60];

    res.json({
      success: true,
      citas: citas || [],
      doctores: doctores || [],
      pacientes: pacientes || [],
      consultas: consultasExistentes || [],
      metadata: { tipos, prioridades, duraciones }
    });

  } catch (err) {
    console.error(" Error en GET /consultaMedica/api/datos:", err);
    res.status(500).json({
      success: false,
      error: "Error al obtener datos: " + err.message,
      citas: [],
      doctores: [],
      pacientes: [],
      consultas: [],
      metadata: {}
    });
  }
});

// ============================================================
// POST /nueva - Crear o actualizar consulta (UPSERT)
// ============================================================
router.post("/nueva", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const body = req.body;
    console.log("📥 Body recibido en /nueva (UPSERT):", JSON.stringify(body, null, 2));

    const idCita = body.idCita || body.citaId || body.ID_CITA;
    let idPaciente = body.idPaciente || body.pacienteId || body.ID_PACIENTE;
    let idDoctor = body.idDoctor || body.doctorId || body.ID_DOCTOR;

    if (idCita && (!idPaciente || !idDoctor)) {
      const [citaData] = await connection.query(
        "SELECT ID_PACIENTE, ID_DOCTOR FROM TBL_CITAS WHERE ID_CITA = ?",
        [idCita]
      );
      if (citaData.length > 0) {
        if (!idPaciente) idPaciente = citaData[0].ID_PACIENTE;
        if (!idDoctor) idDoctor = citaData[0].ID_DOCTOR;
      } else {
        await connection.rollback();
        return res.status(404).json({ success: false, error: "La cita no existe" });
      }
    }

    if (!idCita || !idPaciente || !idDoctor) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Faltan campos obligatorios: idCita, idPaciente, idDoctor",
        recibido: { idCita, idPaciente, idDoctor }
      });
    }

    const usuarioCreacion = req.user?.USUARIO || 'SISTEMA';

    // Verificar si la cita está en estado cancelado o no asistió
    const [citaExists] = await connection.query(
      "SELECT ID_CITA, ESTADO FROM TBL_CITAS WHERE ID_CITA = ?",
      [idCita]
    );
    if (citaExists.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "La cita no existe" });
    }
    const estadoCita = String(citaExists[0].ESTADO || "").toUpperCase();
    if (estadoCita === "CANCELADA" || estadoCita === "NO_ASISTIO") {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `No se puede crear/editar consulta para una cita en estado "${estadoCita}".`
      });
    }

    // --- Preparar datos de la consulta ---
    const motivoConsulta = body.motivoConsulta || body.motivo || body.MOTIVO_CONSULTA || null;
    const sintomas = body.sintomas || body.SINTOMAS || [];
    const examenFisico = body.examenFisico || body.EXAMEN_FISICO || [];
    const diagnosticoPrincipal = body.diagnosticoPrincipal || body.diagnostico || body.DIAGNOSTICO_PRINCIPAL || null;
    const codigoCIE10Principal = body.codigoCIE10Principal || body.codigoCIE10 || body.CODIGO_CIE10_PRINCIPAL || null;
    const diagnosticoSecundario = body.diagnosticoSecundario || body.DIAGNOSTICO_SECUNDARIO || null;
    const codigoCIE10Secundario = body.codigoCIE10Secundario || body.CODIGO_CIE10_SECUNDARIO || null;
    const tratamiento = body.tratamiento || body.TRATAMIENTO || null;
    const recomendaciones = body.recomendaciones || body.RECOMENDACIONES || null;
    const observaciones = body.observaciones || body.OBSERVACIONES || body.examenesComplementarios || null;
    const tipoConsulta = body.tipoConsulta || body.TIPO_CONSULTA || 'GENERAL';
    const proximaCita = body.proximaCita || body.PROXIMA_CITA_RECOMENDADA || null;

    // --- Verificar si ya existe consulta para esta cita ---
    const [consultaExistente] = await connection.query(
      "SELECT ID_CONSULTA FROM TBL_CONSULTA_MEDICA WHERE ID_CITA = ?",
      [idCita]
    );
    let idConsulta = null;

    if (consultaExistente.length > 0) {
      // ✅ ACTUALIZAR consulta existente
      idConsulta = consultaExistente[0].ID_CONSULTA;
      await connection.query(
        `
        UPDATE TBL_CONSULTA_MEDICA SET
          MOTIVO_CONSULTA = ?, SINTOMAS = ?, EXAMEN_FISICO = ?,
          DIAGNOSTICO_PRINCIPAL = ?, CODIGO_CIE10_PRINCIPAL = ?,
          DIAGNOSTICO_SECUNDARIO = ?, CODIGO_CIE10_SECUNDARIO = ?,
          TRATAMIENTO = ?, RECOMENDACIONES = ?, OBSERVACIONES = ?,
          PROXIMA_CITA_RECOMENDADA = ?, TIPO_CONSULTA = ?,
          USUARIO_MODIFICACION = ?
        WHERE ID_CONSULTA = ?
        `,
        [
          motivoConsulta,
          sintomas && sintomas.length > 0 ? JSON.stringify(sintomas) : null,
          examenFisico && examenFisico.length > 0 ? JSON.stringify(examenFisico) : null,
          diagnosticoPrincipal,
          codigoCIE10Principal,
          diagnosticoSecundario,
          codigoCIE10Secundario,
          tratamiento,
          recomendaciones,
          observaciones,
          proximaCita,
          tipoConsulta,
          usuarioCreacion,
          idConsulta
        ]
      );
      console.log(`✅ Consulta #${idConsulta} actualizada para cita #${idCita}`);
    } else {
      // ✅ CREAR nueva consulta
      const [result] = await connection.query(
        `
        INSERT INTO TBL_CONSULTA_MEDICA (
          ID_CITA, ID_PACIENTE, ID_DOCTOR, MOTIVO_CONSULTA, SINTOMAS, EXAMEN_FISICO,
          DIAGNOSTICO_PRINCIPAL, CODIGO_CIE10_PRINCIPAL, DIAGNOSTICO_SECUNDARIO,
          CODIGO_CIE10_SECUNDARIO, TRATAMIENTO, RECOMENDACIONES, OBSERVACIONES,
          FECHA_CONSULTA, PROXIMA_CITA_RECOMENDADA, TIPO_CONSULTA, USUARIO_CREACION
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
        `,
        [
          idCita, idPaciente, idDoctor, motivoConsulta,
          sintomas && sintomas.length > 0 ? JSON.stringify(sintomas) : null,
          examenFisico && examenFisico.length > 0 ? JSON.stringify(examenFisico) : null,
          diagnosticoPrincipal, codigoCIE10Principal, diagnosticoSecundario, codigoCIE10Secundario,
          tratamiento, recomendaciones, observaciones,
          proximaCita, tipoConsulta, usuarioCreacion
        ]
      );
      idConsulta = result.insertId;
      console.log(`✅ Nueva consulta #${idConsulta} creada para cita #${idCita}`);
    }

    // --- Actualizar estado de la cita si estaba en PRECLINICA ---
    if (estadoCita === "PRECLINICA") {
      await connection.query(
        `
        UPDATE TBL_CITAS 
        SET ESTADO = 'CONSULTA_MEDICA', 
            USUARIO_MODIFICACION = ?,
            FECHA_MODIFICACION = NOW()
        WHERE ID_CITA = ?
        `,
        [usuarioCreacion, idCita]
      );
      console.log(`🔄 Cita #${idCita} actualizada de PRECLINICA a CONSULTA_MEDICA`);
    } else {
      // Solo actualizar FECHA_MODIFICACION
      await connection.query(
        `
        UPDATE TBL_CITAS 
        SET USUARIO_MODIFICACION = ?,
            FECHA_MODIFICACION = NOW()
        WHERE ID_CITA = ?
        `,
        [usuarioCreacion, idCita]
      );
    }

    // ============================================================
    // GUARDAR MEDICAMENTOS (borrar y recrear)
    // ============================================================
    await connection.query(
      "DELETE FROM TBL_PRESCRIPCION WHERE ID_CONSULTA = ?",
      [idConsulta]
    );

    if (body.medicamentos && Array.isArray(body.medicamentos) && body.medicamentos.length > 0) {
      console.log(`💊 Insertando ${body.medicamentos.length} medicamentos...`);
      for (const med of body.medicamentos) {
        const idMed = await getOrCreateMedicamento(med.nombre, usuarioCreacion);
        if (idMed) {
          await connection.query(
            `
            INSERT INTO TBL_PRESCRIPCION (
              ID_CONSULTA, ID_MEDICAMENTO, DOSIS, FRECUENCIA, DURACION,
              INSTRUCCIONES_ADICIONALES, ESTADO, USUARIO_CREACION
            ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVA', ?)
            `,
            [
              idConsulta,
              idMed,
              med.dosis || null,
              med.frecuencia || null,
              med.duracion || null,
              med.instrucciones || null,
              usuarioCreacion
            ]
          );
        }
      }
    } else {
      console.log(`⏭️ No se recibieron medicamentos para guardar.`);
    }

    // ============================================================
    // GUARDAR HISTORIAL (solo si se envían campos)
    // ============================================================
    const {
      ALERGIAS,
      ENFERMEDADES_CRONICAS,
      CIRUGIAS_PREVIAS,
      MEDICAMENTOS_ACTUALES,
      ANTECEDENTES_FAMILIARES,
      HABITOS,
      VACUNAS,
      NOTAS_IMPORTANTES
    } = body;

    const toArray = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        if (value.startsWith('[')) {
          try { return JSON.parse(value); } catch { return []; }
        }
        return value.split(',').map(item => item.trim()).filter(item => item !== '');
      }
      return [];
    };

    const hayDatosHistorial = 
      (ALERGIAS && toArray(ALERGIAS).length > 0) ||
      (ENFERMEDADES_CRONICAS && toArray(ENFERMEDADES_CRONICAS).length > 0) ||
      (CIRUGIAS_PREVIAS && toArray(CIRUGIAS_PREVIAS).length > 0) ||
      (MEDICAMENTOS_ACTUALES && toArray(MEDICAMENTOS_ACTUALES).length > 0) ||
      (ANTECEDENTES_FAMILIARES && toArray(ANTECEDENTES_FAMILIARES).length > 0) ||
      (HABITOS && toArray(HABITOS).length > 0) ||
      (VACUNAS && toArray(VACUNAS).length > 0) ||
      (NOTAS_IMPORTANTES && NOTAS_IMPORTANTES.trim() !== '');

    if (hayDatosHistorial) {
      const historialUpdates = {};
      if (ALERGIAS !== undefined) historialUpdates.ALERGIAS = JSON.stringify(toArray(ALERGIAS));
      if (ENFERMEDADES_CRONICAS !== undefined) historialUpdates.ENFERMEDADES_CRONICAS = JSON.stringify(toArray(ENFERMEDADES_CRONICAS));
      if (CIRUGIAS_PREVIAS !== undefined) historialUpdates.CIRUGIAS_PREVIAS = JSON.stringify(toArray(CIRUGIAS_PREVIAS));
      if (MEDICAMENTOS_ACTUALES !== undefined) historialUpdates.MEDICAMENTOS_ACTUALES = JSON.stringify(toArray(MEDICAMENTOS_ACTUALES));
      if (ANTECEDENTES_FAMILIARES !== undefined) historialUpdates.ANTECEDENTES_FAMILIARES = JSON.stringify(toArray(ANTECEDENTES_FAMILIARES));
      if (HABITOS !== undefined) historialUpdates.HABITOS = JSON.stringify(toArray(HABITOS));
      if (VACUNAS !== undefined) historialUpdates.VACUNAS = JSON.stringify(toArray(VACUNAS));
      if (NOTAS_IMPORTANTES !== undefined) historialUpdates.NOTAS_IMPORTANTES = NOTAS_IMPORTANTES;

      const [existeHistorial] = await connection.query(
        "SELECT ID_HISTORIAL FROM TBL_HISTORIAL_MEDICO WHERE ID_PACIENTE = ?",
        [idPaciente]
      );

      if (existeHistorial.length > 0) {
        const setClauses = [];
        const values = [];
        for (const [key, value] of Object.entries(historialUpdates)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        setClauses.push(`FECHA_ACTUALIZACION = CURRENT_TIMESTAMP`);
        setClauses.push(`USUARIO_MODIFICACION = ?`);
        values.push(usuarioCreacion);
        values.push(idPaciente);
        await connection.query(
          `UPDATE TBL_HISTORIAL_MEDICO SET ${setClauses.join(', ')} WHERE ID_PACIENTE = ?`,
          values
        );
      } else {
        const columnas = ['ID_PACIENTE', ...Object.keys(historialUpdates)];
        const placeholders = columnas.map(() => '?').join(', ');
        const valores = [idPaciente, ...Object.values(historialUpdates)];
        await connection.query(
          `INSERT INTO TBL_HISTORIAL_MEDICO (${columnas.join(', ')}, USUARIO_CREACION, FECHA_ACTUALIZACION)
            VALUES (${placeholders}, ?, CURRENT_TIMESTAMP)`,
          [...valores, usuarioCreacion]
        );
      }
    }

    // ============================================================
    // BITÁCORA
    // ============================================================
    const [pacienteInfo] = await connection.query(
      "SELECT CONCAT(NOMBRES, ' ', APELLIDOS) AS NOMBRE FROM TBL_PACIENTE WHERE ID_PACIENTE = ?",
      [idPaciente]
    );
    const nombrePaciente = pacienteInfo.length > 0 ? pacienteInfo[0].NOMBRE : `ID ${idPaciente}`;

    await registrarBitacora({
      usuario: usuarioCreacion,
      accion: consultaExistente.length > 0 ? "ACTUALIZACION_CONSULTA_MEDICA" : "CREACION_CONSULTA_MEDICA",
      descripcion: `${consultaExistente.length > 0 ? 'Actualizada' : 'Creada'} consulta ID #${idConsulta} para cita #${idCita} (Paciente: ${nombrePaciente})`,
      modulo: "CONSULTA_MEDICA",
      idRegistro: idConsulta,
      tabla: "TBL_CONSULTA_MEDICA",
      estado: "EXITO",
      req: req
    });

    await connection.commit();

    res.json({
      success: true,
      message: consultaExistente.length > 0 ? "Consulta actualizada exitosamente" : "Consulta creada exitosamente",
      idConsulta: idConsulta,
      idCita: idCita,
      idPaciente: idPaciente,
      estadoActualizado: estadoCita === "PRECLINICA" ? 'CONSULTA_MEDICA' : estadoCita,
      actualizada: consultaExistente.length > 0
    });

  } catch (err) {
    await connection.rollback();
    console.error("❌ Error en POST /consultaMedica/nueva:", err);
    try {
      await registrarBitacora({
        usuario: req.user?.USUARIO || 'SISTEMA',
        accion: "ERROR_CREACION_CONSULTA",
        descripcion: `Error al guardar consulta: ${err.message}`,
        modulo: "CONSULTA_MEDICA",
        tabla: "TBL_CONSULTA_MEDICA",
        estado: "ERROR",
        detalleError: err.message,
        req: req
      });
    } catch (bitError) { /* ignorar */ }
    res.status(500).json({
      success: false,
      error: "Error al guardar la consulta médica: " + err.message
    });
  } finally {
    connection.release();
  }
});

// ============================================================
// POST /actualizar - Actualizar consulta médica (CON FECHA_MODIFICACION Y MEDICAMENTOS)
// ============================================================
router.post("/actualizar", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const body = req.body;
    const idConsulta = body.idConsulta;

    console.log(" Body recibido en /actualizar:", JSON.stringify(body, null, 2));

    if (!idConsulta) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: "ID de consulta requerido" });
    }

    const [consultaExists] = await connection.query(
      "SELECT ID_CONSULTA, ID_CITA FROM TBL_CONSULTA_MEDICA WHERE ID_CONSULTA = ?",
      [idConsulta]
    );

    if (consultaExists.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "La consulta médica no existe" });
    }

    const idCita = consultaExists[0].ID_CITA;

    const [citaData] = await connection.query(
      "SELECT ESTADO FROM TBL_CITAS WHERE ID_CITA = ?",
      [idCita]
    );

    if (citaData.length > 0) {
      const estadoCita = String(citaData[0].ESTADO || "").toUpperCase();
      if (estadoCita === "CANCELADA" || estadoCita === "NO_ASISTIO") {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: `No se puede actualizar la consulta porque la cita está en estado "${estadoCita}".`
        });
      }
    }

    const usuarioModificacion = req.user?.NOMBRE_USUARIO || req.user?.USUARIO || 'SISTEMA';

    // ✅ 1. ACTUALIZAR CONSULTA
    await connection.query(`
      UPDATE TBL_CONSULTA_MEDICA SET
        MOTIVO_CONSULTA = ?, SINTOMAS = ?, EXAMEN_FISICO = ?,
        DIAGNOSTICO_PRINCIPAL = ?, CODIGO_CIE10_PRINCIPAL = ?,
        DIAGNOSTICO_SECUNDARIO = ?, CODIGO_CIE10_SECUNDARIO = ?,
        TRATAMIENTO = ?, RECOMENDACIONES = ?, OBSERVACIONES = ?,
        TIPO_CONSULTA = ?, USUARIO_MODIFICACION = ?
      WHERE ID_CONSULTA = ?
    `, [
      body.motivoConsulta || null,
      body.sintomas && body.sintomas.length > 0 ? JSON.stringify(body.sintomas) : null,
      body.examenFisico && body.examenFisico.length > 0 ? JSON.stringify(body.examenFisico) : null,
      body.diagnosticoPrincipal || null,
      body.codigoCIE10Principal || null,
      body.diagnosticoSecundario || null,
      body.codigoCIE10Secundario || null,
      body.tratamiento || null,
      body.recomendaciones || null,
      body.observaciones || body.examenesComplementarios || null,
      body.tipoConsulta || 'GENERAL',
      usuarioModificacion,
      idConsulta
    ]);

    // ✅ 2. MEDICAMENTOS: BORRAR Y RECREAR
    await connection.query("DELETE FROM TBL_PRESCRIPCION WHERE ID_CONSULTA = ?", [idConsulta]);

    if (body.medicamentos && Array.isArray(body.medicamentos) && body.medicamentos.length > 0) {
      for (const med of body.medicamentos) {
        const idMed = await getOrCreateMedicamento(med.nombre, usuarioModificacion);
        if (idMed) {
          await connection.query(`
            INSERT INTO TBL_PRESCRIPCION (
              ID_CONSULTA, ID_MEDICAMENTO, DOSIS, FRECUENCIA, DURACION,
              INSTRUCCIONES_ADICIONALES, ESTADO, USUARIO_CREACION
            ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVA', ?)
          `, [
            idConsulta,
            idMed,
            med.dosis || null,
            med.frecuencia || null,
            med.duracion || null,
            med.instrucciones || null,
            usuarioModificacion
          ]);
        }
      }
    }

    // ✅ 3. ACTUALIZAR CITA (FECHA_MODIFICACION)
    await connection.query(`
      UPDATE TBL_CITAS 
      SET USUARIO_MODIFICACION = ?, FECHA_MODIFICACION = NOW()
      WHERE ID_CITA = ?
    `, [usuarioModificacion, idCita]);

    await connection.commit();

    await registrarBitacora({
      usuario: usuarioModificacion,
      accion: "ACTUALIZACION_CONSULTA_MEDICA",
      descripcion: `El usuario ${usuarioModificacion} actualizó la consulta médica ID #${idConsulta} (incluye medicamentos)`,
      modulo: "CONSULTA_MEDICA",
      idRegistro: idConsulta,
      tabla: "TBL_CONSULTA_MEDICA",
      estado: "EXITO",
      req: req
    });

    res.json({ success: true, message: "Consulta actualizada correctamente" });

  } catch (err) {
    await connection.rollback();
    console.error(" Error en POST /consultaMedica/actualizar:", err);
    res.status(500).json({ success: false, error: "Error al actualizar la consulta: " + err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;