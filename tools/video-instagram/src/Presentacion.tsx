import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { EscenaCierre } from "./EscenaCierre";
import { EscenaPortada } from "./EscenaPortada";
import { EscenaPresentadora } from "./EscenaPresentadora";

// A 30 fps. DURACION_CLIP esta en 15 segundos, que es lo que dura un video de
// Marketing Studio de Higgsfield. Si en vez de eso graban a una persona de
// verdad con el guion largo, hay que subirlo a 1500 (50 s x 30).
export const DURACION_PORTADA = 60;  // 2 s
export const DURACION_CLIP = 450;    // 15 s, el maximo que da Marketing Studio
export const DURACION_CIERRE = 150;  // 5 s

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
      <EscenaPresentadora nombre="[tu nombre]" segundoDelPrecio={6} />
    </TransitionSeries.Sequence>

    <TransitionSeries.Transition presentation={fade()} timing={cruce} />

    <TransitionSeries.Sequence name="Cierre" durationInFrames={DURACION_CIERRE}>
      <EscenaCierre />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
