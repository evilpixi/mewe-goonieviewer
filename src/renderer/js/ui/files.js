// Saca los archivos elegidos en un <input type="file"> y lo vacía, para que elegir otra vez el mismo archivo
// vuelva a avisar. Devuelve copias en memoria: en Android los File del selector dejan de poder leerse en cuanto
// el input se vacía (fallaban al subirlos con un error de permisos).
export async function takeFiles(input) {
  try {
    return await Promise.all(
      [...input.files].map(async (file) => new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified })),
    );
  } catch (err) {
    console.error('[archivos] no se pudo leer el archivo elegido:', err);
    return [];
  } finally {
    input.value = '';
  }
}
