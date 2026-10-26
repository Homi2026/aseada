// Los mismos colores y la misma tipografia del sitio y de las piezas de
// Instagram, para que el video no se vea de otra marca.

import { loadFont } from "@remotion/google-fonts/BricolageGrotesque";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"],
});

export const tipografia = fontFamily;

export const COLORES = {
  tinta: "#15201A",
  papel: "#F6F7F1",
  pino: "#1F5C46",
  pinoOscuro: "#122A20",
  oro: "#E8A93B",
  niebla: "#E3EAE1",
  pizarra: "#5B665F",
  // Gris claro para texto secundario sobre los fondos verdes.
  nieblaTenue: "#A9B8AF",
};

// La interfaz del Reel tapa parte de la pantalla: abajo van el texto y el
// nombre de la cuenta, y por la derecha baja la columna de botones (me gusta,
// comentar, compartir). Todo lo que se tenga que leer vive dentro de esto.
export const ZONA_SEGURA = {
  paddingTop: 220,
  paddingBottom: 420,
  paddingLeft: 90,
  paddingRight: 200,
};
