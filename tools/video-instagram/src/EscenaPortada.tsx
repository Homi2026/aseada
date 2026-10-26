import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORES, tipografia, ZONA_SEGURA } from "./marca";

// Dos segundos de marca antes de que ella aparezca. Corta a proposito: los
// primeros segundos deciden si alguien se queda, y un logo largo los gasta.
export const EscenaPortada: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Portada"
      style={{
        backgroundColor: COLORES.pino,
        color: COLORES.papel,
        fontFamily: tipografia,
        ...ZONA_SEGURA,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 28,
      }}
    >
      <Interactive.Div
        name="Nombre"
        style={{
          fontSize: 136,
          fontWeight: 800,
          letterSpacing: -5,
          lineHeight: 0.95,
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0, 1.2 * fps], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
        }}
      >
        Aseada
      </Interactive.Div>

      <Interactive.Div
        name="Bajada"
        style={{
          fontSize: 50,
          lineHeight: 1.3,
          color: COLORES.oro,
          fontWeight: 600,
          opacity: interpolate(frame, [0.5 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Tu casa limpia.<br />Tu tiempo, de vuelta.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
