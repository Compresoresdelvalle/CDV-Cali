import { useState } from "react";

/**
 * Form reutilizable de producto (crear / editar — F12).
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
}) {
  const [form, setForm] = useState({
    nombre: initial.nombre ?? "",
    descripcion: initial.descripcion ?? "",
    referencia: initial.referencia ?? "",
    codigo_interno: initial.codigo_interno ?? "",
    codigo_proveedor: initial.codigo_proveedor ?? "",
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
    };
    await onSubmit?.(payload);
  };

  const errorBox = validationError || errorMsg;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorBox && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.4)",
            color: "hsl(var(--destructive))",
          }}
        >
          {errorBox}
        </div>
      )}

      <Section title="Identificación">
        <Field label="Nombre *" required>
          <input
            type="text"
            value={form.nombre}
            onChange={set("nombre")}
            className={inputCls}
            style={inputStyle}
            placeholder="Ej. Compresor 50L 2HP"
            maxLength={200}
          />
        </Field>
        <Row>
          <Field label="Código interno *" required>
            <input
              type="text"
              value={form.codigo_interno}
              onChange={set("codigo_interno")}
              className={inputCls}
              style={inputStyle}
              placeholder="CV-001"
              maxLength={64}
            />
          </Field>
          <Field label="Código del proveedor">
            <input
              type="text"
              value={form.codigo_proveedor}
              onChange={set("codigo_proveedor")}
              className={inputCls}
              style={inputStyle}
              placeholder="Opcional"
              maxLength={64}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Referencia (SKU fabricante)">
            <input
              type="text"
              value={form.referencia}
              onChange={set("referencia")}
              className={inputCls}
              style={inputStyle}
              maxLength={64}
            />
          </Field>
          <Field label="Tipo *" required>
            <select
              value={form.tipo}
              onChange={set("tipo")}
              className={inputCls}
              style={inputStyle}
            >
              <option value="nuevo">Nuevo</option>
              <option value="segunda_mano">Segunda mano</option>
            </select>
          </Field>
        </Row>
      </Section>

      <Section title="Catalogación">
        <Row>
          <Field label="Categoría">
            <input
              type="text"
              value={form.categoria}
              onChange={set("categoria")}
              className={inputCls}
              style={inputStyle}
              maxLength={80}
            />
          </Field>
          <Field label="Subcategoría">
            <input
              type="text"
              value={form.subcategoria}
              onChange={set("subcategoria")}
              className={inputCls}
              style={inputStyle}
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
              className={inputCls}
              style={inputStyle}
              maxLength={80}
            />
          </Field>
          <Field label="Modelo">
            <input
              type="text"
              value={form.modelo}
              onChange={set("modelo")}
              className={inputCls}
              style={inputStyle}
              maxLength={80}
            />
          </Field>
        </Row>
        <Field label="Descripción">
          <textarea
            value={form.descripcion}
            onChange={set("descripcion")}
            className={inputCls + " min-h-[80px]"}
            style={inputStyle}
            maxLength={500}
          />
        </Field>
      </Section>

      <Section title="Precios e inventario">
        <Row>
          <Field label="Precio de venta (COP)">
            <input
              type="number"
              min="0"
              step="1"
              value={form.precio_venta}
              onChange={set("precio_venta")}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Costo promedio (COP)">
            <input
              type="number"
              min="0"
              step="1"
              value={form.costo_promedio}
              onChange={set("costo_promedio")}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Unidad de medida">
            <input
              type="text"
              value={form.unidad_medida}
              onChange={set("unidad_medida")}
              className={inputCls}
              style={inputStyle}
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
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Stock máximo">
            <input
              type="number"
              min="0"
              step="1"
              value={form.stock_maximo}
              onChange={set("stock_maximo")}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm px-4 py-2 rounded-lg border cursor-pointer min-h-[48px] disabled:opacity-50"
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
          disabled={submitting}
          className="text-sm px-5 py-2 rounded-lg cursor-pointer min-h-[48px] disabled:opacity-50"
          style={{
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          {submitting ? "Guardando..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border text-sm min-h-[44px] focus:outline-none";
const inputStyle = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))",
};

function Section({ title, children }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{
        backgroundColor: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label
        className="text-xs"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
