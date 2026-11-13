package com.dragoneat666.familytrack.cook;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.dragoneat666.familytrack.MainActivity;
import com.dragoneat666.familytrack.R;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Kitchen timers from cooking mode. Each one is an exact alarm plus a
 * notification counting down, so it goes off on time even with the app
 * swiped away or the screen off. When it's up, a notification rings (like
 * an alarm, over and over) until Stop is tapped or it's swiped away, or for
 * ten minutes. The timers are kept in prefs so the app can catch up with
 * what happened while it was closed.
 */
public final class CookTimers {
    private static final String TAG = "FamilyCook";
    private static final String PREFS = "family_cook_timers";
    static final String CHANNEL_RUNNING = "timers_running";
    static final String CHANNEL_DONE = "timers_done";
    private static final int ID_RUNNING = 2;
    private static final int ID_DONE = 3;
    private static final long RING_FOR = 10 * 60 * 1000L;
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    /** Told when a timer is stopped or goes off outside the app's own screens. */
    interface Listener { void changed(String id, String what); }
    static Listener listener;

    private CookTimers() {}

    // ---------- kept timers: { id: { label, endAt, ringing } } ----------

    static synchronized JSONObject all(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("timers", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static synchronized void save(Context ctx, JSONObject timers) {
        prefs(ctx).edit().putString("timers", timers.toString()).apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray list(Context ctx) {
        JSONObject timers = all(ctx);
        JSONArray out = new JSONArray();
        long now = System.currentTimeMillis();
        boolean pruned = false;
        for (java.util.Iterator<String> it = timers.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject t = timers.optJSONObject(id);
            if (t == null) continue;
            // Rang out long ago (the alarm was missed or the notification timed out).
            if (t.optLong("endAt") + RING_FOR < now) {
                it.remove();
                pruned = true;
                continue;
            }
            try {
                out.put(new JSONObject(t.toString()).put("id", id));
            } catch (JSONException ignored) { }
        }
        if (pruned) save(ctx, timers);
        return out;
    }

    // ---------- starting and stopping ----------

    static void start(Context ctx, String id, String label, long endAt) {
        JSONObject timers = all(ctx);
        try {
            timers.put(id, new JSONObject().put("label", label).put("endAt", endAt).put("ringing", false));
        } catch (JSONException ignored) { }
        save(ctx, timers);
        channels(ctx);
        showRunning(ctx, id, label, endAt);
        setAlarm(ctx, id, endAt);
    }

    /** Cancel (or stop the ringing of) one timer. */
    static void stop(Context ctx, String id) {
        JSONObject timers = all(ctx);
        timers.remove(id);
        save(ctx, timers);
        ctx.getSystemService(AlarmManager.class).cancel(intent(ctx, id, TimerReceiver.ACTION_FIRE));
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(tag(id), ID_RUNNING);
        nm.cancel(tag(id), ID_DONE);
    }

    /** The alarm went off: ring. */
    static void fire(Context ctx, String id) {
        JSONObject timers = all(ctx);
        JSONObject t = timers.optJSONObject(id);
        if (t == null) return; // stopped meanwhile
        try {
            t.put("ringing", true);
        } catch (JSONException ignored) { }
        save(ctx, timers);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(tag(id), ID_RUNNING);
        channels(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_family_track)
            .setContentTitle("⏲ " + t.optString("label", "Timer") + " is done")
            .setContentText("Tap Stop to stop the alarm")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(openApp(ctx, id))
            .setDeleteIntent(intent(ctx, id, TimerReceiver.ACTION_STOP))
            .addAction(0, "Stop", intent(ctx, id, TimerReceiver.ACTION_STOP))
            .setTimeoutAfter(RING_FOR)
            .setAutoCancel(true);
        // (Before Android 8 the sound is set here rather than on the channel.)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) b.setSound(alarmSound(), android.media.AudioManager.STREAM_ALARM);
        android.app.Notification n = b.build();
        n.flags |= android.app.Notification.FLAG_INSISTENT; // keep ringing until stopped
        try {
            nm.notify(tag(id), ID_DONE, n);
        } catch (SecurityException e) {
            Log.i(TAG, "notifications not allowed");
        }
        if (listener != null) listener.changed(id, "ringing");
    }

    // ---------- notifications and alarms ----------

    private static String tag(String id) { return "timer-" + id; }

    private static void showRunning(Context ctx, String id, String label, long endAt) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_family_track)
            .setContentTitle("⏲ " + label)
            .setContentText("Done at " + android.text.format.DateFormat.getTimeFormat(ctx).format(new java.util.Date(endAt)))
            .setWhen(endAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(openApp(ctx, id))
            .addAction(0, "Cancel", intent(ctx, id, TimerReceiver.ACTION_STOP));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true);
        try {
            NotificationManagerCompat.from(ctx).notify(tag(id), ID_RUNNING, b.build());
        } catch (SecurityException e) {
            Log.i(TAG, "notifications not allowed");
        }
    }

    private static void setAlarm(Context ctx, String id, long at) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = intent(ctx, id, TimerReceiver.ACTION_FIRE);
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                return;
            }
        } catch (SecurityException e) {
            Log.i(TAG, "exact alarms not allowed, using a loose one");
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private static PendingIntent intent(Context ctx, String id, String action) {
        Intent i = new Intent(ctx, TimerReceiver.class)
            .setAction(action)
            .setData(Uri.parse("familytrack://timer/" + Uri.encode(id) + "/" + action))
            .putExtra("id", id);
        return PendingIntent.getBroadcast(ctx, 0, i, FLAGS);
    }

    private static PendingIntent openApp(Context ctx, String id) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setData(Uri.parse("familytrack://timer-open/" + Uri.encode(id)))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 0, i, FLAGS);
    }

    private static Uri alarmSound() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return u != null ? u : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    private static void channels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_RUNNING) == null) {
            NotificationChannel running = new NotificationChannel(CHANNEL_RUNNING, "Cooking timers counting down", NotificationManager.IMPORTANCE_LOW);
            running.setShowBadge(false);
            nm.createNotificationChannel(running);
        }
        if (nm.getNotificationChannel(CHANNEL_DONE) == null) {
            NotificationChannel done = new NotificationChannel(CHANNEL_DONE, "Cooking timer done", NotificationManager.IMPORTANCE_HIGH);
            done.setSound(alarmSound(), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            done.enableVibration(true);
            done.setBypassDnd(false);
            nm.createNotificationChannel(done);
        }
    }
}
