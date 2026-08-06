const db = require('../database/db');

async function verificarPrimerIngreso(req, res, next) {
    if (req.path === '/cambiar-password') {
        return next();
    }

    try {
        const usuario = req.usuarioActual;
        if (!usuario) {
            return next();
        }

        const resultado = await db.query(
            `SELECT "ESTADO" FROM "TBL_MS_USUARIO" WHERE "USUARIO" = $1`,
            [usuario]
        );
        const rows = resultado.rows;

        if (rows.length === 0) {
            return next();
        }

        const estado = rows[0].ESTADO || '';

        if (estado.toUpperCase() === 'NUEVO') {
            if (req.path !== '/') {
                return res.redirect('/dashboard');
            }
            req.esPrimerIngreso = true;
            return next();
        }

        next();
    } catch (error) {
        console.error('Error en verificarPrimerIngreso:', error);
        next();
    }
}

module.exports = verificarPrimerIngreso;