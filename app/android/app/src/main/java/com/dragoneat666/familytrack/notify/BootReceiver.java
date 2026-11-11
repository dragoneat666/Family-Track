package com.dragoneat666.familytrack.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The phone restarted, or the app was updated: Android dropped our alarms
 * and notifications, so set them up again from what was saved.
 *
 * After a restart Android says so twice: once straight away, before anyone
 * has unlocked the phone (LOCKED_BOOT_COMPLETED), and again after the first
 * unlock (BOOT_COMPLETED), which can be minutes later on a phone with many
 * apps. We act on whichever comes first, so pins are back on the lock screen
 * and alarms are set without waiting for the unlock.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context ctx = context.getApplicationContext();
        String action = intent.getAction();
        if (Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            NotifyStore.log(ctx, "Android says the phone restarted (still locked)");
            Notifier.reconcile(ctx);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            NotifyStore.log(ctx, "Android says the phone restarted (unlocked)");
            Notifier.reconcile(ctx);
        } else if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            NotifyStore.log(ctx, "The app was updated");
            Notifier.appReplaced(ctx);
        }
    }
}
