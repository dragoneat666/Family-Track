package com.dragoneat666.familytrack.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A reminder's alarm went off: its time, a nudge, or its end. Works with the
 * app closed and with no network. A nudge that should first ask the server
 * whether someone already did it does that on its own thread (goAsync keeps
 * the app alive the few seconds that takes).
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION = "com.dragoneat666.familytrack.NOTIFY_ALARM";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        String id = intent.getStringExtra("id");
        if (id == null) return;
        final Notifier.Nudge ask = Notifier.fire(ctx, id, intent.getLongExtra("at", 0));
        if (ask == null) return;
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                Notifier.nudge(ctx, ask);
            } finally {
                if (result != null) result.finish();
            }
        }, "family-notify-nudge").start();
    }
}
