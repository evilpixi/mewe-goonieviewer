// Formatos de fecha compartidos (español)
const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const shortDateTime = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
const dayThisYear = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const dayOtherYear = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });
const full = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'short' });

export const formatTime = (ms) => time.format(ms);
export const formatDateTime = (ms) => shortDateTime.format(ms);
export const formatFull = (ms) => full.format(ms);

// Clave por día local ("2026-10-01"), para agrupar
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// "Hoy", "Ayer", "lunes, 28 de septiembre" o "3 de marzo de 2025"
export function formatDay(ms) {
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Hoy';
  if (dayKey(date) === dayKey(yesterday)) return 'Ayer';
  const text = (date.getFullYear() === today.getFullYear() ? dayThisYear : dayOtherYear).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
