import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { EscenaCierre } from "./EscenaCierre";
import { EscenaPortada } from "./EscenaPortada";
import { EscenaPresentadora } from "./EscenaPresentadora";

// A 30 fps. El unico valor que hay que ajustar cuando llegue la grabacion es
// DURACION_CLIP: ponerle los cuadros que dure la toma (segundos x 30).
export const DURACION_PORTADA = 60;   // 2 s
export const DURACION_CLIP = 1500;    // 50 s, el largo del guion largo
export const DURACION_CIERRE = 150;   // 5 s

const CRUCE = 12;
export const DURACION_PRESENTACION =
  DURACION_PORTADA + DURACION_CLIP + DURACION_CIERRE - 2 * CRUCE;

const cruce = linearTiming({ durationInFrames: CRUCE });

export const Presentacion: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Portada" durationInFrames={DURACION_PORTADA}>
      <EscenaPortada />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Presentadora" durationInFrames={DURACION_CLIP}>
      <EscenaPresentadora nombre="[tu nombre]" segundoDelPrecio={14} />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Cierre" durationInFrames={DURACION_CIERRE}>
      <EscenaCierre />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
