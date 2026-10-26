import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORES, tipografia, ZONA_SEGURA } from "./marca";

const GARANTIAS = [
  "Precio exacto antes de agendar",
  "Pago retenido hasta que confirmas",
  "Si nadie llega, reagendamos o devolvemos",
];

export const EscenaCierre: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Cierre"
      style={{
        backgroundColor: COLORES.pino,
        color: COLORES.papel,
        fontFamily: tipografia,
        ...ZONA_SEGURA,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 56,
      }}
    >
      <Interactive.Div
        name="Titular"
        style={{
          fontSize: 100,
          fontWeight: 800,
          lineHeight: 0.98,
          letterSpacing: -5,
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0, 0.8 * fps],
            ["0px 40px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        Sin cotizar
        <br />
        por WhatsApp
      </Interactive.Div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {GARANTIAS.map((texto, i) => (
          <Interactive.Div
            key={texto}
            name={`Garantía ${i + 1}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 26,
              backgroundColor: "rgba(246,247,241,0.1)",
              borderRadius: 24,
              padding: "32px 38px",
              fontSize: 46,
              lineHeight: 1.25,
              opacity: interpolate(
                frame,
                [(0.6 + i * 0.25) * fps, (1.1 + i * 0.25) * fps],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
              translate: interpolate(
                frame,
                [(0.6 + i * 0.25) * fps, (1.3 + i * 0.25) * fps],
                ["0px 28px", "0px 0px"],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
            }}
          >
            <span
              style={{
                fontSize: 52,
                fontWeight: 800,
                color: COLORES.oro,
                flex: "none",
              }}
            >
              ✓
            </span>
            {texto}
          </Interactive.Div>
        ))}
      </div>

      <Interactive.Div
        name="Llamado"
        style={{
          fontSize: 60,
          fontWeight: 800,
          color: COLORES.oro,
          opacity: interpolate(frame, [1.8 * fps, 2.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Link en la bio
      </Interactive.Div>
    </AbsoluteFill>
  );
};
