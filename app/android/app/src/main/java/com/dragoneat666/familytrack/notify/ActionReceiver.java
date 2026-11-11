package com.dragoneat666.familytrack.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A button on a notification (Done) was tapped, or a notification was swiped
 * away. The app is not opened: the change is sent to the server from here,
 * and if that doesn't work it waits for the next background check or for the
 * app to send it.
 */
public class ActionReceiver extends BroadcastReceiver {
    static final String ACTION = "com.dragoneat666.familytrack.NOTIFY_BUTTON";
    static final String DISMISSED = "dismissed";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        String id = intent.getStringExtra("id");
        String action = intent.getStringExtra("action");
        if (id == null || action == null) return;
        boolean send = Notifier.acted(ctx, id, action, intent.getStringExtra("post"), intent.getBooleanExtra("ongoing", false));
        NotifyPlugin.eventsWaiting();
        if (!send) return;
        // Network isn't allowed on this thread, and Android may stop the app
        // as soon as onReceive returns: goAsync keeps it alive a few seconds.
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                Notifier.sync(ctx);
                NotifyPlugin.eventsWaiting();
            } finally {
                if (result != null) result.finish();
            }
        }, "family-notify-button").start();
    }
}
