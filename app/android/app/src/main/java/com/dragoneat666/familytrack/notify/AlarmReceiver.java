package com.dragoneat666.familytrack.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A reminder's alarm went off. Works with the app closed and with no network. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION = "com.dragoneat666.familytrack.NOTIFY_ALARM";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id != null) Notifier.fire(ctx.getApplicationContext(), id, intent.getLongExtra("at", 0));
    }
}
