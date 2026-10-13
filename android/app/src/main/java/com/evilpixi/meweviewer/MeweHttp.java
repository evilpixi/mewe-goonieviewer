package com.evilpixi.meweviewer;

import android.content.Context;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

// HTTP nativo contra MeWe con las cookies de cada cuenta. Lo comparten el plugin (peticiones de la API que
// arma MeweClient en JS), las imágenes y videos (MediaServer) y el tiempo real (WebSocket).
final class MeweHttp {

    static final String HOST = "https://mewe.com";
    // Los mismos valores de src/config.js y de MeweClient.headers()
    static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
    private static final String IDENTIFY = HOST + "/api/v3/auth/identify";
    private static final String CSRF_COOKIE = "csrf-token";
    private static final long REFRESH_MIN_INTERVAL_MS = 30000; // no renovar la sesión más seguido que esto

    private static MeweHttp instance;

    final CookieStore cookies;
    final MediaServer media = new MediaServer(this);
    private final OkHttpClient base;
    private OkHttpClient sockets;
    private final Map<String, OkHttpClient> clients = new HashMap<>();
    private final Map<String, Long> refreshedAt = new HashMap<>();

    static synchronized MeweHttp get(Context context) {
        if (instance == null) instance = new MeweHttp(context.getApplicationContext());
        return instance;
    }

    private MeweHttp(Context context) {
        cookies = new CookieStore(context);
        base = new OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build();
    }

    // Sólo se habla con MeWe: el plugin no es un proxy abierto para lo que corra en el WebView
    static boolean isMewe(HttpUrl url) {
        return url != null && url.isHttps() && (url.host().equals("mewe.com") || url.host().endsWith(".mewe.com"));
    }

    // La única excepción: los videos se suben directo a un bucket de S3 que indica MeWe (ver sendChatVideo
    // en src/mewe/client.js). Ahí sólo se hace POST, con uploadClient (sin las cookies de la cuenta).
    static boolean isUploadBucket(HttpUrl url) {
        return url != null && url.isHttps() && url.host().endsWith(".s3.amazonaws.com");
    }

    OkHttpClient uploadClient() {
        return base;
    }

    // Un cliente por cuenta: comparten conexiones, cada uno con las cookies de la suya
    synchronized OkHttpClient clientFor(String accountId) {
        OkHttpClient client = clients.get(accountId);
        if (client == null) {
            client = base.newBuilder().cookieJar(cookies.jarFor(accountId)).build();
            clients.put(accountId, client);
        }
        return client;
    }

    // Para el tiempo real: sin límite de lectura (la conexión queda abierta) y sin CookieJar
    // (quien abre el WebSocket elige qué cookies manda)
    synchronized OkHttpClient socketClient() {
        if (sockets == null) sockets = base.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build();
        return sockets;
    }

    synchronized void forget(String accountId) {
        clients.remove(accountId);
        refreshedAt.remove(accountId);
        cookies.clear(accountId);
    }

    // Cabeceras con las que la web le habla a su API (ver MeweClient.headers en src/mewe/client.js)
    Request.Builder newRequest(String accountId, HttpUrl url) {
        Request.Builder builder = new Request.Builder()
            .url(url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/json, text/plain, */*")
            .header("Origin", HOST)
            .header("Referer", HOST + "/");
        String csrf = cookies.get(accountId, CSRF_COOKIE);
        if (csrf != null) builder.header("X-CSRF-Token", csrf);
        return builder;
    }

    // Descarga de imágenes y videos. range: cabecera Range del pedido, o null.
    // Las cookies del CDN duran ~20 min: con un 401/403 se renueva la sesión y se reintenta una vez.
    Response fetchMedia(String accountId, HttpUrl url, String range) throws IOException {
        long startedAt = System.currentTimeMillis();
        Response response = clientFor(accountId).newCall(mediaRequest(accountId, url, range)).execute();
        if ((response.code() == 401 || response.code() == 403) && refreshSession(accountId, startedAt)) {
            response.close();
            response = clientFor(accountId).newCall(mediaRequest(accountId, url, range)).execute();
        }
        return response;
    }

    private Request mediaRequest(String accountId, HttpUrl url, String range) {
        Request.Builder builder = newRequest(accountId, url);
        if (range != null) builder.header("Range", range);
        return builder.build();
    }

    // Renueva las cookies de corta vida con el refresh-token (GET /auth/identify), como MeweClient.refreshSession.
    //   since: cuándo salió la petición que falló. Si la sesión ya se renovó después, alcanza con reintentar;
    //   si se renovó hace poco y aun así falla, el error es real y no se insiste.
    private boolean refreshSession(String accountId, long since) {
        Object lock;
        synchronized (this) {
            lock = clientFor(accountId); // una renovación por cuenta a la vez
        }
        synchronized (lock) {
            long last = lastRefresh(accountId);
            if (last > since) return true;
            if (System.currentTimeMillis() - last < REFRESH_MIN_INTERVAL_MS) return false;
            try (Response response = clientFor(accountId).newCall(newRequest(accountId, HttpUrl.get(IDENTIFY)).build()).execute()) {
                if (!response.isSuccessful()) return false;
                synchronized (this) {
                    refreshedAt.put(accountId, System.currentTimeMillis());
                }
                return true;
            } catch (IOException err) {
                return false;
            }
        }
    }

    private synchronized long lastRefresh(String accountId) {
        Long at = refreshedAt.get(accountId);
        return at == null ? 0 : at;
    }
}
