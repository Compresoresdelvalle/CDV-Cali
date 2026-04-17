import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

/**
 * Abre una ventana de impresión con la etiqueta QR del producto.
 * Formato aprox 5cm × 3cm — ideal para impresora térmica.
 *
 * Props:
 *   referencia: string
 *   nombre:     string
 */
export default function QRPrintLabel({ referencia, nombre }) {
  const handlePrint = () => {
    // Generar SVG del QR como HTML estático
    const svgMarkup = renderToStaticMarkup(
      <QRCodeSVG value={referencia} size={150} level="M" marginSize={2} />,
    );

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Etiqueta QR — ${referencia}</title>
  <style>
    @page {
      size: 50mm 30mm;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 50mm;
      height: 30mm;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4mm;
      padding: 2mm;
      font-family: 'Segoe UI', Arial, sans-serif;
      -webkit-print-color-adjust: exact;
    }
    .qr { flex-shrink: 0; }
    .qr svg { width: 24mm; height: 24mm; display: block; }
    .info { flex: 1; overflow: hidden; }
    .ref  { font-size: 8pt; font-weight: 700; color: #000; word-break: break-all; }
    .nom  { font-size: 6pt; color: #333; margin-top: 1.5mm; line-height: 1.3;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .brand { font-size: 5pt; color: #888; margin-top: 2mm; }
  </style>
</head>
<body>
  <div class="qr">${svgMarkup}</div>
  <div class="info">
    <p class="ref">${referencia}</p>
    <p class="nom">${nombre}</p>
    <p class="brand">Compresores del Valle</p>
  </div>
  <script>window.onload = () => { window.print(); window.close(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=400,height=300");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  return (
    <button
      onClick={handlePrint}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                 bg-primary text-white text-sm font-semibold
                 hover:bg-primary-light active:scale-[0.97]
                 transition-all duration-150 cursor-pointer min-h-[44px]"
    >
      <PrinterIcon />
      Imprimir etiqueta
    </button>
  );
}

function PrinterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 9V2h12v7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="6"
        y="14"
        width="12"
        height="8"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
