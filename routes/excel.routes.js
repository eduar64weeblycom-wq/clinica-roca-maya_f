// ============================================================
// RUTAS DEDICADAS PARA EXCEL - INDEPENDIENTE (PostgreSQL)
// ============================================================
const express = require("express");
const router = express.Router();
const pool = require("../database/db"); // PostgreSQL pool (pg)
const xl = require('excel4node');
const { registrarBitacora } = require("../services/bitacora.service");

// ============================================================
// RUTA DE PRUEBA - PARA VERIFICAR QUE EXCEL ROUTES FUNCIONA
// ============================================================
router.get("/test", (req, res) => {
    console.log("✅ Ruta /excel/test funcionando");
    res.json({
        success: true,
        message: "✅ Ruta de Excel funcionando correctamente",
        timestamp: new Date().toISOString(),
        rutas_disponibles: [
            "/excel/test",
            "/excel/preclinica",
            "/excel/usuarios",
            "/excel/pacientes",
            "/excel/citas",
            "/excel/especialidades",
            "/excel/bitacora",
            "/excel/historial/:idPaciente",
            "/excel/prueba-excel"
        ]
    });
});

// ============================================================
// GET /excel/preclinica -> Descargar Excel de Preclínica CON FILTROS
// ============================================================
router.get("/preclinica", async (req, res) => {
    try {
        console.log("📊 Generando Excel de Preclínica...");
        console.log(" Query params:", req.query);

        const usuario = req.user || null;
        const { paciente, telefono, identidad, fecha, estado } = req.query;

        // ============================================================
        // CONSULTA SQL (PostgreSQL)
        // ============================================================
        let sql = `
            SELECT 
                p.id_preclinica,
                p.id_cita,
                p.fecha_registro,
                p.temperatura,
                p.presion_sistolica,
                p.presion_diastolica,
                p.frecuencia_cardiaca,
                p.frecuencia_respiratoria,
                p.saturacion_oxigeno,
                p.peso,
                p.talla,
                p.imc,
                p.glucosa,
                p.perimetro_abdominal,
                p.estado_general,
                p.observaciones,
                u.nombre_usuario AS enfermera,
                c.estado AS estado_cita,
                CONCAT(pa.nombres, ' ', pa.apellidos) AS nombre_paciente,
                pa.numero_documento_identidad AS identidad_paciente,
                pa.telefono,
                pa.correo_electronico
            FROM tbl_preclinica p
            INNER JOIN tbl_citas c ON p.id_cita = c.id_cita
            INNER JOIN tbl_paciente pa ON c.id_paciente = pa.id_paciente
            LEFT JOIN tbl_ms_usuario u ON p.id_usuario_enfermeria = u.id_usuario
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        // Aplicar filtros si existen
        if (paciente) {
            sql += ` AND (CONCAT(pa.nombres, ' ', pa.apellidos) ILIKE $${paramIndex} OR pa.nombres ILIKE $${paramIndex} OR pa.apellidos ILIKE $${paramIndex})`;
            const searchTerm = `%${paciente}%`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (telefono) {
            sql += ` AND pa.telefono ILIKE $${paramIndex}`;
            params.push(`%${telefono}%`);
            paramIndex++;
        }

        if (identidad) {
            sql += ` AND pa.numero_documento_identidad ILIKE $${paramIndex}`;
            params.push(`%${identidad}%`);
            paramIndex++;
        }

        if (fecha) {
            sql += ` AND DATE(c.fecha_cita) = $${paramIndex}`;
            params.push(fecha);
            paramIndex++;
        }

        if (estado) {
            sql += ` AND c.estado = $${paramIndex}`;
            params.push(estado.toUpperCase());
            paramIndex++;
        }

        sql += ` ORDER BY p.fecha_registro DESC`;

        console.log(" SQL Query:", sql);
        console.log(" Parámetros:", params);

        const { rows: preclinicas } = await pool.query(sql, params);

        console.log(` Preclínicas encontradas: ${preclinicas.length}`);

        if (!preclinicas || preclinicas.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No hay registros de preclínica con los filtros aplicados"
            });
        }

        // ============================================================
        // GENERAR NOMBRE DEL ARCHIVO CON EL NOMBRE DEL PACIENTE
        // ============================================================
        let nombreBase = 'Preclinica';

        if (preclinicas.length > 0 && preclinicas[0].nombre_paciente) {
            const nombreCompleto = preclinicas[0].nombre_paciente;
            const todosMismoPaciente = preclinicas.every(p => p.nombre_paciente === nombreCompleto);

            if (todosMismoPaciente) {
                const nombreLimpio = nombreCompleto
                    .replace(/[^a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s]/g, '')
                    .trim()
                    .replace(/\s+/g, '_')
                    .substring(0, 50)
                    .toUpperCase();
                nombreBase = nombreLimpio;
                console.log(` Todos los pacientes son: ${nombreCompleto} → ${nombreLimpio}`);
            } else {
                if (paciente && paciente.length > 0) {
                    const nombreFiltro = paciente
                        .replace(/[^a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s]/g, '')
                        .trim()
                        .replace(/\s+/g, '_')
                        .substring(0, 30)
                        .toUpperCase();
                    nombreBase = `Preclinica_${nombreFiltro}_y_otros`;
                } else {
                    nombreBase = 'Preclinica_Varios_Pacientes';
                }
            }
        }

        if (fecha) {
            const fechaFormateada = fecha.replace(/-/g, '');
            nombreBase += `_${fechaFormateada}`;
        }

        const fechaActual = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const fileName = `${nombreBase}_${fechaActual}.xlsx`;

        console.log(` Nombre de archivo generado: ${fileName}`);

        // ============================================================
        // CREAR EXCEL
        // ============================================================
        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Preclínica');

        const headerStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 12 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#1a3c6e', fgColor: '#1a3c6e' },
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

        const cellCenterStyle = wb.createStyle({
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
                left: { style: 'thin', color: '#000000' },
                right: { style: 'thin', color: '#000000' },
                top: { style: 'thin', color: '#000000' },
                bottom: { style: 'thin', color: '#000000' },
            },
        });

        const headers = [
            'ID Preclínica', 'ID Cita', 'Paciente', 'Identidad', 'Teléfono',
            'Fecha Registro', 'Temperatura °C', 'Presión Sist.', 'Presión Diast.',
            'FC (lpm)', 'FR (rpm)', 'Sat O₂ %', 'Peso (kg)', 'Talla (m)',
            'IMC', 'Glucosa (mg/dL)', 'Perímetro Abdominal (cm)',
            'Estado General', 'Estado Cita', 'Enfermera', 'Observaciones'
        ];

        headers.forEach((header, index) => {
            ws.cell(1, index + 1).string(header).style(headerStyle);
        });

        preclinicas.forEach((item, rowIndex) => {
            const row = rowIndex + 2;

            ws.cell(row, 1).number(item.id_preclinica || 0).style(cellCenterStyle);
            ws.cell(row, 2).number(item.id_cita || 0).style(cellCenterStyle);
            ws.cell(row, 3).string(item.nombre_paciente || '').style(cellStyle);
            ws.cell(row, 4).string(item.identidad_paciente || '').style(cellStyle);
            ws.cell(row, 5).string(item.telefono || '').style(cellStyle);
            ws.cell(row, 6).string(item.fecha_registro ? 
                new Date(item.fecha_registro).toLocaleString('es-ES') : '').style(cellStyle);
            ws.cell(row, 7).number(parseFloat(item.temperatura) || 0).style(cellCenterStyle);
            ws.cell(row, 8).number(parseInt(item.presion_sistolica) || 0).style(cellCenterStyle);
            ws.cell(row, 9).number(parseInt(item.presion_diastolica) || 0).style(cellCenterStyle);
            ws.cell(row, 10).number(parseInt(item.frecuencia_cardiaca) || 0).style(cellCenterStyle);
            ws.cell(row, 11).number(parseInt(item.frecuencia_respiratoria) || 0).style(cellCenterStyle);
            ws.cell(row, 12).number(parseFloat(item.saturacion_oxigeno) || 0).style(cellCenterStyle);
            ws.cell(row, 13).number(parseFloat(item.peso) || 0).style(cellCenterStyle);
            ws.cell(row, 14).number(parseFloat(item.talla) || 0).style(cellCenterStyle);
            ws.cell(row, 15).number(parseFloat(item.imc) || 0).style(cellCenterStyle);
            ws.cell(row, 16).number(parseFloat(item.glucosa) || 0).style(cellCenterStyle);
            ws.cell(row, 17).number(parseFloat(item.perimetro_abdominal) || 0).style(cellCenterStyle);
            ws.cell(row, 18).string(item.estado_general || '').style(cellStyle);
            ws.cell(row, 19).string(item.estado_cita || '').style(cellStyle);
            ws.cell(row, 20).string(item.enfermera || '').style(cellStyle);
            ws.cell(row, 21).string((item.observaciones || '').substring(0, 500)).style(cellStyle);
        });

        const columnWidths = [14, 10, 35, 22, 18, 22, 16, 16, 16, 14, 14, 14, 14, 14, 12, 16, 20, 18, 18, 25, 45];
        columnWidths.forEach((width, index) => {
            ws.column(index + 1).setWidth(width);
        });

        const totalRow = preclinicas.length + 2;
        ws.cell(totalRow, 1).string('TOTAL REGISTROS:').style({
            font: { bold: true, size: 11 },
            alignment: { horizontal: 'left', vertical: 'center' }
        });
        ws.cell(totalRow, 2).number(preclinicas.length).style({
            font: { bold: true, size: 11 },
            alignment: { horizontal: 'center', vertical: 'center' }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);

        wb.write(fileName, res);

        console.log(` Excel de Preclínica generado correctamente: ${preclinicas.length} registros`);
        console.log(` Archivo: ${fileName}`);

        try {
            await registrarBitacora({
                usuario: req.user?.USUARIO || "SISTEMA",
                accion: "EXPORTAR_EXCEL_PRECLINICA",
                descripcion: `Exportados ${preclinicas.length} registros de preclínica a Excel. Archivo: ${fileName}`,
                modulo: "PRECLINICA",
                tabla: "TBL_PRECLINICA",
                estado: "EXITO",
                req
            });
        } catch (bitError) {
            console.error("Error registrando bitácora:", bitError);
        }

    } catch (error) {
        console.error(" Error exportando Excel de preclínica:", error);
        res.status(500).json({
            success: false,
            message: "Error al generar el archivo Excel: " + error.message
        });
    }
});

// ============================================================
// GET /excel/usuarios -> Descargar Excel de usuarios
// ============================================================
router.get("/usuarios", async (req, res) => {
    try {
        console.log("📊 Generando Excel de usuarios...");

        const { rows: usuarios } = await pool.query(`
            SELECT 
                u.usuario,
                u.nombre_usuario,
                r.rol,
                u.estado,
                u.correo_electronico,
                CASE WHEN u.activo_2fa = true THEN 'Sí' ELSE 'No' END AS activo_2fa,
                u.fecha_ultima_conexion
            FROM tbl_ms_usuario u
            INNER JOIN tbl_ms_roles r ON u.id_rol = r.id_rol
            ORDER BY u.id_usuario
        `);

        console.log(` Usuarios encontrados: ${usuarios.length}`);

        if (!usuarios || usuarios.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No hay usuarios para exportar"
            });
        }

        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Usuarios');

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

        const headers = ['Usuario', 'Nombre', 'Rol', 'Estado', 'Correo', '2FA Activado', 'Última Conexión'];

        headers.forEach((header, index) => {
            ws.cell(1, index + 1).string(header).style(headerStyle);
        });

        usuarios.forEach((usuario, rowIndex) => {
            const row = rowIndex + 2;
            ws.cell(row, 1).string(usuario.usuario || '').style(cellStyle);
            ws.cell(row, 2).string(usuario.nombre_usuario || '').style(cellStyle);
            ws.cell(row, 3).string(usuario.rol || '').style(cellStyle);
            ws.cell(row, 4).string(usuario.estado || '').style(cellStyle);
            ws.cell(row, 5).string(usuario.correo_electronico || '').style(cellStyle);
            ws.cell(row, 6).string(usuario.activo_2fa || 'No').style(cellStyle);
            ws.cell(row, 7).string(usuario.fecha_ultima_conexion ? new Date(usuario.fecha_ultima_conexion).toLocaleString() : 'Nunca').style(cellStyle);
        });

        ws.column(1).setWidth(20);
        ws.column(2).setWidth(30);
        ws.column(3).setWidth(20);
        ws.column(4).setWidth(15);
        ws.column(5).setWidth(30);
        ws.column(6).setWidth(18);
        ws.column(7).setWidth(25);

        const fechaActual2 = new Date().toISOString().split('T')[0];
        const fileName = `Usuarios_${fechaActual2}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

        wb.write(fileName, res);

        console.log(` Excel de usuarios generado correctamente: ${usuarios.length} usuarios`);

        try {
            await registrarBitacora({
                usuario: req.user?.nombre || "SISTEMA",
                accion: "EXPORTAR_EXCEL_USUARIOS",
                descripcion: `Exportados ${usuarios.length} usuarios a Excel`,
                modulo: "USUARIOS",
                tabla: "TBL_MS_USUARIO",
                estado: "EXITO",
                req
            });
        } catch (bitError) {
            console.error("Error registrando bitácora:", bitError);
        }

    } catch (error) {
        console.error(" Error exportando Excel de usuarios:", error);
        res.status(500).json({
            success: false,
            message: "Error al generar el archivo Excel: " + error.message
        });
    }
});

// ============================================================
// GET /excel/consultas -> Descargar Excel de consultas médicas
// ============================================================
router.get("/consultas", async (req, res) => {
    try {
        console.log("📊 Generando Excel de citas para consulta médica...");
        console.log(" Query params:", req.query);

        const usuario = req.user || null;
        const { paciente, telefono, identidad, fecha, tipo } = req.query;

        // ============================================================
        // CONSULTA SQL (PostgreSQL)
        // ============================================================
        let sql = `
            SELECT 
                c.id_cita,
                c.fecha_cita,
                c.estado,
                c.tipo_cita,
                c.prioridad,
                c.motivo_consulta,
                c.observaciones,
                CONCAT(p.nombres, ' ', p.apellidos) AS nombre_paciente,
                p.telefono,
                p.numero_documento_identidad,
                u.nombre_usuario AS doctor,
                pr.temperatura,
                pr.presion_sistolica,
                pr.presion_diastolica,
                pr.peso,
                pr.talla,
                pr.imc,
                cm.id_consulta,
                cm.diagnostico_principal,
                cm.tratamiento,
                cm.recomendaciones,
                cm.fecha_consulta
            FROM tbl_citas c
            INNER JOIN tbl_paciente p ON c.id_paciente = p.id_paciente
            INNER JOIN tbl_ms_usuario u ON c.id_doctor = u.id_usuario
            LEFT JOIN tbl_preclinica pr ON c.id_cita = pr.id_cita
            LEFT JOIN tbl_consulta_medica cm ON c.id_cita = cm.id_cita
            WHERE c.estado IN ('CONSULTA_MEDICA', 'PRECLINICA')
        `;

        const params = [];
        let paramIndex = 1;

        if (usuario && usuario.ROL === 'DOCTOR') {
            sql += ` AND c.id_doctor = $${paramIndex}`;
            params.push(usuario.ID_USUARIO);
            paramIndex++;
        }

        if (paciente) {
            sql += ` AND (CONCAT(p.nombres, ' ', p.apellidos) ILIKE $${paramIndex} OR p.nombres ILIKE $${paramIndex} OR p.apellidos ILIKE $${paramIndex})`;
            const searchTerm = `%${paciente}%`;
            params.push(searchTerm);
            paramIndex++;
        }

        if (telefono) {
            sql += ` AND p.telefono ILIKE $${paramIndex}`;
            params.push(`%${telefono}%`);
            paramIndex++;
        }

        if (identidad) {
            sql += ` AND p.numero_documento_identidad ILIKE $${paramIndex}`;
            params.push(`%${identidad}%`);
            paramIndex++;
        }

        if (fecha) {
            sql += ` AND DATE(c.fecha_cita) = $${paramIndex}`;
            params.push(fecha);
            paramIndex++;
        }

        if (tipo) {
            sql += ` AND c.tipo_cita = $${paramIndex}`;
            params.push(tipo);
            paramIndex++;
        }

        sql += ` ORDER BY c.fecha_cita DESC`;

        console.log(" SQL Query:", sql);
        console.log(" Parámetros:", params);

        const { rows: citas } = await pool.query(sql, params);

        console.log(` Citas encontradas: ${citas.length}`);

        if (!citas || citas.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No hay citas en consulta médica con los filtros aplicados"
            });
        }

        // ============================================================
        // GENERAR NOMBRE DEL ARCHIVO
        // ============================================================
        let nombreBase = 'Consultas';

        if (citas.length > 0 && citas[0].nombre_paciente) {
            const nombreCompleto = citas[0].nombre_paciente;
            const todosMismoPaciente = citas.every(c => c.nombre_paciente === nombreCompleto);

            if (todosMismoPaciente) {
                const nombreLimpio = nombreCompleto
                    .replace(/[^a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s]/g, '')
                    .trim()
                    .replace(/\s+/g, '_')
                    .substring(0, 50)
                    .toUpperCase();
                nombreBase = nombreLimpio;
                console.log(` Todos los pacientes son: ${nombreCompleto} → ${nombreLimpio}`);
            } else {
                if (paciente && paciente.length > 0) {
                    const nombreFiltro = paciente
                        .replace(/[^a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s]/g, '')
                        .trim()
                        .replace(/\s+/g, '_')
                        .substring(0, 30)
                        .toUpperCase();
                    nombreBase = `Consultas_${nombreFiltro}_y_otros`;
                } else {
                    nombreBase = 'Consultas_Varios_Pacientes';
                }
            }
        }

        const fechaActual = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const fileName = `${nombreBase}_${fechaActual}.xlsx`;

        console.log(` Nombre de archivo generado: ${fileName}`);

        // ============================================================
        // CREAR EXCEL
        // ============================================================
        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Consultas Médicas');

        const headerStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 12 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#1a3c6e', fgColor: '#1a3c6e' },
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

        const cellCenterStyle = wb.createStyle({
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
                left: { style: 'thin', color: '#000000' },
                right: { style: 'thin', color: '#000000' },
                top: { style: 'thin', color: '#000000' },
                bottom: { style: 'thin', color: '#000000' },
            },
        });

        const headers = [
            'ID Cita', 'Paciente', 'Identidad', 'Teléfono',
            'Doctor', 'Fecha Cita', 'Estado', 'Tipo', 'Prioridad',
            'Motivo', 'Temperatura °C', 'Presión Sist.', 'Presión Diast.',
            'Peso (kg)', 'Talla (m)', 'IMC',
            'Diagnóstico', 'Tratamiento', 'Recomendaciones',
            'Fecha Consulta', 'Observaciones'
        ];

        headers.forEach((header, index) => {
            ws.cell(1, index + 1).string(header).style(headerStyle);
        });

        citas.forEach((c, idx) => {
            const row = idx + 2;
            ws.cell(row, 1).number(c.id_cita || 0).style(cellCenterStyle);
            ws.cell(row, 2).string(c.nombre_paciente || '').style(cellStyle);
            ws.cell(row, 3).string(c.numero_documento_identidad || '').style(cellStyle);
            ws.cell(row, 4).string(c.telefono || '').style(cellStyle);
            ws.cell(row, 5).string(c.doctor || '').style(cellStyle);
            ws.cell(row, 6).string(c.fecha_cita ? new Date(c.fecha_cita).toLocaleString('es-ES') : '').style(cellStyle);
            ws.cell(row, 7).string(c.estado || '').style(cellCenterStyle);
            ws.cell(row, 8).string(c.tipo_cita || '').style(cellCenterStyle);
            ws.cell(row, 9).string(c.prioridad || 'NORMAL').style(cellCenterStyle);
            ws.cell(row, 10).string(c.motivo_consulta || '').style(cellStyle);
            ws.cell(row, 11).number(parseFloat(c.temperatura) || 0).style(cellCenterStyle);
            ws.cell(row, 12).number(parseInt(c.presion_sistolica) || 0).style(cellCenterStyle);
            ws.cell(row, 13).number(parseInt(c.presion_diastolica) || 0).style(cellCenterStyle);
            ws.cell(row, 14).number(parseFloat(c.peso) || 0).style(cellCenterStyle);
            ws.cell(row, 15).number(parseFloat(c.talla) || 0).style(cellCenterStyle);
            ws.cell(row, 16).number(parseFloat(c.imc) || 0).style(cellCenterStyle);
            ws.cell(row, 17).string(c.diagnostico_principal || '').style(cellStyle);
            ws.cell(row, 18).string(c.tratamiento || '').style(cellStyle);
            ws.cell(row, 19).string(c.recomendaciones || '').style(cellStyle);
            ws.cell(row, 20).string(c.fecha_consulta ? new Date(c.fecha_consulta).toLocaleString('es-ES') : '').style(cellStyle);
            ws.cell(row, 21).string(c.observaciones || '').style(cellStyle);
        });

        ws.column(1).setWidth(10);
        ws.column(2).setWidth(30);
        ws.column(3).setWidth(20);
        ws.column(4).setWidth(18);
        ws.column(5).setWidth(25);
        ws.column(6).setWidth(22);
        ws.column(7).setWidth(18);
        ws.column(8).setWidth(15);
        ws.column(9).setWidth(12);
        ws.column(10).setWidth(30);
        ws.column(11).setWidth(16);
        ws.column(12).setWidth(16);
        ws.column(13).setWidth(16);
        ws.column(14).setWidth(14);
        ws.column(15).setWidth(14);
        ws.column(16).setWidth(12);
        ws.column(17).setWidth(30);
        ws.column(18).setWidth(30);
        ws.column(19).setWidth(30);
        ws.column(20).setWidth(22);
        ws.column(21).setWidth(30);

        const totalRow = citas.length + 2;
        ws.cell(totalRow, 1).string('TOTAL REGISTROS:').style({
            font: { bold: true, size: 11 },
            alignment: { horizontal: 'left', vertical: 'center' }
        });
        ws.cell(totalRow, 2).number(citas.length).style({
            font: { bold: true, size: 11 },
            alignment: { horizontal: 'center', vertical: 'center' }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileName)}`);

        wb.write(fileName, res);

        console.log(` Excel de consultas generado correctamente: ${citas.length} registros`);
        console.log(` Archivo: ${fileName}`);

        try {
            await registrarBitacora({
                usuario: req.user?.USUARIO || "SISTEMA",
                accion: "EXPORTAR_EXCEL_CONSULTAS",
                descripcion: `Exportados ${citas.length} registros de consultas a Excel. Archivo: ${fileName}`,
                modulo: "CONSULTA_MEDICA",
                tabla: "TBL_CITAS",
                estado: "EXITO",
                req
            });
        } catch (bitError) {
            console.error("Error registrando bitácora:", bitError);
        }

    } catch (error) {
        console.error(" Error exportando Excel de consultas:", error);
        res.status(500).json({
            success: false,
            message: "Error al generar el archivo Excel: " + error.message
        });
    }
});

// ============================================================
// GET /excel/bitacora -> Descargar Excel de bitácora
// ============================================================
router.get("/bitacora", async (req, res) => {
    try {
        console.log("📊 Generando Excel de bitácora...");

        const { rows: registros } = await pool.query(`
            SELECT 
                TO_CHAR(b.fecha_hora, 'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
                COALESCE(u.usuario, 'SISTEMA') AS usuario,
                b.accion,
                b.modulo,
                b.descripcion
            FROM tbl_ms_bitacora b
            LEFT JOIN tbl_ms_usuario u ON b.id_usuario = u.id_usuario
            ORDER BY b.fecha_hora DESC
            LIMIT 500
        `);

        if (!registros || registros.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No hay registros de bitácora para exportar"
            });
        }

        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Bitácora');

        const headerStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 12 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#023047', fgColor: '#023047' },
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

        const headers = ['Fecha y Hora', 'Usuario', 'Acción', 'Módulo', 'Descripción'];

        headers.forEach((header, index) => {
            ws.cell(1, index + 1).string(header).style(headerStyle);
        });

        registros.forEach((registro, rowIndex) => {
            const row = rowIndex + 2;
            ws.cell(row, 1).string(registro.fecha_hora || '').style(cellStyle);
            ws.cell(row, 2).string(registro.usuario || '').style(cellStyle);
            ws.cell(row, 3).string(registro.accion || '').style(cellStyle);
            ws.cell(row, 4).string(registro.modulo || '').style(cellStyle);
            ws.cell(row, 5).string(registro.descripcion || '').style(cellStyle);
        });

        ws.column(1).setWidth(25);
        ws.column(2).setWidth(20);
        ws.column(3).setWidth(25);
        ws.column(4).setWidth(20);
        ws.column(5).setWidth(50);

        const fechaActual4 = new Date().toISOString().split('T')[0];
        const fileName = `Bitacora_${fechaActual4}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

        wb.write(fileName, res);

        console.log(` Excel de bitácora generado correctamente: ${registros.length} registros`);

    } catch (error) {
        console.error(" Error exportando Excel de bitácora:", error);
        res.status(500).json({
            success: false,
            message: "Error al generar el archivo Excel: " + error.message
        });
    }
});

// ============================================================
// GET /excel/citas -> Descargar Excel de citas
// ============================================================
router.get("/citas", async (req, res) => {
    try {
        console.log("📊 Generando Excel de citas...");

        const { rows: citas } = await pool.query(`
            SELECT 
                c.id_cita,
                CONCAT(p.nombres, ' ', p.apellidos) AS nombre_paciente,
                p.telefono AS telefono_paciente,
                p.correo_electronico AS correo_paciente,
                p.numero_documento_identidad AS identidad_paciente,
                u.nombre_usuario AS nombre_doctor,
                c.fecha_cita,
                c.estado,
                c.tipo_cita,
                c.prioridad,
                c.motivo_consulta,
                c.duracion_estimada_min,
                c.canal_registro
            FROM tbl_citas c
            INNER JOIN tbl_paciente p ON c.id_paciente = p.id_paciente
            INNER JOIN tbl_ms_usuario u ON c.id_doctor = u.id_usuario
            WHERE c.estado IN ('PROGRAMADA','CONFIRMADA','FINALIZADA','CANCELADA','NO_ASISTIO')
            ORDER BY c.fecha_cita DESC
            LIMIT 500
        `);

        if (!citas || citas.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No hay citas para exportar"
            });
        }

        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Citas');

        const headerStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 12 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#023047', fgColor: '#023047' },
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

        const headers = [
            'ID', 'Paciente', 'Teléfono', 'Correo', 'Identidad',
            'Doctor', 'Fecha', 'Estado', 'Tipo', 'Prioridad',
            'Motivo', 'Duración (min)', 'Canal'
        ];

        headers.forEach((header, index) => {
            ws.cell(1, index + 1).string(header).style(headerStyle);
        });

        citas.forEach((cita, rowIndex) => {
            const row = rowIndex + 2;
            ws.cell(row, 1).number(cita.id_cita).style(cellStyle);
            ws.cell(row, 2).string(cita.nombre_paciente || '').style(cellStyle);
            ws.cell(row, 3).string(cita.telefono_paciente || '').style(cellStyle);
            ws.cell(row, 4).string(cita.correo_paciente || '').style(cellStyle);
            ws.cell(row, 5).string(cita.identidad_paciente || '').style(cellStyle);
            ws.cell(row, 6).string(cita.nombre_doctor || '').style(cellStyle);
            ws.cell(row, 7).string(new Date(cita.fecha_cita).toLocaleString('es-ES')).style(cellStyle);
            ws.cell(row, 8).string(cita.estado || '').style(cellStyle);
            ws.cell(row, 9).string(cita.tipo_cita || '').style(cellStyle);
            ws.cell(row, 10).string(cita.prioridad || '').style(cellStyle);
            ws.cell(row, 11).string(cita.motivo_consulta || '').style(cellStyle);
            ws.cell(row, 12).number(cita.duracion_estimada_min || 30).style(cellStyle);
            ws.cell(row, 13).string(cita.canal_registro || '').style(cellStyle);
        });

        ws.column(1).setWidth(8);
        ws.column(2).setWidth(30);
        ws.column(3).setWidth(18);
        ws.column(4).setWidth(30);
        ws.column(5).setWidth(20);
        ws.column(6).setWidth(25);
        ws.column(7).setWidth(22);
        ws.column(8).setWidth(15);
        ws.column(9).setWidth(15);
        ws.column(10).setWidth(12);
        ws.column(11).setWidth(35);
        ws.column(12).setWidth(15);
        ws.column(13).setWidth(15);

        const fechaActual5 = new Date().toISOString().split('T')[0];
        const fileName = `Citas_${fechaActual5}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

        wb.write(fileName, res);

        console.log(`✅ Excel de citas generado correctamente: ${citas.length} citas`);

    } catch (error) {
        console.error("❌ Error exportando Excel de citas:", error);
        res.status(500).json({
            success: false,
            message: "Error al generar el archivo Excel: " + error.message
        });
    }
});

// ============================================================
// GET /excel/pacientes -> Descargar Excel de pacientes
// ============================================================
router.get("/pacientes", async (req, res) => {
    try {
        console.log("📊 Generando Excel de pacientes...");

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

        const fechaActual6 = new Date().toISOString().split('T')[0];
        const fileName = `Pacientes_${fechaActual6}.xlsx`;

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

// ============================================================
// GET /excel/historial/:idPaciente - Exportar historial médico
// ============================================================
router.get("/historial/:idPaciente", async (req, res) => {
    try {
        const { idPaciente } = req.params;

        console.log(`📊 ========================================`);
        console.log(`📊 Generando Excel de historial médico`);
        console.log(`📊 Paciente ID: ${idPaciente}`);
        console.log(`📊 ========================================`);

        if (!idPaciente || isNaN(idPaciente) || parseInt(idPaciente) <= 0) {
            console.error(`❌ ID inválido: ${idPaciente}`);
            return res.status(400).json({
                success: false,
                message: "ID de paciente inválido"
            });
        }

        const { rows: paciente } = await pool.query(`
            SELECT 
                p.id_paciente,
                p.nombres,
                p.apellidos,
                CONCAT(p.nombres, ' ', p.apellidos) AS nombre_completo,
                p.fecha_nacimiento,
                p.genero,
                p.telefono,
                p.correo_electronico,
                p.direccion,
                p.estado,
                p.rtn_paciente,
                p.ocupacion,
                p.estado_civil,
                p.tipo_documento_identidad,
                p.numero_documento_identidad
            FROM tbl_paciente p
            WHERE p.id_paciente = $1
        `, [idPaciente]);

        if (!paciente || paciente.length === 0) {
            console.error(`❌ Paciente no encontrado: ${idPaciente}`);
            return res.status(404).json({
                success: false,
                message: "Paciente no encontrado"
            });
        }

        const p = paciente[0];
        console.log(`✅ Paciente encontrado: ${p.nombre_completo}`);

        const calcularEdad = (fecha) => {
            if (!fecha) return '';
            const nacimiento = new Date(fecha);
            const hoy = new Date();
            let edad = hoy.getFullYear() - nacimiento.getFullYear();
            const mes = hoy.getMonth() - nacimiento.getMonth();
            if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
            return edad;
        };

        const { rows: historial } = await pool.query(`
            SELECT 
                alergias,
                enfermedades_cronicas,
                cirugias_previas,
                medicamentos_actuales,
                antecedentes_familiares,
                habitos,
                vacunas,
                notas_importantes,
                fecha_actualizacion
            FROM tbl_historial_medico
            WHERE id_paciente = $1
        `, [idPaciente]);

        const datosHistorial = historial && historial.length > 0 ? historial[0] : null;
        console.log(`📋 Historial: ${datosHistorial ? 'ENCONTRADO' : 'NO ENCONTRADO'}`);

        const { rows: consultas } = await pool.query(`
            SELECT 
                cm.fecha_consulta,
                cm.motivo_consulta,
                cm.diagnostico_principal,
                cm.codigo_cie10_principal,
                cm.tratamiento,
                cm.recomendaciones,
                cm.tipo_consulta,
                u.nombre_usuario AS doctor
            FROM tbl_consulta_medica cm
            LEFT JOIN tbl_ms_usuario u ON cm.id_doctor = u.id_usuario
            WHERE cm.id_paciente = $1
            ORDER BY cm.fecha_consulta DESC
            LIMIT 20
        `, [idPaciente]);

        console.log(`📋 Consultas encontradas: ${consultas.length}`);

        const { rows: preclinicas } = await pool.query(`
            SELECT 
                pr.fecha_registro,
                pr.temperatura,
                pr.presion_sistolica,
                pr.presion_diastolica,
                pr.frecuencia_cardiaca,
                pr.saturacion_oxigeno,
                pr.peso,
                pr.talla,
                pr.imc,
                pr.glucosa,
                pr.estado_general,
                u.nombre_usuario AS enfermera
            FROM tbl_preclinica pr
            LEFT JOIN tbl_ms_usuario u ON pr.id_usuario_enfermeria = u.id_usuario
            WHERE pr.id_cita IN (
                SELECT c.id_cita FROM tbl_citas c WHERE c.id_paciente = $1
            )
            ORDER BY pr.fecha_registro DESC
            LIMIT 20
        `, [idPaciente]);

        console.log(`📋 Signos vitales encontrados: ${preclinicas.length}`);

        const { rows: medicamentos } = await pool.query(`
            SELECT 
                pr.fecha_prescripcion,
                m.nombre_medicamento,
                pr.dosis,
                pr.frecuencia,
                pr.duracion,
                pr.estado
            FROM tbl_prescripcion pr
            LEFT JOIN tbl_inventario_medicamentos m ON pr.id_medicamento = m.id_medicamento
            LEFT JOIN tbl_consulta_medica cm ON pr.id_consulta = cm.id_consulta
            WHERE cm.id_paciente = $1
            ORDER BY pr.fecha_prescripcion DESC
            LIMIT 20
        `, [idPaciente]);

        console.log(`📋 Medicamentos encontrados: ${medicamentos.length}`);

        const wb = new xl.Workbook();

        const titleStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 14 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#023047', fgColor: '#023047' },
            alignment: { horizontal: 'center', vertical: 'center' },
        });

        const headerStyle = wb.createStyle({
            font: { bold: true, color: '#FFFFFF', size: 11 },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#219ebc', fgColor: '#219ebc' },
            alignment: { horizontal: 'center', vertical: 'center' },
        });

        const labelStyle = wb.createStyle({
            font: { bold: true, size: 11, color: '#023047' },
            fill: { type: 'pattern', patternType: 'solid', bgColor: '#E8F0FE', fgColor: '#E8F0FE' },
            alignment: { horizontal: 'left', vertical: 'center' },
        });

        const cellStyle = wb.createStyle({
            alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
            border: {
                left: { style: 'thin', color: '#000000' },
                right: { style: 'thin', color: '#000000' },
                top: { style: 'thin', color: '#000000' },
                bottom: { style: 'thin', color: '#000000' },
            },
        });

        const cellCenterStyle = wb.createStyle({
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: {
                left: { style: 'thin', color: '#000000' },
                right: { style: 'thin', color: '#000000' },
                top: { style: 'thin', color: '#000000' },
                bottom: { style: 'thin', color: '#000000' },
            },
        });

        // HOJA 1: DATOS DEL PACIENTE
        const wsPaciente = wb.addWorksheet('1. Datos Paciente');

        wsPaciente.cell(1, 1).string('HISTORIAL MÉDICO COMPLETO').style({
            font: { bold: true, size: 16, color: '#023047' },
            alignment: { horizontal: 'center' },
        });
        wsPaciente.column(1).setWidth(30);
        wsPaciente.column(2).setWidth(50);

        let row = 3;

        const infoPaciente = [
            ['ID Paciente:', p.id_paciente],
            ['Nombre Completo:', p.nombre_completo || ''],
            ['Nombres:', p.nombres || ''],
            ['Apellidos:', p.apellidos || ''],
            ['Fecha de Nacimiento:', p.fecha_nacimiento ? new Date(p.fecha_nacimiento).toLocaleDateString('es-ES') : ''],
            ['Edad:', p.fecha_nacimiento ? `${calcularEdad(p.fecha_nacimiento)} años` : ''],
            ['Género:', p.genero || ''],
            ['Teléfono:', p.telefono || ''],
            ['Correo Electrónico:', p.correo_electronico || ''],
            ['Dirección:', p.direccion || ''],
            ['RTN:', p.rtn_paciente || 'N/A'],
            ['Ocupación:', p.ocupacion || 'N/A'],
            ['Estado Civil:', p.estado_civil || 'N/A'],
            ['Tipo Documento:', p.tipo_documento_identidad || ''],
            ['Número Documento:', p.numero_documento_identidad || ''],
            ['Estado:', p.estado || '']
        ];

        infoPaciente.forEach(([label, value]) => {
            wsPaciente.cell(row, 1).string(label).style(labelStyle);
            wsPaciente.cell(row, 2).string(String(value || '')).style(cellStyle);
            row++;
        });

        // HOJA 2: HISTORIAL MÉDICO
        const wsHistorial = wb.addWorksheet('2. Historial Médico');

        let rowH = 1;
        wsHistorial.cell(rowH, 1).string('HISTORIAL MÉDICO').style({
            font: { bold: true, size: 14, color: '#023047' },
            alignment: { horizontal: 'center' },
        });
        rowH += 2;

        const parseArray = (value) => {
            if (!value) return '';
            if (Array.isArray(value)) return value.join(', ');
            if (typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) return parsed.join(', ');
                    return value;
                } catch {
                    return value;
                }
            }
            return value;
        };

        if (datosHistorial) {
            const camposHistorial = [
                ['Alergias:', datosHistorial.alergias],
                ['Enfermedades Crónicas:', datosHistorial.enfermedades_cronicas],
                ['Cirugías Previas:', datosHistorial.cirugias_previas],
                ['Medicamentos Actuales:', datosHistorial.medicamentos_actuales],
                ['Antecedentes Familiares:', datosHistorial.antecedentes_familiares],
                ['Hábitos:', datosHistorial.habitos],
                ['Vacunas:', datosHistorial.vacunas],
                ['Notas Importantes:', datosHistorial.notas_importantes],
                ['Última Actualización:', datosHistorial.fecha_actualizacion ? new Date(datosHistorial.fecha_actualizacion).toLocaleString('es-ES') : '']
            ];

            camposHistorial.forEach(([label, value]) => {
                wsHistorial.cell(rowH, 1).string(label).style(labelStyle);
                wsHistorial.cell(rowH, 2).string(parseArray(value)).style(cellStyle);
                rowH++;
            });
        } else {
            wsHistorial.cell(rowH, 1).string('No hay historial médico registrado para este paciente.').style(cellStyle);
        }

        wsHistorial.column(1).setWidth(30);
        wsHistorial.column(2).setWidth(60);

        // HOJA 3: CONSULTAS MÉDICAS
        const wsConsultas = wb.addWorksheet('3. Consultas Médicas');

        const headersConsulta = ['Fecha', 'Motivo', 'Diagnóstico Principal', 'CIE-10', 'Tratamiento', 'Recomendaciones', 'Tipo', 'Doctor'];
        headersConsulta.forEach((header, index) => {
            wsConsultas.cell(1, index + 1).string(header).style(headerStyle);
        });

        if (consultas && consultas.length > 0) {
            consultas.forEach((consulta, idx) => {
                const rowIdx = idx + 2;
                wsConsultas.cell(rowIdx, 1).string(consulta.fecha_consulta ? new Date(consulta.fecha_consulta).toLocaleDateString('es-ES') : '').style(cellCenterStyle);
                wsConsultas.cell(rowIdx, 2).string(consulta.motivo_consulta || '').style(cellStyle);
                wsConsultas.cell(rowIdx, 3).string(consulta.diagnostico_principal || '').style(cellStyle);
                wsConsultas.cell(rowIdx, 4).string(consulta.codigo_cie10_principal || '').style(cellCenterStyle);
                wsConsultas.cell(rowIdx, 5).string(consulta.tratamiento || '').style(cellStyle);
                wsConsultas.cell(rowIdx, 6).string(consulta.recomendaciones || '').style(cellStyle);
                wsConsultas.cell(rowIdx, 7).string(consulta.tipo_consulta || '').style(cellCenterStyle);
                wsConsultas.cell(rowIdx, 8).string(consulta.doctor || '').style(cellStyle);
            });
        } else {
            wsConsultas.cell(2, 1).string('No hay consultas médicas registradas.').style(cellStyle);
        }

        wsConsultas.column(1).setWidth(15);
        wsConsultas.column(2).setWidth(30);
        wsConsultas.column(3).setWidth(30);
        wsConsultas.column(4).setWidth(15);
        wsConsultas.column(5).setWidth(30);
        wsConsultas.column(6).setWidth(30);
        wsConsultas.column(7).setWidth(18);
        wsConsultas.column(8).setWidth(25);

        // HOJA 4: SIGNOS VITALES
        const wsPre = wb.addWorksheet('4. Signos Vitales');

        const headersPre = ['Fecha', 'Temperatura °C', 'Presión Sist.', 'Presión Diast.', 'F.C. (lat/min)', 'Sat. O₂ %', 'Peso (kg)', 'Talla (cm)', 'IMC', 'Glucosa', 'Estado General', 'Enfermera'];
        headersPre.forEach((header, index) => {
            wsPre.cell(1, index + 1).string(header).style(headerStyle);
        });

        if (preclinicas && preclinicas.length > 0) {
            preclinicas.forEach((pre, idx) => {
                const rowIdx = idx + 2;
                wsPre.cell(rowIdx, 1).string(pre.fecha_registro ? new Date(pre.fecha_registro).toLocaleDateString('es-ES') : '').style(cellCenterStyle);
                wsPre.cell(rowIdx, 2).number(parseFloat(pre.temperatura) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 3).number(parseFloat(pre.presion_sistolica) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 4).number(parseFloat(pre.presion_diastolica) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 5).number(parseFloat(pre.frecuencia_cardiaca) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 6).number(parseFloat(pre.saturacion_oxigeno) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 7).number(parseFloat(pre.peso) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 8).number(parseFloat(pre.talla) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 9).number(parseFloat(pre.imc) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 10).number(parseFloat(pre.glucosa) || 0).style(cellCenterStyle);
                wsPre.cell(rowIdx, 11).string(pre.estado_general || '').style(cellStyle);
                wsPre.cell(rowIdx, 12).string(pre.enfermera || '').style(cellStyle);
            });
        } else {
            wsPre.cell(2, 1).string('No hay registros de signos vitales.').style(cellStyle);
        }

        wsPre.column(1).setWidth(15);
        wsPre.column(2).setWidth(15);
        wsPre.column(3).setWidth(14);
        wsPre.column(4).setWidth(14);
        wsPre.column(5).setWidth(15);
        wsPre.column(6).setWidth(12);
        wsPre.column(7).setWidth(12);
        wsPre.column(8).setWidth(12);
        wsPre.column(9).setWidth(12);
        wsPre.column(10).setWidth(12);
        wsPre.column(11).setWidth(20);
        wsPre.column(12).setWidth(25);

        // HOJA 5: MEDICAMENTOS
        const wsMed = wb.addWorksheet('5. Medicamentos');

        const headersMed = ['Fecha', 'Medicamento', 'Dosis', 'Frecuencia', 'Duración', 'Estado'];
        headersMed.forEach((header, index) => {
            wsMed.cell(1, index + 1).string(header).style(headerStyle);
        });

        if (medicamentos && medicamentos.length > 0) {
            medicamentos.forEach((med, idx) => {
                const rowIdx = idx + 2;
                wsMed.cell(rowIdx, 1).string(med.fecha_prescripcion ? new Date(med.fecha_prescripcion).toLocaleDateString('es-ES') : '').style(cellCenterStyle);
                wsMed.cell(rowIdx, 2).string(med.nombre_medicamento || '').style(cellStyle);
                wsMed.cell(rowIdx, 3).string(med.dosis || '').style(cellCenterStyle);
                wsMed.cell(rowIdx, 4).string(med.frecuencia || '').style(cellCenterStyle);
                wsMed.cell(rowIdx, 5).string(med.duracion || '').style(cellCenterStyle);
                wsMed.cell(rowIdx, 6).string(med.estado || '').style(cellCenterStyle);
            });
        } else {
            wsMed.cell(2, 1).string('No hay medicamentos prescritos.').style(cellStyle);
        }

        wsMed.column(1).setWidth(15);
        wsMed.column(2).setWidth(30);
        wsMed.column(3).setWidth(15);
        wsMed.column(4).setWidth(18);
        wsMed.column(5).setWidth(15);
        wsMed.column(6).setWidth(15);

        // GENERAR Y ENVIAR
        const fechaActual7 = new Date().toISOString().split('T')[0];
        const nombreArchivo = `Historial_${p.nombre_completo.replace(/\s/g, '_')}_${fechaActual7}.xlsx`;

        console.log(`📊 Enviando archivo: ${nombreArchivo}`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(nombreArchivo)}`);

        wb.write(nombreArchivo, res);

        console.log(`✅ Excel generado exitosamente: ${nombreArchivo}`);
        console.log(`   - ${consultas.length} consultas`);
        console.log(`   - ${preclinicas.length} signos vitales`);
        console.log(`   - ${medicamentos.length} medicamentos`);
        console.log(`📊 ========================================`);

    } catch (error) {
        console.error(`❌ Error exportando Excel de historial médico:`);
        console.error(`❌ Mensaje:`, error.message);
        console.error(`❌ Stack:`, error.stack);

        try {
            res.status(500).json({
                success: false,
                message: "Error al generar el archivo Excel: " + error.message
            });
        } catch (e) {
            console.error('❌ Error al enviar respuesta de error:', e);
            res.status(500).send('Error interno del servidor');
        }
    }
});

// ============================================================
// GET /excel/prueba-excel -> Excel de prueba simple
// ============================================================
router.get("/prueba-excel", (req, res) => {
    try {
        console.log("📊 Generando Excel de prueba...");

        const wb = new xl.Workbook();
        const ws = wb.addWorksheet('Prueba');

        ws.cell(1, 1).string('Prueba de Excel');
        ws.cell(2, 1).string('¡Funciona correctamente!');
        ws.cell(3, 1).string('Fecha: ' + new Date().toLocaleString());

        const fechaActual8 = new Date().toISOString().split('T')[0];
        const fileName = `Prueba_Excel_${fechaActual8}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

        wb.write(fileName, res);

        console.log("✅ Excel de prueba generado correctamente");
    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({
            success: false,
            message: "Error: " + error.message
        });
    }
});

module.exports = router;