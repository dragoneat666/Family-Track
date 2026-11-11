package com.dragoneat666.familytrack.notify;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.dragoneat666.familytrack.MainActivity;
import com.dragoneat666.familytrack.R;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns the plan (a list of "entries" from the server, plus this phone's own
 * unsent changes) into Android notifications and alarms, and keeps them in
 * line with it. An entry looks like:
 *
 *   { id, at, title, body, lines, channel, ongoing, actions, dismiss, tap }
 *
 *   at       when to show it (ms since 1970); null = show now and keep it up
 *            to date for as long as it's in the plan (a pin)
 *   actions  buttons: { id, title, post: { path, body } }. Tapping one sends
 *            post to the server without opening the app
 *   dismiss  { post } to send when an ongoing one is swiped away
 *   tap      handed to the app when the notification itself is tapped
 *
 * Everything here may run with the app closed: from an alarm, a tapped
 * button, a restart of the phone, or the background check. Methods that
 * touch the saved state are synchronized so those can't trip over each other.
 */
public final class Notifier {
    static final String TAG = "FamilyNotify";
    static final String CHANNEL_REMINDERS = "reminders";
    static final String CHANNEL_PINS = "pins";
    /** A reminder missed while the phone was off still shows if it's less than this late. */
    static final long LATE_MS = 24L * 60 * 60 * 1000;
    private static final long KEEP_FIRED_MS = 7 * LATE_MS;
    private static final long UNSUPPRESS_MS = 2 * 60 * 1000;
    private static final int NOTIFICATION_ID = 1; // entries are told apart by tag (their id)

    private Notifier() {}

    // ---------- the plan ----------

    /** The plan with this phone's overrides applied and anything just dealt with left out. */
    static Map<String, JSONObject> wanted(Context ctx, JSONObject state) {
        Map<String, JSONObject> out = new LinkedHashMap<>();
        JSONArray plan = NotifyStore.plan(ctx);
        for (int i = 0; i < plan.length(); i++) {
            JSONObject e = plan.optJSONObject(i);
            if (e != null && e.optString("id").length() > 0) out.put(e.optString("id"), e);
        }
        JSONArray overrides = NotifyStore.overrides(ctx);
        for (int i = 0; i < overrides.length(); i++) {
            JSONObject e = overrides.optJSONObject(i);
            if (e == null || e.optString("id").length() == 0) continue;
            if (e.optBoolean("removed")) out.remove(e.optString("id"));
            else out.put(e.optString("id"), e);
        }
        JSONObject suppressed = state.optJSONObject("suppressed");
        if (suppressed != null) for (String id : keys(suppressed)) out.remove(id);
        return out;
    }

    /**
     * Bring what's showing and what's scheduled in line with the plan.
     *
     * state: shown      { id: hash }        notifications we have up
     *        alarms     { id: at }          alarms set with Android
     *        fired      { "id@at": time }   reminders already shown at their time
     *        suppressed { id: time }        dealt with on a notification; hidden until the server agrees
     *        repost     [ id ]              were up before a restart
     */
    public static synchronized void reconcile(Context ctx) {
        try {
            JSONObject state = NotifyStore.state(ctx);
            Map<String, JSONObject> want = wanted(ctx, state);
            JSONObject shown = child(state, "shown");
            JSONObject alarms = child(state, "alarms");
            JSONObject fired = child(state, "fired");
            JSONArray repostList = state.optJSONArray("repost");
            List<String> repost = new ArrayList<>();
            if (repostList != null) for (int i = 0; i < repostList.length(); i++) repost.add(repostList.optString(i));
            long now = System.currentTimeMillis();

            // What we think is up may have been taken down behind our back (the
            // app was force-stopped, say). Forget those, so pins get put back.
            List<String> active = activeNotifications(ctx);
            for (String id : keys(shown)) if (active != null && !active.contains(id)) shown.remove(id);

            for (String id : keys(shown)) {
                if (want.containsKey(id)) continue;
                cancelNotification(ctx, id);
                shown.remove(id);
            }
            for (String id : keys(alarms)) {
                JSONObject e = want.get(id);
                if (e != null && !e.isNull("at") && e.optLong("at") == alarms.optLong(id)) continue;
                cancelAlarm(ctx, id);
                alarms.remove(id);
            }

            for (JSONObject e : want.values()) {
                String id = e.optString("id");
                String hash = Integer.toHexString(e.toString().hashCode());
                boolean up = shown.has(id);
                if (e.isNull("at")) {
                    // A pin: there for as long as it's in the plan, quietly kept up to date.
                    if (!hash.equals(shown.optString(id)) && show(ctx, e, true)) shown.put(id, hash);
                    continue;
                }
                long at = e.optLong("at");
                String key = id + "@" + at;
                if (fired.has(key)) {
                    // Already shown at its time. Keep its words current while it's
                    // still up, and put it back if a restart took it down.
                    boolean changed = up && !hash.equals(shown.optString(id));
                    if ((changed || (!up && repost.contains(id))) && show(ctx, e, true)) shown.put(id, hash);
                } else if (at <= now) {
                    // Its time passed while we weren't looking (phone off, alarm lost).
                    fired.put(key, now);
                    if (at >= now - LATE_MS && show(ctx, e, false)) shown.put(id, hash);
                } else if (alarms.optLong(id, -1) != at) {
                    setAlarm(ctx, id, at);
                    alarms.put(id, at);
                }
            }

            for (String key : keys(fired)) if (fired.optLong(key) < now - KEEP_FIRED_MS) fired.remove(key);
            state.remove("repost");
            NotifyStore.setState(ctx, state);
        } catch (Exception e) {
            Log.w(TAG, "reconcile failed", e);
        }
    }

    /** An alarm went off: show its reminder, if it's still wanted. */
    static synchronized void fire(Context ctx, String id, long at) {
        try {
            JSONObject state = NotifyStore.state(ctx);
            child(state, "alarms").remove(id);
            JSONObject e = wanted(ctx, state).get(id);
            JSONObject fired = child(state, "fired");
            String key = id + "@" + at;
            if (e != null && !e.isNull("at") && e.optLong("at") == at && !fired.has(key)) {
                fired.put(key, System.currentTimeMillis());
                if (show(ctx, e, false)) child(state, "shown").put(id, Integer.toHexString(e.toString().hashCode()));
            }
            NotifyStore.setState(ctx, state);
        } catch (Exception ex) {
            Log.w(TAG, "fire failed", ex);
        }
    }

    /**
     * A button on a notification was tapped, or it was swiped away.
     * Returns true when there is something to send to the server.
     */
    static synchronized boolean acted(Context ctx, String id, String action, String postJson, boolean ongoing) {
        try {
            boolean swiped = ActionReceiver.DISMISSED.equals(action);
            cancelNotification(ctx, id);
            JSONObject state = NotifyStore.state(ctx);
            child(state, "shown").remove(id);
            // A reminder swiped away is just out of the way: nothing changes.
            boolean matters = !swiped || ongoing;
            if (matters) child(state, "suppressed").put(id, System.currentTimeMillis());
            NotifyStore.setState(ctx, state);
            if (!matters) return false;
            JSONObject post = postJson == null ? null : new JSONObject(postJson);
            NotifyStore.addEvent(ctx, id, action, post, System.currentTimeMillis());
            return post != null;
        } catch (Exception e) {
            Log.w(TAG, "acted failed", e);
            return false;
        }
    }

    /** The notification itself was tapped (the app is opening). */
    static synchronized void tapped(Context ctx, String id, boolean ongoing) {
        if (ongoing) return; // a pin stays up
        try {
            JSONObject state = NotifyStore.state(ctx);
            child(state, "shown").remove(id);
            NotifyStore.setState(ctx, state);
        } catch (Exception e) {
            Log.w(TAG, "tapped failed", e);
        }
    }

    /** The phone restarted (or the app was updated): notifications and alarms are gone. */
    static synchronized void restarted(Context ctx) {
        try {
            JSONObject state = NotifyStore.state(ctx);
            JSONArray repost = new JSONArray();
            for (String id : keys(child(state, "shown"))) repost.put(id);
            state.put("repost", repost);
            state.put("shown", new JSONObject());
            state.put("alarms", new JSONObject());
            NotifyStore.setState(ctx, state);
        } catch (Exception e) {
            Log.w(TAG, "restarted failed", e);
        }
        reconcile(ctx);
    }

    /**
     * The app was opened. If it had been force-stopped, Android threw our
     * alarms away without telling us: forget them so reconcile sets them again.
     */
    static synchronized void appOpened(Context ctx) {
        try {
            JSONObject state = NotifyStore.state(ctx);
            state.put("alarms", new JSONObject());
            NotifyStore.setState(ctx, state);
        } catch (Exception e) {
            Log.w(TAG, "appOpened failed", e);
        }
    }

    /** Signed out or switched server: take everything down. */
    static synchronized void clear(Context ctx) {
        JSONObject state = NotifyStore.state(ctx);
        JSONObject shown = state.optJSONObject("shown");
        JSONObject alarms = state.optJSONObject("alarms");
        if (shown != null) for (String id : keys(shown)) cancelNotification(ctx, id);
        if (alarms != null) for (String id : keys(alarms)) cancelAlarm(ctx, id);
        NotifyStore.setState(ctx, new JSONObject());
    }

    // ---------- the server ----------

    /**
     * Send what's waiting, fetch the plan, and reconcile. Returns true when
     * the plan was fetched. Does network: never call on the main thread.
     */
    public static boolean sync(Context ctx) {
        boolean fetched = false;
        if (NotifyStore.token(ctx).length() > 0) {
            sendEvents(ctx);
            fetched = fetchPlan(ctx);
        }
        reconcile(ctx);
        return fetched;
    }

    /** Tapped buttons the server hasn't heard about yet. */
    static void sendEvents(Context ctx) {
        JSONArray pending;
        synchronized (Notifier.class) {
            pending = NotifyStore.events(ctx);
        }
        List<String> sent = new ArrayList<>();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject ev = pending.optJSONObject(i);
            JSONObject post = ev == null ? null : ev.optJSONObject("post");
            if (post == null || ev.optBoolean("sent")) continue;
            String path = post.optString("path");
            if (!path.startsWith("/api/")) continue;
            try {
                request(ctx, "POST", path, String.valueOf(post.opt("body")));
                sent.add(ev.optString("uid"));
            } catch (IOException e) {
                Log.i(TAG, "could not send " + ev.optString("action") + " for " + ev.optString("id") + ": " + e.getMessage());
                break; // no server right now; the rest would fail too
            }
        }
        if (sent.isEmpty()) return;
        synchronized (Notifier.class) {
            try {
                // Re-read: the app may have taken some while we were sending.
                JSONArray events = NotifyStore.events(ctx);
                for (int i = 0; i < events.length(); i++) {
                    JSONObject ev = events.optJSONObject(i);
                    if (ev != null && sent.contains(ev.optString("uid"))) ev.put("sent", true);
                }
                NotifyStore.setEvents(ctx, events);
            } catch (JSONException e) {
                Log.w(TAG, "marking events sent failed", e);
            }
        }
    }

    static boolean fetchPlan(Context ctx) {
        try {
            JSONArray plan = new JSONObject(request(ctx, "GET", "/api/notify/plan", null)).getJSONArray("entries");
            synchronized (Notifier.class) {
                NotifyStore.setPlan(ctx, plan);
                // Things dealt with on a notification stay hidden until the server
                // agrees they're gone. If it still lists one a while later and
                // nothing is waiting to be sent, the change didn't take: show it again.
                JSONObject state = NotifyStore.state(ctx);
                JSONObject suppressed = child(state, "suppressed");
                List<String> inPlan = new ArrayList<>();
                for (int i = 0; i < plan.length(); i++) inPlan.add(plan.getJSONObject(i).optString("id"));
                List<String> unsent = new ArrayList<>();
                JSONArray events = NotifyStore.events(ctx);
                for (int i = 0; i < events.length(); i++) {
                    JSONObject ev = events.optJSONObject(i);
                    if (ev != null && !ev.optBoolean("sent")) unsent.add(ev.optString("id"));
                }
                long now = System.currentTimeMillis();
                for (String id : keys(suppressed)) {
                    boolean stale = suppressed.optLong(id) < now - UNSUPPRESS_MS && !unsent.contains(id);
                    if (!inPlan.contains(id) || stale) suppressed.remove(id);
                }
                NotifyStore.setState(ctx, state);
            }
            return true;
        } catch (IOException | JSONException e) {
            Log.i(TAG, "plan not fetched: " + e.getMessage());
            return false;
        }
    }

    /** One request to the Family Track server; throws unless it answers 2xx. */
    static String request(Context ctx, String method, String path, String body) throws IOException {
        String server = NotifyStore.server(ctx);
        if (server.length() == 0) throw new IOException("no server set");
        HttpURLConnection c = (HttpURLConnection) new URL(server + path).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(3000);
            c.setReadTimeout(4000);
            c.setRequestProperty("Authorization", "Bearer " + NotifyStore.token(ctx));
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = c.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("server answered " + status);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                return buf.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }

    // ---------- Android notifications and alarms ----------

    private static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_REMINDERS) == null) {
            NotificationChannel reminders = new NotificationChannel(CHANNEL_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_HIGH);
            reminders.setDescription("Reminders at the time you set");
            nm.createNotificationChannel(reminders);
        }
        if (nm.getNotificationChannel(CHANNEL_PINS) == null) {
            NotificationChannel pins = new NotificationChannel(CHANNEL_PINS, "Pinned", NotificationManager.IMPORTANCE_LOW);
            pins.setDescription("Things you pinned, kept here until they're done");
            pins.setShowBadge(false);
            nm.createNotificationChannel(pins);
        }
    }

    /** Returns false when Android won't show it (notifications are off for the app). */
    @SuppressLint("MissingPermission")
    static boolean show(Context ctx, JSONObject e, boolean quiet) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        if (!nm.areNotificationsEnabled()) return false;
        ensureChannels(ctx);
        String id = e.optString("id");
        boolean ongoing = e.optBoolean("ongoing");
        boolean pin = CHANNEL_PINS.equals(e.optString("channel"));
        String body = e.optString("body");

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, pin ? CHANNEL_PINS : CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_stat_family_track)
            .setColor(0xFF4F8CFF)
            .setContentTitle(e.optString("title"))
            .setContentText(body)
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .setOnlyAlertOnce(true)
            .setSilent(quiet)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(pin ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tapIntent(ctx, e))
            .setDeleteIntent(buttonIntent(ctx, id, ActionReceiver.DISMISSED, post(e.optJSONObject("dismiss")), ongoing));
        if (e.isNull("at")) b.setShowWhen(false);
        else b.setWhen(e.optLong("at")).setShowWhen(true);

        JSONArray lines = e.optJSONArray("lines");
        if (lines != null && lines.length() > 0) {
            NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle();
            for (int i = 0; i < lines.length(); i++) style.addLine(lines.optString(i));
            b.setStyle(style);
        } else if (body.length() > 0) {
            b.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }

        JSONArray actions = e.optJSONArray("actions");
        for (int i = 0; actions != null && i < actions.length() && i < 3; i++) {
            JSONObject a = actions.optJSONObject(i);
            if (a != null) b.addAction(0, a.optString("title"), buttonIntent(ctx, id, a.optString("id"), post(a), ongoing));
        }

        try {
            nm.notify(id, NOTIFICATION_ID, b.build());
            return true;
        } catch (SecurityException ex) {
            return false;
        }
    }

    private static String post(JSONObject holder) {
        JSONObject post = holder == null ? null : holder.optJSONObject("post");
        return post == null ? null : post.toString();
    }

    private static final int PENDING_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    // Each PendingIntent gets its own data URI: Android tells them apart by that, not by their extras.
    private static PendingIntent tapIntent(Context ctx, JSONObject e) {
        Intent i = new Intent(ctx, MainActivity.class)
            .setAction(NotifyPlugin.ACTION_TAP)
            .setData(Uri.parse("familytrack://tap/" + Uri.encode(e.optString("id"))))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(NotifyPlugin.EXTRA_ID, e.optString("id"))
            .putExtra(NotifyPlugin.EXTRA_ONGOING, e.optBoolean("ongoing"));
        JSONObject tap = e.optJSONObject("tap");
        if (tap != null) i.putExtra(NotifyPlugin.EXTRA_TAP, tap.toString());
        return PendingIntent.getActivity(ctx, 0, i, PENDING_FLAGS);
    }

    private static PendingIntent buttonIntent(Context ctx, String id, String action, String post, boolean ongoing) {
        Intent i = new Intent(ctx, ActionReceiver.class)
            .setAction(ActionReceiver.ACTION)
            .setData(Uri.parse("familytrack://button/" + Uri.encode(id) + "/" + Uri.encode(action)))
            .putExtra("id", id)
            .putExtra("action", action)
            .putExtra("ongoing", ongoing);
        if (post != null) i.putExtra("post", post);
        return PendingIntent.getBroadcast(ctx, 0, i, PENDING_FLAGS);
    }

    private static PendingIntent alarmIntent(Context ctx, String id, long at) {
        Intent i = new Intent(ctx, AlarmReceiver.class)
            .setAction(AlarmReceiver.ACTION)
            .setData(Uri.parse("familytrack://alarm/" + Uri.encode(id)))
            .putExtra("id", id)
            .putExtra("at", at);
        return PendingIntent.getBroadcast(ctx, 0, i, PENDING_FLAGS);
    }

    private static void setAlarm(Context ctx, String id, long at) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        PendingIntent pi = alarmIntent(ctx, id, at);
        try {
            // On the dot, even when the phone is dozing, where Android lets us.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                return;
            }
        } catch (SecurityException e) {
            Log.i(TAG, "exact alarms not allowed, using a loose one");
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private static void cancelAlarm(Context ctx, String id) {
        ctx.getSystemService(AlarmManager.class).cancel(alarmIntent(ctx, id, 0));
    }

    private static void cancelNotification(Context ctx, String id) {
        NotificationManagerCompat.from(ctx).cancel(id, NOTIFICATION_ID);
    }

    /** Tags of our notifications that are really up right now; null if Android won't say. */
    private static List<String> activeNotifications(Context ctx) {
        try {
            List<String> out = new ArrayList<>();
            for (StatusBarNotification n : ctx.getSystemService(NotificationManager.class).getActiveNotifications()) {
                if (n.getTag() != null) out.add(n.getTag());
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- small JSON helpers ----------

    private static JSONObject child(JSONObject parent, String name) throws JSONException {
        JSONObject o = parent.optJSONObject(name);
        if (o == null) {
            o = new JSONObject();
            parent.put(name, o);
        }
        return o;
    }

    /** A copy of the keys, so entries can be removed while going through them. */
    private static List<String> keys(JSONObject o) {
        List<String> out = new ArrayList<>();
        for (Iterator<String> it = o.keys(); it.hasNext(); ) out.add(it.next());
        return out;
    }
}
