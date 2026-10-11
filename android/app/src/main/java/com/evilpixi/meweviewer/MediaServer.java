package com.evilpixi.meweviewer;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.HttpUrl;
import okhttp3.Response;
import okhttp3.ResponseBody;

// Imágenes y videos de MeWe para la UI: https://localhost/_mewe-img/<accountId>?u=<url de MeWe>
// Necesitan las cookies de la cuenta, así que se descargan acá. Es el protocolo mewe-img:// de Electron
// (src/main/imageProtocol.js) con la misma lógica de rangos y de imágenes temporales.
final class MediaServer {

    static final String PATH_PREFIX = "/_mewe-img/";

    private static final String TEMPORAL_SIZE = "/400x400/"; // config.mewe.chat.disappearingImageSize
    private static final int TEMPORAL_ITEMS = 30; // imágenes temporales que se guardan en memoria
    private static final int TEMPORAL_MAX_BYTES = 8 * 1024 * 1024; // las más pesadas no se guardan
    private static final long WHOLE_MAX_BYTES = 150L * 1024 * 1024;
    private static final int WHOLE_KEEP = 3;
    private static final Pattern RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");
    private static final String ALBUM = "Goonie Mewe";

    private static final class Blob {

        final byte[] data;
        final String contentType;

        Blob(byte[] data, String contentType) {
            this.data = data;
            this.contentType = contentType;
        }
    }

    private final MeweHttp http;
    // url → imagen temporal ya vista: se puede volver a abrir (y guardar) aunque MeWe ya no la entregue
    private final Map<String, Blob> temporal = new LinkedHashMap<>();
    // "cuenta url" → archivo bajado entero para servirlo por rangos. Quedan los últimos.
    private final Map<String, Blob> whole = new LinkedHashMap<>();

    MediaServer(MeweHttp http) {
        this.http = http;
    }

    // null si el pedido no es de /_mewe-img/ (lo atiende Capacitor)
    WebResourceResponse intercept(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (path == null || !path.startsWith(PATH_PREFIX)) return null;
        try {
            String accountId = path.substring(PATH_PREFIX.length());
            HttpUrl target = HttpUrl.parse(String.valueOf(uri.getQueryParameter("u")));
            if (accountId.isEmpty() || !MeweHttp.isMewe(target)) return text(400, "Host no permitido");
            return serve(accountId, target, header(request, "Range"));
        } catch (Exception err) {
            return text(500, String.valueOf(err.getMessage()));
        }
    }

    private WebResourceResponse serve(String accountId, HttpUrl target, String range) throws IOException {
        if (isTemporal(target)) {
            Blob image = temporalImage(accountId, target);
            return bytes(200, image.contentType, image.data, new HashMap<>());
        }
        // Los videos se piden de a rangos: se reenvía el pedido y la respuesta parcial tal cual
        String key = accountId + " " + target;
        Blob cached = range == null ? null : cachedWhole(key);
        if (cached != null) return partial(cached, range);

        Response response = http.fetchMedia(accountId, target, range);
        ResponseBody body = response.body();
        String contentType = response.header("Content-Type", "application/octet-stream");
        // Los videos mandados como archivo (/doc/chat/…) no se sirven por rangos: MeWe contesta 200 con el archivo
        // entero pida lo que se pida, y <video> se rompe. Se baja una vez y los rangos salen de esa copia.
        long size = body == null ? -1 : body.contentLength();
        if (range != null && response.code() == 200 && body != null && size <= WHOLE_MAX_BYTES) {
            Blob file;
            try {
                file = new Blob(readUpTo(body.byteStream(), WHOLE_MAX_BYTES), contentType);
            } finally {
                response.close();
            }
            rememberWhole(key, file);
            return partial(file, range);
        }
        Map<String, String> headers = new HashMap<>();
        for (String name : new String[] { "Content-Range", "Accept-Ranges", "Content-Length" }) {
            String value = response.header(name);
            if (value != null) headers.put(name, value);
        }
        // al cerrar el stream se cierra la respuesta
        InputStream data = body == null ? new ByteArrayInputStream(new byte[0]) : body.byteStream();
        if (range != null && response.code() == 206) data = new RangedStream(data, rangeStart(range));
        return stream(response.code(), contentType, data, headers);
    }

    // El WebView de Android atiende él mismo el Range de un pedido interceptado: da por hecho que el stream
    // empieza en el byte 0 del recurso y saltea (skip) hasta el comienzo del rango. La respuesta 206 de MeWe ya
    // empieza ahí: este stream se traga ese salto, o el video llegaría corrido y no cargaría nunca.
    // available() en 0 le dice al WebView que no conoce el tamaño: si no, toma lo que haya en el buffer como total.
    private static final class RangedStream extends java.io.FilterInputStream {

        private long toSwallow;

        RangedStream(InputStream in, long start) {
            super(in);
            toSwallow = start;
        }

        @Override
        public long skip(long n) throws IOException {
            if (toSwallow <= 0) return super.skip(n);
            long swallowed = Math.min(n, toSwallow);
            toSwallow -= swallowed;
            return swallowed;
        }

        @Override
        public int available() {
            return 0;
        }
    }

    // Primer byte de "bytes=a-b" o "bytes=a-" (0 si pide los últimos n: ahí el WebView no saltea)
    private static long rangeStart(String range) {
        Matcher match = RANGE.matcher(range.trim());
        return match.matches() && !match.group(1).isEmpty() ? Long.parseLong(match.group(1)) : 0;
    }

    private static byte[] readUpTo(InputStream stream, long max) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[64 * 1024];
        for (int n = stream.read(chunk); n != -1; n = stream.read(chunk)) {
            out.write(chunk, 0, n);
            if (out.size() > max) throw new IOException("El archivo es demasiado grande para reproducirlo.");
        }
        return out.toByteArray();
    }

    // Guarda una imagen o un video en la galería (Pictures o Movies, carpeta "Goonie Mewe") → ruta relativa
    String save(Context context, String accountId, HttpUrl target, String suggestedName) throws IOException {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new IOException("Guardar archivos requiere Android 10 o posterior.");
        Blob known = isTemporal(target) ? temporalImage(accountId, target) : null;
        Response response = known == null ? http.fetchMedia(accountId, target, null) : null;
        try {
            if (response != null && !response.isSuccessful()) throw new IOException("No se pudo descargar la imagen (HTTP " + response.code() + ").");
            String contentType = known != null ? known.contentType : response.header("Content-Type", "image/jpeg");
            String type = contentType.split(";")[0].trim();
            boolean video = type.equals("video/mp4");
            String ext = extension(type);
            String base = String.valueOf(suggestedName == null || suggestedName.isEmpty() ? "mewe-imagen" : suggestedName)
                .replaceAll("[^\\w.-]+", "_")
                .replaceAll("\\.\\w+$", "");
            String name = base + "." + ext;
            String folder = (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/" + ALBUM;

            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, video ? "video/mp4" : "image/" + (ext.equals("jpg") ? "jpeg" : ext));
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri item = resolver.insert(collection, values);
            if (item == null) throw new IOException("No se pudo crear el archivo.");
            try (
                OutputStream out = resolver.openOutputStream(item);
                InputStream in = known != null ? new ByteArrayInputStream(known.data) : response.body().byteStream()
            ) {
                if (out == null) throw new IOException("No se pudo abrir el archivo.");
                byte[] chunk = new byte[64 * 1024];
                for (int n = in.read(chunk); n != -1; n = in.read(chunk)) out.write(chunk, 0, n);
            } catch (IOException | RuntimeException err) {
                resolver.delete(item, null, null);
                throw err;
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            return folder + "/" + name;
        } finally {
            if (response != null) response.close();
        }
    }

    private static String extension(String type) {
        switch (type) {
            case "image/png":
                return "png";
            case "image/gif":
                return "gif";
            case "image/webp":
                return "webp";
            case "video/mp4":
                return "mp4";
            default:
                return "jpg";
        }
    }

    // Las imágenes temporales del chat se piden a mewe.com con un tamaño fijo (ver normalize.js)
    private static boolean isTemporal(HttpUrl target) {
        return target.host().equals("mewe.com") && target.encodedPath().contains(TEMPORAL_SIZE);
    }

    private Blob temporalImage(String accountId, HttpUrl target) throws IOException {
        String key = target.toString();
        synchronized (temporal) {
            Blob hit = temporal.get(key);
            if (hit != null) return hit;
        }
        try (Response response = http.fetchMedia(accountId, target, null)) {
            if (!response.isSuccessful() || response.body() == null) throw new IOException("HTTP " + response.code());
            Blob image = new Blob(response.body().bytes(), response.header("Content-Type", "application/octet-stream"));
            if (image.data.length > 0 && image.data.length <= TEMPORAL_MAX_BYTES) {
                synchronized (temporal) {
                    temporal.put(key, image);
                    // se descartan las más viejas (LinkedHashMap conserva el orden de inserción)
                    while (temporal.size() > TEMPORAL_ITEMS) temporal.remove(temporal.keySet().iterator().next());
                }
            }
            return image;
        }
    }

    private Blob cachedWhole(String key) {
        synchronized (whole) {
            return whole.get(key);
        }
    }

    private void rememberWhole(String key, Blob file) {
        synchronized (whole) {
            whole.put(key, file);
            while (whole.size() > WHOLE_KEEP) whole.remove(whole.keySet().iterator().next());
        }
    }

    // Respuesta 206 al rango pedido ("bytes=a-b", "bytes=a-" o "bytes=-n") de un archivo que ya está en memoria.
    // Va el archivo entero: el WebView saltea y corta el rango por su cuenta (ver RangedStream).
    private static WebResourceResponse partial(Blob file, String range) {
        int size = file.data.length;
        Matcher match = RANGE.matcher(range.trim());
        long start = -1;
        long end = size - 1;
        if (match.matches()) {
            String from = match.group(1);
            String to = match.group(2);
            if (!from.isEmpty()) {
                start = Long.parseLong(from);
                if (!to.isEmpty()) end = Long.parseLong(to);
            } else if (!to.isEmpty()) {
                start = Math.max(0, size - Long.parseLong(to)); // los últimos n bytes
            }
        }
        end = Math.min(end, size - 1);
        Map<String, String> headers = new HashMap<>();
        if (start < 0 || start > end) {
            headers.put("Content-Range", "bytes */" + size);
            return bytes(416, file.contentType, new byte[0], headers);
        }
        int length = (int) (end - start + 1);
        headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(length));
        return stream(206, file.contentType, new ByteArrayInputStream(file.data), headers);
    }

    private static String header(WebResourceRequest request, String name) {
        for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }

    private static WebResourceResponse text(int status, String message) {
        return bytes(status, "text/plain", message.getBytes(StandardCharsets.UTF_8), new HashMap<>());
    }

    private static WebResourceResponse bytes(int status, String contentType, byte[] data, Map<String, String> headers) {
        return stream(status, contentType, new ByteArrayInputStream(data), headers);
    }

    private static WebResourceResponse stream(int status, String contentType, InputStream data, Map<String, String> headers) {
        // WebResourceResponse no admite redirecciones ni estados fuera de rango
        int code = status < 100 || status > 599 || (status >= 300 && status < 400) ? 502 : status;
        String mime = contentType.split(";")[0].trim();
        headers.put("Content-Type", contentType);
        return new WebResourceResponse(mime, null, code, reason(code), headers, data);
    }

    private static String reason(int status) {
        if (status == 200) return "OK";
        if (status == 206) return "Partial Content";
        if (status == 404) return "Not Found";
        if (status == 416) return "Range Not Satisfiable";
        return status < 400 ? "OK" : "Error";
    }
}
