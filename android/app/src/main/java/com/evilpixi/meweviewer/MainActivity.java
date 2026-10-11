package com.evilpixi.meweviewer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeweNativePlugin.class); // los plugins propios van antes de super.onCreate
        super.onCreate(savedInstanceState);
        // Las imágenes y videos de MeWe se sirven desde nativo, con las cookies de cada cuenta
        bridge.setWebViewClient(new MeweWebViewClient(bridge, MeweHttp.get(this).media));
    }
}
