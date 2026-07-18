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
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
