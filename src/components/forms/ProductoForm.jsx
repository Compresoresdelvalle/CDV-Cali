import { useState } from "react";

/**
 * Form reutilizable de producto (crear / editar — F12 · re-vestido Lovable F4c).
 *
 * Props:
 *   - initial: objeto con campos (opcional, para edición futura)
 *   - onSubmit: async (payload) => void
 *   - onCancel: () => void
 *   - submitLabel: string ("Crear producto", "Guardar cambios")
 *   - submitting: boolean — desactiva botón
 *   - errorMsg: string
 */
export default function ProductoForm({
  initial = {},
  onSubmit,
  onCancel,
  submitLabel = "Crear producto",
  submitting = false,
  errorMsg = "",
  // Solo el Admin puede fijar el costo. Para otros roles el campo se oculta
  // y el producto se crea con costo 0 (lo ajusta el Admin o las compras).
  puedeEditarCosto = false,
}) {
  const [form, setForm] = useState({
    nombre: initial.nombre ?? "",
    descripcion: initial.descripcion ?? "",
    referencia: initial.referencia ?? "",
    codigo_interno: initial.codigo_interno ?? "",
    codigo_proveedor: initial.codigo_proveedor ?? "",
    proveedor_inicial: initial.proveedor_inicial ?? "", // F12 fix: proveedor habitual
    categoria: initial.categoria ?? "",
    subcategoria: initial.subcategoria ?? "",
    marca: initial.marca ?? "",
    modelo: initial.modelo ?? "",
    unidad_medida: initial.unidad_medida ?? "unidad",
    tipo: initial.tipo ?? "nuevo",
    precio_venta: initial.precio_venta ?? "",
    costo_promedio: initial.costo_promedio ?? "",
    stock_minimo: initial.stock_minimo ?? 0,
    stock_maximo: initial.stock_maximo ?? "",
    vendible: initial.vendible ?? true,
    ensamblable: initial.ensamblable ?? false,
    stand: initial.stand ?? "",
    posicion: initial.posicion ?? "",
    en_piso: initial.en_piso ?? false,
  });
  const [validationError, setValidationError] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError("");
    if (!form.nombre.trim()) {
      setValidationError("El nombre es obligatorio");
      return;
    }
    if (!form.codigo_interno.trim()) {
      setValidationError("El código interno es obligatorio");
      return;
    }
    if (form.precio_venta !== "" && Number(form.precio_venta) < 0) {
      setValidationError("El precio de venta no puede ser negativo");
      return;
    }
    const payload = {
      ...form,
      precio_venta: form.precio_venta === "" ? 0 : Number(form.precio_venta),
      costo_promedio:
        form.costo_promedio === "" ? 0 : Number(form.costo_promedio),
      stock_minimo: form.stock_minimo === "" ? 0 : Number(form.stock_minimo),
      stock_maximo: form.stock_maximo === "" ? null : Number(form.stock_maximo),
      vendible: !!form.vendible,
      ensamblable: !!form.ensamblable,
      // En piso: zona central, sin stand/posición.
      en_piso: !!form.en_piso,
      stand: form.en_piso || form.stand === "" ? null : Number(form.stand),
      posicion:
        form.en_piso || form.posicion === "" ? null : Number(form.posicion),
    };
    await onSubmit?.(payload);
  };

  const errorBox = validationError || errorMsg;

  return (
    <form onSubmit={handleSubmit} className="space-y-[18px]">
      {errorBox && (
        <div
          role="alert"
          className="rounded-[10px] border px-4 py-3"
          style={{
            backgroundColor: "var(--dang-50)",
            borderColor: "var(--dang-border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--dang-700)" }}>
            {errorBox}
          </p>
        </div>
      )}

      <SectionCard title="Identificación">
        <Field label="Nombre *">
          <input
            type="text"
            value={form.nombre}
            onChange={set("nombre")}
            className="finput sans"
            placeholder="Ej. Compresor 50L 2HP"
            maxLength={200}
          />
        </Field>
        <Row>
          <Field label="Código interno *">
            <input
              type="text"
              value={form.codigo_interno}
              onChange={set("codigo_interno")}
              className="finput"
              placeholder="CV-001"
              maxLength={64}
            />
          </Field>
          <Field label="Código del proveedor">
            <input
              type="text"
              value={form.codigo_proveedor}
              onChange={set("codigo_proveedor")}
              className="finput"
              placeholder="Opcional"
              maxLength={64}
            />
          </Field>
        </Row>
        <Field label="Proveedor habitual (opcional)">
          <input
            type="text"
            value={form.proveedor_inicial}
            onChange={set("proveedor_inicial")}
            className="finput sans"
            placeholder="Ej. ACME Repuestos — se llenará al recibir compras"
            maxLength={120}
          />
        </Field>
        <Row>
          <Field label="Referencia (SKU fabricante)">
            <input
              type="text"
              value={form.referencia}
              onChange={set("referencia")}
              className="finput"
              maxLength={64}
            />
          </Field>
          <Field label="Tipo *">
            <select
              value={form.tipo}
              onChange={set("tipo")}
              className="finput sans"
            >
              <option value="nuevo">Nuevo</option>
              <option value="segunda_mano">Segunda mano</option>
            </select>
          </Field>
        </Row>
      </SectionCard>

      <SectionCard title="Catalogación">
        <Row>
          <Field label="Categoría">
            <input
              type="text"
              value={form.categoria}
              onChange={set("categoria")}
              className="finput sans"
              maxLength={80}
            />
          </Field>
          <Field label="Subcategoría">
            <input
              type="text"
              value={form.subcategoria}
              onChange={set("subcategoria")}
              className="finput sans"
              maxLength={80}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Marca">
            <input
              type="text"
              value={form.marca}
              onChange={set("marca")}
              className="finput sans"
              maxLength={80}
            />
          </Field>
          <Field label="Modelo">
            <input
              type="text"
              value={form.modelo}
              onChange={set("modelo")}
              className="finput sans"
              maxLength={80}
            />
          </Field>
        </Row>
        <Field label="Descripción">
          <textarea
            value={form.descripcion}
            onChange={set("descripcion")}
            className="ftextarea"
            rows={3}
            maxLength={500}
          />
        </Field>
      </SectionCard>

      <SectionCard title="Precios e inventario">
        <Row>
          <Field label="Precio de venta (COP)">
            <input
              type="number"
              min="0"
              step="1"
              value={form.precio_venta}
              onChange={set("precio_venta")}
              className="finput"
            />
          </Field>
          {puedeEditarCosto && (
            <Field label="Costo promedio (COP)">
              <input
                type="number"
                min="0"
                step="1"
                value={form.costo_promedio}
                onChange={set("costo_promedio")}
                className="finput"
              />
            </Field>
          )}
        </Row>
        <Row cols={3}>
          <Field label="Unidad de medida">
            <input
              type="text"
              value={form.unidad_medida}
              onChange={set("unidad_medida")}
              className="finput sans"
              placeholder="unidad, kg, m, ..."
              maxLength={20}
            />
          </Field>
          <Field label="Stock mínimo">
            <input
              type="number"
              min="0"
              step="1"
              value={form.stock_minimo}
              onChange={set("stock_minimo")}
              className="finput"
            />
          </Field>
          <Field label="Stock máximo">
            <input
              type="number"
              min="0"
              step="1"
              value={form.stock_maximo}
              onChange={set("stock_maximo")}
              className="finput"
            />
          </Field>
        </Row>
      </SectionCard>

      <SectionCard title="Clasificación y ubicación">
        <Field label="¿Se puede vender?">
          <label
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--n-700)" }}
          >
            <input
              type="checkbox"
              checked={form.vendible}
              onChange={(e) => setForm({ ...form, vendible: e.target.checked })}
              className="h-4 w-4"
            />
            Vendible (desmárcalo si es un insumo que no se vende)
          </label>
        </Field>
        <Field label="¿Es ensamblable?">
          <label
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--n-700)" }}
          >
            <input
              type="checkbox"
              checked={form.ensamblable}
              onChange={(e) =>
                setForm({ ...form, ensamblable: e.target.checked })
              }
              className="h-4 w-4"
            />
            Ensamblable (puede producirse en el módulo de Ensambles)
          </label>
        </Field>
        <Field label="¿En piso?">
          <label
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--n-700)" }}
          >
            <input
              type="checkbox"
              checked={form.en_piso}
              onChange={(e) =>
                setForm({
                  ...form,
                  en_piso: e.target.checked,
                  stand: e.target.checked ? "" : form.stand,
                  posicion: e.target.checked ? "" : form.posicion,
                })
              }
              className="h-4 w-4"
            />
            En piso (zona central de carga pesada, sin stand ni posición)
          </label>
        </Field>
        <Row>
          <Field label="Stand (1–9)">
            <input
              type="number"
              min="1"
              max="9"
              step="1"
              value={form.stand}
              onChange={set("stand")}
              disabled={form.en_piso}
              className="finput"
              placeholder={form.en_piso ? "En piso" : "—"}
            />
          </Field>
          <Field label="Posición (1–4)">
            <input
              type="number"
              min="1"
              max="4"
              step="1"
              value={form.posicion}
              onChange={set("posicion")}
              disabled={form.en_piso}
              className="finput"
              placeholder="—"
            />
          </Field>
        </Row>
      </SectionCard>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="btn btn-out justify-center disabled:opacity-50"
          style={{ height: 48 }}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-pri justify-center disabled:opacity-50"
          style={{ height: 48 }}
        >
          {submitting ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────────── */

function SectionCard({ title, children }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] border"
      style={{ backgroundColor: "var(--n-0)", borderColor: "var(--n-150)" }}
    >
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: "var(--n-100)", backgroundColor: "var(--n-50)" }}
      >
        <p
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{ color: "var(--n-500)" }}
        >
          {title}
        </p>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function Row({ children, cols = 2 }) {
  const gridCls =
    cols === 3
      ? "grid grid-cols-1 gap-3 md:grid-cols-3"
      : "grid grid-cols-1 gap-3 md:grid-cols-2";
  return <div className={gridCls}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span
        className="block text-xs font-medium"
        style={{ color: "var(--n-500)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
