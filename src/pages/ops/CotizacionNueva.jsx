import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  FileText,
  Save,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";
import ClientePicker from "../../components/forms/ClientePicker";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { upsertCliente } from "../../lib/clientes";
import { getParametroInt } from "../../hooks/useParametro";
import SelectorCuentasBancarias from "../../components/cotizaciones/SelectorCuentasBancarias";
import {
  categoriaBadge,
  componerObservaciones,
} from "../../lib/cotizaciones-ui";

// Texto fijo de condiciones de entrega (Lovable paso 3 · locked, idéntico al PDF).
const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse al momento de la entrega. Las garantías aplican según política de fábrica del producto. Los precios incluyen embalaje estándar. Embalaje especial bajo cotización adicional.";

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
  const [searchParams] = useSearchParams();
  const otIdParam = searchParams.get("ot_id");
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

  // Paso 3 · ajustes
  const [descuentoPct, setDescuentoPct] = useState(0);
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

  // Fase 10 §10.6: si llegamos con ?ot_id=xxx, pre-llenar datos del cliente.
  // Si la pre-carga falla (RLS u OT inexistente), se invalida otIdParam para
  // que NO se pase al RPC y no haya privilege escalation cross-sede.
  const [otIdValido, setOtIdValido] = useState(null);
  useEffect(() => {
    if (!otIdParam) {
      setOtIdValido(null);
      return;
    }
    let mounted = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("ordenes_servicio")
        .select("cliente_nombre, cliente_telefono, sede_id")
        .eq("id", otIdParam)
        .maybeSingle();
      if (!mounted) return;
      if (e || !data) {
        setError(
          "No se pudo cargar la OT vinculada — verifica que tienes acceso. Puedes continuar manualmente.",
        );
        setOtIdValido(null);
        return;
      }
      setClienteNombre(data.cliente_nombre ?? "");
      setClienteTelefono(data.cliente_telefono ?? "");
      setOtIdValido(otIdParam);
    })();
    return () => {
      mounted = false;
    };
  }, [otIdParam]);

  /* ── Búsqueda de productos (debounce 400ms server-side) ─────────────── */
  const buscarProductos = useCallback(async (q) => {
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
        .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
        .limit(8);
      if (err) throw err;
      setResultados(data ?? []);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }, []);

  const buscarDebounced = useDebouncedCallback(buscarProductos, 400);

  const handleBusquedaChange = (e) => {
    const val = e.target.value;
    setBusqueda(val);
    buscarDebounced(val);
  };

  const handleQRFound = useCallback(async (productoId) => {
    setScannerOpen(false);
    try {
      const { data, error: err } = await supabase
        .from("productos")
        .select(
          "id, nombre, referencia, precio_venta, unidad_medida, categoria, marca",
        )
        .eq("id", productoId)
        .maybeSingle();
      if (err || !data) return;
      agregarAlCarrito(data);
    } catch {
      /* ignore */
    }
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
          precio_unitario: prod.precio_venta,
          unidad: prod.unidad_medida,
          categoria: prod.categoria,
          marca: prod.marca,
          cantidad: 1,
        },
      ];
    });
  };

  const actualizarCantidad = (productoId, delta) => {
    setCarrito((prev) =>
      prev
        .map((i) =>
          i.producto_id !== productoId
            ? i
            : { ...i, cantidad: Math.max(0, i.cantidad + delta) },
        )
        .filter((i) => i.cantidad > 0),
    );
  };

  const setCantidadDirecta = (productoId, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n)) return;
    // Clamp [1, 100000]; teclear 0 NO elimina la fila (eso es la X).
    const clamped = Math.min(100000, Math.max(1, n));
    setCarrito((prev) =>
      prev.map((i) =>
        i.producto_id !== productoId ? i : { ...i, cantidad: clamped },
      ),
    );
  };

  const eliminarItem = (productoId) => {
    setCarrito((prev) => prev.filter((i) => i.producto_id !== productoId));
  };

  /* ── Totales (fórmula consistente con el servidor · IVA dinámico) ───── */
  const subtotal = carrito.reduce(
    (s, i) => s + i.cantidad * i.precio_unitario,
    0,
  );
  const descuento = subtotal * (descuentoPct / 100);
  const baseIva = subtotal - descuento;
  const iva = baseIva * (ivaPct / 100);
  const total = subtotal * (1 - descuentoPct / 100) * (1 + ivaPct / 100);

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
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "fn_registrar_cotizacion",
        {
          p_sede_id: perfil.sede_id,
          p_cliente_nombre: clienteNombre || null,
          p_cliente_nit: clienteNit || null,
          p_cliente_email: clienteEmail || null,
          p_cliente_telefono: clienteTelefono || null,
          p_descuento_pct: descuentoPct,
          p_vigencia_dias: vigenciaDias,
          p_iva_pct: ivaPct,
          p_observaciones: observacionesFinal,
          p_condiciones_pago: condicionesPago || null,
          p_tiempo_entrega_nota: tiempoEntregaNota || null,
          p_items: carrito.map((i) => ({
            producto_id: i.producto_id,
            cantidad: i.cantidad,
            precio_unitario: i.precio_unitario,
          })),
          p_cuentas_ids: cuentasLimpias,
          // Solo pasar ot_id si la pre-carga validó (anti privilege escalation).
          p_ot_id: otIdValido || null,
        },
      );
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

      // Si está vinculada a una OT, COPIAR los ítems cotizados al detalle de la
      // OT (los triggers descuentan stock y suman al total OT).
      if (otIdValido && rpcData?.cotizacion_id) {
        const { error: copyErr } = await supabase.rpc(
          "fn_asociar_cotizacion_a_ot",
          {
            p_cotizacion_id: rpcData.cotizacion_id,
            p_ot_id: otIdValido,
          },
        );
        if (copyErr) {
          console.warn("[CotizacionNueva] No se copiaron items a OT:", copyErr);
          setError(
            `Cotización creada (#${rpcData.numero}), pero no se pudieron copiar los repuestos a la OT: ${copyErr.message}`,
          );
          return;
        }
        navigate(`/ops/ordenes/${otIdValido}`);
        return;
      }
      navigate("/ops/cotizaciones");
    } catch (e) {
      setError(safeError(e, "Error al guardar la cotización"));
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
            {otIdValido ? " · vinculada a OT" : ""}
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
              onDec={(id) => actualizarCantidad(id, -1)}
              onInc={(id) => actualizarCantidad(id, 1)}
              onSet={setCantidadDirecta}
              onEliminar={eliminarItem}
            />
          )}

          {paso === 3 && (
            <PasoAjustes
              descuentoPct={descuentoPct}
              setDescuentoPct={setDescuentoPct}
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
              iva={iva}
              ivaPct={ivaPct}
              total={total}
              ajustes={{
                vigenciaDias,
                descuentoPct,
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
          {descuentoPct > 0 && (
            <div className="cart-line" style={{ color: "var(--warn-700)" }}>
              <span>Descuento ({descuentoPct}%)</span>
              <span className="v" style={{ color: "var(--warn-700)" }}>
                −{formatCOP(descuento)}
              </span>
            </div>
          )}
          <div className="cart-line">
            <span>IVA {ivaPct}%</span>
            <span className="v">{formatCOP(iva)}</span>
          </div>
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
  onDec,
  onInc,
  onSet,
  onEliminar,
}) {
  return (
    <WizCard paso={2} title="Productos a cotizar">
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

      {buscando && (
        <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
          Buscando…
        </p>
      )}

      {resultados.length > 0 && (
        <div
          className="mt-2 overflow-hidden rounded-lg border"
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
                const badge = categoriaBadge(item.categoria);
                return (
                  <tr key={item.producto_id}>
                    <td>
                      <span className="p-sku">{item.referencia ?? "—"}</span>
                      <div className="p-meta">
                        {item.marca ?? item.unidad ?? ""}
                      </div>
                    </td>
                    <td>
                      <div className="p-nm">{item.nombre}</div>
                    </td>
                    <td>
                      {badge ? (
                        <CatBadge cls={badge.cls} label={badge.label} />
                      ) : (
                        <span style={{ color: "var(--n-300)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <QtyControl
                        value={item.cantidad}
                        onDec={() => onDec(item.producto_id)}
                        onInc={() => onInc(item.producto_id)}
                        onSet={(v) => onSet(item.producto_id, v)}
                      />
                    </td>
                    <td
                      className="p-pr"
                      title="Precio del catálogo (no editable)"
                    >
                      {formatCOP(item.precio_unitario)}
                    </td>
                    <td className="p-sub">
                      {formatCOP(item.cantidad * item.precio_unitario)}
                    </td>
                    <td>
                      <button
                        onClick={() => onEliminar(item.producto_id)}
                        className="flex size-7 items-center justify-center rounded-md transition-colors"
                        style={{ color: "var(--n-500)" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "var(--dang-600)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "var(--n-500)")
                        }
                        aria-label="Eliminar producto"
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
        El precio es el del catálogo (no editable). La negociación se hace con
        el descuento % en el paso de ajustes.
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

/* ─────────────────────────── Paso 3 · Ajustes ─────────────────────────── */

function PasoAjustes({
  descuentoPct,
  setDescuentoPct,
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
      <div className="grid grid-cols-3 gap-3">
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
          label="Descuento %"
          value={descuentoPct}
          min={0}
          max={100}
          onChange={(v) => setDescuentoPct(Math.min(100, Math.max(0, v)))}
        />
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--n-500)" }}>
        IVA 0% si la venta no lleva IVA.
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
          {TEXTO_FIJO_ENTREGA}
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
              {carrito.map((i) => (
                <tr key={i.producto_id}>
                  <ReviewTd mono muted>
                    {i.referencia ?? "—"}
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
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="mt-3 flex flex-col gap-1 border-t border-dashed pt-3"
          style={{ borderColor: "var(--n-150)" }}
        >
          <ReviewFootLine label="Subtotal" value={formatCOP(subtotal)} />
          <ReviewFootLine label={`IVA (${ivaPct}%)`} value={formatCOP(iva)} />
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
              ajustes.descuentoPct > 0
                ? `${ajustes.descuentoPct}%`
                : "Sin descuento"
            }
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

      {/* Acciones de generación */}
      <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div
          className="flex flex-col gap-1.5 rounded-[10px] border-2 p-4"
          style={{
            borderColor: "var(--p-600)",
            backgroundColor: "var(--p-50)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <FileText
              className="h-4 w-4"
              style={{ color: "var(--p-700)" }}
              strokeWidth={2}
            />
            <span
              className="text-sm font-medium"
              style={{ color: "var(--p-700)" }}
            >
              Generar PDF y guardar
            </span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--n-500)" }}>
            Usa el botón <b>Generar cotización</b> del resumen. Se guarda la
            cotización y podrás descargar el PDF desde el listado.
          </p>
        </div>
        <div
          className="flex flex-col gap-1.5 rounded-[10px] border p-4"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div className="flex items-center gap-2.5">
            <Save
              className="h-4 w-4"
              style={{ color: "var(--n-500)" }}
              strokeWidth={2}
            />
            <span
              className="text-sm font-medium"
              style={{ color: "var(--n-950)" }}
            >
              Queda como borrador
            </span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--n-500)" }}>
            La cotización se crea en estado borrador. Podrás enviarla o
            convertirla más tarde.
          </p>
        </div>
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

function NumField({ label, value, min, max, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flbl">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="finput"
        style={{ textAlign: "center" }}
      />
    </label>
  );
}
