package com.evilpixi.meweviewer;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

// El WebViewClient de Capacitor, más las imágenes y videos de MeWe (/_mewe-img/…)
final class MeweWebViewClient extends BridgeWebViewClient {

    private final MediaServer media;

    MeweWebViewClient(Bridge bridge, MediaServer media) {
        super(bridge);
        this.media = media;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse response = media.intercept(request);
        return response != null ? response : super.shouldInterceptRequest(view, request);
    }
}
