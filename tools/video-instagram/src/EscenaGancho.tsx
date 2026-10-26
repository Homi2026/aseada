import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORES, tipografia, ZONA_SEGURA } from "./marca";

export const EscenaGancho: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Gancho"
      style={{
        backgroundColor: COLORES.pinoOscuro,
        color: COLORES.papel,
        fontFamily: tipografia,
        ...ZONA_SEGURA,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 40,
      }}
    >
      <Interactive.Div
        name="Antetitulo"
        style={{
          fontSize: 44,
          fontWeight: 600,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: COLORES.oro,
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Aseo a domicilio
      </Interactive.Div>

      <Interactive.Div
        name="Titular"
        style={{
          fontSize: 122,
          fontWeight: 800,
          lineHeight: 0.95,
          letterSpacing: -6,
          opacity: interpolate(frame, [0.2 * fps, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0.2 * fps, 1.1 * fps],
            ["0px 48px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        ¿Cómo
        <br />
        funciona
        <br />
        Aseada?
      </Interactive.Div>

      <Interactive.Div
        name="Bajada"
        style={{
          fontSize: 50,
          lineHeight: 1.35,
          color: COLORES.nieblaTenue,
          maxWidth: 780,
          opacity: interpolate(frame, [0.9 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Tres pasos, y el pago queda protegido hasta el final.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
