package com.evilpixi.meweviewer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

// El login real de mewe.com en un WebView a pantalla completa (la ventana de login de Electron:
// src/main/loginWindow.js). El usuario se loguea ahí, captcha incluido; cuando aparece la cookie de sesión,
// las cookies se copian a la cuenta y se avisa con onSession para que la app verifique la sesión.
// Usar desde el hilo principal.
final class LoginWindow {

    interface Listener {
        // las cookies de la cuenta ya tienen una sesión para probar (puede avisar varias veces)
        void onSession();

        // la ventana se cerró, por el usuario o con close()
        void onClosed();
    }

    private static final String[] HOSTS = { "mewe.com", "img.mewe.com" };
    private static final String ANY_SUBDOMAIN = "https://cualquiera.mewe.com";
    private static final Pattern SESSION_COOKIE = Pattern.compile("(^|;\\s*)session-id=");
    private static final long POLL_MS = 1000;
    private static final long NOTIFY_EVERY_MS = 3000;

    private final Activity activity;
    private final CookieStore cookies;
    private final String accountId;
    private final String url;
    private final String prefillScript;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private WebView web;
    private boolean closed = false;
    private boolean prefilled = false;
    private String imported = "";
    private long notifiedAt = 0;

    // prefillScript: JS que rellena el formulario (puede ser null)
    LoginWindow(Activity activity, CookieStore cookies, String accountId, String url, String prefillScript, Listener listener) {
        this.activity = activity;
        this.cookies = cookies;
        this.accountId = accountId;
        this.url = url;
        this.prefillScript = prefillScript;
        this.listener = listener;
    }

    void open() {
        // El WebView comparte un solo almacén de cookies: se vacía para no heredar la sesión de otra cuenta
        CookieManager.getInstance().removeAllCookies(done -> show());
    }

    void close() {
        if (closed) return;
        closed = true;
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        WebStorage.getInstance().deleteOrigin(MeweHttp.HOST);
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        if (web != null) web.destroy();
        listener.onClosed();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void show() {
        if (closed) return;
        web = new WebView(activity);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Sin la marca de WebView ("; wv"): hay captchas y logins que la rechazan
        settings.setUserAgentString(WebSettings.getDefaultUserAgent(activity).replace("; wv", "").replace("Version/4.0 ", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true); // el captcha vive en otro dominio
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String finishedUrl) {
                    if (closed) return;
                    if (!prefilled && prefillScript != null && finishedUrl != null && finishedUrl.contains("/login")) {
                        prefilled = true;
                        view.evaluateJavascript(prefillScript, null);
                    }
                    check();
                }
            }
        );

        FrameLayout root = new FrameLayout(activity);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Que las barras del sistema y el teclado no tapen la página
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar);
        dialog.setContentView(root);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            WindowCompat.setDecorFitsSystemWindows(window, false);
        }
        // Atrás: vuelve una página; en la primera, cierra
        dialog.setOnKeyListener((d, keyCode, event) -> {
            if (keyCode != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_UP || !web.canGoBack()) return false;
            web.goBack();
            return true;
        });
        dialog.setOnDismissListener(d -> close());
        dialog.show();
        web.loadUrl(url);
        main.postDelayed(this::poll, POLL_MS);
    }

    private void poll() {
        if (closed) return;
        check();
        main.postDelayed(this::poll, POLL_MS);
    }

    private void check() {
        CookieManager manager = CookieManager.getInstance();
        String session = manager.getCookie(MeweHttp.HOST); // incluye las httpOnly
        if (session == null || !SESSION_COOKIE.matcher(session).find()) return;

        Map<String, String> hostCookies = new HashMap<>();
        StringBuilder seen = new StringBuilder();
        for (String host : HOSTS) {
            String value = manager.getCookie("https://" + host);
            hostCookies.put(host, value);
            seen.append(value).append('\n');
        }
        boolean changed = !seen.toString().equals(imported);
        if (changed) {
            imported = seen.toString();
            cookies.importFromWebView(accountId, hostCookies, manager.getCookie(ANY_SUBDOMAIN));
        }
        // Se avisa al cambiar las cookies y, por si la verificación anterior llegó antes de tiempo, cada tanto
        long now = System.currentTimeMillis();
        if (changed || now - notifiedAt >= NOTIFY_EVERY_MS) {
            notifiedAt = now;
            listener.onSession();
        }
    }
}
