package com.dragoneat666.familytrack.notify;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * What the notification side remembers between runs. It has to work with the
 * app closed, and right after the phone restarts, before anyone has unlocked
 * it. So it lives in two places:
 *
 * "family_notify_data", in storage Android opens as soon as the phone is on:
 *   plan       what the server last said this phone should show
 *   overrides  changes made on this phone the server has not heard yet
 *   state      what is on screen / scheduled / already shown (see Notifier)
 *   events     notification buttons the user tapped, for the app to pick up
 *   log        the last things that happened, for the app's Settings screen
 *
 * "family_notify", in storage that stays locked until the first unlock:
 *   server, token  where the Family Track server is and this device's sign-in
 *
 * Before that first unlock, reminders and pins are put back and alarms go
 * off, but nothing can be sent to the server yet (no token): it waits.
 */
final class NotifyStore {
    private static final String SECRETS = "family_notify";
    private static final String DATA = "family_notify_data";
    private static final String[] MOVED_KEYS = { "plan", "overrides", "state", "events" };
    private static final int MAX_EVENTS = 200;
    private static final int MAX_LOG = 80;

    private NotifyStore() {}

    /** Null while the phone has not been unlocked since it restarted. */
    private static SharedPreferences secrets(Context ctx) {
        try {
            return ctx.getApplicationContext().getSharedPreferences(SECRETS, Context.MODE_PRIVATE);
        } catch (IllegalStateException locked) {
            return null;
        }
    }

    private static SharedPreferences data(Context ctx) {
        SharedPreferences data = ctx.getApplicationContext().createDeviceProtectedStorageContext()
            .getSharedPreferences(DATA, Context.MODE_PRIVATE);
        if (!data.contains("moved")) moveOldData(ctx, data);
        return data;
    }

    /** App builds up to 0.1.18 kept everything in the locked storage: bring it over once. */
    private static void moveOldData(Context ctx, SharedPreferences data) {
        SharedPreferences old = secrets(ctx);
        if (old == null) return; // locked: try again next time
        SharedPreferences.Editor to = data.edit().putBoolean("moved", true);
        SharedPreferences.Editor from = old.edit();
        for (String key : MOVED_KEYS) {
            String value = old.getString(key, null);
            if (value != null && !data.contains(key)) to.putString(key, value);
            from.remove(key);
        }
        to.commit();
        from.commit();
    }

    static String server(Context ctx) {
        SharedPreferences s = secrets(ctx);
        return s == null ? "" : s.getString("server", "");
    }

    static String token(Context ctx) {
        SharedPreferences s = secrets(ctx);
        return s == null ? "" : s.getString("token", "");
    }

    /** A different server or sign-in: start clean. */
    static void setAccount(Context ctx, String server, String token) {
        SharedPreferences s = secrets(ctx);
        if (s == null) return;
        s.edit().putString("server", server).putString("token", token).commit();
        SharedPreferences.Editor e = data(ctx).edit();
        for (String key : MOVED_KEYS) e.remove(key);
        e.commit();
    }

    static JSONArray plan(Context ctx) { return array(ctx, "plan"); }
    static void setPlan(Context ctx, JSONArray plan) { put(ctx, "plan", plan.toString()); }

    static JSONArray overrides(Context ctx) { return array(ctx, "overrides"); }
    static void setOverrides(Context ctx, JSONArray overrides) { put(ctx, "overrides", overrides.toString()); }

    static JSONObject state(Context ctx) {
        try {
            return new JSONObject(data(ctx).getString("state", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
    static void setState(Context ctx, JSONObject state) { put(ctx, "state", state.toString()); }

    static JSONArray events(Context ctx) { return array(ctx, "events"); }
    static void setEvents(Context ctx, JSONArray events) { put(ctx, "events", events.toString()); }

    /** A button was tapped: remember it until the app takes it. */
    static void addEvent(Context ctx, String id, String action, String title, JSONObject post, long at) throws JSONException {
        JSONObject ev = new JSONObject();
        ev.put("uid", UUID.randomUUID().toString());
        ev.put("id", id);
        ev.put("action", action);
        ev.put("title", title);
        ev.put("at", at);
        ev.put("sent", false);
        if (post != null) ev.put("post", post);
        // Never let it grow without end if the app is never opened.
        setEvents(ctx, lastOf(events(ctx).put(ev), MAX_EVENTS));
    }

    static JSONArray log(Context ctx) { return array(ctx, "log"); }

    /** One line for the "what happened" list in the app's Settings. */
    static void log(Context ctx, String message) {
        try {
            synchronized (NotifyStore.class) {
                JSONArray log = log(ctx).put(new JSONObject().put("t", System.currentTimeMillis()).put("m", message));
                put(ctx, "log", lastOf(log, MAX_LOG).toString());
            }
        } catch (Exception e) {
            // The log is a nicety: never let it break a reminder.
        }
    }

    private static JSONArray lastOf(JSONArray all, int max) throws JSONException {
        if (all.length() <= max) return all;
        JSONArray kept = new JSONArray();
        for (int i = all.length() - max; i < all.length(); i++) kept.put(all.get(i));
        return kept;
    }

    private static JSONArray array(Context ctx, String key) {
        try {
            return new JSONArray(data(ctx).getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void put(Context ctx, String key, String value) {
        // commit, not apply: a receiver's process can be stopped right after it returns.
        data(ctx).edit().putString(key, value).commit();
    }
}
