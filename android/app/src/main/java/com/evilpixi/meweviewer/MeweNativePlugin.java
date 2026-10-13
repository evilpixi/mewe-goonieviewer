package com.evilpixi.meweviewer;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

// Lo que el WebView no puede hacer solo: es la contraparte de src/main/platform.js en Electron.
// - request: HTTP contra MeWe con las cookies de la cuenta (el fetch del navegador no deja mandarlas, y hay CORS)
// - loginOpen / loginClose: el login real de mewe.com (evento "loginSession" cuando hay una sesión para verificar)
// - wsOpen / wsSend / wsClose: el tiempo real, con las cookies de la cuenta (eventos "ws")
// - saveMedia: guarda una imagen o un video en la galería
// - openUrl: abre un link en el navegador del teléfono
// - getCookie / clearAccount / storageGet / storageSet / setTextZoom / setWindowColor
// - el botón "atrás": evento "back", y minimize si la UI no tenía nada que cerrar
// Las imágenes y videos que muestra la UI no pasan por acá: ver MediaServer.
@CapacitorPlugin(name = "MeweNative")
public class MeweNativePlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService background = Executors.newCachedThreadPool();
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
    private MeweHttp http;
    private SharedPreferences storage;
    private LoginWindow loginWindow;
    private Integer windowColor; // ver setWindowColor

    @Override
    public void load() {
        http = MeweHttp.get(getContext());
        storage = getContext().getSharedPreferences("mewe-storage", Context.MODE_PRIVATE);
        // El botón (o gesto) "atrás" lo decide la UI: evento "back". Si no tiene nada que cerrar, llama a minimize.
        getActivity()
            .getOnBackPressedDispatcher()
            .addCallback(
                getActivity(),
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        notifyListeners("back", new JSObject());
                    }
                }
            );
    }

    // Manda la app al fondo sin cerrarla (lo que hace "atrás" en la pantalla principal de una app)
    @PluginMethod
    public void minimize(PluginCall call) {
        main.post(() -> {
            getActivity().moveTaskToBack(true);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (WebSocket socket : sockets.values()) socket.cancel();
        sockets.clear();
    }

    // { accountId, url, method?, headers?, body? (texto) | bodyBase64? } → { status, headers, bodyBase64 }
    // Las cookies de la cuenta las agrega y las guarda nativo: nunca pasan por el WebView.
    @PluginMethod
    public void request(PluginCall call) {
        String accountId = call.getString("accountId");
        String method = call.getString("method", "GET").toUpperCase();
        HttpUrl url = HttpUrl.parse(call.getString("url", ""));
        // subir un video: POST al bucket de S3 de MeWe, sin las cookies de la cuenta
        boolean upload = method.equals("POST") && MeweHttp.isUploadBucket(url);
        if (accountId == null || !(upload || MeweHttp.isMewe(url))) {
            call.reject("Faltan accountId o una url de MeWe.");
            return;
        }
        Request.Builder builder = new Request.Builder().url(url);
        JSObject headers = call.getObject("headers", new JSObject());
        for (Iterator<String> names = headers.keys(); names.hasNext();) {
            String name = names.next();
            String value = headers.getString(name);
            // la cabecera cookie la pone el CookieJar de la cuenta
            if (value != null && !value.isEmpty() && !name.equalsIgnoreCase("cookie")) builder.header(name, value);
        }
        byte[] body = null;
        if (call.getString("bodyBase64") != null) body = Base64.decode(call.getString("bodyBase64"), Base64.DEFAULT);
        else if (call.getString("body") != null) body = call.getString("body").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        boolean bodyless = method.equals("GET") || method.equals("HEAD");
        // OkHttp exige cuerpo en POST/PUT/PATCH: vacío si no vino ninguno. El content-type ya va en las cabeceras.
        builder.method(method, bodyless ? null : RequestBody.create(body == null ? new byte[0] : body, null));

        (upload ? http.uploadClient() : http.clientFor(accountId))
            .newCall(builder.build())
            .enqueue(
                new Callback() {
                    @Override
                    public void onFailure(Call failed, IOException err) {
                        call.reject("No se pudo conectar con MeWe: " + err.getMessage());
                    }

                    @Override
                    public void onResponse(Call done, Response response) {
                        try (Response res = response) {
                            ResponseBody responseBody = res.body();
                            JSObject responseHeaders = new JSObject();
                            for (String name : res.headers().names()) {
                                if (!name.equalsIgnoreCase("set-cookie")) responseHeaders.put(name.toLowerCase(), res.header(name));
                            }
                            JSObject result = new JSObject();
                            result.put("status", res.code());
                            result.put("headers", responseHeaders);
                            result.put("bodyBase64", Base64.encodeToString(responseBody == null ? new byte[0] : responseBody.bytes(), Base64.NO_WRAP));
                            call.resolve(result);
                        } catch (IOException err) {
                            call.reject("Se cortó la respuesta de MeWe: " + err.getMessage());
                        }
                    }
                }
            );
    }

    // { accountId, name } → { value } (null si no está)
    @PluginMethod
    public void getCookie(PluginCall call) {
        String accountId = call.getString("accountId");
        String name = call.getString("name");
        if (accountId == null || name == null) {
            call.reject("Faltan accountId o name.");
            return;
        }
        String value = http.cookies.get(accountId, name);
        JSObject result = new JSObject();
        result.put("value", value == null ? JSObject.NULL : value);
        call.resolve(result);
    }

    // { accountId }: borra la sesión de la cuenta
    @PluginMethod
    public void clearAccount(PluginCall call) {
        String accountId = call.getString("accountId");
        if (accountId == null) {
            call.reject("Falta accountId.");
            return;
        }
        http.forget(accountId);
        call.resolve();
    }

    // { accountId, url, script? }: abre el login de MeWe. Resuelve cuando la ventana se cierra (por el usuario
    // o con loginClose). Mientras está abierta, cada vez que hay una sesión para probar emite "loginSession" { accountId }.
    @PluginMethod
    public void loginOpen(PluginCall call) {
        String accountId = call.getString("accountId");
        HttpUrl url = meweUrl(call, "url");
        if (accountId == null || url == null) {
            call.reject("Faltan accountId o una url de MeWe.");
            return;
        }
        main.post(() -> {
            if (loginWindow != null) {
                call.reject("Ya hay un login en curso.");
                return;
            }
            JSObject event = new JSObject();
            event.put("accountId", accountId);
            loginWindow = new LoginWindow(
                getActivity(),
                http.cookies,
                accountId,
                url.toString(),
                call.getString("script"),
                new LoginWindow.Listener() {
                    @Override
                    public void onSession() {
                        notifyListeners("loginSession", event);
                    }

                    @Override
                    public void onClosed() {
                        loginWindow = null;
                        call.resolve();
                    }
                }
            );
            loginWindow.open();
        });
    }

    @PluginMethod
    public void loginClose(PluginCall call) {
        main.post(() -> {
            if (loginWindow != null) loginWindow.close();
            call.resolve();
        });
    }

    // { id, accountId, url, headers?, cookieUrl? }: abre un WebSocket con las cookies que la cuenta tiene para
    // cookieUrl (por defecto mewe.com: las de sesión pueden no alcanzar a ws.mewe.com). Lo que pasa después
    // llega como eventos "ws": { id, type: 'open' | 'message' | 'close', data? }
    @PluginMethod
    public void wsOpen(PluginCall call) {
        String id = call.getString("id");
        String accountId = call.getString("accountId");
        String url = call.getString("url", "");
        // OkHttp sólo entiende http(s) en HttpUrl: el esquema ws(s) se traduce para validarlo
        HttpUrl target = HttpUrl.parse(url.replaceFirst("^ws", "http"));
        HttpUrl cookieUrl = HttpUrl.parse(call.getString("cookieUrl", MeweHttp.HOST));
        if (id == null || accountId == null || !MeweHttp.isMewe(target) || !MeweHttp.isMewe(cookieUrl)) {
            call.reject("Faltan id, accountId o una url de MeWe.");
            return;
        }
        Request.Builder builder = new Request.Builder().url(target);
        JSObject headers = call.getObject("headers", new JSObject());
        for (Iterator<String> names = headers.keys(); names.hasNext();) {
            String name = names.next();
            String value = headers.getString(name);
            if (value != null && !value.isEmpty() && !name.equalsIgnoreCase("cookie")) builder.header(name, value);
        }
        StringBuilder cookie = new StringBuilder();
        for (okhttp3.Cookie c : http.cookies.matching(accountId, cookieUrl)) {
            if (cookie.length() > 0) cookie.append("; ");
            cookie.append(c.name()).append('=').append(c.value());
        }
        if (cookie.length() > 0) builder.header("Cookie", cookie.toString());

        // sin CookieJar: las cookies van en la cabecera, tal cual las de cookieUrl
        WebSocket socket = http.socketClient().newWebSocket(
            builder.build(),
            new WebSocketListener() {
                @Override
                public void onOpen(WebSocket ws, Response response) {
                    emit(id, "open", null);
                }

                @Override
                public void onMessage(WebSocket ws, String text) {
                    emit(id, "message", text);
                }

                @Override
                public void onClosing(WebSocket ws, int code, String reason) {
                    ws.close(1000, null);
                }

                @Override
                public void onClosed(WebSocket ws, int code, String reason) {
                    closed(id, ws);
                }

                @Override
                public void onFailure(WebSocket ws, Throwable err, Response response) {
                    closed(id, ws);
                }
            }
        );
        sockets.put(id, socket);
        call.resolve();
    }

    // { id, data }
    @PluginMethod
    public void wsSend(PluginCall call) {
        WebSocket socket = sockets.get(String.valueOf(call.getString("id")));
        if (socket != null) socket.send(call.getString("data", ""));
        call.resolve();
    }

    // { id }
    @PluginMethod
    public void wsClose(PluginCall call) {
        WebSocket socket = sockets.get(String.valueOf(call.getString("id")));
        if (socket != null) socket.close(1000, null);
        call.resolve();
    }

    // { accountId, url, name? } → { saved: true, filePath }
    @PluginMethod
    public void saveMedia(PluginCall call) {
        String accountId = call.getString("accountId");
        HttpUrl url = meweUrl(call, "url");
        if (accountId == null || url == null) {
            call.reject("Faltan accountId o una url de MeWe.");
            return;
        }
        background.execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("saved", true);
                result.put("filePath", http.media.save(getContext(), accountId, url, call.getString("name")));
                call.resolve(result);
            } catch (Exception err) {
                call.reject(String.valueOf(err.getMessage()));
            }
        });
    }

    // Datos de la app que tienen que durar lo mismo que las cookies (la lista de cuentas)
    // { key } → { value } (null si no hay)
    @PluginMethod
    public void storageGet(PluginCall call) {
        String value = storage.getString(String.valueOf(call.getString("key")), null);
        JSObject result = new JSObject();
        result.put("value", value == null ? JSObject.NULL : value);
        call.resolve(result);
    }

    // { key, value }
    @PluginMethod
    public void storageSet(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("Falta key.");
            return;
        }
        storage.edit().putString(key, call.getString("value")).apply();
        call.resolve();
    }

    // { value }: tamaño del texto del WebView, en porcentaje (el "zoom" de los ajustes de UI)
    @PluginMethod
    public void setTextZoom(PluginCall call) {
        int value = Math.max(50, Math.min(250, call.getInt("value", 100)));
        main.post(() -> {
            getBridge().getWebView().getSettings().setTextZoom(value);
            call.resolve();
        });
    }

    // { url }: abre un link http(s) en el navegador del teléfono
    @PluginMethod
    public void openUrl(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
            call.reject("Link no válido.");
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
            call.resolve();
        } catch (ActivityNotFoundException err) {
            call.reject("No hay una app para abrir el link.");
        }
    }

    // { color: "#rrggbb" }: el color de fondo de la app. Con él se pinta la ventana, que es lo que se ve donde el
    // WebView no llega: debajo de las barras del sistema en los WebView viejos y, en algunos teléfonos, una
    // franja entre la app y el teclado (el sistema reserva más alto que el que el teclado ocupa). Sin esto ahí
    // se ve el gris del tema de Android.
    @PluginMethod
    public void setWindowColor(PluginCall call) {
        try {
            windowColor = Color.parseColor(call.getString("color", ""));
        } catch (IllegalArgumentException err) {
            call.reject("Color inválido.");
            return;
        }
        main.post(() -> {
            applyWindowColor();
            call.resolve();
        });
    }

    private void applyWindowColor() {
        if (windowColor == null || getActivity() == null) return;
        getActivity().getWindow().getDecorView().setBackgroundColor(windowColor);
        getBridge().getWebView().setBackgroundColor(windowColor);
    }

    // Al girar la pantalla o cambiar el modo oscuro, el plugin SystemBars de Capacitor repinta la ventana con
    // el color del tema de Android: el nuestro se vuelve a poner después.
    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        main.post(this::applyWindowColor);
    }

    private static HttpUrl meweUrl(PluginCall call, String field) {
        HttpUrl url = HttpUrl.parse(call.getString(field, ""));
        return MeweHttp.isMewe(url) ? url : null;
    }

    private void closed(String id, WebSocket socket) {
        // sólo si sigue siendo el socket de ese id: puede haberse reabierto con el mismo
        if (sockets.remove(id, socket)) emit(id, "close", null);
    }

    private void emit(String id, String type, String data) {
        JSObject event = new JSObject();
        event.put("id", id);
        event.put("type", type);
        if (data != null) event.put("data", data);
        notifyListeners("ws", event);
    }
}
