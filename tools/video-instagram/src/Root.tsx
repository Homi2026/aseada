import { Composition, Folder } from "remotion";
import { ComoFunciona, DURACION_TOTAL } from "./ComoFunciona";
import { EscenaCierre } from "./EscenaCierre";
import { EscenaGancho } from "./EscenaGancho";
import { EscenaPaso } from "./EscenaPaso";
import { EscenaPortada } from "./EscenaPortada";
import { EscenaPresentadora } from "./EscenaPresentadora";
import {
  DURACION_CLIP,
  DURACION_PORTADA,
  DURACION_PRESENTACION,
  Presentacion,
} from "./Presentacion";

// Vertical, como lo pide un Reel o una historia.
const FORMATO = { width: 1080, height: 1920, fps: 30 } as const;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ComoFunciona"
        component={ComoFunciona}
        durationInFrames={DURACION_TOTAL}
        {...FORMATO}
      />

      <Composition
        id="Presentacion"
        component={Presentacion}
        durationInFrames={DURACION_PRESENTACION}
        {...FORMATO}
      />

      <Folder name="Escenas">
        <Composition
          id="Portada"
          component={EscenaPortada}
          durationInFrames={DURACION_PORTADA}
          {...FORMATO}
        />
        <Composition
          id="Presentadora"
          component={EscenaPresentadora}
          durationInFrames={DURACION_CLIP}
          defaultProps={{ nombre: "[tu nombre]", segundoDelPrecio: 14 }}
          {...FORMATO}
        />
        <Composition
          id="Gancho"
          component={EscenaGancho}
          durationInFrames={90}
          {...FORMATO}
        />
        <Composition
          id="Paso1"
          component={EscenaPaso}
          durationInFrames={180}
          defaultProps={{
            numero: 1,
            titulo: "Eliges el tamaño de tu hogar",
            monto: "$35.990",
            pieDelMonto: "depto hasta 50 m², 3 horas",
            detalle:
              "El precio aparece completo en pantalla. No hay que esperar una cotización.",
          }}
          {...FORMATO}
        />
        <Composition
          id="Paso2"
          component={EscenaPaso}
          durationInFrames={150}
          defaultProps={{
            numero: 2,
            titulo: "Un aseador toma tu solicitud",
            detalle:
              "Ves su nombre, su teléfono y su calificación antes de que llegue.",
          }}
          {...FORMATO}
        />
        <Composition
          id="Paso3"
          component={EscenaPaso}
          durationInFrames={165}
          defaultProps={{
            numero: 3,
            titulo: "Confirmas y recién ahí se paga",
            detalle:
              "Tu dinero queda retenido hasta que revisas tu casa y dices que quedó bien.",
          }}
          {...FORMATO}
        />
        <Composition
          id="Cierre"
          component={EscenaCierre}
          durationInFrames={180}
          {...FORMATO}
        />
      </Folder>
    </>
  );
};
