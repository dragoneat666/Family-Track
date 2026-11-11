package com.dragoneat666.familytrack;

import android.os.Bundle;

import com.dragoneat666.familytrack.notify.NotifyPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Reminders and pins: our own notification code (see notify/).
        registerPlugin(NotifyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
