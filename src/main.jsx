import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// PWA — recarga al activarse una versión nueva.
// Con registerType "autoUpdate" el service worker nuevo se descarga e instala
// solo, PERO la pestaña sigue ejecutando el código viejo hasta que se recarga.
// Las tablets de bodega quedan abiertas todo el día, así que los operarios
// podían seguir horas con una versión vieja: ya pasó dos veces (un cliente
// cacheado llamando endpoints ya blindados daba "no tienes permiso", y el
// arreglo de Compras no llegaba pese a estar desplegado).
// Cuando un SW NUEVO toma control, recargamos una sola vez.
if ("serviceWorker" in navigator) {
  // Si al arrancar no había controlador, es la primera instalación: en ese caso
  // controllerchange dispara igual y recargar sería un rebote innecesario.
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControlador || recargando) return;
    recargando = true;
    window.location.reload();
  });

  // ...pero recargar solo sirve si el navegador llega a DESCUBRIR que hay
  // versión nueva, y por su cuenta solo lo revisa en una navegación real. Esto
  // es una SPA que las tablets dejan abiertas días enteros: el enrutado interno
  // no cuenta como navegación, y las llamadas a Supabase van a otro dominio sin
  // pasar por el service worker. Resultado: una pestaña puede quedarse con el
  // mismo código durante días aunque el despliegue ya esté hecho.
  //
  // Fue la tercera vez que muerde. La última: el arreglo que devuelve el
  // diagnóstico inicial a la constancia de recepción se desplegó el 31/08 y dos
  // días después la dueña seguía imprimiendo la hoja sin él, con el código
  // correcto ya en producción y el texto guardado en la orden.
  //
  // Se pregunta explícitamente: al volver a la pestaña y cada 15 minutos.
  navigator.serviceWorker.ready
    .then((registro) => {
      const revisar = () => {
        // Sin foco no hay nadie mirando, y una recarga a ciegas podría caer en
        // mitad de un formulario a medio llenar.
        if (document.visibilityState !== "visible") return;
        registro.update().catch(() => {
          // Sin conexión o el servidor caído: se reintenta en la próxima vuelta.
        });
      };
      document.addEventListener("visibilitychange", revisar);
      window.addEventListener("focus", revisar);
      setInterval(revisar, 15 * 60 * 1000);
      revisar();
    })
    .catch(() => {
      // En desarrollo no hay service worker registrado; no hay nada que revisar.
    });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
