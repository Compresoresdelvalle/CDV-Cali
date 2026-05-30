import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Plus, X, Users, Pencil, Phone, Mail } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/authStore";
import { useDebounce } from "../../hooks/useDebounce";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { sanitizeSearch, safeError } from "../../lib/utils";

const PAGE_SIZE = 30;
const SELECT_COLS =
  "id, nombre, identificacion, telefono, email, direccion, activo, created_at";

/**
 * Gestión de clientes reutilizables (Bloque 0 #2).
 *
 * - Cualquier autenticado: listar, buscar y crear (vía fn_upsert_cliente).
 * - Solo Admin: editar / desactivar (RLS restringe el UPDATE; la UI lo oculta).
 */
export default function Clientes() {
  const perfil = useAuthStore((s) => s.perfil);
  const esAdmin = perfil?.rol === "Admin";
  const { confirm, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");

  // Modal crear/editar
  const [modal, setModal] = useState(null); // null | { cliente?, ... }

  const debouncedBusqueda = useDebounce(busqueda, 400);
  const fetchTokenRef = useRef(0);
  const pageRef = useRef(0);

  const fetchClientes = useCallback(
    async (append) => {
      const token = ++fetchTokenRef.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        pageRef.current = 0;
      }
      setError(null);
      try {
        const offset = append ? pageRef.current * PAGE_SIZE : 0;
        let q = supabase
          .from("clientes")
          .select(SELECT_COLS)
          .eq("activo", true)
          .order("nombre", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        const raw = sanitizeSearch(debouncedBusqueda);
        if (raw) {
          q = q.or(`nombre.ilike.%${raw}%,identificacion.ilike.%${raw}%`);
        }

        const { data, error: qErr } = await q;
        if (qErr) throw qErr;
        if (token !== fetchTokenRef.current) return;

        const rows = data ?? [];
        if (append) {
          setItems((prev) => [...prev, ...rows]);
          pageRef.current += 1;
        } else {
          setItems(rows);
          pageRef.current = 1;
        }
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        if (token !== fetchTokenRef.current) return;
        setError(safeError(err, "No se pudieron cargar los clientes"));
        if (!append) setItems([]);
        setHasMore(false);
      } finally {
        if (token === fetchTokenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedBusqueda],
  );

  useEffect(() => {
    fetchClientes(false);
  }, [fetchClientes]);

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) fetchClientes(true);
  }, [hasMore, loadingMore, loading, fetchClientes]);

  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      observer.disconnect();
    };
  }, [loadMore]);

  const desactivar = async (cliente) => {
    const ok = await confirm({
      titulo: "Desactivar cliente",
      mensaje: `¿Desactivar a "${cliente.nombre}"? Dejará de aparecer en el listado y en el autocompletado, pero los documentos asociados se conservan.`,
      confirmLabel: "Desactivar",
      danger: true,
    });
    if (!ok) return;
    try {
      const { error: e } = await supabase
        .from("clientes")
        .update({ activo: false })
        .eq("id", cliente.id);
      if (e) throw e;
      setItems((prev) => prev.filter((c) => c.id !== cliente.id));
    } catch (err) {
      setError(safeError(err, "No se pudo desactivar el cliente"));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-[18px] px-4 py-5 sm:px-7 sm:py-6 animate-fade-in">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em]"
            style={{ color: "var(--n-300)" }}
          >
            Operaciones · Clientes ·{" "}
            {loading
              ? "cargando…"
              : `${items.length}${hasMore ? "+" : ""} activos`}
          </p>
          <h1
            className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.018em]"
            style={{ color: "var(--n-950)" }}
          >
            Clientes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModal({})}
            className="btn btn-pri"
            style={{ height: 48 }}
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nuevo cliente
          </button>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-12 flex-1 items-center gap-2.5 rounded-lg border px-3.5"
          style={{ borderColor: "var(--n-200)", backgroundColor: "var(--n-0)" }}
        >
          <Search
            className="h-4 w-4 shrink-0"
            strokeWidth={1.5}
            style={{ color: "var(--n-500)" }}
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o identificación…"
            className="flex-1 border-none bg-transparent text-[14px] outline-none"
            style={{ color: "var(--n-950)" }}
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="grid h-6 w-6 place-items-center rounded"
              style={{ color: "var(--n-500)" }}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-[10px] border p-4"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: "var(--dang-700)" }}
          >
            {error}
          </p>
        </div>
      )}

      {loading && <SkeletonList />}

      {!loading && items.length === 0 && !error && (
        <EmptyState filtroBusqueda={debouncedBusqueda} />
      )}

      {!loading && items.length > 0 && (
        <>
          {/* Móvil: cards */}
          <ul className="md:hidden space-y-2.5" role="list">
            {items.map((c) => (
              <li key={c.id}>
                <ClienteCard
                  cliente={c}
                  esAdmin={esAdmin}
                  onEdit={() => setModal({ cliente: c })}
                  onDesactivar={() => desactivar(c)}
                />
              </li>
            ))}
          </ul>

          {/* Desktop: tabla */}
          <div
            className="hidden md:block min-w-0 overflow-hidden rounded-[10px] border"
            style={{
              borderColor: "var(--n-150)",
              backgroundColor: "var(--n-0)",
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th width={170}>Identificación</Th>
                    <Th width={150}>Teléfono</Th>
                    <Th width={220}>Correo</Th>
                    {esAdmin && <Th width={120} right />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <ClienteFila
                      key={c.id}
                      cliente={c}
                      esAdmin={esAdmin}
                      onEdit={() => setModal({ cliente: c })}
                      onDesactivar={() => desactivar(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div ref={sentinelRef} className="h-4" />

      {loadingMore && (
        <div className="flex justify-center py-4">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2"
            style={{
              borderColor: "var(--p-200)",
              borderTopColor: "var(--p-600)",
            }}
          />
        </div>
      )}

      {modal && (
        <ClienteModal
          cliente={modal.cliente}
          esAdmin={esAdmin}
          onClose={() => setModal(null)}
          onSaved={(saved, esNuevo) => {
            setModal(null);
            if (esNuevo) {
              // Recargar para respetar el orden alfabético del listado.
              fetchClientes(false);
            } else {
              setItems((prev) =>
                prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
              );
            }
          }}
        />
      )}

      <ConfirmDialog />
    </div>
  );
}

/* ─────────────────────────── Modal crear/editar ─────────────────────────── */

function ClienteModal({ cliente, esAdmin, onClose, onSaved }) {
  const esEdicion = !!cliente?.id;
  const soloLectura = esEdicion && !esAdmin; // no-admin no puede editar existentes

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [identificacion, setIdentificacion] = useState(
    cliente?.identificacion ?? "",
  );
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [email, setEmail] = useState(cliente?.email ?? "");
  const [direccion, setDireccion] = useState(cliente?.direccion ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    try {
      if (esEdicion) {
        // Editar: UPDATE directo (RLS solo permite a Admin).
        const payload = {
          nombre: nombre.trim(),
          identificacion: identificacion.trim() || null,
          telefono: telefono.trim() || null,
          email: email.trim() || null,
          direccion: direccion.trim() || null,
        };
        const { data, error: e2 } = await supabase
          .from("clientes")
          .update(payload)
          .eq("id", cliente.id)
          .select(SELECT_COLS)
          .single();
        if (e2) throw e2;
        onSaved(data, false);
      } else {
        // Crear/reutilizar: RPC (cualquier autenticado).
        const { data, error: e2 } = await supabase.rpc("fn_upsert_cliente", {
          p_nombre: nombre.trim(),
          p_identificacion: identificacion.trim() || null,
          p_telefono: telefono.trim() || null,
          p_email: email.trim() || null,
          p_direccion: direccion.trim() || null,
        });
        if (e2) throw e2;
        const row = Array.isArray(data) ? data[0] : data;
        onSaved(row, true);
      }
    } catch (err) {
      setError(safeError(err, "No se pudo guardar el cliente"));
    } finally {
      setGuardando(false);
      guardandoRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ backgroundColor: "var(--n-0)" }}
        role="dialog"
        aria-labelledby="cliente-modal-title"
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--n-100)" }}
        >
          <h2
            id="cliente-modal-title"
            className="text-[17px] font-semibold"
            style={{ color: "var(--n-950)" }}
          >
            {esEdicion ? "Editar cliente" : "Nuevo cliente"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-8 w-8 place-items-center rounded-md"
            style={{ color: "var(--n-500)" }}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <form onSubmit={guardar} className="flex flex-col gap-3.5 p-5">
          {soloLectura && (
            <div
              className="rounded-lg border px-3.5 py-2.5 text-[12.5px]"
              style={{
                backgroundColor: "var(--info-50)",
                borderColor: "var(--info-border)",
                color: "var(--info-700)",
              }}
            >
              Solo un Admin puede editar clientes existentes.
            </div>
          )}

          <ModalField label="Nombre *">
            <ModalInput
              value={nombre}
              onChange={setNombre}
              disabled={soloLectura}
              required
              autoFocus
              placeholder="Ej. Industrial XYZ S.A.S."
            />
          </ModalField>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <ModalField label="NIT o Cédula">
              <ModalInput
                value={identificacion}
                onChange={setIdentificacion}
                disabled={soloLectura}
                placeholder="900.123.456-7"
              />
            </ModalField>
            <ModalField label="Teléfono">
              <ModalInput
                value={telefono}
                onChange={setTelefono}
                disabled={soloLectura}
                placeholder="3001234567"
              />
            </ModalField>
          </div>
          <ModalField label="Correo">
            <ModalInput
              value={email}
              onChange={setEmail}
              disabled={soloLectura}
              type="email"
              placeholder="contacto@empresa.com"
            />
          </ModalField>
          <ModalField label="Dirección">
            <ModalInput
              value={direccion}
              onChange={setDireccion}
              disabled={soloLectura}
              placeholder="Calle, ciudad, departamento"
            />
          </ModalField>

          {error && (
            <p
              className="text-[12.5px] font-medium"
              style={{ color: "var(--dang-700)" }}
            >
              {error}
            </p>
          )}

          <div className="mt-1 flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="flex-1 rounded-lg border text-sm font-medium disabled:opacity-50"
              style={{
                height: 48,
                borderColor: "var(--n-200)",
                color: "var(--n-700)",
                backgroundColor: "var(--n-0)",
              }}
            >
              {soloLectura ? "Cerrar" : "Cancelar"}
            </button>
            {!soloLectura && (
              <button
                type="submit"
                disabled={guardando}
                className="flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ height: 48, backgroundColor: "var(--p-600)" }}
                onMouseEnter={(e) => {
                  if (!guardando)
                    e.currentTarget.style.backgroundColor = "var(--p-700)";
                }}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--p-600)")
                }
              >
                {guardando
                  ? "Guardando…"
                  : esEdicion
                    ? "Guardar cambios"
                    : "Crear cliente"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalField({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function ModalInput({ value, onChange, type = "text", disabled, ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border px-3 text-sm outline-none disabled:opacity-60"
      style={{
        height: 48,
        backgroundColor: "var(--n-0)",
        borderColor: "var(--n-200)",
        color: "var(--n-950)",
      }}
      {...rest}
    />
  );
}

/* ─────────────────────────── Subcomponentes lista ─────────────────────────── */

function Th({ children, width, right }) {
  return (
    <th
      style={{ width, backgroundColor: "var(--n-50)", color: "var(--n-500)" }}
      className={
        "border-b px-2.5 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] " +
        (right ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, right }) {
  return (
    <td
      className={"border-b px-2.5 py-2.5 " + (right ? "text-right" : "")}
      style={{ borderColor: "var(--n-100)" }}
    >
      {children}
    </td>
  );
}

function ClienteFila({ cliente: c, esAdmin, onEdit, onDesactivar }) {
  return (
    <tr>
      <Td>
        <span className="font-medium" style={{ color: "var(--n-950)" }}>
          {c.nombre}
        </span>
      </Td>
      <Td>
        <span
          className="font-mono text-[12px]"
          style={{ color: "var(--n-700)" }}
        >
          {c.identificacion || "—"}
        </span>
      </Td>
      <Td>
        <span style={{ color: "var(--n-700)" }}>{c.telefono || "—"}</span>
      </Td>
      <Td>
        <span className="truncate" style={{ color: "var(--n-700)" }}>
          {c.email || "—"}
        </span>
      </Td>
      {esAdmin && (
        <Td right>
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[12px] font-medium"
              style={{ borderColor: "var(--n-200)", color: "var(--p-700)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--p-50)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
            >
              <Pencil className="h-3 w-3" strokeWidth={2} /> Editar
            </button>
            <button
              onClick={onDesactivar}
              className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-[12px] font-medium"
              style={{
                borderColor: "var(--dang-border)",
                color: "var(--dang-700)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--dang-50)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
            >
              Desactivar
            </button>
          </div>
        </Td>
      )}
    </tr>
  );
}

function ClienteCard({ cliente: c, esAdmin, onEdit, onDesactivar }) {
  return (
    <div
      className="w-full rounded-[10px] border px-4 py-3.5 shadow-sm"
      style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
    >
      <p
        className="text-[14px] font-medium leading-tight"
        style={{ color: "var(--n-950)" }}
      >
        {c.nombre}
      </p>
      {c.identificacion && (
        <p
          className="mt-0.5 font-mono text-[11px] tracking-[0.04em]"
          style={{ color: "var(--n-500)" }}
        >
          {c.identificacion}
        </p>
      )}
      <div
        className="mt-1.5 flex flex-col gap-1 text-[12.5px]"
        style={{ color: "var(--n-700)" }}
      >
        {c.telefono && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="h-3 w-3" strokeWidth={1.8} /> {c.telefono}
          </span>
        )}
        {c.email && (
          <span className="inline-flex items-center gap-1.5">
            <Mail className="h-3 w-3" strokeWidth={1.8} /> {c.email}
          </span>
        )}
      </div>
      {esAdmin && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 rounded-lg border text-[13px] font-medium"
            style={{
              height: 44,
              borderColor: "var(--n-200)",
              color: "var(--p-700)",
            }}
          >
            Editar
          </button>
          <button
            onClick={onDesactivar}
            className="flex-1 rounded-lg border text-[13px] font-medium"
            style={{
              height: 44,
              borderColor: "var(--dang-border)",
              color: "var(--dang-700)",
            }}
          >
            Desactivar
          </button>
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[10px] border p-4"
          style={{ borderColor: "var(--n-150)", backgroundColor: "var(--n-0)" }}
        >
          <div className="space-y-2">
            <div
              className="h-4 w-3/4 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
            <div
              className="h-3 w-1/2 rounded"
              style={{ backgroundColor: "var(--n-100)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtroBusqueda }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-[12px]"
        style={{ backgroundColor: "var(--p-50)", color: "var(--p-600)" }}
      >
        <Users className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="font-semibold" style={{ color: "var(--n-950)" }}>
        Sin clientes
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--n-500)" }}>
        {filtroBusqueda
          ? `No se encontraron clientes para "${filtroBusqueda}"`
          : "Aún no hay clientes. Crea el primero con “Nuevo cliente”."}
      </p>
    </div>
  );
}
