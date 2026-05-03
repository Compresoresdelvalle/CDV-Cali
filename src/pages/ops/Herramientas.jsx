import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { formatDate, sanitizeSearch, safeError } from "../../lib/utils";
import PageHeader from "../../components/layout/PageHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import PlusIcon from "../../components/ui/PlusIcon";

const FILTROS = [
  "Todas",
  "Disponibles",
  "Prestadas",
  "Mantenimiento",
  "Extraviadas",
];
const FILTRO_TO_ESTADO = {
  Disponibles: "disponible",
  Prestadas: "prestada",
  Mantenimiento: "en_mantenimiento",
  Extraviadas: "extraviada",
};

export default function Herramientas() {
  const perfil = useAuthStore((s) => s.perfil);
  const isAdmin = perfil?.rol === "Admin";

  const [herramientas, setHerramientas] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("Todas");
  const [search, setSearch] = useState("");
  const [accionando, setAccionando] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Modal state
  const [modalPrestar, setModalPrestar] = useState(null); // herramienta seleccionada
  const [modalNueva, setModalNueva] = useState(false);

  const cargarHerramientas = async (signal) => {
    setLoading(true);
    setErrorMsg("");
    try {
      let query = supabase
        .from("herramientas_prestamo")
        .select(
          `
          id, herramienta_nombre, herramienta_codigo, estado, prestada_a,
          fecha_prestamo, fecha_devolucion_esperada, fecha_devolucion_real,
          sede_id, observaciones,
          usuario:prestada_a(nombre)
        `,
        )
        .order("herramienta_nombre", { ascending: true });

      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        query = query.eq("sede_id", perfil.sede_id);

      const estadoFiltro = FILTRO_TO_ESTADO[filtro];
      if (estadoFiltro) query = query.eq("estado", estadoFiltro);

      const q = sanitizeSearch(search.trim());
      if (q)
        query = query.or(
          `herramienta_nombre.ilike.%${q}%,herramienta_codigo.ilike.%${q}%`,
        );

      const { data, error } = await query;
      if (signal?.aborted || !mountedRef.current) return;
      if (error) throw error;
      setHerramientas(data ?? []);
    } catch (err) {
      if (signal?.aborted || !mountedRef.current) return;
      console.error("[Herramientas] cargar:", err);
      setErrorMsg(safeError(err, "Error al cargar herramientas"));
      setHerramientas([]);
    } finally {
      if (!signal?.aborted && mountedRef.current) setLoading(false);
    }
  };

  const cargarUsuarios = async () => {
    try {
      let q = supabase
        .from("usuarios")
        .select("id, nombre, rol, sede_id")
        .eq("activo", true)
        .order("nombre");
      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        q = q.eq("sede_id", perfil.sede_id);
      const { data, error } = await q;
      if (error) throw error;
      setUsuarios(data ?? []);
    } catch (err) {
      console.error("[Herramientas] usuarios:", err);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, [perfil?.sede_id, perfil?.rol]);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => cargarHerramientas(ac.signal), 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [filtro, search, perfil?.sede_id]);

  const devolver = async (h) => {
    setAccionando(h.id);
    setErrorMsg("");
    try {
      // Defensa en profundidad: además del filtro id, restringimos por sede
      // para que un usuario no pueda devolver una herramienta de otra sede
      // si la RLS llegase a ser permisiva.
      let q = supabase
        .from("herramientas_prestamo")
        .update({
          estado: "disponible",
          estado_prestamo: "devuelto",
          fecha_devolucion_real: new Date().toISOString(),
          prestada_a: null,
        })
        .eq("id", h.id)
        // Guard de estado: solo si está prestada (anti race con doble click)
        .eq("estado", "prestada");
      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        q = q.eq("sede_id", perfil.sede_id);
      // .select() para confirmar count y detectar si la herramienta ya estaba devuelta
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        setErrorMsg("Esta herramienta ya estaba devuelta o no tienes permiso");
        await cargarHerramientas();
        return;
      }
      await cargarHerramientas();
    } catch (err) {
      setErrorMsg(safeError(err, "Error al devolver herramienta"));
    } finally {
      setAccionando(null);
    }
  };

  return (
    <div
      className="p-4 sm:p-6 space-y-4 animate-fade-in"
      style={{ backgroundColor: "hsl(var(--background))" }}
    >
      <PageHeader
        title="Herramientas"
        description={
          !loading ? `${herramientas.length} registros` : "Cargando…"
        }
        actions={
          isAdmin && (
            <button
              onClick={() => setModalNueva(true)}
              className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity cursor-pointer"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <PlusIcon />
              Nueva herramienta
            </button>
          )
        }
      />

      {/* Banner de error */}
      {errorMsg && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Buscador */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre o código…"
        className="w-full h-10 px-3 rounded-lg border text-sm"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
          color: "hsl(var(--foreground))",
        }}
      />

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
            style={
              filtro === f
                ? {
                    backgroundColor: "hsl(var(--primary))",
                    color: "hsl(var(--primary-foreground))",
                    borderColor: "hsl(var(--primary))",
                  }
                : {
                    backgroundColor: "transparent",
                    color: "hsl(var(--muted-foreground))",
                    borderColor: "hsl(var(--border))",
                  }
            }
          >
            {f}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading && herramientas.length === 0 ? (
        <SkeletonList />
      ) : herramientas.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {herramientas.map((h) => (
            <li key={h.id}>
              <HerramientaCard
                h={h}
                accionando={accionando === h.id}
                onPrestar={() => setModalPrestar(h)}
                onDevolver={() => devolver(h)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Modales */}
      {modalPrestar && (
        <ModalPrestar
          herramienta={modalPrestar}
          usuarios={usuarios}
          onClose={() => setModalPrestar(null)}
          onSaved={async () => {
            setModalPrestar(null);
            await cargarHerramientas();
          }}
        />
      )}
      {modalNueva && (
        <ModalNueva
          sedeDefault={perfil?.sede_id ?? "BOD-PRINCIPAL"}
          onClose={() => setModalNueva(false)}
          onSaved={async () => {
            setModalNueva(false);
            await cargarHerramientas();
          }}
        />
      )}
    </div>
  );
}

/* ── Card ────────────────────────────────────────────────────────────── */

function HerramientaCard({ h, accionando, onPrestar, onDevolver }) {
  const vencida =
    h.estado === "prestada" &&
    h.fecha_devolucion_esperada &&
    new Date(h.fecha_devolucion_esperada) < new Date();

  return (
    <div
      className="rounded-xl px-4 py-4 border h-full flex flex-col"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: vencida ? "hsl(var(--destructive))" : "hsl(var(--border))",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {h.herramienta_nombre}
          </p>
          {h.herramienta_codigo && (
            <p
              className="text-xs font-mono mt-0.5"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {h.herramienta_codigo}
            </p>
          )}
        </div>
        <StatusBadge status={h.estado} />
      </div>

      {h.estado === "prestada" && (
        <div
          className="text-xs space-y-0.5 mt-1 mb-3"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <p>
            <span className="font-medium">Prestada a:</span>{" "}
            {h.usuario?.nombre ?? "—"}
          </p>
          {h.fecha_prestamo && (
            <p>
              <span className="font-medium">Desde:</span>{" "}
              {formatDate(h.fecha_prestamo)}
            </p>
          )}
          {h.fecha_devolucion_esperada && (
            <p
              style={{ color: vencida ? "hsl(var(--destructive))" : undefined }}
            >
              <span className="font-medium">
                {vencida ? "Vencida desde:" : "Devolver:"}
              </span>{" "}
              {formatDate(h.fecha_devolucion_esperada)}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto pt-2">
        {h.estado === "disponible" && (
          <button
            onClick={onPrestar}
            disabled={accionando}
            className="w-full h-12 rounded-lg text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "hsl(var(--primary))",
              color: "hsl(var(--primary))",
              backgroundColor: "hsl(var(--primary) / 0.05)",
            }}
          >
            Prestar
          </button>
        )}
        {h.estado === "prestada" && (
          <button
            onClick={onDevolver}
            disabled={accionando}
            className="w-full h-12 rounded-lg text-sm font-medium border transition-all disabled:opacity-50 cursor-pointer"
            style={{
              borderColor: "hsl(var(--success))",
              color: "hsl(var(--success))",
              backgroundColor: "hsl(var(--success) / 0.05)",
            }}
          >
            {accionando ? "Procesando…" : "Marcar devuelta"}
          </button>
        )}
        {h.estado === "en_mantenimiento" && (
          <p
            className="text-xs text-center py-3"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            En mantenimiento
          </p>
        )}
        {h.estado === "extraviada" && (
          <p
            className="text-xs text-center py-3"
            style={{ color: "hsl(var(--destructive))" }}
          >
            Extraviada
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Modal: Prestar ──────────────────────────────────────────────────── */

function ModalPrestar({ herramienta, usuarios, onClose, onSaved }) {
  const perfil = useAuthStore((s) => s.perfil);
  const [usuarioId, setUsuarioId] = useState("");
  const [fechaEsperada, setFechaEsperada] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guardar = async (e) => {
    e.preventDefault();
    if (!usuarioId) {
      setError("Selecciona un usuario");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Fecha esperada: 17:00 hora Colombia (UTC-5) = 22:00 UTC del mismo día
      const fechaEsperadaISO = new Date(
        `${fechaEsperada}T17:00:00-05:00`,
      ).toISOString();
      // Defensa en profundidad: restringir UPDATE a la sede del usuario.
      let q = supabase
        .from("herramientas_prestamo")
        .update({
          estado: "prestada",
          estado_prestamo: "activo",
          prestada_a: usuarioId,
          fecha_prestamo: new Date().toISOString(),
          fecha_devolucion_esperada: fechaEsperadaISO,
          fecha_devolucion_real: null,
          observaciones: observaciones || null,
        })
        .eq("id", herramienta.id);
      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        q = q.eq("sede_id", perfil.sede_id);
      const { error: e2 } = await q;
      if (e2) throw e2;
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al prestar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper
      onClose={onClose}
      titulo={`Prestar: ${herramienta.herramienta_nombre}`}
    >
      <form onSubmit={guardar} className="space-y-4">
        <Field label="Prestar a *">
          <select
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
            required
            className="w-full h-12 px-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            <option value="">— Selecciona usuario —</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre} ({u.rol})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fecha esperada de devolución *">
          <input
            type="date"
            value={fechaEsperada}
            onChange={(e) => setFechaEsperada(e.target.value)}
            required
            min={new Date().toISOString().slice(0, 10)}
            className="w-full h-12 px-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </Field>

        <Field label="Observaciones">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </Field>

        {error && (
          <p className="text-xs" style={{ color: "hsl(var(--destructive))" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "transparent",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {saving ? "Guardando…" : "Confirmar préstamo"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

/* ── Modal: Nueva herramienta (Admin) ────────────────────────────────── */

function ModalNueva({ sedeDefault, onClose, onSaved }) {
  const perfil = useAuthStore((s) => s.perfil);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [sedeId, setSedeId] = useState(sedeDefault);
  const [sedes, setSedes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("sedes")
      .select("id, nombre")
      .eq("activa", true)
      .order("nombre")
      .then(({ data }) => setSedes(data ?? []));
  }, []);

  const guardar = async (e) => {
    e.preventDefault();
    if (perfil?.rol !== "Admin") {
      setError("Solo el Admin puede crear herramientas");
      return;
    }
    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { error: e2 } = await supabase
        .from("herramientas_prestamo")
        .insert({
          herramienta_nombre: nombre.trim(),
          herramienta_codigo: codigo.trim() || null,
          sede_id: sedeId,
          estado: "disponible",
        });
      if (e2) throw e2;
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al crear"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper onClose={onClose} titulo="Nueva herramienta">
      <form onSubmit={guardar} className="space-y-4">
        <Field label="Nombre *">
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            autoFocus
            placeholder="Ej. Llave inglesa 12 pulgadas"
            className="w-full h-12 px-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </Field>

        <Field label="Código (opcional)">
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Ej. HER-001"
            className="w-full h-12 px-3 rounded-lg border text-sm font-mono"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          />
        </Field>

        <Field label="Sede *">
          <select
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            required
            className="w-full h-12 px-3 rounded-lg border text-sm"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }}
          >
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p className="text-xs" style={{ color: "hsl(var(--destructive))" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
              backgroundColor: "transparent",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 h-12 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {saving ? "Guardando…" : "Crear"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

/* ── Helpers UI ──────────────────────────────────────────────────────── */

function ModalWrapper({ titulo, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "hsl(var(--card))" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {titulo}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
            style={{ color: "hsl(var(--muted-foreground))" }}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-xs font-medium mb-1.5"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function SkeletonList() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 animate-pulse border h-32"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          <div
            className="h-4 rounded w-2/3 mb-2"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
          <div
            className="h-3 rounded w-1/2"
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🔧</div>
      <p className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>
        Sin herramientas registradas
      </p>
      <p
        className="text-sm mt-1"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        Crea la primera con el botón "Nueva herramienta"
      </p>
    </div>
  );
}
