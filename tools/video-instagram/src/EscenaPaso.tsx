import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORES, tipografia, ZONA_SEGURA } from "./marca";

export type PropsPaso = {
  numero: number;
  titulo: string;
  detalle: string;
  // Cuando el paso tiene una cifra que mostrar, aparece grande y despues del
  // titulo: es el momento que la gente recuerda.
  monto?: string;
  pieDelMonto?: string;
};

export const EscenaPaso: React.FC<PropsPaso> = ({
  numero,
  titulo,
  detalle,
  monto,
  pieDelMonto,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name={`Paso ${numero}`}
      style={{
        backgroundColor: COLORES.papel,
        color: COLORES.tinta,
        fontFamily: tipografia,
        ...ZONA_SEGURA,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 44,
      }}
    >
      <Interactive.Div
        name="Insignia"
        style={{
          alignSelf: "flex-start",
          backgroundColor: COLORES.pino,
          color: COLORES.papel,
          fontSize: 40,
          fontWeight: 800,
          padding: "16px 36px",
          borderRadius: 999,
          opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Paso {numero} de 3
      </Interactive.Div>

      <Interactive.Div
        name="Numero"
        style={{
          fontSize: 240,
          fontWeight: 800,
          lineHeight: 0.8,
          letterSpacing: -12,
          color: COLORES.oro,
          scale: interpolate(frame, [0, 0.9 * fps], [0.82, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        0{numero}
      </Interactive.Div>

      <Interactive.Div
        name="Titulo"
        style={{
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.02,
          letterSpacing: -3,
          opacity: interpolate(frame, [0.3 * fps, 0.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0.3 * fps, 1.1 * fps],
            ["0px 40px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        {titulo}
      </Interactive.Div>

      {monto ? (
        <Interactive.Div
          name="Monto"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            opacity: interpolate(frame, [1.4 * fps, 1.9 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            scale: interpolate(frame, [1.4 * fps, 2.2 * fps], [0.9, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 200 }),
              output: "perceptual-scale",
            }),
          }}
        >
          <span
            style={{
              fontSize: 116,
              fontWeight: 800,
              letterSpacing: -5,
              color: COLORES.pino,
            }}
          >
            {monto}
          </span>
          <span style={{ fontSize: 44, color: COLORES.pizarra }}>
            {pieDelMonto}
          </span>
        </Interactive.Div>
      ) : null}

      <Interactive.Div
        name="Detalle"
        style={{
          fontSize: 50,
          lineHeight: 1.35,
          color: COLORES.pizarra,
          maxWidth: 840,
          opacity: interpolate(
            frame,
            [(monto ? 2 : 1.1) * fps, (monto ? 2.6 : 1.7) * fps],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        {detalle}
      </Interactive.Div>
    </AbsoluteFill>
  );
};
