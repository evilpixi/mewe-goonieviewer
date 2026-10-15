// Versión mobile: el mismo corte que usa styles.css (@media (max-width: 640px)).
const query = window.matchMedia('(max-width: 640px)');

export const isMobile = () => query.matches;

// La app de Android (Capacitor), no una ventana angosta de escritorio. Su <html> lleva la clase `android`.
export const isAndroid = Boolean(window.Capacitor);
document.documentElement.classList.toggle('android', isAndroid);

// Un gesto táctil que empieza a menos de esto del borde izquierdo de la conversación es para la lista de chats
// (ver chatView.js); más adentro, para el mensaje que se toca (ver chat/conversation.js)
export const EDGE_SWIPE_PX = 28;

// callback() cuando la ventana pasa de mobile a escritorio o al revés
export const onMobileChange = (callback) => query.addEventListener('change', callback);
