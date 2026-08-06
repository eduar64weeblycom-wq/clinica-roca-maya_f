// ============================================================
// MODAL DE REGISTRO DE USUARIO
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  
  // ============================================================
  // ELEMENTOS DEL MODAL
  // ============================================================
  const modalRegister = document.getElementById('modalRegister');
  const btnAbrirModal = document.getElementById('btnNuevoUsuario');
  const btnCerrarModal = document.getElementById('btnCerrarModalRegister');
  const btnCancelarModal = document.getElementById('btnCancelarRegister');
  const formRegister = document.getElementById('formRegisterModal');
  const btnGuardar = document.getElementById('btnGuardarRegister');

  // Campos del formulario
  const inputNombre = document.getElementById('regNombreCompleto');
  const inputUsuario = document.getElementById('regUsuario');
  const inputPassword = document.getElementById('regPassword');
  const inputConfirmPassword = document.getElementById('regConfirmPassword');
  const inputEmail = document.getElementById('regEmail');
  const inputRol = document.getElementById('regRol');

  // Elementos de feedback
  const passwordStrength = document.getElementById('regPasswordStrength');
  const passwordHelp = document.getElementById('regPasswordHelp');
  const errorContainer = document.getElementById('regErrorContainer');
  const errorMessage = document.getElementById('regErrorMessage');

  // ============================================================
  // FUNCIONES DE SEGURIDAD - MENSAJES MEJORADOS
  // ============================================================

  /**
   * Muestra la contraseña generada de forma segura
   * @param {string} contrasena - Contraseña generada
   */
  function mostrarContrasenaGenerada(contrasena) {
    const mensaje = `
🔐 CONTRASEÑA TEMPORAL GENERADA

📋 Su contraseña temporal es: ${contrasena}

⚠️ INSTRUCCIONES DE SEGURIDAD:

🔒 Esta contraseña es TEMPORAL
🔒 Debe cambiarla en el PRIMER inicio de sesión
🔒 NO comparta esta contraseña con nadie
🔒 Se ha enviado una copia a su correo electrónico
🔒 Guarde esta contraseña en un lugar seguro

📌 ¿Cómo cambiar su contraseña?
1. Inicie sesión con su usuario y contraseña temporal
2. Vaya al menú de configuración (⚙️)
3. Seleccione "Cambiar contraseña"
4. Elija una contraseña segura (mínimo 9 caracteres)
    `;
    
    alert(mensaje);
  }

  /**
   * Muestra mensaje de registro exitoso SIN mostrar la contraseña
   * @param {boolean} emailEnviado - Indica si el correo fue enviado
   */
  function mostrarRegistroExitoso(emailEnviado) {
    let mensaje = `
✅ REGISTRO EXITOSO

Usuario registrado correctamente en el sistema.
    `;

    if (emailEnviado) {
      mensaje += `
📧 Se ha enviado un correo con las credenciales de acceso.
📧 Revise su bandeja de entrada y spam.
      `;
    } else {
      mensaje += `
⚠️ No se pudo enviar el correo electrónico.
📋 Contacte al administrador para obtener sus credenciales.
      `;
    }

    mensaje += `

🔒 RECOMENDACIONES DE SEGURIDAD:

• Cambie su contraseña en el primer inicio de sesión
• No comparta sus credenciales con nadie
• Use una contraseña segura (9-15 caracteres)
• Incluya letras, números y símbolos

📌 Para iniciar sesión, visite: /auth/login
    `;
    
    alert(mensaje);
  }

  /**
   * Muestra mensaje de error de conexión
   * @param {string} mensajeError - Mensaje de error
   */
  function mostrarErrorConexion(mensajeError) {
    const mensaje = `
❌ ERROR DE CONEXIÓN

${mensajeError}

🔄 Por favor, intente nuevamente o contacte al administrador del sistema.
    `;
    alert(mensaje);
  }

  /**
   * Copia la contraseña al portapapeles y muestra confirmación
   * @param {string} contrasena - Contraseña a copiar
   */
  function copiarContrasena(contrasena) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(contrasena).then(() => {
        alert('✅ Contraseña copiada al portapapeles.\n\n🔒 Recuerda cambiarla en el primer inicio de sesión y NO compartirla con nadie.');
      }).catch(() => {
        // Fallback: seleccionar el texto
        const textarea = document.createElement('textarea');
        textarea.value = contrasena;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('✅ Contraseña copiada al portapapeles.');
      });
    } else {
      // Fallback para navegadores antiguos
      const textarea = document.createElement('textarea');
      textarea.value = contrasena;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('✅ Contraseña copiada al portapapeles.');
    }
  }

  // ============================================================
  // GENERAR CONTRASEÑA ALEATORIA
  // ============================================================
  function generarContrasenaAleatoria() {
    const mayusculas = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const minusculas = 'abcdefghijklmnopqrstuvwxyz';
    const numeros = '0123456789';
    const simbolos = '!@#$%&*';
    const todos = mayusculas + minusculas + numeros + simbolos;
    
    const longitud = 9;
    
    let contrasena = '';
    contrasena += mayusculas[Math.floor(Math.random() * mayusculas.length)];
    contrasena += minusculas[Math.floor(Math.random() * minusculas.length)];
    contrasena += numeros[Math.floor(Math.random() * numeros.length)];
    contrasena += simbolos[Math.floor(Math.random() * simbolos.length)];
    
    for (let i = contrasena.length; i < longitud; i++) {
      contrasena += todos[Math.floor(Math.random() * todos.length)];
    }
    
    return contrasena.split('').sort(() => Math.random() - 0.5).join('');
  }

  // ============================================================
  // CREAR BOTÓN GENERAR CONTRASEÑA
  // ============================================================
  const confirmPasswordGroup = inputConfirmPassword.closest('.form-group');
  
  if (confirmPasswordGroup) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'mt-2';
    btnContainer.style.width = '100%';
    
    const btnGenerarPassword = document.createElement('button');
    btnGenerarPassword.type = 'button';
    btnGenerarPassword.className = 'btn-generate-password';
    btnGenerarPassword.innerHTML = '<i class="fas fa-dice me-1"></i> Generar contraseña (9 caracteres)';
    btnGenerarPassword.id = 'btnGenerarPassword';
    
    btnContainer.appendChild(btnGenerarPassword);
    confirmPasswordGroup.appendChild(btnContainer);

    btnGenerarPassword.addEventListener('click', function() {
      const nuevaPassword = generarContrasenaAleatoria();
      inputPassword.value = nuevaPassword;
      inputConfirmPassword.value = nuevaPassword;
      
      actualizarIndicadorPassword();
      validarContraseña(nuevaPassword);
      validarConfirmacion();
      
      // ✅ Mostrar la contraseña generada de forma SEGURA
      mostrarContrasenaGenerada(nuevaPassword);
      
      // Feedback visual
      const originalHTML = this.innerHTML;
      this.innerHTML = '<i class="fas fa-check text-success me-1"></i> ¡Contraseña generada!';
      this.style.borderColor = '#28a745';
      this.style.color = '#28a745';
      
      setTimeout(() => {
        this.innerHTML = originalHTML;
        this.style.borderColor = '';
        this.style.color = '';
      }, 3000);
    });
  }

  // ============================================================
  // BOTÓN PARA COPIAR CONTRASEÑA
  // ============================================================
  const passwordWrapper = inputPassword.closest('.password-wrapper');
  if (passwordWrapper) {
    const btnCopiar = document.createElement('button');
    btnCopiar.type = 'button';
    btnCopiar.className = 'btn-copy-password';
    btnCopiar.innerHTML = '<i class="fas fa-copy"></i>';
    btnCopiar.title = 'Copiar contraseña';
    btnCopiar.style.cssText = `
      background: none;
      border: none;
      cursor: pointer;
      color: #6c757d;
      padding: 0 8px;
      font-size: 1rem;
      position: absolute;
      right: 35px;
      top: 50%;
      transform: translateY(-50%);
    `;
    
    btnCopiar.addEventListener('click', function() {
      const contrasena = inputPassword.value;
      if (contrasena) {
        copiarContrasena(contrasena);
      } else {
        alert('⚠️ No hay contraseña para copiar. Genera una primero.');
      }
    });
    
    passwordWrapper.style.position = 'relative';
    passwordWrapper.appendChild(btnCopiar);
  }

  // ============================================================
  // ABRIR MODAL
  // ============================================================
  if (btnAbrirModal) {
    btnAbrirModal.replaceWith(btnAbrirModal.cloneNode(true));
    const nuevoBtn = document.getElementById('btnNuevoUsuario');
    nuevoBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      abrirModal();
    });
  }

  function abrirModal() {
    modalRegister.style.display = 'flex';
    modalRegister.setAttribute('aria-hidden', 'false');
    formRegister.reset();
    limpiarErrores();
    
    if (passwordHelp) {
      passwordHelp.textContent = '🔒 Mínimo 9 caracteres, máximo 15. Debe incluir letras, números y un símbolo (@$!%*#?&)';
      passwordHelp.style.color = '#6c757d';
    }
    if (passwordStrength) {
      passwordStrength.style.width = '0%';
      passwordStrength.className = 'progress-bar';
    }
    
    document.querySelectorAll('.toggle-password-modal').forEach(btn => {
      btn.innerHTML = '<i class="fas fa-eye"></i>';
    });
  }

  // ============================================================
  // CERRAR MODAL
  // ============================================================
  function cerrarModal() {
    modalRegister.style.display = 'none';
    modalRegister.setAttribute('aria-hidden', 'true');
    formRegister.reset();
    limpiarErrores();
    
    if (passwordHelp) {
      passwordHelp.textContent = '🔒 Mínimo 9 caracteres, máximo 15. Debe incluir letras, números y un símbolo (@$!%*#?&)';
      passwordHelp.style.color = '#6c757d';
    }
    if (passwordStrength) {
      passwordStrength.style.width = '0%';
      passwordStrength.className = 'progress-bar';
    }
  }

  if (btnCerrarModal) {
    btnCerrarModal.addEventListener('click', cerrarModal);
  }

  if (btnCancelarModal) {
    btnCancelarModal.addEventListener('click', cerrarModal);
  }

  modalRegister.addEventListener('click', function(e) {
    if (e.target === modalRegister) {
      cerrarModal();
    }
  });

  // ============================================================
  // MOSTRAR/OCULTAR CONTRASEÑA
  // ============================================================
  document.querySelectorAll('.toggle-password-modal').forEach(btn => {
    btn.addEventListener('click', function() {
      const input = this.closest('.password-wrapper').querySelector('.password-field-modal');
      const icon = this.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    });
  });

  // ============================================================
  // VALIDACIONES EN TIEMPO REAL
  // ============================================================
  
  inputNombre.addEventListener('input', function() {
    this.value = this.value.toUpperCase();
    const valor = this.value;
    const limpio = valor.replace(/[^A-Za-zÁÉÍÓÚáéíóúñÑÜü\s]/g, '');
    if (valor !== limpio) {
      this.value = limpio;
    }
    limpiarError(this);
  });

  inputUsuario.addEventListener('input', function() {
    const valor = this.value;
    const limpio = valor.replace(/\s/g, '');
    if (valor !== limpio) {
      this.value = limpio;
    }
    limpiarError(this);
  });

  inputPassword.addEventListener('input', function() {
    const password = this.value;
    actualizarIndicadorPassword();
    validarContraseña(password);
    
    if (inputConfirmPassword.value.length > 0) {
      validarConfirmacion();
    }
  });

  inputConfirmPassword.addEventListener('input', function() {
    const confirmValue = this.value;
    const passwordValue = inputPassword.value;
    
    if (passwordValue.length > 0 && confirmValue.length > 0) {
      validarConfirmacion();
    } else if (confirmValue.length === 0) {
      limpiarError(this);
      const successDiv = this.parentElement.querySelector('.field-success');
      if (successDiv) successDiv.remove();
    }
  });

  inputEmail.addEventListener('blur', function() {
    if (this.value && !esEmailValido(this.value)) {
      mostrarError(this, '📧 Ingrese un correo electrónico válido');
    } else {
      limpiarError(this);
    }
  });

  // ============================================================
  // FUNCIONES DE VALIDACIÓN
  // ============================================================
  function esEmailValido(email) {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
  }

  function validarContraseña(password) {
    const regex = /^.{9,15}$/;
    
    limpiarError(inputPassword);
    
    if (password && !regex.test(password)) {
      mostrarError(inputPassword, '⚠️ La contraseña debe tener entre 9 y 15 caracteres');
      if (passwordHelp) {
        passwordHelp.textContent = '⚠️ La contraseña debe tener entre 9 y 15 caracteres';
        passwordHelp.style.color = '#dc3545';
      }
      return false;
    } else if (password && regex.test(password)) {
      if (passwordHelp) {
        passwordHelp.textContent = '✅ Longitud válida (9-15 caracteres)';
        passwordHelp.style.color = '#28a745';
      }
      return true;
    } else {
      if (passwordHelp) {
        passwordHelp.textContent = '🔒 Mínimo 9 caracteres, máximo 15. Debe incluir letras, números y un símbolo (@$!%*#?&)';
        passwordHelp.style.color = '#6c757d';
      }
      return false;
    }
  }

  function validarConfirmacion() {
    const password = inputPassword.value;
    const confirmPassword = inputConfirmPassword.value;
    
    if (!password || !confirmPassword) {
      limpiarError(inputConfirmPassword);
      const successDiv = inputConfirmPassword.parentElement.querySelector('.field-success');
      if (successDiv) successDiv.remove();
      return true;
    }
    
    const regex = /^.{9,15}$/;
    if (!regex.test(password)) {
      limpiarError(inputConfirmPassword);
      const successDiv = inputConfirmPassword.parentElement.querySelector('.field-success');
      if (successDiv) successDiv.remove();
      return false;
    }
    
    if (confirmPassword !== password) {
      mostrarError(inputConfirmPassword, '❌ Las contraseñas no coinciden');
      const successDiv = inputConfirmPassword.parentElement.querySelector('.field-success');
      if (successDiv) successDiv.remove();
      return false;
    } else {
      limpiarError(inputConfirmPassword);
      let successDiv = inputConfirmPassword.parentElement.querySelector('.field-success');
      if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.className = 'field-success';
        inputConfirmPassword.parentElement.appendChild(successDiv);
      }
      successDiv.textContent = '✅ Las contraseñas coinciden';
      successDiv.style.color = '#28a745';
      successDiv.style.fontSize = '12px';
      successDiv.style.marginTop = '4px';
      return true;
    }
  }

  // ============================================================
  // INDICADOR DE FORTALEZA
  // ============================================================
  function actualizarIndicadorPassword() {
    const password = inputPassword.value;
    const strength = document.getElementById('regPasswordStrength');
    const help = document.getElementById('regPasswordHelp');
    
    if (!password) {
      if (strength) {
        strength.style.width = '0%';
        strength.className = 'progress-bar';
      }
      if (help) {
        help.textContent = '🔒 Mínimo 9 caracteres, máximo 15. Debe incluir letras, números y un símbolo (@$!%*#?&)';
        help.style.color = '#6c757d';
      }
      return;
    }

    let puntos = 0;
    if (password.length >= 9) puntos++;
    if (password.length >= 12) puntos++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) puntos++;
    if (/\d/.test(password)) puntos++;
    if (/[@$!%*#?&]/.test(password)) puntos++;

    let porcentaje = Math.min((puntos / 5) * 100, 100);
    if (strength) {
      strength.style.width = porcentaje + '%';
    }

    if (puntos <= 2) {
      if (strength) strength.className = 'progress-bar bg-danger';
      if (help) {
        help.textContent = '⚠️ Contraseña débil (usa más variedad)';
        help.style.color = '#dc3545';
      }
    } else if (puntos <= 3) {
      if (strength) strength.className = 'progress-bar bg-warning';
      if (help) {
        help.textContent = '⚠️ Contraseña media';
        help.style.color = '#856404';
      }
    } else if (puntos <= 4) {
      if (strength) strength.className = 'progress-bar bg-info';
      if (help) {
        help.textContent = '✅ Contraseña fuerte';
        help.style.color = '#0c5460';
      }
    } else {
      if (strength) strength.className = 'progress-bar bg-success';
      if (help) {
        help.textContent = '✅ Contraseña muy fuerte';
        help.style.color = '#155724';
      }
    }
  }

  // ============================================================
  // MOSTRAR/OCULTAR ERRORES
  // ============================================================
  function mostrarError(input, mensaje) {
    input.classList.add('input-error');
    
    const successDiv = input.parentElement.querySelector('.field-success');
    if (successDiv) successDiv.remove();
    
    let errorDiv = input.parentElement.querySelector('.field-error');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.className = 'field-error';
      input.parentElement.appendChild(errorDiv);
    }
    errorDiv.textContent = mensaje;
    errorDiv.style.color = '#dc3545';
    errorDiv.style.fontSize = '12px';
    errorDiv.style.marginTop = '4px';
  }

  function limpiarError(input) {
    input.classList.remove('input-error');
    const errorDiv = input.parentElement.querySelector('.field-error');
    if (errorDiv) {
      errorDiv.remove();
    }
  }

  function limpiarErrores() {
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.field-error').forEach(el => el.remove());
    document.querySelectorAll('.field-success').forEach(el => el.remove());
    if (errorContainer) {
      errorContainer.style.display = 'none';
      errorMessage.textContent = '';
    }
  }

  function mostrarErrorGeneral(mensaje) {
    if (errorContainer) {
      errorContainer.style.display = 'block';
      errorMessage.textContent = mensaje;
      setTimeout(() => {
        errorContainer.style.display = 'none';
      }, 5000);
    }
  }

  // ============================================================
  // ENVÍO DEL FORMULARIO - CON SEGURIDAD MEJORADA
  // ============================================================
  formRegister.addEventListener('submit', async function(e) {
    e.preventDefault();
    limpiarErrores();

    const nombre = inputNombre.value.trim();
    const usuario = inputUsuario.value.trim();
    const password = inputPassword.value;
    const confirmPassword = inputConfirmPassword.value;
    const email = inputEmail.value.trim();
    const rol = inputRol.value;

    // Validaciones
    let valid = true;

    if (!nombre) {
      mostrarError(inputNombre, '❌ Nombre completo es obligatorio');
      valid = false;
    } else if (!/^[A-Za-zÁÉÍÓÚáéíóúñÑÜü\s]+$/.test(nombre)) {
      mostrarError(inputNombre, '❌ Solo letras y espacios');
      valid = false;
    }

    if (!usuario) {
      mostrarError(inputUsuario, '❌ Usuario es obligatorio');
      valid = false;
    } else if (/\s/.test(usuario)) {
      mostrarError(inputUsuario, '❌ No se permiten espacios');
      valid = false;
    }

    if (!email) {
      mostrarError(inputEmail, '❌ Correo es obligatorio');
      valid = false;
    } else if (!esEmailValido(email)) {
      mostrarError(inputEmail, '❌ Formato de correo inválido');
      valid = false;
    }

    const regex = /^.{9,15}$/;
    if (!password) {
      mostrarError(inputPassword, '❌ Contraseña es obligatoria');
      valid = false;
    } else if (!regex.test(password)) {
      mostrarError(inputPassword, '⚠️ La contraseña debe tener entre 9 y 15 caracteres');
      valid = false;
    }

    if (password && regex.test(password)) {
      if (!confirmPassword) {
        mostrarError(inputConfirmPassword, '❌ Confirmar contraseña es obligatorio');
        valid = false;
      } else if (password !== confirmPassword) {
        mostrarError(inputConfirmPassword, '❌ Las contraseñas no coinciden');
        valid = false;
      }
    }

    if (!valid) return;

    // Deshabilitar botón
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Registrando...';

    try {
      const response = await fetch('/auth/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nombre_completo: nombre,
          usuario: usuario,
          contrasena: password,
          confirm_contrasena: confirmPassword,
          correo_electronico: email,
          id_rol: rol || 5
        })
      });

      const result = await response.json();

      if (result.success) {
        // ✅ MOSTRAR MENSAJE DE REGISTRO EXITOSO SIN CONTRASEÑA
        mostrarRegistroExitoso(result.email_enviado === true);
        cerrarModal();
        window.location.reload();
      } else {
        mostrarErrorGeneral(result.error || '❌ Error al registrar usuario');
      }
    } catch (error) {
      console.error('Error:', error);
      mostrarErrorConexion('Error de conexión: ' + error.message);
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = '<i class="fas fa-save"></i> Registrar Usuario';
    }
  });

});