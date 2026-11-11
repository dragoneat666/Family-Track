package com.dragoneat666.familytrack.notify;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/**
 * What the notification side remembers between runs (it has to work with the
 * app closed and after a restart), kept in the app's private preferences:
 *
 *   server, token  where the Family Track server is and this device's sign-in
 *   plan           what the server last said this phone should show
 *   overrides      changes made on this phone the server hasn't heard yet
 *   state          what is on screen / scheduled / already shown (see Notifier)
 *   events         notification buttons the user tapped, for the app to pick up
 */
final class NotifyStore {
    private static final String PREFS = "family_notify";
    private static final int MAX_EVENTS = 200;

    private NotifyStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String server(Context ctx) { return prefs(ctx).getString("server", ""); }
    static String token(Context ctx) { return prefs(ctx).getString("token", ""); }

    /** Returns true when this is a different server or sign-in than before. */
    static boolean setAccount(Context ctx, String server, String token) {
        boolean changed = !server.equals(server(ctx)) || !token.equals(token(ctx));
        if (changed) {
            prefs(ctx).edit().putString("server", server).putString("token", token)
                .remove("plan").remove("overrides").remove("state").remove("events").commit();
        }
        return changed;
    }

    static JSONArray plan(Context ctx) { return array(ctx, "plan"); }
    static void setPlan(Context ctx, JSONArray plan) { put(ctx, "plan", plan.toString()); }

    static JSONArray overrides(Context ctx) { return array(ctx, "overrides"); }
    static void setOverrides(Context ctx, JSONArray overrides) { put(ctx, "overrides", overrides.toString()); }

    static JSONObject state(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("state", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
    static void setState(Context ctx, JSONObject state) { put(ctx, "state", state.toString()); }

    static JSONArray events(Context ctx) { return array(ctx, "events"); }
    static void setEvents(Context ctx, JSONArray events) { put(ctx, "events", events.toString()); }

    /** A button was tapped: remember it until the app takes it. */
    static void addEvent(Context ctx, String id, String action, JSONObject post, long at) throws JSONException {
        JSONArray events = events(ctx);
        JSONObject ev = new JSONObject();
        ev.put("uid", UUID.randomUUID().toString());
        ev.put("id", id);
        ev.put("action", action);
        ev.put("at", at);
        ev.put("sent", false);
        if (post != null) ev.put("post", post);
        events.put(ev);
        // Never let it grow without end if the app is never opened.
        JSONArray kept = new JSONArray();
        for (int i = Math.max(0, events.length() - MAX_EVENTS); i < events.length(); i++) kept.put(events.get(i));
        setEvents(ctx, kept);
    }

    private static JSONArray array(Context ctx, String key) {
        try {
            return new JSONArray(prefs(ctx).getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void put(Context ctx, String key, String value) {
        // commit, not apply: a receiver's process can be killed right after it returns.
        prefs(ctx).edit().putString(key, value).commit();
    }
}
