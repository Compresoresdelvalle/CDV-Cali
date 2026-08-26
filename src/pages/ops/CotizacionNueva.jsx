import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  ScanLine,
  Trash2,
  Minus,
  Plus,
  ChevronRight,
  ChevronLeft,
  Check,
  Info,
  Lock,
  Pencil,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch } from "../../lib/utils";
import { avisarOk, avisarError } from "../../lib/notify";
import QRScanner from "../../components/forms/QRScanner";
import ClientePicker from "../../components/forms/ClientePicker";
import UbicacionChip from "../../components/ui/UbicacionChip";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { upsertCliente } from "../../lib/clientes";
import { getParametroInt } from "../../hooks/useParametro";
import SelectorCuentasBancarias from "../../components/cotizaciones/SelectorCuentasBancarias";
import {
  categoriaBadge,
  componerObservaciones,
} from "../../lib/cotizaciones-ui";
// Mismo texto que imprime el PDF: la pantalla mostraba otro distinto bajo la
// etiqueta "aparece siempre", que no era cierta.
import { TEXTO_ENTREGA_COTIZACION } from "../../lib/pdf/pdfStyles";

// Validación de email igual al CHECK del servidor (RFC simplificado).
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const PASOS = [
  { n: 1, label: "Cliente" },
  { n: 2, label: "Productos" },
  { n: 3, label: "Ajustes" },
  { n: 4, label: "Revisión" },
];

export default function CotizacionNueva() {
  const navigate = useNavigate();
  const perfil = useAuthStore((s) => s.perfil);

  const [paso, setPaso] = useState(1);

  // Paso 1 · cliente
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [clienteContacto, setClienteContacto] = useState("");
  const [clienteCargo, setClienteCargo] = useState("");
  const [clienteDireccion, setClienteDireccion] = useState("");

  // Paso 2 · productos
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [carrito, setCarrito] = useState([]);

  // B4 · catálogo de servicios activos (vender servicio en la cotización).
  const [servicios, setServicios] = useState([]);
  useEffect(() => {
    supabase
      .from("servicios")
      .select("id, nombre, precio, iva_pct")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setServicios(data ?? []));
  }, []);

  // Paso 3 · ajustes (B4: descuento en $ + domicilio, reemplazan al % legado)
  const [descuentoValor, setDescuentoValor] = useState(0);
  const [domicilio, setDomicilio] = useState(0);
  const [vigenciaDias, setVigenciaDias] = useState(15);
  const [ivaPct, setIvaPct] = useState(19);
  const [observaciones, setObservaciones] = useState("");
  const [condicionesPago, setCondicionesPago] = useState("");
  const [tiempoEntregaNota, setTiempoEntregaNota] = useState("");
  const [cuentasIds, setCuentasIds] = useState([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [erroresCampos, setErroresCampos] = useState({});
  const guardandoRef = useRef(false);

  // Defaults desde parámetros del sistema (Fase 9)
  useEffect(() => {
    let mounted = true;
    Promise.all([
      getParametroInt("iva_pct", 19),
      getParametroInt("validez_cotizacion_dias", 15),
    ])
      .then(([iva, validez]) => {
        if (!mounted) return;
        setIvaPct(iva);
        setVigenciaDias(validez);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  /* ── Búsqueda de productos (debounce 400ms server-side) ─────────────── */
  const buscarProductos = useCallback(
    async (q) => {
      if (!q || q.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      try {
        const safe = sanitizeSearch(q.trim());
        const { data, error: err } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, precio_venta, unidad_medida, categoria, marca",
          )
          .eq("activo", true)
          .eq("vendible", true) // Bloque 2: los insumos no se cotizan/venden
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(1000);
        if (err) throw err;
        // Ubicación física en la sede del vendedor (solo referencia visual,
        // la cotización no valida stock).
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
        setResultados(
          (data ?? []).map((p) => ({
            ...p,
            ubicacion_id: ubicMap[p.id] ?? null,
          })),
        );
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
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

  // #C2-1: antes un insumo, un inactivo o un error de red terminaban en el
  // mismo `return` mudo — el operario veía "Código encontrado" y no pasaba
  // nada. Ahora se distingue cada caso y se avisa (mismo criterio que
  // VentaNueva #S1-19). No se cierra el escáner aquí: en modo continuo lo
  // mantiene abierto el propio QRScanner para encadenar la siguiente lectura.
  const handleQRFound = useCallback(async (productoId) => {
    try {
      const { data, error: err } = await supabase
        .from("productos")
        .select(
          "id, nombre, referencia, precio_venta, unidad_medida, categoria, marca, activo, vendible",
        )
        .eq("id", productoId)
        .maybeSingle();
      if (err) throw err;
      // Toast además del texto fijo: en modo continuo el escáner tapa toda la
      // pantalla, así que el `setError` no se ve hasta cerrarlo.
      if (!data || !data.activo) {
        const msg =
          "Ese código no corresponde a un producto activo (no existe o está inactivo).";
        setError(msg);
        avisarError(msg);
        return;
      }
      if (!data.vendible) {
        const msg = "Este producto no es vendible/cotizable (es un insumo).";
        setError(msg);
        avisarError(msg);
        return;
      }
      setError(null);
      agregarAlCarrito(data);
    } catch (e) {
      avisarError(
        e,
        "No se pudo leer el producto escaneado. Revisa la conexión e intenta de nuevo.",
      );
    }
  }, []);

  // Identidad de línea (producto o servicio) — key de React y de los handlers.
  const lineKey = (i) =>
    i.tipo === "servicio" ? `s:${i.servicio_id}` : `p:${i.producto_id}`;

  const agregarAlCarrito = (prod) => {
    setBusqueda("");
    setResultados([]);
    setCarrito((prev) => {
      const idx = prev.findIndex(
        (i) => i.tipo !== "servicio" && i.producto_id === prod.id,
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          tipo: "producto",
          producto_id: prod.id,
          nombre: prod.nombre,
          referencia: prod.referencia,
          precio_unitario: prod.precio_venta,
          unidad: prod.unidad_medida,
          categoria: prod.categoria,
          marca: prod.marca,
          cantidad: 1,
        },
      ];
    });
  };

  // B4: agregar un servicio a la cotización (no depende de stock ni sede).
  const agregarServicioAlCarrito = (serv) => {
    setCarrito((prev) => {
      const idx = prev.findIndex(
        (i) => i.tipo === "servicio" && i.servicio_id === serv.id,
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], cantidad: updated[idx].cantidad + 1 };
        return updated;
      }
      return [
        ...prev,
        {
          tipo: "servicio",
          servicio_id: serv.id,
          nombre: serv.nombre,
          precio_unitario: Number(serv.precio) || 0,
          cantidad: 1,
        },
      ];
    });
  };

  const actualizarCantidad = (key, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) =>
          lineKey(i) !== key
            ? i
            : { ...i, cantidad: Math.max(0, i.cantidad + delta) },
        )
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (key, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    // Clamp [1, 100000]; teclear 0 NO elimina la fila (eso es la X).
    const clamped = Math.min(100000, Math.max(1, n));
    setCarrito((prev) =>
      prev.map((i) => (lineKey(i) !== key ? i : { ...i, cantidad: clamped })),
    );
  };

  // B4: precio editable por línea (igual que en ventas). Solo dígitos; vacío = 0.
  const setPrecioDirecto = (key, valor) => {
    const limpio = String(valor).replace(/[^\d]/g, "");
    const n = limpio === "" ? 0 : Number(limpio);
    if (isNaN(n) || n < 0) return;
    setCarrito((prev) =>
      prev.map((i) => (lineKey(i) === key ? { ...i, precio_unitario: n } : i)),
    );
  };

  const eliminarItem = (key) => {
    setCarrito((prev) => prev.filter((i) => lineKey(i) !== key));
  };

  /* ── Totales (misma fórmula que el RPC · descuento $ + domicilio) ───── */
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = Math.min(Math.max(0, descuentoValor), subtotal);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (ivaPct / 100);
  // Redondeo a pesos enteros (sin centavos), igual que el servidor.
  const total = Math.round(
    baseIva * (1 + ivaPct / 100) + Math.max(0, domicilio),
  );

  /* ── Validación por paso ────────────────────────────────────────────── */
  const validarPaso1 = () => {
    const errs = {};
    if (!clienteNombre.trim())
      errs.nombre = "El nombre del cliente es obligatorio";
    if (clienteEmail && !EMAIL_REGEX.test(clienteEmail))
      errs.email = "Formato de correo inválido (revisar @)";
    if (clienteEmail && clienteEmail.length > 254)
      errs.email = "Email demasiado largo (máx 254 caracteres)";
    setErroresCampos(errs);
    return Object.keys(errs).length === 0;
  };

  const avanzar = () => {
    setError(null);
    if (paso === 1 && !validarPaso1()) return;
    if (paso === 2 && carrito.length === 0) {
      setError("Agrega al menos un producto para continuar.");
      return;
    }
    setPaso((p) => Math.min(4, p + 1));
  };

  const retroceder = () => {
    setError(null);
    setPaso((p) => Math.max(1, p - 1));
  };

  const irAPaso = (n) => {
    setError(null);
    setPaso(n);
  };

  /* ── Guardar / generar cotización ───────────────────────────────────── */
  const guardarCotizacion = async () => {
    if (carrito.length === 0) return;
    setError(null);
    if (!perfil?.sede_id) {
      setError("Tu usuario no tiene sede asignada. Contacta al Admin.");
      return;
    }
    if (!clienteNombre.trim()) {
      setError("El nombre del cliente es obligatorio");
      setPaso(1);
      return;
    }
    if (clienteEmail && !EMAIL_REGEX.test(clienteEmail)) {
      setError("Email inválido");
      setPaso(1);
      return;
    }
    if (clienteEmail && clienteEmail.length > 254) {
      setError("Email demasiado largo (máx 254 caracteres)");
      setPaso(1);
      return;
    }
    // Guard síncrono anti doble-submit (el `disabled` no es inmediato).
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    const cuentasLimpias = cuentasIds.filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    // Contacto/Cargo/Dirección no tienen columna propia → se preservan dentro
    // de las observaciones libres (sin inventar esquema).
    const observacionesFinal = componerObservaciones(
      {
        contacto: clienteContacto,
        cargo: clienteCargo,
        direccion: clienteDireccion,
      },
      observaciones,
    );
    setGuardando(true);
    try {
      const { error: rpcErr } = await supabase.rpc("fn_registrar_cotizacion", {
        p_sede_id: perfil.sede_id,
        p_cliente_nombre: clienteNombre || null,
        p_cliente_nit: clienteNit || null,
        p_cliente_email: clienteEmail || null,
        p_cliente_telefono: clienteTelefono || null,
        // B4: descuento ahora en $ (el % legado se manda en 0).
        p_descuento_pct: 0,
        p_descuento_valor: descuento,
        p_domicilio: Math.max(0, domicilio),
        p_vigencia_dias: vigenciaDias,
        p_iva_pct: ivaPct,
        p_observaciones: observacionesFinal,
        p_condiciones_pago: condicionesPago || null,
        p_tiempo_entrega_nota: tiempoEntregaNota || null,
        p_items: carrito.map((i) =>
          i.tipo === "servicio"
            ? {
                servicio_id: i.servicio_id,
                cantidad: i.cantidad,
                precio_unitario: i.precio_unitario,
              }
            : {
                producto_id: i.producto_id,
                cantidad: i.cantidad,
                precio_unitario: i.precio_unitario,
              },
        ),
        p_cuentas_ids: cuentasLimpias,
        p_ot_id: null,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      // Bloque 0 #2: guardar/reutilizar cliente para el autocompletado. NO toca
      // la cotización (no se pasa cliente_id al RPC) y nunca rompe el flujo.
      if (clienteNombre.trim()) {
        await upsertCliente({
          nombre: clienteNombre,
          identificacion: clienteNit,
          telefono: clienteTelefono,
          email: clienteEmail,
          direccion: clienteDireccion,
        });
      }

      avisarOk("Cotización generada correctamente");
      navigate("/ops/cotizaciones");
    } catch (e) {
      avisarError(e, "Error al guardar la cotización");
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div className="px-4 pb-16 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate("/ops/cotizaciones")}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a Cotizaciones
      </button>

      {/* ── Encabezado ──────────────────────────────────────────────── */}
      <div
        className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b pb-4"
        style={{ borderColor: "var(--n-150)" }}
      >
        <div>
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: "var(--n-300)" }}
          >
            Nueva cotización
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Nueva cotización
          </h1>
          <p className="mt-1.5 text-[13px]" style={{ color: "var(--n-500)" }}>
            Vendedor ·{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.nombre ?? "—"}
            </b>{" "}
            · Sede{" "}
            <b
              className="font-mono font-medium"
              style={{ color: "var(--n-700)" }}
            >
              {perfil?.sede_id ?? "—"}
            </b>
          </p>
        </div>
        <button
          onClick={() => navigate("/ops/cotizaciones")}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────── */}
      <div className="stepper mt-5">
        {PASOS.map((p, idx) => (
          <StepFragment
            key={p.n}
            paso={p}
            pasoActivo={paso}
            last={idx === PASOS.length - 1}
          />
        ))}
      </div>

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {paso === 1 && (
            <PasoCliente
              clienteNombre={clienteNombre}
              setClienteNombre={setClienteNombre}
              clienteNit={clienteNit}
              setClienteNit={setClienteNit}
              clienteTelefono={clienteTelefono}
              setClienteTelefono={setClienteTelefono}
              clienteEmail={clienteEmail}
              setClienteEmail={setClienteEmail}
              clienteContacto={clienteContacto}
              setClienteContacto={setClienteContacto}
              clienteCargo={clienteCargo}
              setClienteCargo={setClienteCargo}
              clienteDireccion={clienteDireccion}
              setClienteDireccion={setClienteDireccion}
              onSelectCliente={(c) => {
                setClienteNombre(c.nombre ?? "");
                if (c.identificacion) setClienteNit(c.identificacion);
                if (c.telefono) setClienteTelefono(c.telefono);
                if (c.email) setClienteEmail(c.email);
                if (c.direccion) setClienteDireccion(c.direccion);
              }}
              errores={erroresCampos}
            />
          )}

          {paso === 2 && (
            <PasoProductos
              busqueda={busqueda}
              onBusquedaChange={handleBusquedaChange}
              buscando={buscando}
              resultados={resultados}
              onAgregar={agregarAlCarrito}
              onScan={() => setScannerOpen(true)}
              carrito={carrito}
              servicios={servicios}
              onAgregarServicio={agregarServicioAlCarrito}
              lineKey={lineKey}
              onDec={(key) => actualizarCantidad(key, -1)}
              onInc={(key) => actualizarCantidad(key, 1)}
              onSet={setCantidadDirecta}
              onSetPrecio={setPrecioDirecto}
              onEliminar={eliminarItem}
            />
          )}

          {paso === 3 && (
            <PasoAjustes
              descuentoValor={descuentoValor}
              setDescuentoValor={setDescuentoValor}
              domicilio={domicilio}
              setDomicilio={setDomicilio}
              vigenciaDias={vigenciaDias}
              setVigenciaDias={setVigenciaDias}
              ivaPct={ivaPct}
              setIvaPct={setIvaPct}
              condicionesPago={condicionesPago}
              setCondicionesPago={setCondicionesPago}
              tiempoEntregaNota={tiempoEntregaNota}
              setTiempoEntregaNota={setTiempoEntregaNota}
              observaciones={observaciones}
              setObservaciones={setObservaciones}
              cuentasIds={cuentasIds}
              setCuentasIds={setCuentasIds}
              perfil={perfil}
            />
          )}

          {paso === 4 && (
            <PasoRevision
              cliente={{
                nombre: clienteNombre,
                nit: clienteNit,
                telefono: clienteTelefono,
                email: clienteEmail,
                contacto: clienteContacto,
                cargo: clienteCargo,
                direccion: clienteDireccion,
              }}
              carrito={carrito}
              subtotal={subtotal}
              descuento={descuento}
              domicilio={Math.max(0, domicilio)}
              iva={iva}
              ivaPct={ivaPct}
              total={total}
              ajustes={{
                vigenciaDias,
                descuento,
                domicilio: Math.max(0, domicilio),
                condicionesPago,
                tiempoEntregaNota,
                cuentasCount: cuentasIds.length,
              }}
              onEditar={irAPaso}
            />
          )}

          {error && (
            <div
              role="alert"
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

          {/* Navegación entre pasos */}
          <div className="flex items-center justify-between gap-3">
            {paso > 1 ? (
              <button
                onClick={retroceder}
                className="btn btn-out"
                style={{ height: 48 }}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                Atrás
              </button>
            ) : (
              <span />
            )}
            {paso < 4 && (
              <button
                onClick={avanzar}
                className="btn btn-pri"
                style={{ height: 48 }}
              >
                {paso === 1
                  ? "Continuar a productos"
                  : paso === 2
                    ? "Continuar a ajustes"
                    : "Continuar a revisión"}
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {/* ── Resumen (cart sticky) ─────────────────────────────────── */}
        <aside className="cart">
          <span className="cart-eyebrow">Resumen</span>
          <div className="text-[12px]" style={{ color: "var(--n-500)" }}>
            {carrito.length === 0
              ? "Sin productos aún"
              : `${carrito.length} producto${carrito.length !== 1 ? "s" : ""}`}
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
            <span>IVA {ivaPct}%</span>
            <span className="v">{formatCOP(iva)}</span>
          </div>
          {domicilio > 0 && (
            <div className="cart-line">
              <span>Domicilio</span>
              <span className="v">{formatCOP(Math.max(0, domicilio))}</span>
            </div>
          )}
          <div className="cart-line tot">
            <span>Total</span>
            <span className="v">{formatCOP(total)}</span>
          </div>

          {paso < 4 ? (
            <button
              onClick={avanzar}
              disabled={paso === 2 && carrito.length === 0}
              className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
              style={{ height: 48 }}
            >
              Continuar
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              onClick={guardarCotizacion}
              disabled={carrito.length === 0 || guardando}
              className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
              style={{ height: 48 }}
            >
              {guardando ? "Generando…" : "Generar cotización"}
              {!guardando && <Check className="h-4 w-4" strokeWidth={2.5} />}
            </button>
          )}
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

/* ─────────────────────────── Stepper ─────────────────────────── */

function StepFragment({ paso, pasoActivo, last }) {
  const cls =
    pasoActivo > paso.n ? "done" : pasoActivo === paso.n ? "active" : "todo";
  return (
    <>
      <div className={`step ${cls}`}>
        <div className="step-dot">
          {cls === "done" ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : (
            paso.n
          )}
        </div>
        <div className="step-lbl">{paso.label}</div>
      </div>
      {!last && (
        <div className={`step-line ${pasoActivo > paso.n ? "done" : ""}`} />
      )}
    </>
  );
}

/* ─────────────────────────── Card de paso ─────────────────────────── */

function WizCard({ paso, total = 4, title, sub, children }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: "var(--n-100)" }}
      >
        <p
          className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em]"
          style={{ color: "var(--n-300)" }}
        >
          Paso {paso} de {total}
        </p>
        <h2
          className="text-[17px] font-medium tracking-[-0.005em]"
          style={{ color: "var(--n-950)" }}
        >
          {title}
        </h2>
        {sub && (
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--n-500)" }}>
            {sub}
          </p>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─────────────────────────── Paso 1 · Cliente ─────────────────────────── */

function PasoCliente({
  clienteNombre,
  setClienteNombre,
  clienteNit,
  setClienteNit,
  clienteTelefono,
  setClienteTelefono,
  clienteEmail,
  setClienteEmail,
  clienteContacto,
  setClienteContacto,
  clienteCargo,
  setClienteCargo,
  clienteDireccion,
  setClienteDireccion,
  onSelectCliente,
  errores,
}) {
  return (
    <WizCard
      paso={1}
      title="Datos del cliente"
      sub="Busca un cliente existente o escribe uno nuevo (se guarda al generar la cotización)."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="flbl">
            Cliente<span className="req">*</span>
          </label>
          <ClientePicker
            value={clienteNombre}
            onChange={setClienteNombre}
            onSelect={onSelectCliente}
            placeholder="Buscar o escribir cliente…"
            inputStyle={
              errores.nombre ? { color: "var(--dang-700)" } : undefined
            }
          />
          {errores.nombre && (
            <span
              className="flex items-center gap-1.5 text-[11.5px] font-medium"
              style={{ color: "var(--dang-700)" }}
            >
              <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
              {errores.nombre}
            </span>
          )}
        </div>
        <FieldText
          label="NIT o Cédula"
          value={clienteNit}
          onChange={setClienteNit}
          placeholder="900.123.456-7"
        />
        <FieldText
          label="Teléfono"
          value={clienteTelefono}
          onChange={setClienteTelefono}
          placeholder="318 442 5511"
        />
        <FieldText
          full
          label="Correo"
          value={clienteEmail}
          onChange={setClienteEmail}
          placeholder="contacto@empresa.com"
          type="email"
          sans
          error={errores.email}
        />
        <FieldText
          label="Contacto"
          value={clienteContacto}
          onChange={setClienteContacto}
          placeholder="Nombre de la persona"
          sans
        />
        <FieldText
          label="Cargo"
          value={clienteCargo}
          onChange={setClienteCargo}
          placeholder="Ej. Jefe de mantenimiento"
          sans
        />
        <FieldArea
          full
          label="Dirección"
          value={clienteDireccion}
          onChange={setClienteDireccion}
          placeholder="Calle, ciudad, departamento"
        />
      </div>

      <div className="banner-info mt-4">
        <Info className="size-4 shrink-0" strokeWidth={2} />
        <div className="body">
          <b>Contacto y cargo</b> se guardan junto a las notas de la cotización
          y aparecen en el PDF. Solo el <b>nombre</b> es obligatorio. El cliente
          se registra automáticamente para reutilizarlo después.
        </div>
      </div>
    </WizCard>
  );
}

/* ─────────────────────────── Paso 2 · Productos ─────────────────────────── */

function PasoProductos({
  busqueda,
  onBusquedaChange,
  buscando,
  resultados,
  onAgregar,
  onScan,
  carrito,
  servicios,
  onAgregarServicio,
  lineKey,
  onDec,
  onInc,
  onSet,
  onSetPrecio,
  onEliminar,
}) {
  return (
    <WizCard paso={2} title="Productos y servicios a cotizar">
      {/* Buscador + QR */}
      <div className="flex items-stretch">
        <div
          className="flex h-12 flex-1 items-center gap-2.5 rounded-l-[10px] border border-r-0 px-3.5"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="text"
            value={busqueda}
            onChange={onBusquedaChange}
            placeholder="Buscar producto por nombre o referencia… o escanea QR"
            className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
            style={{ color: "var(--n-950)" }}
          />
        </div>
        <button
          onClick={onScan}
          className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-l-none rounded-r-[10px] px-4 text-white"
          style={{ backgroundColor: "var(--p-600)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-700)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-600)")
          }
          aria-label="Escanear QR"
        >
          <ScanLine className="h-4 w-4" strokeWidth={1.7} />
          <span className="hidden sm:inline">Escanear QR</span>
        </button>
      </div>

      {/* B4 — Agregar un servicio (catálogo que solo crea el Admin). */}
      {servicios.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <label
            htmlFor="cot-serv-add"
            className="inline-flex items-center gap-1.5 text-[12px]"
            style={{ color: "var(--n-500)" }}
          >
            <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />
            Servicio
          </label>
          <select
            id="cot-serv-add"
            value=""
            onChange={(e) => {
              const s = servicios.find((x) => String(x.id) === e.target.value);
              if (s) onAgregarServicio(s);
            }}
            className="h-10 min-w-[220px] cursor-pointer rounded-[10px] border bg-transparent px-3 text-[13px] font-medium outline-none"
            style={{ borderColor: "var(--n-200)", color: "var(--n-950)" }}
          >
            <option value="">Agregar un servicio…</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre} · {formatCOP(s.precio)}
              </option>
            ))}
          </select>
        </div>
      )}

      {buscando && (
        <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
          Buscando…
        </p>
      )}

      {resultados.length > 0 && (
        <div
          className="mt-2 max-h-80 overflow-y-auto rounded-lg border"
          style={{ borderColor: "var(--n-150)" }}
        >
          {resultados.map((p, idx) => {
            const badge = categoriaBadge(p.categoria);
            return (
              <button
                key={p.id}
                onClick={() => onAgregar(p)}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                style={{
                  borderTop: idx === 0 ? "none" : "1px solid var(--n-100)",
                  backgroundColor: "var(--n-0)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--n-50)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--n-0)")
                }
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--n-950)" }}
                    >
                      {p.nombre}
                    </p>
                    {badge && <CatBadge cls={badge.cls} label={badge.label} />}
                    <UbicacionChip codigo={p.ubicacion_id} />
                  </div>
                  <p
                    className="font-mono text-[11px]"
                    style={{ color: "var(--n-500)" }}
                  >
                    {[p.marca, p.referencia].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className="font-mono text-sm font-semibold"
                    style={{ color: "var(--p-700)" }}
                  >
                    {formatCOP(p.precio_venta)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--n-500)" }}>
                    {p.unidad_medida}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Tabla de productos en el carrito */}
      {carrito.length === 0 ? (
        <div
          className="mt-3 rounded-[10px] border border-dashed px-4 py-10 text-center text-sm"
          style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
        >
          Busca o escanea productos para agregarlos a la cotización
        </div>
      ) : (
        <div
          className="mt-3 overflow-x-auto overflow-hidden rounded-[10px] border"
          style={{ borderColor: "var(--n-150)" }}
        >
          <table className="prod-tbl">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Ref.</th>
                <th>Producto</th>
                <th style={{ width: 130 }}>Categoría</th>
                <th className="r" style={{ width: 132 }}>
                  Cant
                </th>
                <th className="r" style={{ width: 110 }}>
                  Unit
                </th>
                <th className="r" style={{ width: 120 }}>
                  Subtotal
                </th>
                <th style={{ width: 42 }} />
              </tr>
            </thead>
            <tbody>
              {carrito.map((item) => {
                const key = lineKey(item);
                const esServicio = item.tipo === "servicio";
                const badge = esServicio
                  ? null
                  : categoriaBadge(item.categoria);
                return (
                  <tr key={key}>
                    <td>
                      {esServicio ? (
                        <span
                          className="p-sku"
                          style={{ color: "var(--p-600)" }}
                        >
                          Servicio
                        </span>
                      ) : (
                        <>
                          <span className="p-sku">
                            {item.referencia ?? "—"}
                          </span>
                          <div className="p-meta">
                            {item.marca ?? item.unidad ?? ""}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="p-nm">{item.nombre}</div>
                    </td>
                    <td>
                      {esServicio ? (
                        <CatBadge cls="cat-srv" label="Servicio" />
                      ) : badge ? (
                        <CatBadge cls={badge.cls} label={badge.label} />
                      ) : (
                        <span style={{ color: "var(--n-300)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <QtyControl
                        value={item.cantidad}
                        onDec={() => onDec(key)}
                        onInc={() => onInc(key)}
                        onSet={(v) => onSet(key, v)}
                      />
                    </td>
                    <td className="p-pr">
                      <PriceInput
                        value={item.precio_unitario}
                        onSet={(v) => onSetPrecio(key, v)}
                      />
                    </td>
                    <td className="p-sub">
                      {formatCOP(item.cantidad * item.precio_unitario)}
                    </td>
                    <td>
                      <button
                        onClick={() => onEliminar(key)}
                        className="flex size-7 items-center justify-center rounded-md transition-colors"
                        style={{ color: "var(--n-500)" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "var(--dang-600)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "var(--n-500)")
                        }
                        aria-label="Eliminar línea"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--n-500)" }}>
        El precio inicia con el del catálogo y es editable por línea. También
        puedes aplicar un descuento en $ y domicilio en el paso de ajustes.
      </p>
    </WizCard>
  );
}

function CatBadge({ cls, label }) {
  const palette = {
    "cat-rep": {
      bg: "var(--dang-50)",
      fg: "var(--dang-700)",
      bd: "var(--dang-100)",
    },
    "cat-lub": {
      bg: "var(--purp-50, var(--p-50))",
      fg: "var(--purp-700, var(--p-700))",
      bd: "var(--purp-200, var(--p-100))",
    },
    "cat-srv": {
      bg: "var(--info-50)",
      fg: "var(--info-700)",
      bd: "#C8DFFC",
    },
  };
  const c = palette[cls] ?? palette["cat-rep"];
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.bd }}
    >
      {label}
    </span>
  );
}

function QtyControl({ value, onDec, onInc, onSet }) {
  return (
    <div
      className="inline-flex h-9 items-center overflow-hidden rounded-md border"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <button
        onClick={onDec}
        className="grid h-full w-8 place-items-center transition-colors"
        style={{ color: "var(--n-700)" }}
        aria-label="Disminuir cantidad"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min="1"
        value={value}
        onChange={(e) => onSet(e.target.value)}
        className="w-10 border-0 bg-transparent text-center font-mono text-[13px] font-medium outline-none"
        style={{ color: "var(--n-950)" }}
      />
      <button
        onClick={onInc}
        className="grid h-full w-8 place-items-center transition-colors"
        style={{ color: "var(--n-700)" }}
        aria-label="Aumentar cantidad"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

// B4 — precio de venta editable por línea (entero COP, sin decimales).
function PriceInput({ value, onSet }) {
  return (
    <div
      className="inline-flex h-9 items-center overflow-hidden rounded-md border"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <span
        className="pl-2 font-mono text-[12px]"
        style={{ color: "var(--n-500)" }}
      >
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onSet(e.target.value)}
        className="w-[92px] border-0 bg-transparent px-1.5 text-right font-mono text-[13px] font-medium outline-none"
        style={{ color: "var(--n-950)" }}
        aria-label="Precio unitario"
      />
    </div>
  );
}

/* ─────────────────────────── Paso 3 · Ajustes ─────────────────────────── */

function PasoAjustes({
  descuentoValor,
  setDescuentoValor,
  domicilio,
  setDomicilio,
  vigenciaDias,
  setVigenciaDias,
  ivaPct,
  setIvaPct,
  condicionesPago,
  setCondicionesPago,
  tiempoEntregaNota,
  setTiempoEntregaNota,
  observaciones,
  setObservaciones,
  cuentasIds,
  setCuentasIds,
  perfil,
}) {
  return (
    <WizCard
      paso={3}
      title="Ajustes de la cotización"
      sub="Configura los términos comerciales según el caso. Los valores predeterminados vienen de Configuración."
    >
      {/* Términos comerciales */}
      <SubHead>Términos comerciales</SubHead>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumField
          label="IVA %"
          value={ivaPct}
          min={0}
          max={100}
          onChange={(v) => setIvaPct(Math.min(100, Math.max(0, v)))}
        />
        <NumField
          label="Vigencia (días)"
          value={vigenciaDias}
          min={1}
          max={365}
          onChange={(v) => setVigenciaDias(Math.max(1, v))}
        />
        <NumField
          label="Descuento $"
          value={descuentoValor}
          min={0}
          step={1000}
          onChange={(v) => setDescuentoValor(Math.max(0, v))}
        />
        <NumField
          label="Domicilio $"
          value={domicilio}
          min={0}
          step={1000}
          onChange={(v) => setDomicilio(Math.max(0, v))}
        />
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
        IVA 0% si la venta no lleva IVA. El descuento se resta antes del IVA; el
        domicilio se suma después (no se grava).
      </p>
      <div className="mt-3 space-y-3">
        <FieldArea
          full
          label="Condiciones de pago"
          value={condicionesPago}
          onChange={setCondicionesPago}
          placeholder="Ej: 50% anticipo, saldo contra entrega — o 'Contado'"
        />
        <FieldArea
          full
          label="Tiempo de entrega"
          value={tiempoEntregaNota}
          onChange={setTiempoEntregaNota}
          placeholder="Ej: 5 a 7 días hábiles tras autorización"
        />
        <FieldArea
          full
          label="Notas adicionales"
          value={observaciones}
          onChange={setObservaciones}
          placeholder="Cualquier otra observación libre"
        />
      </div>

      {/* Cuentas bancarias */}
      <Divider />
      <SubHead>Cuentas bancarias para pago</SubHead>
      <p className="mb-3 text-[12px]" style={{ color: "var(--n-500)" }}>
        Selecciona qué cuentas bancarias aparecerán en el PDF de la cotización.
        Puedes elegir varias.
      </p>
      <SelectorCuentasBancarias
        selectedIds={cuentasIds}
        onChange={setCuentasIds}
        ivaPct={ivaPct}
      />

      {/* Datos de la cotización (readonly, derivados reales) */}
      <Divider />
      <SubHead>Datos de la cotización</SubHead>
      <div className="space-y-1">
        <ReadonlyRow
          label="Cotizado por"
          value={`${perfil?.nombre ?? "—"} · ${perfil?.rol ?? "—"}`}
        />
        <ReadonlyRow
          label="Sede de origen"
          value={perfil?.sede_id ?? "—"}
          mono
        />
      </div>

      {/* Texto fijo locked */}
      <Divider />
      <SubHead>Texto fijo de condiciones de entrega</SubHead>
      <div
        className="rounded-lg border p-3.5"
        style={{ backgroundColor: "var(--n-50)", borderColor: "var(--n-100)" }}
      >
        <p
          className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em]"
          style={{ color: "var(--n-300)" }}
        >
          <Lock className="h-3 w-3" /> Texto fijo · aparece siempre
        </p>
        <p
          className="text-[12px] leading-[1.55]"
          style={{ color: "var(--n-700)" }}
        >
          {TEXTO_ENTREGA_COTIZACION}
        </p>
      </div>
    </WizCard>
  );
}

function SubHead({ children }) {
  return (
    <p
      className="mb-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em]"
      style={{ color: "var(--n-300)" }}
    >
      {children}
    </p>
  );
}

function Divider() {
  return (
    <div
      className="my-4 border-t border-dashed"
      style={{ borderColor: "var(--n-150)" }}
    />
  );
}

function ReadonlyRow({ label, value, mono }) {
  return (
    <div
      className="flex items-center gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: "var(--n-50)" }}
    >
      <span
        className="w-40 shrink-0 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-300)" }}
      >
        {label}
      </span>
      <span
        className={"text-[13px] font-medium " + (mono ? "font-mono" : "")}
        style={{ color: "var(--n-950)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ─────────────────────────── Paso 4 · Revisión ─────────────────────────── */

function PasoRevision({
  cliente,
  carrito,
  subtotal,
  descuento,
  domicilio,
  iva,
  ivaPct,
  total,
  ajustes,
  onEditar,
}) {
  const cuentas = useMemo(
    () =>
      ajustes.cuentasCount > 0
        ? `${ajustes.cuentasCount} cuenta${ajustes.cuentasCount !== 1 ? "s" : ""} seleccionada${ajustes.cuentasCount !== 1 ? "s" : ""}`
        : "Ninguna seleccionada",
    [ajustes.cuentasCount],
  );
  return (
    <WizCard
      paso={4}
      title="Revisar y generar cotización"
      sub="Verifica los datos antes de generar el PDF. Una vez generada, podrás re-emitir o duplicar pero no editar la versión actual."
    >
      {/* Bloque cliente */}
      <ReviewBlock title="Cliente" tag="Paso 1" onEdit={() => onEditar(1)}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <ReviewItem label="Cliente" value={cliente.nombre || "—"} />
          <ReviewItem label="NIT / Cédula" value={cliente.nit || "—"} mono />
          <ReviewItem label="Teléfono" value={cliente.telefono || "—"} mono />
          <ReviewItem label="Correo" value={cliente.email || "—"} />
          <ReviewItem
            label="Contacto"
            value={
              [cliente.contacto, cliente.cargo].filter(Boolean).join(" · ") ||
              "—"
            }
          />
          <ReviewItem label="Dirección" value={cliente.direccion || "—"} />
        </div>
      </ReviewBlock>

      {/* Bloque productos */}
      <ReviewBlock
        title="Productos"
        tag={`${carrito.length} item${carrito.length !== 1 ? "s" : ""}`}
        onEdit={() => onEditar(2)}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <ReviewTh width={110}>Ref.</ReviewTh>
                <ReviewTh>Producto</ReviewTh>
                <ReviewTh width={56} right>
                  Cant
                </ReviewTh>
                <ReviewTh width={110} right>
                  Unit
                </ReviewTh>
                <ReviewTh width={120} right>
                  Subtotal
                </ReviewTh>
              </tr>
            </thead>
            <tbody>
              {carrito.map((i) => {
                const esServicio = i.tipo === "servicio";
                return (
                  <tr
                    key={
                      esServicio ? `s:${i.servicio_id}` : `p:${i.producto_id}`
                    }
                  >
                    <ReviewTd mono muted>
                      {esServicio ? "Servicio" : (i.referencia ?? "—")}
                    </ReviewTd>
                    <ReviewTd>{i.nombre}</ReviewTd>
                    <ReviewTd right>×{i.cantidad}</ReviewTd>
                    <ReviewTd right mono>
                      {formatCOP(i.precio_unitario)}
                    </ReviewTd>
                    <ReviewTd right mono>
                      {formatCOP(i.cantidad * i.precio_unitario)}
                    </ReviewTd>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className="mt-3 flex flex-col gap-1 border-t border-dashed pt-3"
          style={{ borderColor: "var(--n-150)" }}
        >
          <ReviewFootLine label="Subtotal" value={formatCOP(subtotal)} />
          {descuento > 0 && (
            <ReviewFootLine
              label="Descuento"
              value={`−${formatCOP(descuento)}`}
            />
          )}
          <ReviewFootLine label={`IVA (${ivaPct}%)`} value={formatCOP(iva)} />
          {domicilio > 0 && (
            <ReviewFootLine label="Domicilio" value={formatCOP(domicilio)} />
          )}
          <ReviewFootLine label="Total" value={formatCOP(total)} tot />
        </div>
      </ReviewBlock>

      {/* Bloque ajustes */}
      <ReviewBlock title="Ajustes" tag="F11" onEdit={() => onEditar(3)}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <ReviewItem label="Validez" value={`${ajustes.vigenciaDias} días`} />
          <ReviewItem label="IVA" value={`${ivaPct}%`} />
          <ReviewItem
            label="Descuento"
            value={
              ajustes.descuento > 0
                ? formatCOP(ajustes.descuento)
                : "Sin descuento"
            }
          />
          <ReviewItem
            label="Domicilio"
            value={ajustes.domicilio > 0 ? formatCOP(ajustes.domicilio) : "—"}
          />
          <ReviewItem
            label="Condiciones de pago"
            value={ajustes.condicionesPago || "—"}
          />
          <ReviewItem
            label="Tiempo de entrega"
            value={ajustes.tiempoEntregaNota || "—"}
          />
          <ReviewItem label="Cuentas bancarias" value={cuentas} />
        </div>
      </ReviewBlock>

      {/* Nota informativa (NO son botones — el CTA real es "Generar
          cotización" del resumen). Antes eran dos cuadros con pinta de CTA. */}
      <div
        className="mt-1 flex items-start gap-2.5 rounded-[10px] border p-3.5"
        style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-50)" }}
      >
        <Info
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--n-500)" }}
          strokeWidth={2}
        />
        <p
          className="text-[12.5px] leading-relaxed"
          style={{ color: "var(--n-600)" }}
        >
          Para crear la cotización usa el botón{" "}
          <b style={{ color: "var(--n-900)" }}>Generar cotización</b> del
          resumen. Se guarda en estado{" "}
          <b style={{ color: "var(--n-900)" }}>borrador</b>; después podrás
          descargar el PDF, enviarla o convertirla en venta desde el listado.
        </p>
      </div>
    </WizCard>
  );
}

function ReviewBlock({ title, tag, onEdit, children }) {
  return (
    <div
      className="mb-3.5 rounded-[10px] border p-4"
      style={{ backgroundColor: "var(--n-50)", borderColor: "var(--n-100)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[13.5px] font-medium"
            style={{ color: "var(--n-950)" }}
          >
            {title}
          </span>
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[11px]"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-100)",
              color: "var(--n-400)",
            }}
          >
            {tag}
          </span>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
          style={{ color: "var(--p-700)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--p-50)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "transparent")
          }
        >
          <Pencil className="h-3 w-3" strokeWidth={2} /> Editar
        </button>
      </div>
      {children}
    </div>
  );
}

function ReviewItem({ label, value, mono }) {
  return (
    <div className="flex flex-col">
      <span
        className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--n-400)" }}
      >
        {label}
      </span>
      <span
        className={
          "text-[13px] font-medium leading-[1.35] " + (mono ? "font-mono" : "")
        }
        style={{ color: "var(--n-950)" }}
      >
        {value}
      </span>
    </div>
  );
}

function ReviewTh({ children, width, right }) {
  return (
    <th
      style={{ width, color: "var(--n-400)", borderColor: "var(--n-100)" }}
      className={
        "border-b px-2.5 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.08em] " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function ReviewTd({ children, right, mono, muted }) {
  return (
    <td
      className={
        "border-b px-2.5 py-2 text-[12.5px] " +
        (right ? "text-right " : "") +
        (mono ? "font-mono " : "")
      }
      style={{
        borderColor: "var(--n-100)",
        color: muted ? "var(--n-500)" : "var(--n-700)",
      }}
    >
      {children}
    </td>
  );
}

function ReviewFootLine({ label, value, tot }) {
  return (
    <div
      className={"flex justify-between " + (tot ? "border-t pt-1.5" : "")}
      style={tot ? { borderColor: "var(--n-150)" } : undefined}
    >
      <span
        className={tot ? "text-[14px] font-medium" : "text-[12px]"}
        style={{ color: tot ? "var(--n-950)" : "var(--n-500)" }}
      >
        {label}
      </span>
      <span
        className={
          "font-mono font-medium " + (tot ? "text-[18px]" : "text-[12px]")
        }
        style={{ color: tot ? "var(--n-950)" : "var(--n-700)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ─────────────────────────── Campos de formulario ─────────────────────────── */

function FieldText({
  label,
  value,
  onChange,
  placeholder,
  required,
  full,
  sans,
  type = "text",
  error,
}) {
  return (
    <div className={"flex flex-col gap-1.5 " + (full ? "sm:col-span-2" : "")}>
      <label className="flbl">
        {label}
        {required && <span className="req">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={"finput " + (sans ? "sans" : "")}
        style={
          error
            ? {
                borderColor: "var(--dang-border)",
                backgroundColor: "var(--dang-50)",
              }
            : undefined
        }
      />
      {error && (
        <span
          className="flex items-center gap-1.5 text-[11.5px] font-medium"
          style={{ color: "var(--dang-700)" }}
        >
          <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
          {error}
        </span>
      )}
    </div>
  );
}

function FieldArea({ label, value, onChange, placeholder, full }) {
  return (
    <div className={"flex flex-col gap-1.5 " + (full ? "sm:col-span-2" : "")}>
      <label className="flbl">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="ftextarea"
      />
    </div>
  );
}

function NumField({ label, value, min, max, step, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flbl">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="finput"
        style={{ textAlign: "center" }}
      />
    </label>
  );
}
