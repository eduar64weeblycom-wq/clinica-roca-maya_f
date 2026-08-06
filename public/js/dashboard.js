document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard JS inicializado correctamente.');

    // 1. Ejemplo para botones que abren modales de Bootstrap (si usas data-bs-toggle, Bootstrap ya los maneja, 
    // pero puedes agregar lógica adicional aquí si es necesario).

    // 2. Capturar clics en botones generales con una clase específica (ej: .btn-accion)
    const botonesAccion = document.querySelectorAll('.btn-accion');
    botonesAccion.forEach(boton => {
        boton.addEventListener('click', (e) => {
            const idObjeto = e.target.dataset.id;
            console.log('Botón presionado con ID:', idObjeto);
            // Aquí puedes agregar la lógica que necesites
        });
    });

    // 3. Manejar formularios o botones de eliminación/actualización si los hay
    const formularios = document.querySelectorAll('form');
    formularios.forEach(form => {
        form.addEventListener('submit', (e) => {
            // Validaciones previas si se requieren
        });
    });
});