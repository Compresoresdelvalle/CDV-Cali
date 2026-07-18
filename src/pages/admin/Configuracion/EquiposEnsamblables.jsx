import { useState, useEffect, useRef } from "react";
import {
  Info,
  Plus,
  Pencil,
  Minus,
  Boxes,
  Search,
  AlertTriangle,
  Check,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { formatCOP, safeError, sanitizeSearch } from "../../../lib/utils";
import { avisarOk, avisarError } from "../../../lib/notify";
import { useConfirm } from "../../../components/ui/ConfirmDialog";
import { pillStyle, surfaceInputStyle } from "../../../lib/admin-config-ui";

/**
 * REQ9 — Catálogo de EQUIPOS ENSAMBLABLES (solo Admin).
 *
 * Son los `productos` marcados con `ensamblable = true`: lo que aparece como
 * "equipo objetivo" al crear un ensamble. Permite agregar equipos con NOMBRE
 * PROVISIONAL (no se conoce el definitivo hasta avanzar el ensamble) y editarlo
 * después. Reusa el flag/tabla existente: no hay catálogo paralelo ni migración.
 *
 * Desactivar = `activo = false`: deja de ofrecerse al ensamblar, pero queda aquí
 * para reactivarlo (mismo patrón que el checklist de OT).
 */
export default function EquiposEnsamblables() {
  const [equipos, setEquipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [editando, setEditando] = useState(null); // solo EDITAR un ensamblable existente
  const [nuevoOpen, setNuevoOpen] = useState(false); // modal "Nuevo equipo"
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const { confirm, ConfirmDialog } = useConfirm();

  // Callback de éxito del modal Nuevo: refresca la lista y muestra el aviso.
  const onNuevoSaved = async (mensaje) => {
    setNuevoOpen(false);
    avisarOk(mensaje || "Equipo agregado");
    await cargar();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editando) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !saving) setEditando(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editando, saving]);

  const cargar = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("productos")
        .select("id, nombre, referencia, precio_venta, activo")
        .eq("ensamblable", true)
        .order("activo", { ascending: false })
        .order("nombre");
      if (!mountedRef.current) return;
      if (error) throw error;
      setEquipos(data ?? []);
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(safeError(err, "Error al cargar equipos"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    if (!editando) return;
    const nombre = editando.nombre?.trim();
    if (!nombre) {
      setErrorMsg("El nombre es obligatorio (puede ser provisional)");
      return;
    }
    const precio = Number(editando.precio_venta || 0);
    if (!Number.isFinite(precio) || precio < 0) {
      setErrorMsg("El precio debe ser un número mayor o igual a 0");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMsg("");
    try {
      // Solo EDITAR un ensamblable existente (crear/elegir va por ModalNuevoEquipo).
      // Si vacían la referencia, se regenera (NOT NULL + UNIQUE: nunca "").
      const referencia =
        editando.referencia?.trim() ||
        `ENS-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase
        .from("productos")
        .update({ nombre, referencia, precio_venta: precio })
        .eq("id", editando.id);
      if (error) throw error;
      avisarOk(`Equipo "${nombre}" actualizado`);
      setEditando(null);
      await cargar();
    } catch (err) {
      avisarError(err, "Error al guardar");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  // Quitar de la lista = desmarcar `ensamblable` (NO toca `activo`): el producto
  // sigue vendible/en inventario si lo era; solo deja de ofrecerse al ensamblar.
  // Clave: la lista incluye compresores reales (seed) — nunca debe deshabilitar
  // un producto vendible en toda la app.
  const quitar = async (e) => {
    const ok = await confirm({
      titulo: "Quitar de ensamblables",
      mensaje: `Quitar "${e.nombre}" de la lista de equipos ensamblables? Dejará de aparecer al crear un ensamble. No afecta su venta ni su inventario.`,
      confirmLabel: "Quitar",
      danger: true,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from("productos")
        .update({ ensamblable: false })
        .eq("id", e.id);
      if (error) throw error;
      avisarOk(`"${e.nombre}" quitado de ensamblables`);
      await cargar();
    } catch (err) {
      avisarError(err, "Error");
    }
  };

  const activos = equipos.filter((e) => e.activo).length;

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && <Banner type="destructive">{errorMsg}</Banner>}

      <InfoBanner title="Equipos para ensamble (solo Admin)">
        Son los equipos que aparecen como objetivo al crear un ensamble. Lo
        recomendado es <b>elegirlo del inventario que ya existe</b> (así no se
        duplica). Solo crea uno nuevo cuando de verdad no esté en el catálogo;
        puedes usar un <b>nombre provisional</b> y renombrarlo después.{" "}
        <b>Quitar</b> solo lo saca de esta lista — no afecta su venta ni su
        inventario.
      </InfoBanner>

      <div className="flex items-center justify-between gap-3">
        <p
          className="text-xs"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {loading ? "Cargando…" : `${equipos.length} equipos`}
        </p>
        <button
          onClick={() => setNuevoOpen(true)}
          className="inline-flex h-12 items-center gap-1.5 rounded-md px-4 text-[12.5px] font-semibold transition-opacity cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Nuevo equipo
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border"
              style={{
                backgroundColor: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            />
          ))}
        </div>
      ) : equipos.length === 0 ? (
        <Empty icon="📦">Sin equipos ensamblables. Agrega el primero.</Empty>
      ) : (
        <section
          className="overflow-hidden rounded-[10px] border"
          style={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
          }}
        >
          {/* Desktop tabla */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    backgroundColor: "hsl(var(--muted) / 0.3)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {["Equipo", "Precio", "Estado", ""].map((c, i) => (
                    <th
                      key={c || i}
                      className="px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
                      style={{ color: "hsl(var(--muted-foreground))" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equipos.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t align-middle"
                    style={{
                      borderColor: "hsl(var(--border) / 0.6)",
                      opacity: e.activo ? 1 : 0.55,
                    }}
                  >
                    <td className="px-3 py-3">
                      <p
                        className="text-[13px] font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {e.nombre}
                      </p>
                      <p
                        className="mt-0.5 font-mono text-[11px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {e.referencia}
                      </p>
                    </td>
                    <td
                      className="px-3 py-3 font-mono text-[12.5px] font-medium tabular-nums"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {formatCOP(e.precio_venta)}
                    </td>
                    <td className="px-3 py-3">
                      <EstadoPill activo={e.activo} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <IconBtn
                          label="Editar equipo"
                          onClick={() => setEditando({ ...e })}
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconBtn>
                        <IconBtn
                          label="Quitar de ensamblables"
                          token="--destructive"
                          onClick={() => quitar(e)}
                        >
                          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y md:hidden" role="list">
            {equipos.map((e) => (
              <li
                key={e.id}
                className="px-4 py-3.5"
                style={{
                  borderColor: "hsl(var(--border))",
                  opacity: e.activo ? 1 : 0.55,
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {e.nombre}
                  </p>
                  <EstadoPill activo={e.activo} />
                </div>
                <p
                  className="mt-1 font-mono text-xs"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {e.referencia} · {formatCOP(e.precio_venta)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setEditando({ ...e })}
                    className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary))",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => quitar(e)}
                    className="h-11 flex-1 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{
                      borderColor: "hsl(var(--destructive))",
                      color: "hsl(var(--destructive))",
                    }}
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5"
            style={{
              borderColor: "hsl(var(--border))",
              backgroundColor: "hsl(var(--muted) / 0.3)",
            }}
          >
            <span
              className="font-mono text-[11.5px]"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {equipos.length} equipos ·{" "}
              <b style={{ color: "hsl(var(--foreground))" }}>{activos}</b>{" "}
              activos
            </span>
          </div>
        </section>
      )}

      {editando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => !saving && setEditando(null)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-xl border p-5"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              className="flex items-center gap-2 text-lg font-semibold"
              style={{ color: "hsl(var(--foreground))" }}
            >
              <Boxes className="h-4 w-4" strokeWidth={1.75} />
              Editar equipo
            </h3>

            <Field label="Nombre (provisional permitido)">
              <input
                type="text"
                value={editando.nombre ?? ""}
                onChange={(ev) =>
                  setEditando({ ...editando, nombre: ev.target.value })
                }
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
                placeholder="Ej: Equipo por definir / Compresor 100L"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Referencia (opcional)">
                <input
                  type="text"
                  value={editando.referencia ?? ""}
                  onChange={(ev) =>
                    setEditando({ ...editando, referencia: ev.target.value })
                  }
                  className="h-12 w-full rounded-lg border px-3 font-mono text-sm"
                  style={surfaceInputStyle}
                  placeholder="Auto si vacío"
                />
              </Field>
              <Field label="Precio venta (COP)">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={editando.precio_venta ?? 0}
                  onChange={(ev) =>
                    setEditando({ ...editando, precio_venta: ev.target.value })
                  }
                  className="h-12 w-full rounded-lg border px-3 font-mono text-sm"
                  style={surfaceInputStyle}
                  placeholder="0"
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditando(null)}
                disabled={saving}
                className="h-12 rounded-lg border px-4 text-sm cursor-pointer disabled:opacity-50"
                style={{
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={saving}
                className="h-12 rounded-lg px-4 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  backgroundColor: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                }}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {nuevoOpen && (
        <ModalNuevoEquipo
          onClose={() => setNuevoOpen(false)}
          onSaved={onNuevoSaved}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}

/* ── Modal: Nuevo equipo ensamblable (elegir del inventario o crear) ────── */
/**
 * Dos caminos, para NO duplicar el inventario:
 *  1. "Desde el inventario" (recomendado): busca un producto que ya existe y
 *     solo le activa el flag `ensamblable`. Es lo que evita el doble registro.
 *  2. "Crear nuevo": solo cuando de verdad no existe. Antes de crear valida que
 *     no haya ya un producto con ese nombre o código (en `referencia` o en
 *     `codigo_interno`) y, si lo hay, ofrece usar ese en vez de duplicarlo.
 */
function ModalNuevoEquipo({ onClose, onSaved }) {
  const [modo, setModo] = useState("inventario"); // 'inventario' | 'crear'
  // Buscar en inventario
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [marcandoId, setMarcandoId] = useState(null);
  // Crear nuevo
  const [nombre, setNombre] = useState("");
  const [referencia, setReferencia] = useState("");
  const [precio, setPrecio] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicado, setDuplicado] = useState(null); // producto existente hallado al crear
  const savingRef = useRef(false);
  const [error, setError] = useState("");

  // Búsqueda server-side sobre TODO el catálogo activo (no solo ensamblables).
  useEffect(() => {
    if (modo !== "inventario") return;
    const q = sanitizeSearch(busqueda);
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data, error: e } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, codigo_interno, precio_venta, ensamblable, categoria",
          )
          .eq("activo", true)
          .or(
            `nombre.ilike.%${q}%,referencia.ilike.%${q}%,codigo_interno.ilike.%${q}%`,
          )
          .order("ensamblable", { ascending: true })
          .limit(30);
        if (ac.signal.aborted) return;
        if (e) throw e;
        setResultados(data ?? []);
      } catch (err) {
        if (!ac.signal.aborted) setError(safeError(err, "Error al buscar"));
      } finally {
        if (!ac.signal.aborted) setBuscando(false);
      }
    }, 300);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [busqueda, modo]);

  // Marca un producto EXISTENTE como ensamblable (no crea nada nuevo).
  const marcar = async (p) => {
    setError("");
    if (p.ensamblable) {
      setError(
        `"${p.nombre}" ya aparece en la lista de equipos ensamblables. No hay que hacer nada más: ya puedes elegirlo al crear un ensamble.`,
      );
      return;
    }
    setMarcandoId(p.id);
    try {
      const { error: e } = await supabase
        .from("productos")
        .update({ ensamblable: true })
        .eq("id", p.id);
      if (e) throw e;
      onSaved(
        `Listo: "${p.nombre}" ya aparece como equipo para ensamblar. Se usó el producto que ya existía en el inventario, sin duplicarlo.`,
      );
    } catch (err) {
      avisarError(err, "No se pudo marcar el producto");
      setMarcandoId(null);
    }
  };

  const crear = async () => {
    setError("");
    setDuplicado(null);
    const n = nombre.trim();
    if (!n) {
      setError("Escribe el nombre del equipo (puede ser provisional).");
      return;
    }
    const ref = referencia.trim();
    const precioNum = Number(precio || 0);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      setError("El precio debe ser un número mayor o igual a 0.");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Anti-duplicado: por nombre exacto y por código (referencia o codigo_interno).
      const existentes = [];
      const { data: porNombre } = await supabase
        .from("productos")
        .select(
          "id, nombre, referencia, codigo_interno, ensamblable, categoria",
        )
        .eq("activo", true)
        .ilike("nombre", n)
        .limit(5);
      (porNombre ?? []).forEach((e) => existentes.push(e));
      if (ref) {
        const refSan = sanitizeSearch(ref);
        const { data: porCodigo } = await supabase
          .from("productos")
          .select(
            "id, nombre, referencia, codigo_interno, ensamblable, categoria",
          )
          .eq("activo", true)
          .or(`referencia.ilike.${refSan},codigo_interno.ilike.${refSan}`)
          .limit(5);
        const ids = new Set(existentes.map((e) => e.id));
        (porCodigo ?? []).forEach((e) => {
          if (!ids.has(e.id)) existentes.push(e);
        });
      }
      if (existentes.length > 0) {
        // No creamos: mostramos el existente y ofrecemos usarlo.
        setDuplicado(existentes[0]);
        return;
      }
      const referenciaFinal =
        ref || `ENS-${Date.now().toString(36).toUpperCase()}`;
      const { error: e } = await supabase.from("productos").insert({
        nombre: n,
        referencia: referenciaFinal,
        categoria: "ENSAMBLE",
        precio_venta: precioNum,
        ensamblable: true,
        activo: true,
      });
      if (e) throw e;
      onSaved(`Equipo "${n}" creado y agregado a la lista de ensamblables.`);
    } catch (err) {
      avisarError(err, "No se pudo crear el equipo");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={() => !saving && !marcandoId && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border p-5"
        style={{
          backgroundColor: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3
          className="flex items-center gap-2 text-lg font-semibold"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <Boxes className="h-4 w-4" strokeWidth={1.75} />
          Nuevo equipo ensamblable
        </h3>

        {/* Selector de modo */}
        <div className="flex gap-2">
          {[
            { v: "inventario", t: "Desde el inventario" },
            { v: "crear", t: "Crear nuevo" },
          ].map((m) => {
            const on = modo === m.v;
            return (
              <button
                key={m.v}
                type="button"
                onClick={() => {
                  setModo(m.v);
                  setError("");
                  setDuplicado(null);
                }}
                className="h-10 flex-1 rounded-lg border text-[13px] font-medium cursor-pointer transition-colors"
                style={{
                  borderColor: on
                    ? "hsl(var(--primary))"
                    : "hsl(var(--border))",
                  backgroundColor: on ? "hsl(var(--primary))" : "transparent",
                  color: on
                    ? "hsl(var(--primary-foreground))"
                    : "hsl(var(--foreground))",
                }}
              >
                {m.t}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: "hsl(var(--destructive) / 0.08)",
              borderColor: "hsl(var(--destructive) / 0.4)",
              color: "hsl(var(--destructive))",
            }}
          >
            {error}
          </div>
        )}

        {modo === "inventario" ? (
          <>
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              Busca el equipo que ya está en el inventario y márcalo como
              ensamblable. Así se usa el mismo producto y no queda doble en el
              inventario.
            </p>
            <div
              className="flex h-12 items-center gap-2.5 rounded-lg border px-3"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--background))",
              }}
            >
              <Search
                className="h-4 w-4 shrink-0"
                strokeWidth={1.6}
                style={{ color: "hsl(var(--muted-foreground))" }}
              />
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, referencia o código (mín 2)…"
                autoFocus
                className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                style={{ color: "hsl(var(--foreground))" }}
              />
            </div>

            {buscando && (
              <p
                className="text-xs"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Buscando…
              </p>
            )}
            {!buscando &&
              busqueda.trim().length >= 2 &&
              resultados.length === 0 && (
                <div
                  className="rounded-lg border px-3 py-3 text-xs"
                  style={{
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  No hay ningún producto con ese nombre o código. Si de verdad
                  no existe en el inventario, usa la pestaña <b>Crear nuevo</b>.
                </div>
              )}
            {resultados.length > 0 && (
              <ul
                className="max-h-72 divide-y overflow-y-auto rounded-lg border"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {resultados.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[13px] font-medium"
                        style={{ color: "hsl(var(--foreground))" }}
                      >
                        {p.nombre}
                      </p>
                      <p
                        className="mt-0.5 font-mono text-[11px]"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        {p.referencia || p.codigo_interno || "sin código"}
                        {p.categoria ? ` · ${p.categoria}` : ""} ·{" "}
                        {formatCOP(p.precio_venta)}
                      </p>
                    </div>
                    {p.ensamblable ? (
                      <span
                        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium"
                        style={{
                          backgroundColor: "hsl(var(--success) / 0.12)",
                          color: "hsl(var(--success))",
                        }}
                      >
                        Ya en la lista
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => marcar(p)}
                        disabled={!!marcandoId}
                        className="shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-50"
                        style={{
                          backgroundColor: "hsl(var(--primary))",
                          color: "hsl(var(--primary-foreground))",
                        }}
                      >
                        {marcandoId === p.id ? "…" : "Usar este"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {duplicado ? (
              <div
                className="flex flex-col gap-2 rounded-lg border p-3 text-xs"
                style={{
                  backgroundColor: "hsl(var(--warning) / 0.08)",
                  borderColor: "hsl(var(--warning) / 0.4)",
                }}
              >
                <div
                  className="flex items-start gap-2 font-medium"
                  style={{ color: "hsl(var(--warning))" }}
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    strokeWidth={1.8}
                  />
                  <span>
                    Ese producto ya existe en el inventario. Crear otro lo
                    dejaría doble.
                  </span>
                </div>
                <div style={{ color: "hsl(var(--muted-foreground))" }}>
                  Se encontró <b>{duplicado.nombre}</b> (
                  {duplicado.referencia ||
                    duplicado.codigo_interno ||
                    "sin código"}
                  {duplicado.categoria ? ` · ${duplicado.categoria}` : ""}). Usa
                  ese mismo producto en vez de crear uno nuevo.
                </div>
                {duplicado.ensamblable ? (
                  <p style={{ color: "hsl(var(--success))" }}>
                    Además ya está marcado como ensamblable: ya puedes elegirlo
                    al crear un ensamble.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => marcar(duplicado)}
                    disabled={!!marcandoId}
                    className="mt-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                    }}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                    Usar ese producto (marcarlo como ensamblable)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDuplicado(null)}
                  className="self-start text-[12px] font-medium underline cursor-pointer"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Cambiar los datos
                </button>
              </div>
            ) : (
              <p
                className="text-[12px] leading-relaxed"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                Úsalo solo si el equipo <b>no existe</b> en el inventario. Antes
                de crearlo revisamos que no quede duplicado.
              </p>
            )}

            <Field label="Nombre (provisional permitido)">
              <input
                type="text"
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value);
                  setDuplicado(null);
                }}
                className="h-12 w-full rounded-lg border px-3 text-sm"
                style={surfaceInputStyle}
                placeholder="Ej: Equipo por definir / Compresor 100L"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Referencia (opcional)">
                <input
                  type="text"
                  value={referencia}
                  onChange={(e) => {
                    setReferencia(e.target.value);
                    setDuplicado(null);
                  }}
                  className="h-12 w-full rounded-lg border px-3 font-mono text-sm"
                  style={surfaceInputStyle}
                  placeholder="Auto si vacío"
                />
              </Field>
              <Field label="Precio venta (COP)">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={precio}
                  onChange={(e) => setPrecio(e.target.value)}
                  className="h-12 w-full rounded-lg border px-3 font-mono text-sm"
                  style={surfaceInputStyle}
                  placeholder="0"
                />
              </Field>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving || !!marcandoId}
            className="h-12 rounded-lg border px-4 text-sm cursor-pointer disabled:opacity-50"
            style={{
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Cerrar
          </button>
          {modo === "crear" && !duplicado && (
            <button
              onClick={crear}
              disabled={saving}
              className="h-12 rounded-lg px-4 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              {saving ? "Revisando…" : "Crear equipo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers de presentación ──────────────────────────────────────────── */
function EstadoPill({ activo }) {
  const token = activo ? "--success" : "--muted-foreground";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
      style={pillStyle(token)}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(var(${token}))` }}
      />
      {activo ? "Activo" : "Inactivo"}
    </span>
  );
}

function IconBtn({ children, label, onClick, token }) {
  const color = token ? `hsl(var(${token}))` : "hsl(var(--muted-foreground))";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-md transition-colors cursor-pointer"
      style={{ color }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = "hsl(var(--muted) / 0.5)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      {children}
    </button>
  );
}

function Banner({ type, children }) {
  return (
    <div
      role={type === "destructive" ? "alert" : "status"}
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${type}) / 0.08)`,
        borderColor: `hsl(var(--${type}) / 0.4)`,
        color: `hsl(var(--${type}))`,
      }}
    >
      {children}
    </div>
  );
}

function InfoBanner({ title, children }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-4"
      style={{
        backgroundColor: "hsl(var(--info) / 0.08)",
        borderColor: "hsl(var(--info) / 0.3)",
      }}
    >
      <Info
        className="mt-0.5 h-4 w-4 shrink-0"
        strokeWidth={1.75}
        style={{ color: "hsl(var(--info))" }}
      />
      <div>
        <div
          className="text-[13px] font-medium"
          style={{ color: "hsl(var(--info))" }}
        >
          {title}
        </div>
        <div
          className="mt-0.5 text-[12px] leading-relaxed"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-xs font-medium"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Empty({ icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <p style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
    </div>
  );
}
