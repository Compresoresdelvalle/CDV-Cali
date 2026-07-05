/**
 * MapaBodega — mapa físico de ubicaciones (Bloque D2).
 *
 * Dado un `ubicacion_id` real (ej. "ST3-P2", "PISO", "CV-ENTRADA") dibuja:
 * - Sede BODEGA: plano SVG en U de los 9 stands + zona de piso, con el
 *   stand/zona resaltado.
 * - Sedes CV/CHV/L3: barra de 3 zonas relativas (ENTRADA/MEDIO/FONDO).
 *
 * No hace fetch: recibe el código ya resuelto. Solo presentación, 100% con
 * tokens CSS (ninguna referencia hex).
 *
 * Geometría del SVG (viewBox 0 0 200 260, rectángulo vertical, puerta abajo):
 * - ST5 (fondo, arriba):        x 10–190, y 10–44
 * - Columna izquierda (pared):  x 10–44   — ST4(48–93) ST3(99–144) ST2(150–195) ST1(201–246)
 * - Columna derecha (pared):    x 156–190 — ST6(48–93) ST7(99–144) ST8(150–195) ST9(201–246)
 * - PISO (centro de la U):      x 48–152, y 48–246, borde punteado
 * - Puerta: hueco en la pared inferior entre ST1 y ST9 (x 44–156, y≈246–256)
 */

const BODEGA_RE = /^ST([1-9])-P([1-4])$/;
const ZONA_RE = /^(CV|CHV|L3)-(ENTRADA|MEDIO|FONDO)$/;

const ALTURA_LABEL = {
  1: "posición baja",
  2: "altura media (zona cómoda)",
  3: "altura media (zona cómoda)",
  4: "posición alta",
};

// Layout fijo de los 9 stands: id → { x, y, w, h }
const STAND_RECT = {
  ST5: { x: 10, y: 10, w: 180, h: 34 },
  ST4: { x: 10, y: 48, w: 34, h: 45 },
  ST3: { x: 10, y: 99, w: 34, h: 45 },
  ST2: { x: 10, y: 150, w: 34, h: 45 },
  ST1: { x: 10, y: 201, w: 34, h: 45 },
  ST6: { x: 156, y: 48, w: 34, h: 45 },
  ST7: { x: 156, y: 99, w: 34, h: 45 },
  ST8: { x: 156, y: 150, w: 34, h: 45 },
  ST9: { x: 156, y: 201, w: 34, h: 45 },
};

export default function MapaBodega({ ubicacionId, compact = false }) {
  if (!ubicacionId) return null;

  const bodegaMatch =
    ubicacionId === "PISO" ? null : ubicacionId.match(BODEGA_RE);
  const esPiso = ubicacionId === "PISO";
  const zonaMatch = ubicacionId.match(ZONA_RE);

  if (esPiso || bodegaMatch) {
    const standActivo = bodegaMatch ? `ST${bodegaMatch[1]}` : null;
    const posActiva = bodegaMatch ? Number(bodegaMatch[2]) : null;
    const etiqueta = esPiso
      ? "Zona central de piso"
      : `${ubicacionId} · ${ALTURA_LABEL[posActiva] ?? ""}`;

    return (
      <div className="flex flex-col items-center gap-1.5">
        <svg
          viewBox="0 0 200 260"
          className={`w-full ${compact ? "max-w-[160px]" : "max-w-[220px]"}`}
          role="img"
          aria-label={`Mapa de bodega, ubicación ${ubicacionId}`}
        >
          <rect
            x="0.5"
            y="0.5"
            width="199"
            height="259"
            rx="4"
            fill="hsl(var(--card))"
            stroke="none"
          />

          {Object.entries(STAND_RECT).map(([id, r]) => {
            const activo = id === standActivo;
            return (
              <g key={id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx="3"
                  fill={
                    activo
                      ? "hsl(var(--primary) / 0.85)"
                      : "hsl(var(--muted) / 0.6)"
                  }
                  stroke="hsl(var(--border))"
                  strokeWidth="1"
                />
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={
                    activo
                      ? "hsl(var(--primary-foreground))"
                      : "hsl(var(--muted-foreground))"
                  }
                >
                  {id}
                </text>
              </g>
            );
          })}

          {/* PISO — zona central, borde punteado */}
          <rect
            x="48"
            y="48"
            width="104"
            height="198"
            rx="4"
            fill={esPiso ? "hsl(var(--warning) / 0.25)" : "transparent"}
            stroke="hsl(var(--warning) / 0.5)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <text
            x="100"
            y="150"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="600"
            fill="hsl(var(--muted-foreground))"
          >
            PISO
          </text>

          {/* Puerta: hueco en la pared inferior */}
          <line
            x1="44"
            y1="250"
            x2="156"
            y2="250"
            stroke="hsl(var(--border))"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <text
            x="100"
            y="257"
            textAnchor="middle"
            fontSize="8"
            fill="hsl(var(--muted-foreground))"
          >
            Puerta
          </text>
        </svg>
        <p
          className="text-center text-[11px] font-medium"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {etiqueta}
        </p>
      </div>
    );
  }

  if (zonaMatch) {
    const zonaActiva = zonaMatch[2];
    const zonas = ["ENTRADA", "MEDIO", "FONDO"];
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={`flex w-full items-center gap-1.5 ${compact ? "max-w-[220px]" : "max-w-[280px]"}`}
        >
          <span
            className="shrink-0 text-[10.5px] font-semibold"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            Puerta →
          </span>
          {zonas.map((z) => {
            const activa = z === zonaActiva;
            return (
              <div
                key={z}
                className="flex h-9 flex-1 items-center justify-center rounded-md border text-[10.5px] font-semibold"
                style={{
                  backgroundColor: activa
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted) / 0.6)",
                  color: activa
                    ? "hsl(var(--primary-foreground))"
                    : "hsl(var(--muted-foreground))",
                  borderColor: "hsl(var(--border))",
                }}
              >
                {z}
              </div>
            );
          })}
        </div>
        <p
          className="text-center text-[11px] font-medium"
          style={{ color: "hsl(var(--foreground))" }}
        >
          {ubicacionId} · zona {zonaActiva.toLowerCase()}
        </p>
      </div>
    );
  }

  return null;
}
