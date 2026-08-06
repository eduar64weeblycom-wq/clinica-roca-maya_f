// ============================================================
// PACIENTES ROUTES - Versión PostgreSQL
// ============================================================
const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // Conexión PostgreSQL (pg)
const { registrarBitacora } = require('../services/bitacora.service');

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function parseJsonField(value) {
    if (!value) return null;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        // Si es un string con comas, lo convertimos en array
        if (value.includes(',')) {
            return value.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Si parece un JSON array, lo parseamos
        if (value.startsWith('[')) {
            try { return JSON.parse(value); } catch { return null; }
        }
        return [value.trim()];
    }
    return null;
}

function toJsonbArray(value) {
    const arr = parseJsonField(value);
    return arr && arr.length > 0 ? JSON.stringify(arr) : null;
}

function fromJsonbArray(jsonb) {
    if (!jsonb) return [];
    if (Array.isArray(jsonb)) return jsonb;
    if (typeof jsonb === 'string') {
        try { return JSON.parse(jsonb); } catch { return []; }
    }
    return [];
}

// ------------------------------------------------------------
// GET /pacientes -> Vista (render)
// ------------------------------------------------------------
router.get("/", async (req, res) => {
    try {
        const { rows } = await pool.query(`
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

        res.render("pacientes", {
            title: "Gestión de Pacientes",
            pacientes: rows,
            usuario: req.user || { nombre: "Usuario" },
        });
    } catch (error) {
        console.error("Error GET /pacientes:", error);
        res.status(500).render("error", {
            message: "Error al cargar los pacientes",
            error: process.env.NODE_ENV === "development" ? error : {},
        });
    }
});

// ------------------------------------------------------------
// GET /pacientes/api/:id - detalle con historial
// ------------------------------------------------------------
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
        const camposJSON = ['alergias', 'enfermedades_cronicas', 'cirugias_previas', 'medicamentos_actuales', 'vacunas', 'antecedentes_familiares', 'habitos'];
        camposJSON.forEach(campo => {
            paciente[campo] = fromJsonbArray(paciente[campo]);
        });

        res.json({ success: true, data: paciente });
    } catch (error) {
        console.error("Error GET /api/:id:", error);
        res.status(500).json({ success: false, message: "Error al obtener paciente" });
    }
});

// ------------------------------------------------------------
// POST /pacientes/api -> Crear paciente
// ------------------------------------------------------------
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

        // Verificar duplicado de documento
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

        // Insertar historial si hay datos
        const alergiasJson = toJsonbArray(ALERGIAS);
        const enfermedadesJson = toJsonbArray(ENFERMEDADES_CRONICAS);
        const cirugiasJson = toJsonbArray(CIRUGIAS_PREVIAS);
        const medicamentosJson = toJsonbArray(MEDICAMENTOS_ACTUALES);
        const vacunasJson = toJsonbArray(VACUNAS);
        const antecedentesJson = toJsonbArray(ANTECEDENTES_FAMILIARES);
        const habitosJson = toJsonbArray(HABITOS);

        if (alergiasJson || enfermedadesJson || cirugiasJson || medicamentosJson ||
            vacunasJson || antecedentesJson || habitosJson) {
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
                alergiasJson,
                enfermedadesJson,
                cirugiasJson,
                medicamentosJson,
                vacunasJson,
                antecedentesJson,
                habitosJson,
                req.user?.nombre || "ADMIN",
            ]);
        }

        await client.query('COMMIT');

        // Registrar en bitácora
        await registrarBitacora({
            usuario: req.user?.nombre || "ADMIN",
            accion: "CREACION_PACIENTE",
            descripcion: `Paciente creado: ${NOMBRES} ${APELLIDOS} (${NUMERO_DOCUMENTO_IDENTIDAD})`,
            modulo: "PACIENTES",
            idRegistro: pacienteId,
            tabla: "TBL_PACIENTE",
            estado: "EXITO",
            req
        });

        res.json({
            success: true,
            message: "Paciente creado correctamente",
            data: { ID_PACIENTE: pacienteId },
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error POST /api:", error);
        if (error.code === '23505') { // Violación de unique (numero_documento_identidad)
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

// ------------------------------------------------------------
// PUT /pacientes/api/:id -> Actualizar paciente
// ------------------------------------------------------------
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

        // Verificar duplicado de documento (excluyendo el mismo paciente)
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

        // Actualizar historial
        const alergiasJson = toJsonbArray(ALERGIAS);
        const enfermedadesJson = toJsonbArray(ENFERMEDADES_CRONICAS);
        const cirugiasJson = toJsonbArray(CIRUGIAS_PREVIAS);
        const medicamentosJson = toJsonbArray(MEDICAMENTOS_ACTUALES);
        const vacunasJson = toJsonbArray(VACUNAS);
        const antecedentesJson = toJsonbArray(ANTECEDENTES_FAMILIARES);
        const habitosJson = toJsonbArray(HABITOS);

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
                alergiasJson,
                enfermedadesJson,
                cirugiasJson,
                medicamentosJson,
                vacunasJson,
                antecedentesJson,
                habitosJson,
                req.user?.nombre || "ADMIN",
                id,
            ]);
        } else {
            if (alergiasJson || enfermedadesJson || cirugiasJson || medicamentosJson ||
                vacunasJson || antecedentesJson || habitosJson) {
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
                    alergiasJson,
                    enfermedadesJson,
                    cirugiasJson,
                    medicamentosJson,
                    vacunasJson,
                    antecedentesJson,
                    habitosJson,
                    req.user?.nombre || "ADMIN",
                ]);
            }
        }

        await client.query('COMMIT');

        await registrarBitacora({
            usuario: req.user?.nombre || "ADMIN",
            accion: "ACTUALIZACION_PACIENTE",
            descripcion: `Paciente actualizado: ${NOMBRES} ${APELLIDOS} (ID ${id})`,
            modulo: "PACIENTES",
            idRegistro: id,
            tabla: "TBL_PACIENTE",
            estado: "EXITO",
            req
        });

        res.json({ success: true, message: "Paciente actualizado correctamente" });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error PUT /api/:id:", error);
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

// ------------------------------------------------------------
// DELETE /pacientes/api/:id -> Inactivar (soft delete)
// ------------------------------------------------------------
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

        await registrarBitacora({
            usuario: req.user?.nombre || "ADMIN",
            accion: "ELIMINACION_PACIENTE",
            descripcion: `Paciente inactivado (ID ${id})`,
            modulo: "PACIENTES",
            idRegistro: id,
            tabla: "TBL_PACIENTE",
            estado: "EXITO",
            req
        });

        res.json({ success: true, message: "Paciente eliminado correctamente" });
    } catch (error) {
        console.error("Error DELETE /api/:id:", error);
        res.status(500).json({ success: false, message: "Error al eliminar paciente" });
    }
});

// ------------------------------------------------------------
// GET /pacientes/api/excel -> Descargar Excel
// ------------------------------------------------------------
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

        const xl = require('excel4node');
        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Pacientes');

        const headerStyle = wb.createStyle({
            font: {
                bold: true,
                color: '#FFFFFF',
                size: 12,
            },
            fill: {
                type: 'pattern',
                patternType: 'solid',
                bgColor: '#217346',
                fgColor: '#217346',
            },
            alignment: {
                horizontal: 'center',
                vertical: 'center',
            },
        });

        const cellStyle = wb.createStyle({
            alignment: {
                horizontal: 'left',
                vertical: 'center',
            },
            border: {
                left: { style: 'thin', color: '#000000' },
                right: { style: 'thin', color: '#000000' },
                top: { style: 'thin', color: '#000000' },
                bottom: { style: 'thin', color: '#000000' },
            },
        });

        const headers = ['Nombres', 'Apellidos', 'Tipo Documento', 'Número Documento', 'Género', 'Teléfono', 'Correo Electrónico', 'Estado'];
        headers.forEach((header, index) => {
            ws.cell(1, index + 1)
                .string(header)
                .style(headerStyle);
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