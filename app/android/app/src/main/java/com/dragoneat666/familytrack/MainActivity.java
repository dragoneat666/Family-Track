package com.dragoneat666.familytrack;

import android.os.Bundle;

import com.dragoneat666.familytrack.contacts.ContactsPlugin;
import com.dragoneat666.familytrack.cook.CookPlugin;
import com.dragoneat666.familytrack.notify.NotifyPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Reminders and pins: our own notification code (see notify/).
        registerPlugin(NotifyPlugin.class);
        // "From my phone's contacts" in the contact editor (see contacts/).
        registerPlugin(ContactsPlugin.class);
        // Cooking mode: screen on, "Yes chef" voice, timers (see cook/).
        registerPlugin(CookPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
