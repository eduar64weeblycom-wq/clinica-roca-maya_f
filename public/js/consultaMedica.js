(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const $$ = selector => document.querySelectorAll(selector);

    let citas = [];
    let consultas = [];
    let consultasMap = {};
    let saving = false;
    let pacientesData = [];
    let doctoresData = [];

    // Control de carga y caché
    let cargandoDatos = false;
    let abortController = null;
    const historialCache = new Map();
    const preclinicaCache = new Map();

    let filtrosConsulta = {
        paciente: '',
        telefono: '',
        identidad: '',
        fecha: '',
        tipo: ''
    };

    // ============================================================
    // UTILIDADES Y FORMATO DE DATOS
    // ============================================================
    function escapeHtml(s) {
        if (s === undefined || s === null) return "";
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function sanitizarBusqueda(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[^a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s\.\-]/g, '');
    }

    function sanitizarNumero(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[^0-9\-]/g, '');
    }

    function sanitizarIdentidad(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[^a-zA-Z0-9\-]/g, '').toUpperCase();
    }

    function safeEstadoClass(estado) {
        if (!estado) return "";
        return "ctestado-" + String(estado).toLowerCase().replace(/[^a-z0-9]+/g, "_");
    }

    function formatearFecha(fecha) {
        if (!fecha) return '';
        const d = new Date(fecha);
        return d.toLocaleDateString('es-ES', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function formatearFechaSolo(fecha) {
        if (!fecha) return '';
        const d = new Date(fecha);
        return d.toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function resetearEstilosBotonesModal() {
        const contenedor = document.querySelector('.ctmodal-footer-buttons');
        if (contenedor) {
            contenedor.style.display = 'flex';
            contenedor.style.gap = '12px';
            contenedor.style.justifyContent = 'flex-end';
            contenedor.style.marginTop = '18px';
            contenedor.style.flexWrap = 'wrap';
            contenedor.style.width = '100%';
        }
    }

    // ============================================================
    // API SERVICES
    // ============================================================
    const API = {
        async cargarDatos() {
            const res = await fetch("/consultaMedica/api/datos", { credentials: "same-origin" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        },

        async obtenerConsulta(idCita, signal) {
            const res = await fetch(`/consultaMedica/por-cita/${idCita}`, { credentials: "same-origin", signal });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        },

        async guardarConsulta(payload) {
            const res = await fetch('/consultaMedica/nueva', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Error desconocido' }));
                throw new Error(error.message || `HTTP ${res.status}`);
            }
            return await res.json();
        },

        async actualizarConsulta(payload) {
            const res = await fetch('/consultaMedica/actualizar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Error desconocido' }));
                throw new Error(error.message || `HTTP ${res.status}`);
            }
            return await res.json();
        },

        async cambiarEstado(idCita, nuevoEstado) {
            const res = await fetch("/consultaMedica/api/cambiar-estado", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ idCita: Number(idCita), nuevoEstado })
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Error desconocido' }));
                throw new Error(error.message || `HTTP ${res.status}`);
            }
            return await res.json();
        },

        async cargarHistorialRapido(idPaciente, signal) {
            const res = await fetch(`/consultaMedica/api/historial-rapido/${idPaciente}`, { credentials: "same-origin", signal });
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        },

        async obtenerPreclinica(idCita, signal) {
            const res = await fetch(`/consultaMedica/preclinica/por-cita/${idCita}`, { credentials: "same-origin", signal });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        }
    };

    // ============================================================
    // CARGA INICIAL Y RENDER
    // ============================================================
    async function cargarDatosIniciales() {
        try {
            const data = await API.cargarDatos();
            citas = data.citas || [];
            pacientesData = data.pacientes || [];
            doctoresData = data.doctores || [];
            citas.sort((a, b) => (Number(b.ID_CITA) || 0) - (Number(a.ID_CITA) || 0));
            consultas = data.consultas || [];
            consultasMap = {};
            (consultas || []).forEach(c => {
                if (c.ID_CITA != null) consultasMap[c.ID_CITA] = c;
            });
            renderizarTabla();
            const selectCita = $("selectCitaConsulta");
            if (!selectCita || !selectCita.dataset.citaFiltrada) {
                llenarSelectCitas();
            }
        } catch (err) {
            console.error("Error cargando datos:", err);
        }
    }

    function aplicarFiltros(citasData) {
        const paciente = sanitizarBusqueda(filtrosConsulta.paciente).toLowerCase().trim();
        const telefono = sanitizarNumero(filtrosConsulta.telefono).trim();
        const identidad = sanitizarIdentidad(filtrosConsulta.identidad).trim();
        const fecha = filtrosConsulta.fecha;
        const tipo = filtrosConsulta.tipo.toUpperCase();

        return citasData.filter(c => {
            const coincidePaciente = !paciente ||
                String(c.ID_CITA).includes(paciente) ||
                (c.NOMBRE_PACIENTE && c.NOMBRE_PACIENTE.toLowerCase().includes(paciente)) ||
                (c.NOMBRE_DOCTOR && c.NOMBRE_DOCTOR.toLowerCase().includes(paciente));

            const coincideTelefono = !telefono ||
                (c.TELEFONO_PACIENTE && c.TELEFONO_PACIENTE.replace(/[^0-9]/g, '').includes(telefono));

            const coincideIdentidad = !identidad ||
                (c.IDENTIDAD_PACIENTE && c.IDENTIDAD_PACIENTE.toUpperCase().includes(identidad));

            let coincideFecha = true;
            if (fecha) {
                const fechaCita = new Date(c.FECHA_CITA).toISOString().split('T')[0];
                coincideFecha = fechaCita === fecha;
            }

            const coincideTipo = !tipo || (c.TIPO_CITA && c.TIPO_CITA.toUpperCase() === tipo);

            return coincidePaciente && coincideTelefono && coincideIdentidad && coincideFecha && coincideTipo;
        });
    }

    function renderizarTabla() {
        const target = $("tablaContenidoConsulta");
        if (!target) return;

        const citasFiltradas = aplicarFiltros(citas);

        if (!citasFiltradas.length) {
            target.innerHTML = `
                <div class="ctsin-citas">
                    <i class="fas fa-notes-medical"></i>
                    <h3>No hay consultas registradas</h3>
                    <p>Puedes crear una con "Nueva Consulta".</p>
                    <button class="ctbtn-primary" id="btnCrearPrimeraConsulta" type="button"><i class="fas fa-plus"></i> Nueva Consulta</button>
                </div>
            `;
            const btnCrear = document.getElementById('btnCrearPrimeraConsulta');
            if (btnCrear) btnCrear.addEventListener('click', () => window.abrirModalConsulta());
            return;
        }

        let html = `
            <div class="cttabla-consulta">
                <div class="tabla-header">
                    <span class="total-registros">
                        <i class="fas fa-list"></i> ${citasFiltradas.length} consulta${citasFiltradas.length > 1 ? 's' : ''} encontradas
                    </span>
                </div>
                <div class="table-responsive">
                    <table class="table">
                        <thead>
                            <tr><th>ID</th><th>Fecha/Hora</th><th>Paciente</th><th>Doctor</th><th>Tipo</th><th>Estado</th><th>Acciones</th></tr>
                        </thead>
                        <tbody>
        `;

        citasFiltradas.forEach(c => {
            const fechaSolo = formatearFechaSolo(c.FECHA_CITA);
            const hora = new Date(c.FECHA_CITA).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
            const estadoClass = safeEstadoClass(c.ESTADO || "");
            const hasConsulta = !!consultasMap[c.ID_CITA];
            const estadoUpper = String(c.ESTADO || "").toUpperCase();
            const accionesPermitidas = (estadoUpper !== "CANCELADA" && estadoUpper !== "NO_ASISTIO");

            html += `
                <tr data-id="${c.ID_CITA}">
                    <td><strong>#${c.ID_CITA}</strong></td>
                    <td><div class="fecha-cita">${fechaSolo}</div><div class="hora-cita"><i class="far fa-clock"></i> ${hora}</div></td>
                    <td><div class="nombre-paciente"><strong>${escapeHtml(c.NOMBRE_PACIENTE)}</strong></div></td>
                    <td>${escapeHtml(c.NOMBRE_DOCTOR || 'No asignado')}</td>
                    <td><span class="badge">${escapeHtml(c.TIPO_CITA || 'GENERAL')}</span></td>
                    <td><span class="ctestado-badge ${estadoClass}">${escapeHtml(c.ESTADO || '')}</span></td>
                    <td>
                        <div class="ctacciones-consulta">
            `;

            if (accionesPermitidas) {
                html += `<button class="ctbtn-accion" data-action="abrirConsulta" data-id="${c.ID_CITA}"><i class="fas fa-user-md"></i> ${hasConsulta ? 'Ver' : 'Abrir'}</button>`;
                if (hasConsulta) {
                    html += `<button class="ctbtn-accion edit" data-action="editarConsulta" data-id="${c.ID_CITA}"><i class="fas fa-edit"></i> Editar</button>`;
                }
            } else {
                html += `<span class="text-muted">Sin acciones</span>`;
            }

            html += `</div></td></tr>`;
        });

        html += `</tbody></table></div></div>`;
        target.innerHTML = html;
    }

    function llenarSelectCitas() {
        const sel = $("selectCitaConsulta");
        if (!sel || sel.dataset.citaFiltrada) return;

        sel.innerHTML = '<option value="">Seleccionar cita...</option>';
        const citasFiltradas = aplicarFiltros(citas);
        
        citasFiltradas.forEach(c => {
            const label = `#${c.ID_CITA} — ${c.NOMBRE_PACIENTE} • ${formatearFecha(c.FECHA_CITA)}`;
            const opt = document.createElement("option");
            opt.value = c.ID_CITA;
            opt.textContent = label;
            sel.appendChild(opt);
        });
    }

    // ============================================================
    // MODAL CONSULTA - ABRIR / CERRAR / LIMPIAR
    // ============================================================
    window.abrirModalConsulta = function(idCita = null) {
        const modal = $("modalConsulta");
        if (!modal) return;
        modal.style.display = "flex";
        modal.setAttribute("aria-hidden", "false");
        setTimeout(resetearEstilosBotonesModal, 50);

        if (idCita) {
            const selectCita = $("selectCitaConsulta");
            if (selectCita) {
                selectCita.value = idCita;
                selectCita.dataset.citaFiltrada = "true";
                const citaObj = citas.find(c => String(c.ID_CITA) === String(idCita));
                if (citaObj) {
                    cargarTodosLosDatosDeCita(idCita, citaObj.ID_PACIENTE, consultasMap[idCita]?.ID_CONSULTA);
                }
            }
        }
    };

    window.cerrarModalConsulta = function() {
        const modal = $("modalConsulta");
        if (!modal) return;
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        const selectCita = $("selectCitaConsulta");
        if (selectCita) {
            delete selectCita.dataset.citaFiltrada;
            llenarSelectCitas();
        }
        historialCache.clear();
        preclinicaCache.clear();
    };

    async function cargarTodosLosDatosDeCita(idCita, idPaciente, idConsultaExistente) {
        if (cargandoDatos) return;

        if (abortController) abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        cargandoDatos = true;

        try {
            const [consultaData, preclinicaData] = await Promise.all([
                API.obtenerConsulta(idCita, signal).catch(() => null),
                API.obtenerPreclinica(idCita, signal).catch(() => null)
            ]);

            if (consultaData && consultaData.success && consultaData.consulta) {
                const c = consultaData.consulta;
                if ($("idConsulta")) $("idConsulta").value = c.ID_CONSULTA || "";
                if ($("motivoConsulta")) $("motivoConsulta").value = c.MOTIVO_CONSULTA || "";
                if ($("diagnosticoPrincipal")) $("diagnosticoPrincipal").value = c.DIAGNOSTICO_PRINCIPAL || "";
                if ($("tratamiento")) $("tratamiento").value = c.TRATAMIENTO || "";
                if ($("recomendaciones")) $("recomendaciones").value = c.RECOMENDACIONES || "";
            }

            if (preclinicaData && preclinicaData.success && preclinicaData.preclinica) {
                const p = preclinicaData.preclinica;
                const set = (id, val) => { const el = $(id); if (el) el.value = val ?? ""; };
                set("temperatura", p.TEMPERATURA);
                set("presionSistolica", p.PRESION_SISTOLICA);
                set("presionDiastolica", p.PRESION_DIASTOLICA);
                set("peso", p.PESO);
                set("talla", p.TALLA);
            }
        } catch (err) {
            if (err.name !== 'AbortError') console.error("Error al sincronizar datos de la cita:", err);
        } finally {
            cargandoDatos = false;
        }
    }

    // ============================================================
    // DELEGACIÓN GLOBAL DE EVENTOS
    // ============================================================
    document.addEventListener('click', (e) => {
        const btnAccion = e.target.closest('[data-action]');
        if (!btnAccion) return;

        const action = btnAccion.dataset.action;
        const idCita = btnAccion.dataset.id;

        if (action === 'abrirConsulta' || action === 'editarConsulta') {
            window.abrirModalConsulta(idCita);
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        cargarDatosIniciales();
        
        const btnCerrar = document.getElementById('btnCancelarConsulta');
        if (btnCerrar) btnCerrar.addEventListener('click', window.cerrarModalConsulta);
    });
})();