const express = require("express");
const router = express.Router();
const pool = require("../database/db"); // PostgreSQL pool (pg)
const xl = require('excel4node');
const { registrarBitacora } = require("../services/bitacora.service");

const logError = (error, context) => {
  console.error(`Error en ${context}:`, error);
};

// ============================================================
// GET /pacientes -> Vista
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { rows: pacientes } = await pool.query(`
      SELECT 
        id_paciente,
        nombres,
        apellidos,
        fecha_nacimiento,
        genero,
        direccion,
        telefono,
        correo_electronico,
        tipo_documento_identidad,
        numero_documento_identidad,
        rtn_paciente,
        estado_civil,
        ocupacion,
        nombre_contacto_emergencia,
        telefono_contacto_emergencia,
        parentesco_contacto_emergencia,
        estado,
        fecha_registro,
        fecha_actualizacion,
        usuario_creacion,
        usuario_modificacion
      FROM tbl_paciente
      WHERE estado = 'ACTIVO'
      ORDER BY fecha_registro DESC
    `);

    // Convertir nombres de columnas a mayúsculas para la vista (si se usa)
    // La vista renderiza directamente con los nombres originales, pero mejor mantener consistencia
    // No es necesario mapear porque la vista usa los nombres tal cual vienen de la DB
    res.render("pacientes", {
      title: "Gestión de Pacientes",
      pacientes: pacientes, // La vista espera estos campos en minúscula o mayúscula? Depende de la vista.
      usuario: req.user || { nombre: "Usuario" },
    });
  } catch (error) {
    logError(error, "GET /");
    res.status(500).render("error", {
      message: "Error al cargar los pacientes",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
});

// ============================================================
// GET /pacientes/api/:id -> detalle con historial
// ============================================================
router.get("/api/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT 
        p.id_paciente,
        p.nombres,
        p.apellidos,
        p.fecha_nacimiento,
        p.genero,
        p.direccion,
        p.telefono,
        p.correo_electronico,
        p.tipo_documento_identidad,
        p.numero_documento_identidad,
        p.rtn_paciente,
        p.estado_civil,
        p.ocupacion,
        p.nombre_contacto_emergencia,
        p.telefono_contacto_emergencia,
        p.parentesco_contacto_emergencia,
        p.estado,
        p.fecha_registro,
        p.fecha_actualizacion,
        p.usuario_creacion,
        p.usuario_modificacion,
        h.alergias,
        h.enfermedades_cronicas,
        h.cirugias_previas,
        h.medicamentos_actuales,
        h.vacunas,
        h.antecedentes_familiares,
        h.habitos
      FROM tbl_paciente p
      LEFT JOIN tbl_historial_medico h ON p.id_paciente = h.id_paciente
      WHERE p.id_paciente = $1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Paciente no encontrado" });
    }

    const paciente = rows[0];
    // Convertir campos JSONB a arrays (para el frontend)
    const camposJSON = ['alergias', 'enfermedades_cronicas', 'cirugias_previas', 'medicamentos_actuales', 'vacunas', 'antecedentes_familiares', 'habitos'];
    camposJSON.forEach(campo => {
      if (paciente[campo]) {
        try {
          const parsed = JSON.parse(paciente[campo]);
          paciente[campo] = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          paciente[campo] = paciente[campo] ? [paciente[campo]] : [];
        }
      } else {
        paciente[campo] = [];
      }
    });

    // Renombrar campos a mayúsculas para el frontend (pacientes.js espera ID_PACIENTE, NOMBRES, etc.)
    const responseData = {
      ID_PACIENTE: paciente.id_paciente,
      NOMBRES: paciente.nombres,
      APELLIDOS: paciente.apellidos,
      FECHA_NACIMIENTO: paciente.fecha_nacimiento,
      GENERO: paciente.genero,
      DIRECCION: paciente.direccion,
      TELEFONO: paciente.telefono,
      CORREO_ELECTRONICO: paciente.correo_electronico,
      TIPO_DOCUMENTO_IDENTIDAD: paciente.tipo_documento_identidad,
      NUMERO_DOCUMENTO_IDENTIDAD: paciente.numero_documento_identidad,
      RTN_PACIENTE: paciente.rtn_paciente,
      ESTADO_CIVIL: paciente.estado_civil,
      OCUPACION: paciente.ocupacion,
      NOMBRE_CONTACTO_EMERGENCIA: paciente.nombre_contacto_emergencia,
      TELEFONO_CONTACTO_EMERGENCIA: paciente.telefono_contacto_emergencia,
      PARENTESCO_CONTACTO_EMERGENCIA: paciente.parentesco_contacto_emergencia,
      ESTADO: paciente.estado,
      FECHA_REGISTRO: paciente.fecha_registro,
      FECHA_ACTUALIZACION: paciente.fecha_actualizacion,
      USUARIO_CREACION: paciente.usuario_creacion,
      USUARIO_MODIFICACION: paciente.usuario_modificacion,
      ALERGIAS: paciente.alergias,
      ENFERMEDADES_CRONICAS: paciente.enfermedades_cronicas,
      CIRUGIAS_PREVIAS: paciente.cirugias_previas,
      MEDICAMENTOS_ACTUALES: paciente.medicamentos_actuales,
      VACUNAS: paciente.vacunas,
      ANTECEDENTES_FAMILIARES: paciente.antecedentes_familiares,
      HABITOS: paciente.habitos,
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    logError(error, "GET /api/:id");
    res.status(500).json({ success: false, message: "Error al obtener paciente" });
  }
});

// ============================================================
// POST /pacientes/api -> Crear paciente
// ============================================================
router.post("/api", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      NOMBRES,
      APELLIDOS,
      FECHA_NACIMIENTO,
      GENERO,
      DIRECCION,
      TELEFONO,
      CORREO_ELECTRONICO,
      TIPO_DOCUMENTO_IDENTIDAD,
      NUMERO_DOCUMENTO_IDENTIDAD,
      RTN_PACIENTE,
      ESTADO_CIVIL,
      OCUPACION,
      NOMBRE_CONTACTO_EMERGENCIA,
      TELEFONO_CONTACTO_EMERGENCIA,
      PARENTESCO_CONTACTO_EMERGENCIA,
      ESTADO = "ACTIVO",
      ALERGIAS,
      ENFERMEDADES_CRONICAS,
      CIRUGIAS_PREVIAS,
      MEDICAMENTOS_ACTUALES,
      VACUNAS,
      ANTECEDENTES_FAMILIARES,
      HABITOS
    } = req.body;

    if (!NOMBRES || !APELLIDOS || !NUMERO_DOCUMENTO_IDENTIDAD) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Nombres, apellidos y documento son obligatorios",
      });
    }

    // Verificar duplicado
    const { rows: existe } = await client.query(
      `SELECT id_paciente FROM tbl_paciente WHERE numero_documento_identidad = $1 AND estado = 'ACTIVO'`,
      [NUMERO_DOCUMENTO_IDENTIDAD]
    );
    if (existe.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_DOCUMENT",
        message: "Ya existe un paciente activo con este número de documento",
        existingId: existe[0].id_paciente,
      });
    }

    // Insertar paciente
    const { rows: result } = await client.query(`
      INSERT INTO tbl_paciente (
        nombres, apellidos, fecha_nacimiento, genero,
        direccion, telefono, correo_electronico,
        tipo_documento_identidad, numero_documento_identidad,
        rtn_paciente, estado_civil, ocupacion,
        nombre_contacto_emergencia, telefono_contacto_emergencia,
        parentesco_contacto_emergencia, estado, usuario_creacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id_paciente
    `, [
      NOMBRES,
      APELLIDOS,
      FECHA_NACIMIENTO || null,
      GENERO || "OTRO",
      DIRECCION || null,
      TELEFONO || null,
      CORREO_ELECTRONICO || null,
      TIPO_DOCUMENTO_IDENTIDAD || "DNI",
      NUMERO_DOCUMENTO_IDENTIDAD,
      RTN_PACIENTE || null,
      ESTADO_CIVIL || null,
      OCUPACION || null,
      NOMBRE_CONTACTO_EMERGENCIA || null,
      TELEFONO_CONTACTO_EMERGENCIA || null,
      PARENTESCO_CONTACTO_EMERGENCIA || null,
      ESTADO,
      req.user?.nombre || "ADMIN",
    ]);

    const pacienteId = result[0].id_paciente;

    // Función para parsear string separado por comas a array
    const parseArray = (str) => {
      if (!str || typeof str !== 'string') return [];
      return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
    };

    const alergiasArray = parseArray(ALERGIAS);
    const enfermedadesArray = parseArray(ENFERMEDADES_CRONICAS);
    const cirugiasArray = parseArray(CIRUGIAS_PREVIAS);
    const medicamentosArray = parseArray(MEDICAMENTOS_ACTUALES);
    const vacunasArray = parseArray(VACUNAS);
    const antecedentesArray = parseArray(ANTECEDENTES_FAMILIARES);
    const habitosArray = parseArray(HABITOS);

    if (alergiasArray.length > 0 || enfermedadesArray.length > 0 || cirugiasArray.length > 0 ||
        medicamentosArray.length > 0 || vacunasArray.length > 0 || antecedentesArray.length > 0 || habitosArray.length > 0) {
      await client.query(`
        INSERT INTO tbl_historial_medico (
          id_paciente,
          alergias,
          enfermedades_cronicas,
          cirugias_previas,
          medicamentos_actuales,
          vacunas,
          antecedentes_familiares,
          habitos,
          usuario_creacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        pacienteId,
        JSON.stringify(alergiasArray),
        JSON.stringify(enfermedadesArray),
        JSON.stringify(cirugiasArray),
        JSON.stringify(medicamentosArray),
        JSON.stringify(vacunasArray),
        JSON.stringify(antecedentesArray),
        JSON.stringify(habitosArray),
        req.user?.nombre || "ADMIN",
      ]);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: "Paciente creado correctamente",
      data: { ID_PACIENTE: pacienteId },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logError(error, "POST /api");
    if (error.code === '23505') { // Violación de unique en PostgreSQL
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_DOCUMENT",
        message: "Ya existe un paciente con ese número de documento (error DB)",
        existingId: null,
        detail: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error al crear paciente: " + error.message,
    });
  } finally {
    client.release();
  }
});

// ============================================================
// PUT /pacientes/api/:id -> Actualizar paciente
// ============================================================
router.put("/api/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      NOMBRES,
      APELLIDOS,
      FECHA_NACIMIENTO,
      GENERO,
      DIRECCION,
      TELEFONO,
      CORREO_ELECTRONICO,
      TIPO_DOCUMENTO_IDENTIDAD,
      NUMERO_DOCUMENTO_IDENTIDAD,
      RTN_PACIENTE,
      ESTADO_CIVIL,
      OCUPACION,
      NOMBRE_CONTACTO_EMERGENCIA,
      TELEFONO_CONTACTO_EMERGENCIA,
      PARENTESCO_CONTACTO_EMERGENCIA,
      ESTADO,
      ALERGIAS,
      ENFERMEDADES_CRONICAS,
      CIRUGIAS_PREVIAS,
      MEDICAMENTOS_ACTUALES,
      VACUNAS,
      ANTECEDENTES_FAMILIARES,
      HABITOS
    } = req.body;

    if (!NOMBRES || !APELLIDOS || !NUMERO_DOCUMENTO_IDENTIDAD) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Nombres, apellidos y documento son obligatorios",
      });
    }

    // Verificar duplicado (excluyendo el mismo)
    const { rows: existe } = await client.query(
      `SELECT id_paciente FROM tbl_paciente WHERE numero_documento_identidad = $1 AND id_paciente != $2 AND estado = 'ACTIVO'`,
      [NUMERO_DOCUMENTO_IDENTIDAD, id]
    );
    if (existe.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_DOCUMENT",
        message: "Ya existe otro paciente activo con este número de documento",
        existingId: existe[0].id_paciente,
      });
    }

    // Actualizar paciente
    const { rowCount } = await client.query(`
      UPDATE tbl_paciente SET
        nombres = $1,
        apellidos = $2,
        fecha_nacimiento = $3,
        genero = $4,
        direccion = $5,
        telefono = $6,
        correo_electronico = $7,
        tipo_documento_identidad = $8,
        numero_documento_identidad = $9,
        rtn_paciente = $10,
        estado_civil = $11,
        ocupacion = $12,
        nombre_contacto_emergencia = $13,
        telefono_contacto_emergencia = $14,
        parentesco_contacto_emergencia = $15,
        estado = $16,
        fecha_actualizacion = CURRENT_TIMESTAMP,
        usuario_modificacion = $17
      WHERE id_paciente = $18
    `, [
      NOMBRES,
      APELLIDOS,
      FECHA_NACIMIENTO || null,
      GENERO || "OTRO",
      DIRECCION || null,
      TELEFONO || null,
      CORREO_ELECTRONICO || null,
      TIPO_DOCUMENTO_IDENTIDAD || "DNI",
      NUMERO_DOCUMENTO_IDENTIDAD,
      RTN_PACIENTE || null,
      ESTADO_CIVIL || null,
      OCUPACION || null,
      NOMBRE_CONTACTO_EMERGENCIA || null,
      TELEFONO_CONTACTO_EMERGENCIA || null,
      PARENTESCO_CONTACTO_EMERGENCIA || null,
      ESTADO,
      req.user?.nombre || "ADMIN",
      id,
    ]);

    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Paciente no encontrado" });
    }

    const parseArray = (str) => {
      if (!str || typeof str !== 'string') return [];
      return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
    };

    const alergiasArray = parseArray(ALERGIAS);
    const enfermedadesArray = parseArray(ENFERMEDADES_CRONICAS);
    const cirugiasArray = parseArray(CIRUGIAS_PREVIAS);
    const medicamentosArray = parseArray(MEDICAMENTOS_ACTUALES);
    const vacunasArray = parseArray(VACUNAS);
    const antecedentesArray = parseArray(ANTECEDENTES_FAMILIARES);
    const habitosArray = parseArray(HABITOS);

    const { rows: historialExistente } = await client.query(
      `SELECT id_historial FROM tbl_historial_medico WHERE id_paciente = $1`,
      [id]
    );

    if (historialExistente.length > 0) {
      await client.query(`
        UPDATE tbl_historial_medico SET
          alergias = $1,
          enfermedades_cronicas = $2,
          cirugias_previas = $3,
          medicamentos_actuales = $4,
          vacunas = $5,
          antecedentes_familiares = $6,
          habitos = $7,
          fecha_actualizacion = CURRENT_TIMESTAMP,
          usuario_modificacion = $8
        WHERE id_paciente = $9
      `, [
        JSON.stringify(alergiasArray),
        JSON.stringify(enfermedadesArray),
        JSON.stringify(cirugiasArray),
        JSON.stringify(medicamentosArray),
        JSON.stringify(vacunasArray),
        JSON.stringify(antecedentesArray),
        JSON.stringify(habitosArray),
        req.user?.nombre || "ADMIN",
        id,
      ]);
    } else {
      if (alergiasArray.length > 0 || enfermedadesArray.length > 0 || cirugiasArray.length > 0 ||
          medicamentosArray.length > 0 || vacunasArray.length > 0 || antecedentesArray.length > 0 || habitosArray.length > 0) {
        await client.query(`
          INSERT INTO tbl_historial_medico (
            id_paciente,
            alergias,
            enfermedades_cronicas,
            cirugias_previas,
            medicamentos_actuales,
            vacunas,
            antecedentes_familiares,
            habitos,
            usuario_creacion
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          id,
          JSON.stringify(alergiasArray),
          JSON.stringify(enfermedadesArray),
          JSON.stringify(cirugiasArray),
          JSON.stringify(medicamentosArray),
          JSON.stringify(vacunasArray),
          JSON.stringify(antecedentesArray),
          JSON.stringify(habitosArray),
          req.user?.nombre || "ADMIN",
        ]);
      }
    }

    await client.query('COMMIT');

    res.json({ success: true, message: "Paciente actualizado correctamente" });
  } catch (error) {
    await client.query('ROLLBACK');
    logError(error, "PUT /api/:id");
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_DOCUMENT",
        message: "Ya existe otro paciente con ese número de documento (error DB)",
        existingId: null,
        detail: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error al actualizar paciente: " + error.message,
    });
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE /pacientes/api/:id -> Inactivar (soft delete)
// ============================================================
router.delete("/api/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await pool.query(`
      UPDATE tbl_paciente SET
        estado = 'INACTIVO',
        fecha_actualizacion = CURRENT_TIMESTAMP,
        usuario_modificacion = $1
      WHERE id_paciente = $2
    `, [req.user?.nombre || "ADMIN", id]);

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: "Paciente no encontrado" });
    }

    res.json({ success: true, message: "Paciente eliminado correctamente" });
  } catch (error) {
    logError(error, "DELETE /api/:id");
    res.status(500).json({ success: false, message: "Error al eliminar paciente" });
  }
});

// ============================================================
// GET /pacientes/api/excel -> Descargar Excel
// ============================================================
router.get("/api/excel", async (req, res) => {
  try {
    console.log("📊 Generando Excel con excel4node...");

    const { rows: pacientes } = await pool.query(`
      SELECT 
        nombres,
        apellidos,
        tipo_documento_identidad,
        numero_documento_identidad,
        genero,
        telefono,
        correo_electronico,
        estado
      FROM tbl_paciente
      WHERE estado = 'ACTIVO'
      ORDER BY apellidos, nombres
    `);

    console.log(`📋 Pacientes encontrados: ${pacientes.length}`);

    if (!pacientes || pacientes.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hay pacientes para exportar"
      });
    }

    const wb = new xl.Workbook();
    const ws = wb.addWorksheet('Pacientes');

    const headerStyle = wb.createStyle({
      font: { bold: true, color: '#FFFFFF', size: 12 },
      fill: { type: 'pattern', patternType: 'solid', bgColor: '#217346', fgColor: '#217346' },
      alignment: { horizontal: 'center', vertical: 'center' },
    });

    const cellStyle = wb.createStyle({
      alignment: { horizontal: 'left', vertical: 'center' },
      border: {
        left: { style: 'thin', color: '#000000' },
        right: { style: 'thin', color: '#000000' },
        top: { style: 'thin', color: '#000000' },
        bottom: { style: 'thin', color: '#000000' },
      },
    });

    const headers = ['Nombres', 'Apellidos', 'Tipo Documento', 'Número Documento', 'Género', 'Teléfono', 'Correo Electrónico', 'Estado'];
    headers.forEach((header, index) => {
      ws.cell(1, index + 1).string(header).style(headerStyle);
    });

    pacientes.forEach((paciente, rowIndex) => {
      const row = rowIndex + 2;
      ws.cell(row, 1).string(paciente.nombres || '').style(cellStyle);
      ws.cell(row, 2).string(paciente.apellidos || '').style(cellStyle);
      ws.cell(row, 3).string(paciente.tipo_documento_identidad || '').style(cellStyle);
      ws.cell(row, 4).string(paciente.numero_documento_identidad || '').style(cellStyle);
      ws.cell(row, 5).string(paciente.genero || '').style(cellStyle);
      ws.cell(row, 6).string(paciente.telefono || '').style(cellStyle);
      ws.cell(row, 7).string(paciente.correo_electronico || '').style(cellStyle);
      ws.cell(row, 8).string(paciente.estado || '').style(cellStyle);
    });

    ws.column(1).setWidth(25);
    ws.column(2).setWidth(25);
    ws.column(3).setWidth(20);
    ws.column(4).setWidth(20);
    ws.column(5).setWidth(15);
    ws.column(6).setWidth(20);
    ws.column(7).setWidth(30);
    ws.column(8).setWidth(15);

    const fecha = new Date().toISOString().split('T')[0];
    const fileName = `Pacientes_${fecha}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

    wb.write(fileName, res);

    console.log(`✅ Excel generado correctamente: ${pacientes.length} pacientes`);

    try {
      await registrarBitacora({
        usuario: req.user?.nombre || "SISTEMA",
        accion: "EXPORTAR_EXCEL_PACIENTES",
        descripcion: `Exportados ${pacientes.length} pacientes a Excel`,
        modulo: "PACIENTES",
        tabla: "TBL_PACIENTE",
        estado: "EXITO",
        req
      });
    } catch (bitError) {
      console.error("Error registrando bitácora:", bitError);
    }

  } catch (error) {
    console.error("❌ Error exportando Excel:", error);
    res.status(500).json({
      success: false,
      message: "Error al generar el archivo Excel: " + error.message
    });
  }
});

module.exports = router;