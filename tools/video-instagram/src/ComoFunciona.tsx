import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { EscenaCierre } from "./EscenaCierre";
import { EscenaGancho } from "./EscenaGancho";
import { EscenaPaso } from "./EscenaPaso";

// A 30 fps. La suma de las escenas es 765, menos los 4 cruces de 15 cuadros
// cada uno: el video dura 705 cuadros, 23,5 segundos.
export const DURACION_TOTAL = 705;

const cruce = linearTiming({ durationInFrames: 15 });

export const ComoFunciona: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Gancho" durationInFrames={90}>
      <EscenaGancho />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Paso 1" durationInFrames={180}>
      <EscenaPaso
        numero={1}
        titulo="Eliges el tamaño de tu hogar"
        monto="$35.990"
        pieDelMonto="depto hasta 50 m², 3 horas"
        detalle="El precio aparece completo en pantalla. No hay que esperar una cotización."
      />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Paso 2" durationInFrames={150}>
      <EscenaPaso
        numero={2}
        titulo="Un aseador toma tu solicitud"
        detalle="Ves su nombre, su teléfono y su calificación antes de que llegue."
      />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Paso 3" durationInFrames={165}>
      <EscenaPaso
        numero={3}
        titulo="Confirmas y recién ahí se paga"
        detalle="Tu dinero queda retenido hasta que revisas tu casa y dices que quedó bien."
      />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Cierre" durationInFrames={180}>
      <EscenaCierre />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
