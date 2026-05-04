/**
 * Banners reutilizables de error/ok/info/warning con tokens hsl(var(--*)).
 * Reemplaza el patrón duplicado en pages/components.
 *
 * Uso:
 *   <FeedbackBanners errorMsg={errorMsg} okMsg={okMsg} info="..." />
 */
export default function FeedbackBanners({ errorMsg, okMsg, info, warning }) {
  return (
    <>
      {errorMsg && <Banner kind="destructive">{errorMsg}</Banner>}
      {okMsg && <Banner kind="success">{okMsg}</Banner>}
      {info && <Banner kind="info">ℹ️ {info}</Banner>}
      {warning && <Banner kind="warning">⚠️ {warning}</Banner>}
    </>
  );
}

function Banner({ kind, children }) {
  return (
    <div
      role={kind === "destructive" ? "alert" : "status"}
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        backgroundColor: `hsl(var(--${kind}) / 0.08)`,
        borderColor: `hsl(var(--${kind}) / 0.4)`,
        color: `hsl(var(--${kind}))`,
      }}
    >
      {children}
    </div>
  );
}
