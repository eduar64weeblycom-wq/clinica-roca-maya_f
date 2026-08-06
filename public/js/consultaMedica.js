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

    function debounce(fn, wait = 300) {
        let t;
        return (...a) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...a), wait);
        };
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

    function parseJSONField(field) {
        if (!field) return [];
        if (Array.isArray(field)) {
            return field.filter(item => item && (typeof item === 'string' ? item.trim() !== '' : true));
        }
        if (typeof field === 'string') {
            try {
                const parsed = JSON.parse(field);
                return Array.isArray(parsed) ? parsed.filter(item => item && item.trim() !== '') : [];
            } catch {
                return field.split(',').map(item => item.trim()).filter(item => item !== '');
            }
        }
        return [];
    }

    function formatearParaTextarea(val) {
        if (val === null || val === undefined) return '';
        if (Array.isArray(val)) {
            return val.filter(Boolean).join('\n');
        }
        if (typeof val === 'string') {
            const str = val.trim();
            if (str.startsWith('[') && str.endsWith(']')) {
                try {
                    const parsed = JSON.parse(str);
                    if (Array.isArray(parsed)) {
                        return parsed.filter(Boolean).join('\n');
                    }
                } catch (e) {
                    // No es JSON válido, se usa como texto
                }
            }
            return val;
        }
        return String(val);
    }

    function textAreaToArray(value) {
        if (!value) return [];
        return value.split("\n").map(s => s.trim()).filter(Boolean);
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
            contenedor.style.padding = '0';
            contenedor.style.background = 'transparent';
            contenedor.style.border = 'none';
        }

        const botones = document.querySelectorAll('.ctmodal-footer-buttons .ctbtn-modal');
        botones.forEach(btn => {
            btn.style.padding = '10px 24px';
            btn.style.borderRadius = '8px';
            btn.style.fontSize = '0.9rem';
            btn.style.fontWeight = '600';
            btn.style.cursor = 'pointer';
            btn.style.border = 'none';
            btn.style.display = 'inline-flex';
            btn.style.alignItems = 'center';
            btn.style.gap = '8px';
            btn.style.minWidth = '120px';
            btn.style.justifyContent = 'center';
            btn.style.height = 'auto';
            btn.style.lineHeight = 'normal';
            btn.style.margin = '0';
            btn.style.float = 'none';
            btn.style.clear = 'none';
            btn.style.position = 'static';
        });

        const btnImprimir = document.getElementById('btnImprimirConsulta');
        if (btnImprimir) {
            btnImprimir.style.background = '#17a2b8';
            btnImprimir.style.color = 'white';
            btnImprimir.style.border = 'none';
        }

        const btnCancelar = document.getElementById('btnCancelarConsulta');
        if (btnCancelar) {
            btnCancelar.style.background = '#e9ecef';
            btnCancelar.style.color = '#495057';
            btnCancelar.style.border = '1px solid #ced4da';
        }

        const btnGuardar = document.getElementById('btnGuardarConsulta');
        if (btnGuardar) {
            btnGuardar.style.background = '#2c7be5';
            btnGuardar.style.color = 'white';
            btnGuardar.style.border = 'none';
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

        async imprimirConsulta(idConsulta) {
            const res = await fetch(`/consultaMedica/api/imprimir-consulta/${idConsulta}`, { credentials: "same-origin" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        },

        async cargarMedicamentos(idConsulta, signal) {
            const res = await fetch(`/consultaMedica/api/medicamentos/${idConsulta}`, { credentials: "same-origin", signal });
            if (!res.ok) throw new Error("HTTP " + res.status);
            return await res.json();
        },

        async obtenerPreclinica(idCita, signal) {
            const res = await fetch(`/preclinica/por-cita/${idCita}`, { credentials: "same-origin", signal });
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
                    <h3>${filtrosConsulta.paciente || filtrosConsulta.telefono || filtrosConsulta.identidad || filtrosConsulta.fecha || filtrosConsulta.tipo ? 'No se encontraron consultas con los filtros aplicados.' : 'No hay consultas registradas'}</h3>
                    <p>Puedes crear una con "Nueva Consulta".</p>
                    <button class="ctbtn-primary" id="btnCrearPrimeraConsulta" type="button"><i class="fas fa-plus"></i> Nueva Consulta</button>
                </div>
            `;
            const btnCrear = document.getElementById('btnCrearPrimeraConsulta');
            if (btnCrear) btnCrear.addEventListener('click', () => abrirModalConsulta());
            return;
        }

        let html = `
            <div class="cttabla-consulta">
                <div class="tabla-header">
                    <span class="total-registros">
                        <i class="fas fa-list"></i> ${citasFiltradas.length} consulta${citasFiltradas.length > 1 ? 's' : ''} encontradas
                        ${citas.length !== citasFiltradas.length ? ` (de ${citas.length} totales)` : ''}
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
                    <td><div class="nombre-paciente"><strong>${escapeHtml(c.NOMBRE_PACIENTE)}</strong></div>
                        <div class="info-paciente">${c.TELEFONO_PACIENTE ? `<span class="telefono"><i class="fas fa-phone"></i> ${escapeHtml(c.TELEFONO_PACIENTE)}</span>` : ''}
                        ${c.IDENTIDAD_PACIENTE ? `<span class="identidad"><i class="fas fa-id-card"></i> ${escapeHtml(c.IDENTIDAD_PACIENTE)}</span>` : ''}</div></td>
                    <td>${escapeHtml(c.NOMBRE_DOCTOR || 'No asignado')}</td>
                    <td><span class="badge tipo-${(c.TIPO_CITA || 'GENERAL').toLowerCase()}">${escapeHtml(c.TIPO_CITA || 'GENERAL')}</span></td>
                    <td><span class="ctestado-badge ${estadoClass}">${escapeHtml(c.ESTADO || '')}</span></td>
                    <td>
                        <div class="ctacciones-consulta">
            `;

            if (accionesPermitidas) {
                html += `<button class="ctbtn-accion" data-action="abrirConsulta" data-id="${c.ID_CITA}"><i class="fas fa-user-md"></i> ${hasConsulta ? 'Ver' : 'Abrir'}</button>`;
                if (hasConsulta) {
                    html += `<button class="ctbtn-accion edit" data-action="editarConsulta" data-id="${c.ID_CITA}"><i class="fas fa-edit"></i> Editar</button>`;
                }
                if (c.ESTADO !== 'CANCELADA') {
                    html += `<button class="ctbtn-accion ctbtn-cancelar" data-action="cancelar" data-id="${c.ID_CITA}"><i class="fas fa-times"></i> Cancelar</button>`;
                }
                if (c.ESTADO !== 'NO_ASISTIO') {
                    html += `<button class="ctbtn-accion ctbtn-no-asistio" data-action="no_asistio" data-id="${c.ID_CITA}"><i class="fas fa-user-times"></i> No Asistió</button>`;
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
        if (!sel) return;
        if (sel.dataset.citaFiltrada) return;

        sel.innerHTML = '<option value="">Seleccionar cita...</option>';
        const citasFiltradas = aplicarFiltros(citas);
        if (citasFiltradas.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No hay citas disponibles";
            opt.disabled = true;
            sel.appendChild(opt);
            return;
        }

        citasFiltradas.forEach(c => {
            const label = `#${c.ID_CITA} — ${c.NOMBRE_PACIENTE} • ${formatearFecha(c.FECHA_CITA)}`;
            const opt = document.createElement("option");
            opt.value = c.ID_CITA;
            opt.textContent = label;
            opt.dataset.telefono = c.TELEFONO_PACIENTE || "";
            opt.dataset.correo = c.CORREO_PACIENTE || "";
            opt.dataset.identidad = c.IDENTIDAD_PACIENTE || "";
            opt.dataset.estado = c.ESTADO || "";
            sel.appendChild(opt);
        });
    }

    // ============================================================
    // MODAL CONSULTA - ABRIR / CERRAR / LIMPIAR
    // ============================================================
    function abrirModalConsulta() {
        const modal = $("modalConsulta");
        if (!modal) return;
        modal.style.display = "flex";
        modal.setAttribute("aria-hidden", "false");
        limpiarModalConsulta();
        aplicarEstadoPreclinica();
        setTimeout(resetearEstilosBotonesModal, 50);
    }

    function cerrarModalConsulta() {
        const modal = $("modalConsulta");
        if (!modal) return;
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        const historialContainer = document.getElementById('historialRapidoPaciente');
        if (historialContainer) {
            historialContainer.style.display = 'none';
            const contenido = document.getElementById('historialRapidoContenido');
            if (contenido) contenido.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Seleccione una cita para ver el historial del paciente.</p>';
        }
        const selectCita = $("selectCitaConsulta");
        if (selectCita) {
            delete selectCita.dataset.citaFiltrada;
            llenarSelectCitas();
        }
        historialCache.clear();
        preclinicaCache.clear();
    }

    function limpiarModalConsulta() {
        const ids = ["idConsulta", "motivoConsulta", "sintomasConsulta", "examenFisicoConsulta",
            "diagnosticoPrincipal", "tratamiento", "recomendaciones", "examenesComplementariosConsulta"
        ];
        ids.forEach(id => { const el = $(id); if (el) el.value = ""; });
        if ($("tipoConsulta")) $("tipoConsulta").value = "GENERAL";
        if ($("modalErrorConsulta")) $("modalErrorConsulta").style.display = "none";
        if ($("pacienteInfoConsulta")) $("pacienteInfoConsulta").textContent = "";
        limpiarPreclinicaFields();
        limpiarErroresCampos();
        const btnImprimir = document.getElementById('btnImprimirConsulta');
        if (btnImprimir) btnImprimir.dataset.idConsulta = '';
        const historialContainer = document.getElementById('historialRapidoPaciente');
        if (historialContainer) historialContainer.style.display = 'none';
        const btnFinalizar = document.getElementById('btnFinalizarConsulta');
        if (btnFinalizar) btnFinalizar.style.display = 'none';
        const preBox = document.getElementById('preclinicaInfoConsulta');
        if (preBox) {
            const titulo = preBox.querySelector('strong');
            if (titulo) titulo.innerHTML = '<i class="fas fa-heartbeat" style="color:#dc3545;"></i> Preclínica';
            const mensaje = document.getElementById('preclinicaMensaje');
            if (mensaje) {
                mensaje.textContent = 'Complete los signos vitales si el paciente los requiere.';
                mensaje.style.color = '#6c757d';
            }
        }
        actualizarTogglePreclinica();
    }

    function limpiarPreclinicaFields() {
        const ids = ["temperatura", "presionSistolica", "presionDiastolica",
            "peso", "talla", "imc", "frecuenciaCardiaca", "frecuenciaRespiratoria",
            "saturacionOxigeno", "glucosa", "perimetroAbdominal", "observaciones"
        ];
        ids.forEach(id => {
            const el = $(id);
            if (el) {
                el.value = "";
                el.readOnly = false;
                el.style.background = 'white';
                el.style.borderColor = '#ced4da';
            }
        });
        const preBox = $("preclinicaInfoConsulta");
        if (preBox) {
            preBox.style.display = "block";
            const mensaje = document.getElementById('preclinicaMensaje');
            if (mensaje) {
                mensaje.textContent = 'Complete los signos vitales si el paciente los requiere.';
                mensaje.style.color = '#6c757d';
            }
            const fields = document.getElementById('preclinicaFields');
            if (fields) fields.style.display = 'grid';
        }
        document.querySelectorAll('.field-status').forEach(el => el.textContent = '');
    }

    function limpiarErroresCampos() {
        const ids = ["selectCitaConsulta", "diagnosticoPrincipal", "tratamiento", "sintomasConsulta", "examenFisicoConsulta"];
        ids.forEach(id => {
            const el = $(id);
            if (el) el.classList.remove("field-error");
            const err = $(id + "-error");
            if (err) { err.textContent = ""; err.style.display = "none"; }
        });
        if ($("modalErrorConsulta")) {
            $("modalErrorConsulta").style.display = "none";
            $("modalErrorConsulta").textContent = "";
        }
    }

    // ============================================================
    // TOGGLE PRECLÍNICA
    // ============================================================
    function aplicarEstadoPreclinica() {
        const fields = document.getElementById('preclinicaFields');
        const toggleBtn = document.getElementById('togglePreclinica');
        if (!fields || !toggleBtn) return;
        const visible = localStorage.getItem('preclinicaVisible') === 'true';
        fields.style.display = visible ? 'grid' : 'none';
        toggleBtn.innerHTML = visible
            ? '<i class="fas fa-eye-slash"></i> Ocultar'
            : '<i class="fas fa-eye"></i> Mostrar';
    }

    window.togglePreclinica = function() {
        const fields = document.getElementById('preclinicaFields');
        const toggleBtn = document.getElementById('togglePreclinica');
        if (!fields || !toggleBtn) return;
        const isHidden = fields.style.display === 'none';
        fields.style.display = isHidden ? 'grid' : 'none';
        toggleBtn.innerHTML = isHidden
            ? '<i class="fas fa-eye-slash"></i> Ocultar'
            : '<i class="fas fa-eye"></i> Mostrar';
        localStorage.setItem('preclinicaVisible', isHidden ? 'true' : 'false');
    };

    function actualizarTogglePreclinica() {
        const fields = document.getElementById('preclinicaFields');
        const toggleBtn = document.getElementById('togglePreclinica');
        if (!fields || !toggleBtn) return;
        const visible = fields.style.display !== 'none';
        toggleBtn.innerHTML = visible
            ? '<i class="fas fa-eye-slash"></i> Ocultar'
            : '<i class="fas fa-eye"></i> Mostrar';
    }

    // ============================================================
    // CARGAR TODOS LOS DATOS DE UNA CITA (UNIFICADO)
    // ============================================================
    async function cargarTodosLosDatosDeCita(idCita, idPaciente, idConsultaExistente) {
        if (cargandoDatos) return;

        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();
        const signal = abortController.signal;

        cargandoDatos = true;

        try {
            const promises = [
                API.obtenerConsulta(idCita, signal).catch(() => null),
                preclinicaCache.has(idCita) 
                    ? Promise.resolve(preclinicaCache.get(idCita)) 
                    : API.obtenerPreclinica(idCita, signal).then(data => {
                        if (data && data.success && data.preclinica) preclinicaCache.set(idCita, data);
                        return data;
                    }).catch(() => null),
                idPaciente 
                    ? (historialCache.has(idPaciente) ? Promise.resolve(historialCache.get(idPaciente)) : API.cargarHistorialRapido(idPaciente, signal).catch(() => null))
                    : Promise.resolve(null),
                idConsultaExistente ? API.cargarMedicamentos(idConsultaExistente, signal).catch(() => null) : Promise.resolve(null)
            ];

            const [consultaData, preclinicaData] = await Promise.all(promises);

            if (consultaData && consultaData.success && consultaData.consulta) {
                const idConsulta = consultaData.consulta.ID_CONSULTA || consultaData.consulta.idConsulta;
                const btnImprimir = document.getElementById('btnImprimirConsulta');
                if (btnImprimir) btnImprimir.dataset.idConsulta = idConsulta;

                const cita = citas.find(c => String(c.ID_CITA) === String(idCita));
                const estado = cita ? String(cita.ESTADO || "").toUpperCase() : "";
                const btnFinalizar = document.getElementById('btnFinalizarConsulta');
                if (btnFinalizar) {
                    btnFinalizar.style.display = (estado !== 'FINALIZADA') ? 'inline-flex' : 'none';
                }
            } else {
                if ($("idConsulta")) $("idConsulta").value = "";
                ["motivoConsulta", "sintomasConsulta", "examenFisicoConsulta",
                    "diagnosticoPrincipal", "tratamiento", "recomendaciones",
                    "examenesComplementariosConsulta"
                ].forEach(campo => { const el = $(campo); if (el) el.value = ""; });
                const btnImprimir = document.getElementById('btnImprimirConsulta');
                if (btnImprimir) btnImprimir.dataset.idConsulta = '';
                const btnFinalizar = document.getElementById('btnFinalizarConsulta');
                if (btnFinalizar) btnFinalizar.style.display = 'none';
            }

            if (preclinicaData && preclinicaData.success && preclinicaData.preclinica) {
                const p = preclinicaData.preclinica;
                const set = (id, val) => {
                    const el = $(id);
                    if (el) el.value = val == null ? "" : String(val);
                };
                set("temperatura", p.TEMPERATURA ?? p.temperatura);
                set("presionSistolica", p.PRESION_SISTOLICA ?? p.presionSistolica);
                set("presionDiastolica", p.PRESION_DIASTOLICA ?? p.presionDiastolica);
                set("frecuenciaCardiaca", p.FRECUENCIA_CARDIACA ?? p.frecuenciaCardiaca);
                set("frecuenciaRespiratoria", p.FRECUENCIA_RESPIRATORIA ?? p.frecuenciaRespiratoria);
                set("saturacionOxigeno", p.SATURACION_OXIGENO ?? p.saturacionOxigeno);
                set("peso", p.PESO ?? p.peso);
                set("talla", p.TALLA ?? p.talla);
                set("glucosa", p.GLUCOSA ?? p.glucosa);
                set("perimetroAbdominal", p.PERIMETRO_ABDOMINAL ?? p.perimetroAbdominal);
                set("observaciones", p.OBSERVACIONES ?? p.observaciones);
                if ($("estadoGeneral")) $("estadoGeneral").value = p.ESTADO_GENERAL || p.estadoGeneral || "BUENO";
                
                const peso = parseFloat(p.PESO ?? p.peso) || 0;
                const talla = parseFloat(p.TALLA ?? p.talla) || 0;
                if (peso > 0 && talla > 0 && $("imc")) {
                    const tallaMetros = talla > 3 ? talla / 100 : talla;
                    const imcVal = (peso / (tallaMetros * tallaMetros)).toFixed(2);
                    $("imc").value = imcVal;
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Error cargando datos de la cita:", err);
            }
        } finally {
            cargandoDatos = false;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        cargarDatosIniciales();
    });
})();