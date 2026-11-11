package com.dragoneat666.familytrack.notify;

import android.app.ActivityManager;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The app's side of the notification code (app/src/notify.js talks to this). */
@CapacitorPlugin(
    name = "FamilyNotify",
    permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public class NotifyPlugin extends Plugin {
    static final String ACTION_TAP = "com.dragoneat666.familytrack.NOTIFY_TAP";
    static final String EXTRA_TAP = "familyNotifyTap";
    static final String EXTRA_ID = "familyNotifyId";
    static final String EXTRA_ONGOING = "familyNotifyOngoing";

    private static volatile NotifyPlugin live;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private JSObject launchTap;

    @Override
    public void load() {
        live = this;
        // Opened by tapping a notification?
        launchTap = tapFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject tap = tapFrom(intent);
        if (tap != null) notifyListeners("tap", tap, true);
    }

    @Override
    protected void handleOnDestroy() {
        if (live == this) live = null;
    }

    /** A notification button was used: let the app know, if it is running. */
    static void eventsWaiting() {
        NotifyPlugin plugin = live;
        if (plugin != null) plugin.notifyListeners("action", new JSObject());
    }

    private JSObject tapFrom(Intent intent) {
        if (intent == null || !ACTION_TAP.equals(intent.getAction())) return null;
        String id = intent.getStringExtra(EXTRA_ID);
        String tap = intent.getStringExtra(EXTRA_TAP);
        // Only once: the same intent comes back if the screen is rebuilt.
        intent.setAction(Intent.ACTION_MAIN);
        if (id != null) Notifier.tapped(getContext(), id, intent.getBooleanExtra(EXTRA_ONGOING, false));
        try {
            return tap == null ? null : new JSObject(tap);
        } catch (JSONException e) {
            return null;
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Context ctx = getContext();
        String server = call.getString("server", "");
        String token = call.getString("token", "");
        io.execute(() -> {
            try {
                if (!server.equals(NotifyStore.server(ctx)) || !token.equals(NotifyStore.token(ctx))) {
                    Notifier.clear(ctx);
                    NotifyStore.setAccount(ctx, server, token);
                }
                Notifier.appOpened(ctx);
                if (token.length() > 0) SyncWorker.schedule(ctx);
                else SyncWorker.cancel(ctx);
            } catch (Exception e) {
                Log.w(Notifier.TAG, "configure failed", e);
            }
            call.resolve();
        });
    }

    /** overrides: entries (or { id, removed }) for changes the server has not heard yet. */
    @PluginMethod
    public void sync(PluginCall call) {
        Context ctx = getContext();
        JSArray overrides = call.getArray("overrides", new JSArray());
        io.execute(() -> {
            NotifyStore.setOverrides(ctx, overrides);
            // Straight away from what we know (pinning works offline), then again with the word of the server.
            Notifier.reconcile(ctx);
            JSObject out = new JSObject();
            out.put("fetched", Notifier.sync(ctx));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void takeEvents(PluginCall call) {
        Context ctx = getContext();
        JSONArray events;
        synchronized (Notifier.class) {
            events = NotifyStore.events(ctx);
            if (events.length() > 0) NotifyStore.setEvents(ctx, new JSONArray());
        }
        JSObject out = new JSObject();
        out.put("events", events);
        call.resolve(out);
    }

    @PluginMethod
    public void takeLaunchTap(PluginCall call) {
        JSObject out = new JSObject();
        if (launchTap != null) out.put("tap", launchTap);
        launchTap = null;
        call.resolve(out);
    }

    /** How notifications are doing on this phone, for the app's Settings screen. */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        try {
            JSONObject state = NotifyStore.state(ctx);
            out.put("notifications", permission());
            out.put("exactAlarms", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || ctx.getSystemService(AlarmManager.class).canScheduleExactAlarms());
            // The user (or the phone's battery saver) told Android to hold this app back.
            out.put("restricted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && ctx.getSystemService(ActivityManager.class).isBackgroundRestricted());
            out.put("reached", state.optBoolean("reached", false));
            out.put("lastFetch", state.optJSONObject("lastFetch"));
            out.put("lastWorker", state.optLong("lastWorker", 0));
            JSONObject shown = state.optJSONObject("shown");
            JSONObject alarms = state.optJSONObject("alarms");
            out.put("showing", shown == null ? 0 : shown.length());
            out.put("alarms", alarms == null ? 0 : alarms.length());
            out.put("log", NotifyStore.log(ctx));
        } catch (Exception e) {
            Log.w(Notifier.TAG, "status failed", e);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject out = new JSObject();
        out.put("notifications", permission());
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        // Before Android 13 there is nothing to ask: it is a switch in Settings.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            checkPermission(call);
        } else {
            requestPermissionForAlias("notifications", call, "permissionAnswered");
        }
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        // Anything that could not be shown before can be now.
        io.execute(() -> Notifier.reconcile(getContext()));
        checkPermission(call);
    }

    private String permission() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "granted";
        boolean canAsk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.DENIED;
        return canAsk ? "prompt" : "denied";
    }
}
