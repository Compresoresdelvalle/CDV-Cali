import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  ArrowRight,
  Check,
  Info,
  Search,
  ScanLine,
  Trash2,
  Truck,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch } from "../../lib/utils";
import { carritoDesdeReorden, sedesDeSugerencias } from "../../lib/compras-ui";
import { avisarOk, avisarError } from "../../lib/notify";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import UbicacionChip from "../../components/ui/UbicacionChip";
import QRScanner from "../../components/forms/QRScanner";
import NumeroInput from "../../components/forms/NumeroInput";

const IVA_DEFAULT = 19;
const IVA_PRESETS = [0, 19];

export default function CompraNueva() {
  const navigate = useNavigate();
  const location = useLocation();
  const perfil = useAuthStore((s) => s.perfil);
  // Al Vendedor nunca se le muestra/precarga el costo histórico del producto:
  // lo digita manualmente (arranca en 0).
  const esVendedor = perfil?.rol === "Vendedor";

  const [modo, setModo] = useState("normal"); // #31: 'normal' | 'caja_menor'
  const [proveedor, setProveedor] = useState("");
  const [facturaProveedor, setFacturaProveedor] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [recibirAhora, setRecibirAhora] = useState(false);
  const [ivaPct, setIvaPct] = useState(IVA_DEFAULT);
  // B9 — forma de pago (incl. CRÉDITO), cuenta destino real y descuento $.
  const [metodoPago, setMetodoPago] = useState("Efectivo");
  const [cuentaBancaria, setCuentaBancaria] = useState("");
  const [descuentoValor, setDescuentoValor] = useState(0);
  const [cuentasBanco, setCuentasBanco] = useState([]);
  useEffect(() => {
    supabase
      .from("cuentas_bancarias")
      .select("id, banco, tipo, numero, titular")
      .eq("activo", true)
      .order("banco")
      .then(({ data }) => setCuentasBanco(data ?? []));
  }, []);
  const [concepto, setConcepto] = useState(""); // #31 caja menor
  const [monto, setMonto] = useState(""); // #31 caja menor (total manual)
  // estado_compra removido del form: se asigna 'completada' en BD por default.
  // Las garantías se gestionarán desde la compra ya recibida (Fase 13).

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false); // C-05: escáner QR

  const [carrito, setCarrito] = useState([]);

  // Sedes de las que venían las sugerencias de Reorden, para el aviso de que
  // la compra se registra en la sede del usuario y no en la de la sugerencia.
  const [sedesOrigen, setSedesOrigen] = useState([]);

  // Precarga del carrito desde Reorden ("Generar orden de compra").
  //
  // Se hace una sola vez. Si el usuario ya empezó a armar el carrito no se le
  // pisa, y se limpia el state del historial para que un F5 no vuelva a
  // precargar encima de lo que ya haya.
  const precargaHecha = useRef(false);
  useEffect(() => {
    if (precargaHecha.current) return;
    const sug = location.state?.sugerenciasReorden;
    if (!Array.isArray(sug) || sug.length === 0) return;
    precargaHecha.current = true;

    setCarrito(carritoDesdeReorden(sug, { esVendedor }));
    setSedesOrigen(sedesDeSugerencias(sug));
    // Limpia el state DENTRO del router. Un `window.history.replaceState({}, "")`
    // borra también el `idx` y el `key` internos de react-router, y a partir de
    // ahí el índice del historial queda en NaN y no se recupera ni con F5.
    navigate(".", { replace: true, state: null });
  }, [location.state, esVendedor, navigate]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);
  // COMP-06: token de secuencia — una respuesta lenta de una búsqueda vieja
  // no debe pisar los resultados de una más nueva (mismo patrón del Historial).
  const busquedaReqRef = useRef(0);

  const buscarProductos = useCallback(
    async (q) => {
      const myReq = ++busquedaReqRef.current;
      if (!q || q.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data, error: e } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, costo_promedio, unidad_medida, vendible",
          )
          .eq("activo", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(1000);
        if (e) throw e;
        // Ubicación física en la sede que recibe la compra (solo referencia
        // visual; no afecta la lógica de recepción).
        let ubicMap = {};
        if (data?.length && perfil?.sede_id) {
          const { data: inv } = await supabase
            .from("inventario")
            .select("producto_id, ubicacion_id")
            .eq("sede_id", perfil.sede_id)
            .in(
              "producto_id",
              data.map((p) => p.id),
            );
          ubicMap = Object.fromEntries(
            (inv ?? []).map((i) => [i.producto_id, i.ubicacion_id]),
          );
        }
        if (myReq !== busquedaReqRef.current) return; // respuesta obsoleta
        setResultados(
          (data ?? []).map((p) => ({
            ...p,
            ubicacion_id: ubicMap[p.id] ?? null,
          })),
        );
      } catch {
        if (myReq === busquedaReqRef.current) setResultados([]);
      } finally {
        if (myReq === busquedaReqRef.current) setBuscando(false);
      }
    },
    [perfil?.sede_id],
  );

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  // C-05: escaneo QR para agregar un producto al pedido (como en Ventas).
  // #C2-1: antes un inactivo/inexistente o un error de red terminaban en el
  // mismo `return` mudo — el operario veía "Código encontrado" y no pasaba
  // nada. Ahora se distingue cada caso y se avisa (mismo criterio que
  // VentaNueva #S1-19). No se cierra el escáner aquí: en modo continuo lo
  // mantiene abierto el propio QRScanner para encadenar la siguiente lectura.
  const handleQRFound = useCallback(async (productoId) => {
    try {
      const { data, error: e } = await supabase
        .from("productos")
        .select(
          "id, nombre, referencia, costo_promedio, unidad_medida, vendible",
        )
        .eq("id", productoId)
        .eq("activo", true)
        .maybeSingle();
      if (e) throw e;
      if (!data) {
        // Toast además del texto fijo: en modo continuo el escáner tapa toda
        // la pantalla, así que el `setError` de abajo no se ve hasta cerrarlo.
        const msg =
          "Ese código no corresponde a un producto activo (no existe o está inactivo).";
        setError(msg);
        avisarError(msg);
        return;
      }
      setError(null);
      agregarAlCarrito(data);
    } catch (err) {
      avisarError(
        err,
        "No se pudo leer el producto escaneado. Revisa la conexión e intenta de nuevo.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto_id === prod.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          unidad: prod.unidad_medida,
          cantidad: 1,
          // Vendedor: nunca el costo histórico → arranca en 0 (manual).
          costo_unitario: esVendedor ? 0 : (prod.costo_promedio ?? 0),
          // Default inteligente: un producto no-vendible (insumo de catálogo)
          // entra como insumo; el resto, como stock de venta. Editable.
          destino: prod.vendible === false ? "insumo" : "venta",
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) => {
          if (i.producto_id !== productoId) return i;
          return { ...i, cantidad: Math.max(0, i.cantidad + delta) };
        })
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    // Se clampa a [1, 100000]; teclear 0 NO elimina la fila (eso es la X).
    const clamped = Math.min(100000, Math.max(1, n));
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, cantidad: clamped },
      ),
    );
  };

  const setCostoDirecto = (productoId, valor) => {
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0 || n > 99999999) return;
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, costo_unitario: n },
      ),
    );
  };

  const setDestino = (productoId, destino) => {
    setCarrito((prev) =>
      prev.map((i) => (i.producto_id !== productoId ? i : { ...i, destino })),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.costo_unitario,
    0,
  );
  // B9: descuento en $ (clamp a [0, subtotal]); reduce la base gravable.
  const descuento = Math.min(Math.max(0, descuentoValor), subtotal);
  const iva = (subtotal - descuento) * (ivaPct / 100);
  const total = subtotal - descuento + iva;
  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);

  // Pasos del wizard: el paso "Proveedor" se considera completo cuando hay
  // nombre; "Productos" activo cuando hay al menos un item; el envío final
  // (registrar) hace las veces del paso "Confirmación".
  const pasoProveedor = proveedor.trim().length > 0;
  const pasoProductos = carrito.length > 0;

  const guardarCompra = async () => {
    if (!proveedor.trim()) {
      setError("El proveedor es obligatorio.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    // B9: en pagos electrónicos la cuenta destino es obligatoria.
    if (
      (metodoPago === "Transferencia" || metodoPago === "Tarjeta") &&
      !cuentaBancaria
    ) {
      setError("Selecciona la cuenta bancaria desde donde se pagó.");
      return;
    }
    // Guard síncrono: el `disabled` de React no evita el doble-clic veloz.
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      // RPC server-authoritative: registra compra + detalle en una sola
      // transacción, fija `registrado_por` y recalcula los totales.
      const { error: rpcErr } = await supabase.rpc("fn_registrar_compra", {
        p_sede_id: perfil?.sede_id,
        p_proveedor: proveedor.trim(),
        p_factura_proveedor: facturaProveedor.trim() || null,
        p_observaciones: observaciones.trim() || null,
        p_recibir: recibirAhora,
        p_items: carrito.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.cantidad,
          costo_unitario: i.costo_unitario,
          destino: i.destino ?? "venta",
        })),
        p_iva_pct: ivaPct,
        p_metodo_pago: metodoPago,
        p_cuenta_bancaria: cuentaBancaria || null,
        p_descuento_valor: descuento,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      avisarOk(
        recibirAhora ? "Compra registrada y recibida." : "Compra registrada.",
      );
      navigate("/ops/compras");
    } catch (e) {
      avisarError(e, "Error al guardar la compra");
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  // #31 — registrar una compra de CAJA MENOR (concepto + monto, no inventariable).
  const guardarCajaMenor = async () => {
    const m = Number(monto);
    if (!concepto.trim()) {
      setError("El concepto es obligatorio.");
      return;
    }
    if (!m || m <= 0) {
      setError("Ingresa un monto mayor a 0.");
      return;
    }
    // S6-E: caja menor con método real (antes siempre quedaba 'Efectivo').
    const esElectronico = ["Transferencia", "Tarjeta"].includes(metodoPago);
    if (esElectronico && !cuentaBancaria) {
      setError("Selecciona la cuenta bancaria para pagos electrónicos.");
      return;
    }
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setError(null);
    setGuardando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_caja_menor", {
        p_sede_id: perfil?.sede_id,
        p_concepto: concepto.trim(),
        p_monto: m,
        p_proveedor: proveedor.trim() || null,
        p_observaciones: observaciones.trim() || null,
        p_metodo_pago: metodoPago,
        p_cuenta_bancaria: esElectronico ? cuentaBancaria : null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      avisarOk("Gasto de caja menor registrado.");
      navigate("/ops/compras");
    } catch (e) {
      avisarError(e, "Error al registrar la caja menor");
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 px-4 pb-14 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/compras")}
        className="back-btn inline-flex w-fit items-center gap-1.5"
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Compras
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-3.5"
        style={{ borderColor: "var(--n-100)" }}
      >
        <div>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva compra
          </h1>
          <div className="mt-1 text-[13px]" style={{ color: "var(--n-500)" }}>
            Sede destino{" "}
            <b className="font-medium" style={{ color: "var(--n-700)" }}>
              {perfil?.sede_id ?? "—"}
            </b>{" "}
            · IVA {ivaPct}%{ivaPct === 0 ? " (exento)" : ""}
          </div>
        </div>
        <button
          onClick={() => navigate("/ops/compras")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Aviso de sede al venir desde Reorden ─────────────────────────
          La compra se registra SIEMPRE en la sede del usuario (fn_registrar_compra
          recibe una sola sede). Si las sugerencias venían de otras sedes, la
          mercancía va a quedar aquí y hay que traspasarla: mejor decirlo ahora
          que dejar que la busquen donde no está. */}
      {sedesOrigen.some((s) => s !== perfil?.sede_id) && (
        <div
          className="flex items-start gap-2.5 rounded-[10px] border px-4 py-3"
          style={{
            backgroundColor: "var(--info-50)",
            borderColor: "var(--info-border)",
          }}
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: "var(--info-600)" }}
            aria-hidden="true"
          />
          <p className="m-0 text-sm" style={{ color: "var(--info-700)" }}>
            Esta compra se registrará en{" "}
            <b className="font-semibold">{perfil?.sede_id ?? "—"}</b>. Las
            sugerencias venían de{" "}
            <b className="font-semibold">{sedesOrigen.join(", ")}</b>: cuando
            llegue la mercancía habrá que traspasarla.
          </p>
        </div>
      )}

      {/* ── Selector de tipo de compra (#31) ─────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { v: "normal", t: "Compra normal" },
          { v: "caja_menor", t: "Caja menor" },
        ].map((m) => {
          const on = modo === m.v;
          return (
            <button
              key={m.v}
              type="button"
              onClick={() => {
                setModo(m.v);
                // Caja menor no admite 'Crédito' (se paga en el acto): si venía
                // seleccionado de la compra normal, cae a Efectivo.
                if (m.v === "caja_menor" && metodoPago === "Crédito") {
                  setMetodoPago("Efectivo");
                  setCuentaBancaria("");
                }
              }}
              className="rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
              style={{
                minHeight: 40,
                borderColor: on ? "var(--p-500)" : "var(--n-200)",
                backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                color: on ? "#fff" : "var(--n-700)",
              }}
            >
              {m.t}
            </button>
          );
        })}
      </div>

      {/* ── Stepper (solo compra normal) ─────────────────────────────── */}
      {modo === "normal" && (
        <div className="stepper">
          <Step
            n={1}
            label="Proveedor"
            state={pasoProveedor ? "done" : "active"}
          />
          <Line done={pasoProveedor} />
          <Step
            n={2}
            label="Productos"
            state={pasoProductos ? "done" : pasoProveedor ? "active" : "todo"}
          />
          <Line done={pasoProductos} />
          <Step
            n={3}
            label="Confirmación"
            state={pasoProveedor && pasoProductos ? "active" : "todo"}
          />
        </div>
      )}

      {/* ── Wizard grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5">
          {/* Proveedor */}
          <div className="iblock flex flex-col gap-3.5">
            <div className="ib-head">
              <div className="ib-ico">
                <Truck className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="ib-title">Datos del proveedor</div>
            </div>
            <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
              <Field label="Proveedor" req={modo === "normal"}>
                <input
                  type="text"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  placeholder={
                    modo === "normal"
                      ? "Nombre del proveedor"
                      : "Opcional (caja menor)"
                  }
                  className="finput sans"
                />
              </Field>
              <Field label="N° factura del proveedor">
                <input
                  type="text"
                  value={facturaProveedor}
                  onChange={(e) => setFacturaProveedor(e.target.value)}
                  placeholder="Opcional"
                  className="finput sans"
                />
              </Field>
            </div>
          </div>

          {/* Productos (solo compra normal) */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <Search className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Productos a ordenar</div>
                <div className="ib-aux">{carrito.length} en la orden</div>
              </div>

              {/* Búsqueda. C2-3: el botón de escanear era de 32x32 (h-8 w-8);
                  CLAUDE.md exige mínimo 48px por uso con guantes. Se saca del
                  buscador a un botón hermano de 48x48, igual que en
                  TraspasoNuevo/EnsambleNuevo, para no apretarlo dentro de una
                  fila de 44px. */}
              <div className="flex items-center gap-2">
                <div
                  className="flex h-12 flex-1 items-center gap-2.5 rounded-[10px] border px-3.5"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-0)",
                  }}
                >
                  <Search
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.5}
                    style={{ color: "var(--n-300)" }}
                  />
                  <input
                    type="text"
                    value={busqueda}
                    onChange={handleBusquedaChange}
                    placeholder="Buscar por nombre o referencia del catálogo…"
                    className="flex-1 border-none bg-transparent text-[14px] outline-none"
                    style={{ color: "var(--n-700)" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  aria-label="Escanear código QR"
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border transition-colors"
                  style={{
                    borderColor: "var(--n-150)",
                    backgroundColor: "var(--n-0)",
                    color: "var(--p-700)",
                  }}
                >
                  <ScanLine className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </div>

              {buscando && (
                <p className="text-xs" style={{ color: "var(--n-500)" }}>
                  Buscando…
                </p>
              )}

              {resultados.length > 0 && (
                <div
                  className="max-h-80 overflow-y-auto rounded-lg border"
                  style={{ borderColor: "var(--n-150)" }}
                >
                  {resultados.map((r, idx) => (
                    <button
                      key={r.id}
                      onClick={() => agregarAlCarrito(r)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                      style={{
                        borderTop:
                          idx === 0 ? "none" : "1px solid var(--n-100)",
                        backgroundColor: "var(--n-0)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-50)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--n-0)")
                      }
                    >
                      <div>
                        <p
                          className="flex items-center gap-1.5 text-sm font-medium"
                          style={{ color: "var(--n-950)" }}
                        >
                          {r.nombre}
                          <UbicacionChip codigo={r.ubicacion_id} />
                        </p>
                        <p
                          className="font-mono text-[11px]"
                          style={{ color: "var(--n-500)" }}
                        >
                          {r.referencia} · {r.unidad_medida}
                        </p>
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: "var(--p-600)" }}
                      >
                        + Agregar
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Carrito */}
              {carrito.length === 0 ? (
                <p
                  className="rounded-[10px] border border-dashed py-10 text-center text-sm"
                  style={{
                    borderColor: "var(--n-200)",
                    backgroundColor: "var(--n-25)",
                    color: "var(--n-500)",
                  }}
                >
                  Busca y agrega productos a la orden de compra
                </p>
              ) : (
                <>
                  {/* Desktop: tabla */}
                  <div
                    className="hidden overflow-hidden rounded-[10px] border md:block"
                    style={{ borderColor: "var(--n-150)" }}
                  >
                    <table className="prod-tbl w-full">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th style={{ width: 168 }}>Destino</th>
                          <th className="r" style={{ width: 130 }}>
                            Cantidad
                          </th>
                          <th className="r" style={{ width: 140 }}>
                            Costo unit
                          </th>
                          <th className="r" style={{ width: 120 }}>
                            Subtotal
                          </th>
                          <th style={{ width: 42 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {carrito.map((item) => (
                          <tr key={item.producto_id}>
                            <td>
                              <p
                                className="text-[12.5px] font-medium leading-tight"
                                style={{ color: "var(--n-950)" }}
                              >
                                {item.nombre}
                              </p>
                              <p
                                className="font-mono text-[11px]"
                                style={{ color: "var(--n-500)" }}
                              >
                                {item.referencia}
                              </p>
                            </td>
                            <td>
                              <DestinoToggle
                                value={item.destino}
                                onChange={(d) =>
                                  setDestino(item.producto_id, d)
                                }
                              />
                            </td>
                            <td className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <QtyBtn
                                  onClick={() =>
                                    actualizarCantidad(item.producto_id, -1)
                                  }
                                >
                                  −
                                </QtyBtn>
                                <NumeroInput
                                  min={1}
                                  max={100000}
                                  value={item.cantidad}
                                  onChange={(n) =>
                                    setCantidadDirecta(item.producto_id, n)
                                  }
                                  className="w-12 rounded-lg border py-1 text-center font-mono text-sm font-semibold outline-none"
                                  style={{
                                    borderColor: "var(--n-150)",
                                    color: "var(--n-950)",
                                    backgroundColor: "var(--n-0)",
                                  }}
                                />
                                <QtyBtn
                                  onClick={() =>
                                    actualizarCantidad(item.producto_id, 1)
                                  }
                                >
                                  +
                                </QtyBtn>
                              </div>
                            </td>
                            <td className="text-right">
                              <NumeroInput
                                min={0}
                                max={99999999}
                                step="100"
                                value={item.costo_unitario}
                                onChange={(n) =>
                                  setCostoDirecto(item.producto_id, n)
                                }
                                className="w-32 rounded-lg border px-3 py-1.5 text-right font-mono text-sm outline-none"
                                style={{
                                  borderColor: "var(--n-150)",
                                  color: "var(--n-950)",
                                  backgroundColor: "var(--n-0)",
                                }}
                              />
                            </td>
                            <td className="text-right">
                              <span
                                className="font-mono text-sm font-semibold tabular-nums"
                                style={{ color: "var(--n-950)" }}
                              >
                                {formatCOP(item.cantidad * item.costo_unitario)}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => eliminarItem(item.producto_id)}
                                className="grid h-8 w-8 place-items-center rounded-lg transition-colors"
                                style={{ color: "var(--n-500)" }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color =
                                    "var(--dang-600)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = "var(--n-500)")
                                }
                                aria-label="Eliminar producto"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: cards */}
                  <div className="space-y-2.5 md:hidden">
                    {carrito.map((item) => (
                      <div
                        key={item.producto_id}
                        className="space-y-2 rounded-[10px] border p-3"
                        style={{
                          backgroundColor: "var(--n-0)",
                          borderColor: "var(--n-150)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-sm font-medium"
                              style={{ color: "var(--n-950)" }}
                            >
                              {item.nombre}
                            </p>
                            <p
                              className="font-mono text-[11px]"
                              style={{ color: "var(--n-500)" }}
                            >
                              {item.referencia}
                            </p>
                          </div>
                          <button
                            onClick={() => eliminarItem(item.producto_id)}
                            className="shrink-0"
                            style={{ color: "var(--n-500)" }}
                            aria-label="Eliminar producto"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                        <DestinoToggle
                          value={item.destino}
                          onChange={(d) => setDestino(item.producto_id, d)}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1">
                            <QtyBtn
                              onClick={() =>
                                actualizarCantidad(item.producto_id, -1)
                              }
                            >
                              −
                            </QtyBtn>
                            <NumeroInput
                              min={1}
                              max={100000}
                              value={item.cantidad}
                              onChange={(n) =>
                                setCantidadDirecta(item.producto_id, n)
                              }
                              className="w-14 rounded-lg border py-1.5 text-center font-mono text-sm font-semibold outline-none"
                              style={{
                                borderColor: "var(--n-150)",
                                color: "var(--n-950)",
                                backgroundColor: "var(--n-0)",
                              }}
                            />
                            <QtyBtn
                              onClick={() =>
                                actualizarCantidad(item.producto_id, 1)
                              }
                            >
                              +
                            </QtyBtn>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-xs"
                              style={{ color: "var(--n-500)" }}
                            >
                              $
                            </span>
                            <NumeroInput
                              min={0}
                              max={99999999}
                              step="100"
                              value={item.costo_unitario}
                              onChange={(n) =>
                                setCostoDirecto(item.producto_id, n)
                              }
                              className="w-28 rounded-lg border px-2 py-1.5 font-mono text-sm outline-none"
                              style={{
                                borderColor: "var(--n-150)",
                                color: "var(--n-950)",
                                backgroundColor: "var(--n-0)",
                              }}
                            />
                          </div>
                          <span
                            className="ml-auto font-mono text-sm font-bold tabular-nums"
                            style={{ color: "var(--n-950)" }}
                          >
                            {formatCOP(item.cantidad * item.costo_unitario)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* IVA de la compra (solo compra normal) — paridad con Ventas */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3">
              <div className="ib-head">
                <div className="ib-title">IVA de la compra</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {IVA_PRESETS.map((p) => {
                  const on = ivaPct === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setIvaPct(p)}
                      className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                      style={{
                        minHeight: 36,
                        borderColor: on ? "var(--p-400)" : "var(--n-200)",
                        backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                        color: on ? "#fff" : "var(--n-700)",
                      }}
                    >
                      {p === 0 ? "Exento (0%)" : `${p}%`}
                    </button>
                  );
                })}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ivaPct}
                  onChange={(e) =>
                    setIvaPct(
                      Math.min(100, Math.max(0, Number(e.target.value))),
                    )
                  }
                  className="finput"
                  style={{ width: 80, textAlign: "center" }}
                  aria-label="IVA porcentaje"
                />
              </div>
            </div>
          )}

          {/* B9 — Forma de pago + cuenta + descuento (solo compra normal) */}
          {modo === "normal" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-title">Pago de la compra</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Efectivo", "Transferencia", "Tarjeta", "Crédito"].map(
                  (m) => {
                    const on = metodoPago === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMetodoPago(m);
                          if (m === "Efectivo" || m === "Crédito")
                            setCuentaBancaria("");
                        }}
                        className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                        style={{
                          minHeight: 40,
                          borderColor: on ? "var(--p-400)" : "var(--n-200)",
                          backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                          color: on ? "#fff" : "var(--n-700)",
                        }}
                      >
                        {m}
                      </button>
                    );
                  },
                )}
              </div>
              {metodoPago === "Crédito" && (
                <p className="text-xs" style={{ color: "var(--warn-700)" }}>
                  Compra a crédito: queda como pendiente de pago al proveedor.
                </p>
              )}

              {(metodoPago === "Transferencia" || metodoPago === "Tarjeta") && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <label
                    htmlFor="compra-cuenta"
                    className="text-sm"
                    style={{ color: "var(--n-500)" }}
                  >
                    Cuenta bancaria
                    <span style={{ color: "var(--dang-700)" }}> *</span>
                  </label>
                  <select
                    id="compra-cuenta"
                    value={cuentaBancaria}
                    onChange={(e) => setCuentaBancaria(e.target.value)}
                    className="h-10 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                    style={{
                      borderColor: "var(--n-200)",
                      color: "var(--n-950)",
                    }}
                  >
                    <option value="">Sin especificar</option>
                    {cuentasBanco.map((c) => {
                      const ref = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;
                      return (
                        <option key={c.id} value={ref}>
                          {ref}
                        </option>
                      );
                    })}
                  </select>
                  {!cuentaBancaria && (
                    <span
                      className="text-[11.5px]"
                      style={{ color: "var(--dang-700)" }}
                    >
                      {cuentasBanco.length === 0
                        ? "No hay cuentas activas. El Admin debe crearlas en Configuración."
                        : "Obligatorio: indica desde qué cuenta se pagó"}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm" style={{ color: "var(--n-500)" }}>
                  Descuento $
                </label>
                <NumeroInput
                  min={0}
                  step="1000"
                  value={descuentoValor}
                  onChange={(n) => setDescuentoValor(Math.max(0, n))}
                  className="finput"
                  style={{ width: 140, textAlign: "center" }}
                  aria-label="Descuento en pesos"
                />
                <span
                  className="text-[11.5px]"
                  style={{ color: "var(--n-500)" }}
                >
                  Se resta del subtotal antes del IVA.
                </span>
              </div>
            </div>
          )}

          {/* #31 — Caja menor: concepto + monto (no inventariable) */}
          {modo === "caja_menor" && (
            <div className="iblock flex flex-col gap-3.5">
              <div className="ib-head">
                <div className="ib-ico">
                  <Truck className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="ib-title">Gasto de caja menor</div>
              </div>
              <div className="grid grid-cols-1 gap-3 gap-x-3.5 sm:grid-cols-2">
                <Field label="Concepto" req>
                  <input
                    type="text"
                    value={concepto}
                    onChange={(e) => setConcepto(e.target.value)}
                    placeholder="Ej: transporte, papelería, refrigerio…"
                    className="finput sans"
                  />
                </Field>
                <Field label="Monto" req>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0"
                    className="finput"
                  />
                </Field>
              </div>

              {/* S6-E: método de pago del gasto (antes siempre quedaba Efectivo). */}
              <div>
                <p
                  className="mb-1.5 text-xs font-medium"
                  style={{ color: "var(--n-500)" }}
                >
                  ¿Cómo se pagó?
                </p>
                <div className="flex flex-wrap gap-2">
                  {["Efectivo", "Transferencia", "Tarjeta"].map((m) => {
                    const on = metodoPago === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setMetodoPago(m);
                          if (m === "Efectivo") setCuentaBancaria("");
                        }}
                        className="rounded-md border px-3 text-[13px] font-medium transition-colors"
                        style={{
                          minHeight: 40,
                          borderColor: on ? "var(--p-400)" : "var(--n-200)",
                          backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
                          color: on
                            ? "var(--p-contrast, #fff)"
                            : "var(--n-700)",
                        }}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
                {(metodoPago === "Transferencia" ||
                  metodoPago === "Tarjeta") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2.5">
                    <label
                      htmlFor="cm-cuenta"
                      className="text-sm"
                      style={{ color: "var(--n-500)" }}
                    >
                      Cuenta bancaria
                      <span style={{ color: "var(--dang-700)" }}> *</span>
                    </label>
                    <select
                      id="cm-cuenta"
                      value={cuentaBancaria}
                      onChange={(e) => setCuentaBancaria(e.target.value)}
                      className="h-10 cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
                      style={{
                        borderColor: "var(--n-200)",
                        color: "var(--n-950)",
                      }}
                    >
                      <option value="">Sin especificar</option>
                      {cuentasBanco.map((c) => {
                        const ref = `${c.banco} ${c.tipo} ${c.numero}${c.titular ? " · " + c.titular : ""}`;
                        return (
                          <option key={c.id} value={ref}>
                            {ref}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              <p className="text-xs" style={{ color: "var(--n-500)" }}>
                La caja menor NO afecta el inventario. El monto es el total (sin
                IVA).
              </p>
            </div>
          )}

          {/* Observaciones */}
          <div className="iblock flex flex-col gap-3">
            <div className="ib-head">
              <div className="ib-title">Observaciones</div>
            </div>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Observaciones internas (opcional)"
              rows={2}
              className="ftextarea"
            />
          </div>

          {/* Recibir ahora (solo compra normal) */}
          {modo === "normal" && (
            <label
              className="flex cursor-pointer select-none items-center gap-3 rounded-[10px] border p-4"
              style={{
                backgroundColor: "var(--n-0)",
                borderColor: recibirAhora ? "var(--p-500)" : "var(--n-150)",
              }}
            >
              <input
                type="checkbox"
                checked={recibirAhora}
                onChange={(e) => setRecibirAhora(e.target.checked)}
                className="h-5 w-5 cursor-pointer rounded"
                style={{ accentColor: "var(--p-600)" }}
              />
              <div>
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--n-950)" }}
                >
                  Marcar como recibida ahora
                </p>
                <p className="text-xs" style={{ color: "var(--n-500)" }}>
                  El stock se sumará automáticamente al confirmar
                </p>
              </div>
            </label>
          )}

          {error && (
            <div
              className="rounded-[10px] border px-4 py-3"
              style={{
                backgroundColor: "var(--dang-50)",
                borderColor: "var(--dang-border)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--dang-700)" }}>
                {error}
              </p>
            </div>
          )}
        </div>

        {/* ── Resumen (sticky) ──────────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">
            {modo === "caja_menor"
              ? "Resumen de caja menor"
              : "Resumen de la compra"}
          </span>
          {modo === "normal" ? (
            <>
              <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
                {totalItems} items · {carrito.length} productos
              </div>
              <div className="cart-line">
                <span>Subtotal</span>
                <span className="v">{formatCOP(subtotal)}</span>
              </div>
              {descuento > 0 && (
                <div className="cart-line" style={{ color: "var(--warn-700)" }}>
                  <span>Descuento</span>
                  <span className="v" style={{ color: "var(--warn-700)" }}>
                    −{formatCOP(descuento)}
                  </span>
                </div>
              )}
              <div className="cart-line">
                <span>
                  IVA {ivaPct}%{ivaPct === 0 ? " (exento)" : ""}
                </span>
                <span className="v">{formatCOP(iva)}</span>
              </div>
              <div className="cart-line tot">
                <span>Total estimado</span>
                <span className="v">{formatCOP(total)}</span>
              </div>
              <div className="text-[11.5px]" style={{ color: "var(--n-500)" }}>
                Pago: {metodoPago}
                {metodoPago === "Crédito" ? " (pendiente)" : ""}
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
                Gasto no inventariable
              </div>
              <div className="cart-line tot">
                <span>Total</span>
                <span className="v">{formatCOP(Number(monto) || 0)}</span>
              </div>
            </>
          )}
          <button
            onClick={modo === "caja_menor" ? guardarCajaMenor : guardarCompra}
            disabled={
              guardando ||
              (modo === "normal"
                ? carrito.length === 0 || !proveedor.trim()
                : !concepto.trim() || !(Number(monto) > 0))
            }
            className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {guardando ? (
              "Guardando…"
            ) : modo === "caja_menor" ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Registrar caja menor
              </>
            ) : recibirAhora ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Registrar y recibir
              </>
            ) : (
              <>
                Registrar compra
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </>
            )}
          </button>
        </aside>
      </div>
      {scannerOpen && (
        <QRScanner
          onFound={handleQRFound}
          onClose={() => setScannerOpen(false)}
          continuo
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function Step({ n, label, state }) {
  return (
    <div className={`step ${state}`}>
      <div className="step-dot">
        {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
      </div>
      <div className="step-lbl">{label}</div>
    </div>
  );
}

function Line({ done }) {
  return <div className={`step-line ${done ? "done" : ""}`} />;
}

function Field({ label, req, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flbl">
        {label}
        {req && <span className="req">*</span>}
      </label>
      {children}
    </div>
  );
}

function QtyBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-bold transition-colors disabled:opacity-40"
      style={{
        borderColor: "var(--n-150)",
        color: "var(--n-700)",
        backgroundColor: "var(--n-0)",
      }}
    >
      {children}
    </button>
  );
}

/** Selector Venta/Insumo por producto del carrito (a qué stock entra). */
function DestinoToggle({ value, onChange }) {
  const opts = [
    { v: "venta", t: "Venta" },
    { v: "insumo", t: "Insumo" },
  ];
  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--n-150)" }}
      role="group"
      aria-label="Destino del stock"
    >
      {opts.map((o) => {
        const on = (value ?? "venta") === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={on}
            // C-06: tap target táctil (>=40px) — antes py-1 quedaba en ~24px.
            className="min-h-[40px] px-3 py-2 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: on ? "var(--p-600)" : "var(--n-0)",
              color: on ? "var(--p-contrast, #fff)" : "var(--n-500)",
            }}
          >
            {o.t}
          </button>
        );
      })}
    </div>
  );
}
