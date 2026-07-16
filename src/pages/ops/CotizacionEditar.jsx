import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftCircle,
  Search,
  ScanLine,
  Trash2,
  Minus,
  Plus,
  Lock,
  Save,
  AlertCircle,
  Info,
  Wrench,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCOP, sanitizeSearch, safeError } from "../../lib/utils";
import QRScanner from "../../components/forms/QRScanner";
import UbicacionChip from "../../components/ui/UbicacionChip";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import SelectorCuentasBancarias from "../../components/cotizaciones/SelectorCuentasBancarias";
import {
  categoriaBadge,
  componerObservaciones,
  descomponerObservaciones,
} from "../../lib/cotizaciones-ui";

// Texto fijo de condiciones de entrega (Lovable · locked, idéntico al PDF).
const TEXTO_FIJO_ENTREGA =
  "El cliente se compromete a recibir la mercancía en las condiciones físicas en que se entrega. Cualquier reclamo sobre defectos visibles debe realizarse al momento de la entrega. Las garantías aplican según política de fábrica del producto. Los precios incluyen embalaje estándar. Embalaje especial bajo cotización adicional.";

// Misma regex que el CHECK del servidor (RFC simplificado).
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export default function CotizacionEditar() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [numero, setNumero] = useState(null);
  const [noEditable, setNoEditable] = useState(null);
  // Sede de la cotización (para mostrar la ubicación física del producto).
  const [sedeId, setSedeId] = useState(null);
  const guardandoRef = useRef(false);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [carrito, setCarrito] = useState([]);

  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteNit, setClienteNit] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [clienteContacto, setClienteContacto] = useState("");
  const [clienteCargo, setClienteCargo] = useState("");
  const [clienteDireccion, setClienteDireccion] = useState("");

  // B4: descuento en $ + domicilio (reemplazan al % legado).
  const [descuentoValor, setDescuentoValor] = useState(0);
  const [domicilio, setDomicilio] = useState(0);
  const [vigenciaDias, setVigenciaDias] = useState(15);
  const [ivaPct, setIvaPct] = useState(19);
  const [observaciones, setObservaciones] = useState("");
  const [condicionesPago, setCondicionesPago] = useState("");
  const [tiempoEntregaNota, setTiempoEntregaNota] = useState("");
  const [cuentasIds, setCuentasIds] = useState([]);

  // B4: catálogo de servicios activos para agregar a la cotización.
  const [servicios, setServicios] = useState([]);
  useEffect(() => {
    supabase
      .from("servicios")
      .select("id, nombre, precio, iva_pct")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setServicios(data ?? []));
  }, []);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [erroresCampos, setErroresCampos] = useState({});

  /* ── Cargar cotización existente ───────────────────────────────────── */
  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const [{ data: cot, error: cotErr }, { data: filas, error: itemsErr }] =
          await Promise.all([
            supabase.from("cotizaciones").select("*").eq("id", id).single(),
            supabase
              .from("detalle_cotizacion")
              .select(
                `*, producto:producto_id(id, nombre, referencia, unidad_medida, precio_venta, categoria, marca)`,
              )
              .eq("cotizacion_id", id),
          ]);

        if (cotErr) throw cotErr;
        if (itemsErr) throw itemsErr;

        setNumero(cot.numero);
        setSedeId(cot.sede_id ?? null);
        // Solo editable en borrador y si no fue convertida (B9-6: editar una
        // enviada/rechazada fallaba luego con "Transición ilegal a borrador").
        if (cot.venta_id) {
          setNoEditable("Esta cotización ya fue convertida en venta.");
        } else if (cot.estado !== "borrador") {
          setNoEditable(
            `Solo se puede editar una cotización en estado Borrador (estado actual: "${cot.estado}").`,
          );
        }

        // Los datos extendidos del cliente viven dentro de observaciones.
        const extra = descomponerObservaciones(cot.observaciones);
        setClienteNombre(cot.cliente_nombre ?? "");
        setClienteNit(cot.cliente_nit ?? "");
        setClienteEmail(cot.cliente_email ?? "");
        setClienteTelefono(cot.cliente_telefono ?? "");
        setClienteContacto(extra.contacto ?? "");
        setClienteCargo(extra.cargo ?? "");
        setClienteDireccion(extra.direccion ?? "");
        // B4: descuento en $ (si la cotización es legada en %, se convierte a $
        // usando su subtotal guardado para no perder el descuento al editar).
        setDescuentoValor(
          cot.descuento_valor ??
            (cot.descuento_pct
              ? Math.round((cot.subtotal ?? 0) * (cot.descuento_pct / 100))
              : 0),
        );
        setDomicilio(cot.domicilio ?? 0);
        setVigenciaDias(cot.vigencia_dias ?? 15);
        setIvaPct(cot.iva_pct ?? 19);
        setObservaciones(extra.notas ?? "");
        setCondicionesPago(cot.condiciones_pago ?? "");
        setTiempoEntregaNota(cot.tiempo_entrega_nota ?? "");

        const { data: cuentas } = await supabase
          .from("cotizacion_cuentas_bancarias")
          .select("cuenta_id")
          .eq("cotizacion_id", id);
        setCuentasIds((cuentas ?? []).map((r) => r.cuenta_id));

        setCarrito(
          (filas ?? []).map((i) =>
            i.servicio_id != null
              ? {
                  tipo: "servicio",
                  servicio_id: i.servicio_id,
                  nombre: i.descripcion ?? "Servicio",
                  precio_unitario: i.precio_unitario,
                  cantidad: i.cantidad,
                }
              : {
                  tipo: "producto",
                  producto_id: i.producto_id,
                  nombre: i.producto?.nombre ?? "—",
                  referencia: i.producto?.referencia ?? "",
                  unidad: i.producto?.unidad_medida ?? "",
                  categoria: i.producto?.categoria ?? null,
                  marca: i.producto?.marca ?? null,
                  // B4: el precio es editable; conservar el guardado en la línea.
                  precio_unitario: i.precio_unitario,
                  cantidad: i.cantidad,
                },
          ),
        );
      } catch (e) {
        setError(safeError(e, "No se pudo cargar la cotización"));
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, [id]);

  /* ── Búsqueda de productos (debounce 400ms server-side) ────────────── */
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
          // Bloque 2 / COT-H: los insumos no se cotizan/venden. CotizacionNueva
          // ya filtraba vendible; al editar faltaba y dejaba colar insumos.
          .eq("vendible", true)
          .or(`nombre.ilike.%${safe}%,referencia.ilike.%${safe}%`)
          .limit(1000);
        if (err) throw err;
        // Ubicación física en la sede de esta cotización (solo referencia
        // visual; no afecta stock ni validaciones).
        let ubicMap = {};
        if (data?.length && sedeId) {
          const { data: inv } = await supabase
            .from("inventario")
            .select("producto_id, ubicacion_id")
            .eq("sede_id", sedeId)
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
    [sedeId],
  );

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
        .eq("activo", true)
        // COT-H: mismo filtro que en la búsqueda — no cotizar insumos.
        .eq("vendible", true)
        .single();
      if (err || !data) return;
      agregarAlCarrito(data);
    } catch {
      /* ignore */
    }
  }, []);

  // Identidad de línea (producto o servicio).
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
          unidad: prod.unidad_medida,
          categoria: prod.categoria,
          marca: prod.marca,
          precio_unitario: prod.precio_venta,
          cantidad: 1,
        },
      ];
    });
  };

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

  // B4: precio editable por línea. Solo dígitos; vacío = 0.
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

  /* ── Totales (fórmula consistente con el servidor · IVA dinámico) ──── */
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

  /* ── Guardar cambios ───────────────────────────────────────────────── */
  const validar = () => {
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

  const guardarCambios = async () => {
    if (carrito.length === 0) return;
    setError(null);
    if (!validar()) {
      setError("Revisa los campos del cliente antes de guardar.");
      return;
    }
    // Guard síncrono anti doble-submit.
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    const cuentasLimpias = cuentasIds.filter(
      (cid) => Number.isInteger(cid) && cid > 0,
    );
    // Contacto/Cargo/Dirección no tienen columna propia → se preservan dentro
    // de las observaciones libres (sin inventar esquema), igual que en Nueva.
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
      // RPC server-authoritative: recalcula precios desde el catálogo, valida
      // el estado editable, y persiste cotización + detalle + cuentas en una
      // sola transacción (cierra F4-08, F11-01 y F11-02).
      const { error: rpcErr } = await supabase.rpc("fn_editar_cotizacion", {
        p_cotizacion_id: id,
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
      });
      if (rpcErr) throw new Error(rpcErr.message);
      navigate(`/ops/cotizaciones/${id}`);
    } catch (e) {
      setError(safeError(e, "Error al guardar los cambios"));
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  /* ── Estados de carga / no editable ────────────────────────────────── */
  if (loading) {
    return (
      <div className="px-4 pb-16 pt-5 sm:px-7 animate-pulse">
        <div
          className="h-8 w-1/3 rounded-lg"
          style={{ backgroundColor: "var(--n-100)" }}
        />
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="mt-4 h-24 rounded-[10px] border"
            style={{
              backgroundColor: "var(--n-0)",
              borderColor: "var(--n-150)",
            }}
          />
        ))}
      </div>
    );
  }

  if (error && !carrito.length && !numero) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm" style={{ color: "var(--dang-700)" }}>
          {error}
        </p>
      </div>
    );
  }

  // F11-02: una cotización aprobada/vencida o ya convertida no es editable.
  if (noEditable) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-[1100px] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm" style={{ color: "var(--n-950)" }}>
          {noEditable}
        </p>
        <button
          onClick={() => navigate(`/ops/cotizaciones/${id}`)}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          <ArrowLeftCircle className="h-4 w-4" strokeWidth={1.7} />
          Volver a la cotización
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-16 pt-5 sm:px-7 animate-fade-in">
      <button
        onClick={() => navigate(`/ops/cotizaciones/${id}`)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "var(--n-500)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--n-700)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--n-500)")}
      >
        <ArrowLeftCircle className="h-3.5 w-3.5" strokeWidth={1.7} />
        Volver a la cotización
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
            Editar cotización
          </p>
          <h1
            className="m-0 text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--n-950)" }}
          >
            Editar cotización #{numero}
          </h1>
        </div>
        <button
          onClick={() => navigate(`/ops/cotizaciones/${id}`)}
          className="btn btn-out"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
      </div>

      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* ── Columna principal ─────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Productos */}
          <EditCard title="Productos a cotizar">
            {/* Buscador + QR */}
            <div className="flex items-stretch">
              <div
                className="flex h-12 flex-1 items-center gap-2.5 rounded-l-[10px] border border-r-0 px-3.5"
                style={{
                  borderColor: "var(--n-150)",
                  backgroundColor: "var(--n-0)",
                }}
              >
                <Search
                  className="h-4 w-4 shrink-0"
                  strokeWidth={1.5}
                  style={{ color: "var(--n-500)" }}
                />
                <input
                  type="text"
                  value={busqueda}
                  onChange={handleBusquedaChange}
                  placeholder="Buscar producto por nombre o referencia… o escanea QR"
                  className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
                  style={{ color: "var(--n-950)" }}
                />
              </div>
              <button
                onClick={() => setScannerOpen(true)}
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
                  htmlFor="cot-edit-serv-add"
                  className="inline-flex items-center gap-1.5 text-[12px]"
                  style={{ color: "var(--n-500)" }}
                >
                  <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />
                  Servicio
                </label>
                <select
                  id="cot-edit-serv-add"
                  value=""
                  onChange={(e) => {
                    const s = servicios.find(
                      (x) => String(x.id) === e.target.value,
                    );
                    if (s) agregarServicioAlCarrito(s);
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
                      onClick={() => agregarAlCarrito(p)}
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
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className="truncate text-sm font-medium"
                            style={{ color: "var(--n-950)" }}
                          >
                            {p.nombre}
                          </p>
                          {badge && (
                            <CatBadge cls={badge.cls} label={badge.label} />
                          )}
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
                        <p
                          className="text-xs"
                          style={{ color: "var(--n-500)" }}
                        >
                          {p.unidad_medida}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Tabla del carrito */}
            {carrito.length === 0 ? (
              <div
                className="mt-3 rounded-[10px] border border-dashed px-4 py-10 text-center text-sm"
                style={{ borderColor: "var(--n-200)", color: "var(--n-500)" }}
              >
                Sin productos — agrega o escanea al menos uno
              </div>
            ) : (
              <div
                className="mt-3 overflow-hidden overflow-x-auto rounded-[10px] border"
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
                              onDec={() => actualizarCantidad(key, -1)}
                              onInc={() => actualizarCantidad(key, 1)}
                              onSet={(v) => setCantidadDirecta(key, v)}
                            />
                          </td>
                          <td className="p-pr">
                            <PriceInput
                              value={item.precio_unitario}
                              onSet={(v) => setPrecioDirecto(key, v)}
                            />
                          </td>
                          <td className="p-sub">
                            {formatCOP(item.cantidad * item.precio_unitario)}
                          </td>
                          <td>
                            <button
                              onClick={() => eliminarItem(key)}
                              className="flex size-7 items-center justify-center rounded-md transition-colors"
                              style={{ color: "var(--n-500)" }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.color =
                                  "var(--dang-600)")
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
              El precio es editable por línea. También puedes aplicar descuento
              en $ y domicilio en los ajustes.
            </p>
          </EditCard>

          {/* Cliente */}
          <EditCard
            title="Datos del cliente"
            sub="Sin módulo de clientes (decisión del cliente). Captura los datos como texto libre."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldText
                full
                label="Cliente"
                required
                value={clienteNombre}
                onChange={setClienteNombre}
                placeholder="Ej. Industrial XYZ S.A.S."
                sans
                error={erroresCampos.nombre}
              />
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
                error={erroresCampos.email}
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
                <b>Contacto, cargo y dirección</b> se guardan junto a las notas
                de la cotización y aparecen en el PDF. Solo el <b>nombre</b> es
                obligatorio.
              </div>
            </div>
          </EditCard>

          {/* Ajustes */}
          <EditCard
            title="Ajustes de la cotización"
            sub="Configura los términos comerciales según el caso."
          >
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
              IVA 0% si la venta no lleva IVA. El descuento se resta antes del
              IVA; el domicilio se suma después (no se grava).
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

            <Divider />
            <SubHead>Cuentas bancarias para pago</SubHead>
            <p className="mb-3 text-[12px]" style={{ color: "var(--n-500)" }}>
              Selecciona qué cuentas bancarias aparecerán en el PDF de la
              cotización. Puedes elegir varias.
            </p>
            <SelectorCuentasBancarias
              selectedIds={cuentasIds}
              onChange={setCuentasIds}
              ivaPct={ivaPct}
            />

            <Divider />
            <SubHead>Texto fijo de condiciones de entrega</SubHead>
            <div
              className="rounded-lg border p-3.5"
              style={{
                backgroundColor: "var(--n-50)",
                borderColor: "var(--n-100)",
              }}
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
          </EditCard>

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
        </div>

        {/* ── Resumen (sticky) ──────────────────────────────────────── */}
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
          <button
            onClick={guardarCambios}
            disabled={carrito.length === 0 || guardando}
            className="btn btn-pri mt-2 w-full justify-center disabled:opacity-40"
            style={{ height: 48 }}
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
            {!guardando && <Save className="h-4 w-4" strokeWidth={2} />}
          </button>
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

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function EditCard({ title, sub, children }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: "var(--n-100)" }}
      >
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
