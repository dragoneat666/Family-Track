package com.dragoneat666.familytrack.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The phone restarted, or the app was updated: Android dropped our alarms
 * and notifications, so set them up again from what was saved.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Notifier.restarted(ctx.getApplicationContext());
        }
    }
}
