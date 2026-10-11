package com.evilpixi.meweviewer;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;

// Las cookies de cada cuenta, separadas y guardadas entre arranques. Hace de "partition" de Electron:
// el WebView de Android tiene un solo almacén de cookies, así que las sesiones viven acá y no en él.
final class CookieStore {

    private static final long YEAR_MS = 365L * 24 * 60 * 60 * 1000;

    private final SharedPreferences prefs;
    private final Map<String, List<Cookie>> jars = new HashMap<>();

    CookieStore(Context context) {
        prefs = context.getSharedPreferences("mewe-cookies", Context.MODE_PRIVATE);
    }

    // El CookieJar de OkHttp de una cuenta: manda sus cookies y guarda las que llegan (también en redirecciones)
    CookieJar jarFor(String accountId) {
        return new CookieJar() {
            @Override
            public List<Cookie> loadForRequest(HttpUrl url) {
                return matching(accountId, url);
            }

            @Override
            public void saveFromResponse(HttpUrl url, List<Cookie> received) {
                store(accountId, received);
            }
        };
    }

    synchronized List<Cookie> matching(String accountId, HttpUrl url) {
        List<Cookie> result = new ArrayList<>();
        for (Cookie cookie : load(accountId)) {
            if (cookie.expiresAt() > System.currentTimeMillis() && cookie.matches(url)) result.add(cookie);
        }
        return result;
    }

    // Valor de una cookie por nombre (ej. csrf-token), o null
    synchronized String get(String accountId, String name) {
        for (Cookie cookie : load(accountId)) {
            if (cookie.name().equals(name) && cookie.expiresAt() > System.currentTimeMillis()) return cookie.value();
        }
        return null;
    }

    synchronized void store(String accountId, List<Cookie> received) {
        if (received.isEmpty()) return;
        List<Cookie> jar = load(accountId);
        for (Cookie cookie : received) {
            remove(jar, cookie);
            if (cookie.expiresAt() > System.currentTimeMillis()) jar.add(cookie);
        }
        save(accountId, jar);
    }

    // Copia las cookies que dejó el login en el WebView. CookieManager sólo da "nombre=valor" por URL, sin dominio:
    // las que también se ven desde un subdominio cualquiera son de .mewe.com; el resto, sólo del host donde aparecen.
    //   hostCookies: host → lo que devuelve CookieManager.getCookie("https://host") · anySubdomain: lo que ve x.mewe.com
    synchronized void importFromWebView(String accountId, Map<String, String> hostCookies, String anySubdomain) {
        Map<String, String> shared = parse(anySubdomain);
        List<Cookie> jar = new ArrayList<>();
        for (Map.Entry<String, String> pair : shared.entrySet()) add(jar, pair.getKey(), pair.getValue(), "mewe.com", false);
        for (Map.Entry<String, String> host : hostCookies.entrySet()) {
            for (Map.Entry<String, String> pair : parse(host.getValue()).entrySet()) {
                if (!shared.containsKey(pair.getKey())) add(jar, pair.getKey(), pair.getValue(), host.getKey(), true);
            }
        }
        jars.put(accountId, jar);
        save(accountId, jar);
    }

    synchronized void clear(String accountId) {
        jars.remove(accountId);
        prefs.edit().remove(accountId).apply();
    }

    private static void add(List<Cookie> jar, String name, String value, String domain, boolean hostOnly) {
        try {
            // sin fecha de vencimiento a la vista: duran hasta que MeWe las reemplace o las rechace
            Cookie.Builder builder = new Cookie.Builder().name(name).value(value).path("/").secure().expiresAt(System.currentTimeMillis() + YEAR_MS);
            jar.add((hostOnly ? builder.hostOnlyDomain(domain) : builder.domain(domain)).build());
        } catch (IllegalArgumentException err) {
            // nombre o valor que OkHttp no acepta: se descarta esa cookie
        }
    }

    private static Map<String, String> parse(String header) {
        Map<String, String> pairs = new HashMap<>();
        if (header == null) return pairs;
        for (String pair : header.split(";")) {
            int idx = pair.indexOf('=');
            if (idx > 0) pairs.put(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
        }
        return pairs;
    }

    private static void remove(List<Cookie> jar, Cookie replaced) {
        for (Iterator<Cookie> it = jar.iterator(); it.hasNext();) {
            Cookie cookie = it.next();
            if (cookie.name().equals(replaced.name()) && cookie.domain().equals(replaced.domain()) && cookie.path().equals(replaced.path())) {
                it.remove();
            }
        }
    }

    private List<Cookie> load(String accountId) {
        List<Cookie> jar = jars.get(accountId);
        if (jar != null) return jar;
        jar = new ArrayList<>();
        try {
            JSONArray saved = new JSONArray(prefs.getString(accountId, "[]"));
            for (int i = 0; i < saved.length(); i++) {
                JSONObject c = saved.getJSONObject(i);
                Cookie.Builder builder = new Cookie.Builder().name(c.getString("name")).value(c.getString("value")).path(c.getString("path")).expiresAt(c.getLong("expiresAt"));
                if (c.optBoolean("hostOnly")) builder.hostOnlyDomain(c.getString("domain"));
                else builder.domain(c.getString("domain"));
                if (c.optBoolean("secure")) builder.secure();
                if (c.optBoolean("httpOnly")) builder.httpOnly();
                jar.add(builder.build());
            }
        } catch (Exception err) {
            jar.clear(); // guardado ilegible: la cuenta tendrá que volver a loguearse
        }
        jars.put(accountId, jar);
        return jar;
    }

    private void save(String accountId, List<Cookie> jar) {
        JSONArray saved = new JSONArray();
        try {
            for (Cookie cookie : jar) {
                JSONObject c = new JSONObject();
                c.put("name", cookie.name());
                c.put("value", cookie.value());
                c.put("domain", cookie.domain());
                c.put("path", cookie.path());
                c.put("expiresAt", cookie.expiresAt());
                c.put("hostOnly", cookie.hostOnly());
                c.put("secure", cookie.secure());
                c.put("httpOnly", cookie.httpOnly());
                saved.put(c);
            }
        } catch (Exception err) {
            return;
        }
        prefs.edit().putString(accountId, saved.toString()).apply();
    }
}
