// Las horas tienen que coincidir con HORAS_INCLUIDAS del servidor, que es
// quien cobra: 40 y 50 m² caen en el tramo de 50 (3 h), 65 y 80 en el de 80
// (4 h), 100 y 120 en el de 120 (5 h), 150 y 200 en el de 200 (6,5 h), y de
// ahí para arriba el tramo mayor (8 h).
/** 6.5 se escribe "6,5" en Chile, no "6.5". */
export const horasTexto = (horas: number) => horas.toLocaleString('es-CL');

export const TAMANIOS = [
  { label: 'Departamento pequeño', metros: 40, horas: 3, icono: '🏠' },
  { label: 'Departamento mediano', metros: 65, horas: 4, icono: '🏡' },
  { label: 'Casa mediana', metros: 100, horas: 5, icono: '🏘️' },
  { label: 'Casa grande', metros: 150, horas: 6.5, icono: '🏰' },
  { label: 'Casa muy grande', metros: 250, horas: 8, icono: '🏯' },
];
