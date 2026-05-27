import { useState, useEffect, useRef } from "react";
import { Package, Wrench, Check, ChevronDown } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { supabase } from "../../lib/supabase";
import { safeError } from "../../lib/utils";
import { sedeLabel, estadoPill } from "../../lib/herramientas-ui";
import { ToolIcon, UserAvatar, Pill } from "./HerramientasBits";

/* Duración default del préstamo (días). */
const DIAS_DEFAULT = 7;

/* ────────────────────────── Modal: Registrar préstamo ─────────────────── */

/**
 * Reproduce el formulario por pasos `ops.herramientas.nueva.tsx` de Lovable
 * (1·herramienta seleccionada, 2·usuario, 3·fechas, 4·notas) conectado a la
 * lógica REAL de préstamo (mismo UPDATE con guards anti-race y RBAC por sede).
 */
export function ModalPrestar({ herramienta, usuarios, onClose, onSaved }) {
  const perfil = useAuthStore((s) => s.perfil);
  const savingRef = useRef(false);
  const [usuarioId, setUsuarioId] = useState("");
  const [fechaEsperada, setFechaEsperada] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + DIAS_DEFAULT);
    return d.toISOString().slice(0, 10);
  });
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const usuarioSel = usuarios.find((u) => u.id === usuarioId) ?? null;
  const pill = estadoPill(herramienta.estado);

  const guardar = async (e) => {
    e.preventDefault();
    if (!usuarioId) {
      setError("Selecciona un usuario");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      // Fecha esperada: 17:00 hora Colombia (UTC-5) = 22:00 UTC del mismo día
      const fechaEsperadaISO = new Date(
        `${fechaEsperada}T17:00:00-05:00`,
      ).toISOString();
      // Defensa en profundidad: restringir UPDATE a la sede del usuario.
      // `.eq("estado","disponible")` evita prestar dos veces la misma
      // herramienta (race entre dos modales abiertos en paralelo).
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
        .eq("id", herramienta.id)
        .eq("estado", "disponible");
      if (perfil?.rol !== "Admin" && perfil?.sede_id)
        q = q.eq("sede_id", perfil.sede_id);
      const { data, error: e2 } = await q.select("id");
      if (e2) throw e2;
      if (!data || data.length === 0) {
        setError("La herramienta ya no está disponible o no tienes permiso.");
        return;
      }
      await onSaved();
    } catch (err) {
      setError(safeError(err, "Error al prestar"));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={640}>
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--p-50)", color: "var(--p-700)" }}
        >
          <Package className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2
          className="m-0 flex-1 text-[16px] font-semibold leading-[1.3]"
          style={{ color: "var(--n-950)" }}
        >
          Registrar préstamo de herramienta
        </h2>
      </div>
      <p
        className="mb-5 text-[13px] leading-[1.5]"
        style={{ color: "var(--n-500)" }}
      >
        Confirma la herramienta, asigna el usuario que la recibe y la fecha de
        devolución esperada.
      </p>

      <form onSubmit={guardar}>
        {/* 1 · Herramienta (ya seleccionada desde la lista) */}
        <Section step="1" label="Herramienta seleccionada">
          <div
            className="flex items-center gap-3 rounded-md border-2 p-2.5"
            style={{
              borderColor: "var(--p-600)",
              backgroundColor: "var(--p-50)",
            }}
          >
            <ToolIcon />
            <div className="flex-1 min-w-0">
              <div
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--n-950)" }}
              >
                {herramienta.herramienta_nombre}
              </div>
              <div
                className="mt-0.5 text-[11px]"
                style={{ color: "var(--n-500)" }}
              >
                {herramienta.herramienta_codigo && (
                  <span
                    className="font-mono font-medium"
                    style={{ color: "var(--n-700)" }}
                  >
                    {herramienta.herramienta_codigo} ·{" "}
                  </span>
                )}
                {sedeLabel(herramienta.sede_id)}
              </div>
            </div>
            <Pill cls={pill.cls} label={pill.label} small />
          </div>
        </Section>

        {/* 2 · Usuario */}
        <Section step="2" label="Asignar usuario">
          <div className="relative">
            <select
              value={usuarioId}
              onChange={(e) => setUsuarioId(e.target.value)}
              required
              className="w-full appearance-none rounded-md border bg-transparent py-2.5 pl-3 pr-9 text-[13px] outline-none"
              style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
            >
              <option value="">— Selecciona usuario —</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({u.rol})
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--n-500)" }}
            />
          </div>
          {usuarioSel && (
            <div className="mt-2 flex items-center gap-2.5">
              <UserAvatar nombre={usuarioSel.nombre} size="sm" />
              <span className="text-[12px]" style={{ color: "var(--n-700)" }}>
                {usuarioSel.nombre} · {usuarioSel.rol}
              </span>
            </div>
          )}
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            {usuarios.length} usuario{usuarios.length === 1 ? "" : "s"} activo
            {usuarios.length === 1 ? "" : "s"} · cualquier rol puede recibir
            préstamo
          </p>
        </Section>

        {/* 3 · Fechas */}
        <Section step="3" label="Fechas">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Fecha de préstamo</FieldLabel>
              <div
                className="rounded-md border px-3 py-2 font-mono text-[13px] font-medium"
                style={{
                  borderColor: "var(--n-150)",
                  color: "var(--n-950)",
                  backgroundColor: "var(--n-50)",
                }}
              >
                Hoy
              </div>
            </div>
            <div>
              <FieldLabel>Devolución esperada</FieldLabel>
              <input
                type="date"
                value={fechaEsperada}
                onChange={(e) => setFechaEsperada(e.target.value)}
                required
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-[13px] font-medium outline-none"
                style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
              />
            </div>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--n-500)" }}>
            Duración default {DIAS_DEFAULT} días · ajusta según el uso planeado
          </p>
        </Section>

        {/* 4 · Notas */}
        <Section step="4" label="Notas · opcional">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Propósito del préstamo, equipo o cliente asociado…"
            className="min-h-[60px] w-full rounded-md border bg-transparent px-3 py-2.5 text-[13px] outline-none"
            style={{ borderColor: "var(--n-150)", color: "var(--n-950)" }}
          />
        </Section>

        {error && (
          <p className="mb-2 text-xs" style={{ color: "var(--dang-700)" }}>
            {error}
          </p>
        )}

        {/* Footer */}
        <div
          className="mt-5 flex justify-end gap-2 border-t pt-4"
          style={{ borderColor: "var(--n-100)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn btn-out disabled:opacity-50"
            style={{ height: 48 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-pri inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ height: 48 }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {saving ? "Guardando…" : "Registrar préstamo"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ───────────────────────── Modal: Nueva herramienta ───────────────────── */

/**
 * Alta de una herramienta del catálogo (solo Admin). Reusa la estética del
 * formulario por pasos de Lovable. Lógica de inserción REAL sin cambios.
 */
export function ModalNueva({ sedeDefault, onClose, onSaved }) {
  const perfil = useAuthStore((s) => s.perfil);
  const savingRef = useRef(false);
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
    if (savingRef.current) return;
    savingRef.current = true;
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
      savingRef.current = false;
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth={480}>
      <div className="mb-1.5 flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            backgroundColor: "var(--cat-hrm-bg)",
            color: "var(--cat-hrm)",
          }}
        >
          <Wrench className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2
          className="m-0 flex-1 text-[16px] font-semibold leading-[1.3]"
          style={{ color: "var(--n-950)" }}
        >
          Nueva herramienta
        </h2>
      </div>
      <p
        className="mb-5 text-[13px] leading-[1.5]"
        style={{ color: "var(--n-500)" }}
      >
        Registra una herramienta en el catálogo. Quedará disponible para
        préstamo de inmediato.
      </p>

      <form onSubmit={guardar} className="space-y-4">
        <Field label="Nombre *">
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            autoFocus
            placeholder="Ej. Llave inglesa 12 pulgadas"
            className="finput sans"
          />
        </Field>

        <Field label="Código (opcional)">
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Ej. HER-001"
            className="finput"
          />
        </Field>

        <Field label="Sede *">
          <select
            value={sedeId}
            onChange={(e) => setSedeId(e.target.value)}
            required
            className="finput sans"
          >
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p className="text-xs" style={{ color: "var(--dang-700)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn btn-out flex-1 justify-center disabled:opacity-50"
            style={{ height: 48 }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-pri flex-1 justify-center disabled:opacity-50"
            style={{ height: 48 }}
          >
            {saving ? "Guardando…" : "Crear"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ───────────────────────────── Helpers UI ─────────────────────────────── */

function ModalShell({ children, onClose, maxWidth = 480 }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl sm:p-6"
        style={{ backgroundColor: "var(--n-0)", maxWidth }}
      >
        <div className="mb-3 flex justify-end">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--n-500)" }}
            aria-label="Cerrar"
            type="button"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ step, label, children }) {
  return (
    <div className="mb-4">
      <span
        className="mb-2 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: "var(--n-500)" }}
      >
        {step} · {label}
      </span>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <span
      className="mb-1 block font-mono text-[11px] font-medium uppercase tracking-[0.05em]"
      style={{ color: "var(--n-500)" }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-xs font-medium"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
