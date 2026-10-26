import { Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  getStaticFiles,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORES, tipografia, ZONA_SEGURA } from "./marca";

export const ARCHIVO_CLIP = "presentadora.mp4";

/** Si todavia no han grabado, el archivo no existe y hay que decirlo en vez de reventar. */
export const hayClip = () =>
  getStaticFiles().some((f) => f.name === ARCHIVO_CLIP);

export type PropsPresentadora = {
  nombre: string;
  // Aparece sobre el clip en el momento en que ella dice el precio.
  segundoDelPrecio: number;
};

const FaltaElClip: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORES.pinoOscuro,
      color: COLORES.papel,
      fontFamily: tipografia,
      ...ZONA_SEGURA,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 32,
    }}
  >
    <span
      style={{
        fontSize: 40,
        fontWeight: 600,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: COLORES.oro,
      }}
    >
      Falta la toma
    </span>
    <span style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05 }}>
      Deja el clip en<br />
      public/{ARCHIVO_CLIP}
    </span>
    <span style={{ fontSize: 42, lineHeight: 1.4, color: COLORES.nieblaTenue }}>
      El resto del video ya está armado: la portada, el rótulo con el nombre, el
      precio en pantalla y el cierre. Apenas aparezca el archivo, esto se
      reemplaza solo.
    </span>
  </AbsoluteFill>
);

export const EscenaPresentadora: React.FC<PropsPresentadora> = ({
  nombre,
  segundoDelPrecio,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (!hayClip()) return <FaltaElClip />;

  // El rotulo con el nombre entra al segundo y se va a los cinco: lo justo
  // para que se lea sin quedarse encima de toda la toma.
  const rotulo = interpolate(
    frame,
    [1 * fps, 1.6 * fps, 5 * fps, 5.6 * fps],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.16, 1, 0.3, 1)],
    },
  );

  const precio = interpolate(
    frame,
    [
      segundoDelPrecio * fps,
      (segundoDelPrecio + 0.5) * fps,
      (segundoDelPrecio + 3.5) * fps,
      (segundoDelPrecio + 4) * fps,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.16, 1, 0.3, 1)],
    },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", fontFamily: tipografia }}>
      <Video
        src={staticFile(ARCHIVO_CLIP)}
        durationInFrames={durationInFrames}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />

      <Interactive.Div
        name="Rótulo"
        style={{
          position: "absolute",
          left: ZONA_SEGURA.paddingLeft,
          bottom: ZONA_SEGURA.paddingBottom,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          backgroundColor: "rgba(18,42,32,0.86)",
          borderLeft: `8px solid ${COLORES.oro}`,
          borderRadius: "6px 18px 18px 6px",
          padding: "24px 34px",
          opacity: rotulo,
          translate: interpolate(frame, [1 * fps, 1.8 * fps], ["-28px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <span style={{ fontSize: 54, fontWeight: 800, color: COLORES.papel }}>
          {nombre}
        </span>
        <span style={{ fontSize: 34, fontWeight: 600, color: COLORES.oro }}>
          Aseada
        </span>
      </Interactive.Div>

      <Interactive.Div
        name="Precio en pantalla"
        style={{
          position: "absolute",
          right: ZONA_SEGURA.paddingRight,
          top: ZONA_SEGURA.paddingTop,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          backgroundColor: COLORES.oro,
          color: COLORES.tinta,
          borderRadius: 20,
          padding: "22px 30px",
          opacity: precio,
          scale: interpolate(
            frame,
            [segundoDelPrecio * fps, (segundoDelPrecio + 0.7) * fps],
            [0.86, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 200 }),
              output: "perceptual-scale",
            },
          ),
        }}
      >
        <span style={{ fontSize: 76, fontWeight: 800, letterSpacing: -3 }}>
          $35.990
        </span>
        <span style={{ fontSize: 28, fontWeight: 600 }}>
          depto hasta 50 m², 3 horas
        </span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
