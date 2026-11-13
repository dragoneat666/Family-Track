package com.dragoneat666.familytrack.cook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A cooking timer's alarm went off, or its Stop / Cancel was tapped (or it was swiped away). */
public class TimerReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "com.dragoneat666.familytrack.TIMER_FIRE";
    static final String ACTION_STOP = "com.dragoneat666.familytrack.TIMER_STOP";

    @Override
    public void onReceive(Context context, Intent intent) {
        Context ctx = context.getApplicationContext();
        String id = intent.getStringExtra("id");
        if (id == null) return;
        if (ACTION_FIRE.equals(intent.getAction())) {
            CookTimers.fire(ctx, id);
        } else if (ACTION_STOP.equals(intent.getAction())) {
            CookTimers.stop(ctx, id);
            if (CookTimers.listener != null) CookTimers.listener.changed(id, "stopped");
        }
    }
}
