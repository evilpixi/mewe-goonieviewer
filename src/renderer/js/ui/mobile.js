// Versión mobile: el mismo corte que usa styles.css (@media (max-width: 640px)).
const query = window.matchMedia('(max-width: 640px)');

export const isMobile = () => query.matches;
