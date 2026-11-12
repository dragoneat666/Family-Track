package com.dragoneat666.familytrack.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;

import androidx.test.core.app.ApplicationProvider;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

/**
 * The notification code, run on Robolectric (a stand-in for Android): what
 * gets shown and scheduled for a plan, what the buttons do, what comes back
 * after a restart, and the talking to the server.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotifierTest {
    private static final long HOUR = 60 * 60 * 1000;
    private static final long MIN = 60 * 1000;
    private Context ctx;
    private NotificationManager nm;
    private AlarmManager am;
    private MockWebServer server;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        nm = ctx.getSystemService(NotificationManager.class);
        am = ctx.getSystemService(AlarmManager.class);
        NotifyStore.setAccount(ctx, "", "x");
        NotifyStore.setAccount(ctx, "", "");
    }

    @After
    public void tearDown() throws Exception {
        if (server != null) server.shutdown();
    }

    // ---------- entries like the server makes them ----------

    private static JSONObject post(String opId) throws Exception {
        return new JSONObject().put("path", "/api/lists/ops")
            .put("body", new JSONObject().put("ops", new JSONArray().put(new JSONObject().put("id", opId))));
    }

    private static JSONArray done(String id) throws Exception {
        return new JSONArray().put(new JSONObject().put("id", "done").put("title", "Done").put("post", post("done-" + id)));
    }

    private static JSONObject pin(String id, String title) throws Exception {
        return new JSONObject().put("id", id).put("at", JSONObject.NULL).put("ongoing", true).put("channel", "pins")
            .put("title", title).put("body", "Costco").put("actions", done(id))
            .put("dismiss", new JSONObject().put("post", post("unpin-" + id)))
            .put("tap", new JSONObject().put("screen", "list").put("list", "l1"));
    }

    private static JSONObject reminder(String id, String title, long at) throws Exception {
        return new JSONObject().put("id", id).put("at", at).put("channel", "reminders")
            .put("title", title).put("body", "To do").put("actions", done(id))
            .put("tap", new JSONObject().put("screen", "list").put("list", "l2").put("item", "i1"));
    }

    /** A daily reminder (Reminders section): reminds again at 30 and 60 minutes, over 12 hours later. */
    private static JSONObject daily(String id, String title, long at) throws Exception {
        JSONObject done = new JSONObject().put("path", "/api/reminders/done").put("body", new JSONObject().put("id", 1).put("occ", "2026-11-11T08:00"));
        return new JSONObject().put("id", id).put("at", at).put("channel", "reminders").put("quiet", false)
            .put("title", title).put("body", "8:00 AM").put("againBody", "Not done yet · 8:00 AM")
            .put("actions", new JSONArray().put(new JSONObject().put("id", "done").put("title", "Done").put("post", done)))
            .put("nudges", new JSONArray().put(at + 30 * MIN).put(at + 60 * MIN))
            .put("until", at + 12 * HOUR)
            .put("tap", new JSONObject().put("screen", "reminders"));
    }

    private ShadowAlarmManager.ScheduledAlarm onlyAlarm() {
        assertEquals(1, alarms().size());
        return alarms().get(0);
    }

    /**
     * That alarm goes off (and, as on a phone, is no longer set). Returns
     * what to ask the server, for a nudge that asks first.
     */
    private Notifier.Nudge ring(ShadowAlarmManager.ScheduledAlarm alarm) {
        Intent i = shadowOf(alarm.operation).getSavedIntent();
        am.cancel(alarm.operation);
        return Notifier.fire(ctx, i.getStringExtra("id"), i.getLongExtra("at", 0));
    }

    private static String text(Notification n) {
        return String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TEXT));
    }

    private void plan(JSONObject... entries) {
        JSONArray a = new JSONArray();
        for (JSONObject e : entries) a.put(e);
        NotifyStore.setPlan(ctx, a);
    }

    private Notification shown(String id) {
        return shadowOf(nm).getNotification(id, 1);
    }

    private static String title(Notification n) {
        return String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TITLE));
    }

    private void press(PendingIntent button) {
        assertTrue(shadowOf(button).isBroadcastIntent());
        new ActionReceiver().onReceive(ctx, shadowOf(button).getSavedIntent());
    }

    private List<ShadowAlarmManager.ScheduledAlarm> alarms() {
        return shadowOf(am).getScheduledAlarms();
    }

    /** What a restart does: Android forgets our notifications and alarms, and its start-up count goes up. */
    private void restartPhone() {
        nm.cancelAll();
        for (ShadowAlarmManager.ScheduledAlarm a : new ArrayList<>(alarms())) am.cancel(a.operation);
        int boots = Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT, 0);
        Settings.Global.putInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT, boots + 1);
    }

    private int logLines(String containing) throws Exception {
        int n = 0;
        JSONArray log = NotifyStore.log(ctx);
        for (int i = 0; i < log.length(); i++) if (log.getJSONObject(i).getString("m").contains(containing)) n++;
        return n;
    }

    // ---------- tests ----------

    @Test
    public void aPinShowsStaysCurrentAndGoesWithThePlan() throws Exception {
        plan(pin("pin-item-a", "Milk"));
        Notifier.reconcile(ctx);
        Notification n = shown("pin-item-a");
        assertNotNull(n);
        assertEquals("Milk", title(n));
        assertTrue((n.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        assertEquals("pins", n.getChannelId());
        assertEquals("Done", String.valueOf(n.actions[0].title));
        assertEquals(0, alarms().size());

        plan(pin("pin-item-a", "Milk, the big one"));
        Notifier.reconcile(ctx);
        assertEquals("Milk, the big one", title(shown("pin-item-a")));

        plan();
        Notifier.reconcile(ctx);
        assertNull(shown("pin-item-a"));
    }

    @Test
    public void aReminderWaitsForItsAlarmAndShowsOnce() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(reminder("remind-a", "Call the dentist", at));
        Notifier.reconcile(ctx);
        assertNull(shown("remind-a"));
        assertEquals(1, alarms().size());
        ShadowAlarmManager.ScheduledAlarm alarm = alarms().get(0);
        assertEquals(at, alarm.getTriggerAtMs());

        // Same plan again: still one alarm.
        Notifier.reconcile(ctx);
        assertEquals(1, alarms().size());

        Intent fired = shadowOf(alarm.operation).getSavedIntent();
        new AlarmReceiver().onReceive(ctx, fired);
        Notification n = shown("remind-a");
        assertNotNull(n);
        assertEquals("Call the dentist", title(n));
        assertEquals("reminders", n.getChannelId());
        assertEquals(0, n.flags & Notification.FLAG_ONGOING_EVENT);

        // Swiped away, then the plan is looked at again: it does not come back.
        press(n.deleteIntent);
        nm.cancel("remind-a", 1);
        Notifier.reconcile(ctx);
        new AlarmReceiver().onReceive(ctx, fired);
        assertNull(shown("remind-a"));
        assertEquals(0, NotifyStore.events(ctx).length());
    }

    @Test
    public void aChangedTimeMovesTheAlarmAndARemovedReminderCancelsIt() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(reminder("remind-a", "Call", at));
        Notifier.reconcile(ctx);
        plan(reminder("remind-a", "Call", at + HOUR));
        Notifier.reconcile(ctx);
        assertEquals(1, alarms().size());
        assertEquals(at + HOUR, alarms().get(0).getTriggerAtMs());
        plan();
        Notifier.reconcile(ctx);
        assertEquals(0, alarms().size());
    }

    @Test
    public void aReminderMissedWhileOffShowsLateButNotDaysLate() throws Exception {
        long now = System.currentTimeMillis();
        plan(reminder("remind-late", "An hour ago", now - HOUR), reminder("remind-old", "Two days ago", now - 48 * HOUR));
        Notifier.reconcile(ctx);
        assertNotNull(shown("remind-late"));
        assertNull(shown("remind-old"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void doneOnAPinHidesItAndKeepsTheChangeForTheServer() throws Exception {
        plan(pin("pin-item-a", "Milk"), pin("pin-item-b", "Eggs"));
        Notifier.reconcile(ctx);
        press(shown("pin-item-a").actions[0].actionIntent);
        assertNull(shown("pin-item-a"));
        assertNotNull(shown("pin-item-b"));

        JSONArray events = NotifyStore.events(ctx);
        assertEquals(1, events.length());
        JSONObject ev = events.getJSONObject(0);
        assertEquals("pin-item-a", ev.getString("id"));
        assertEquals("done", ev.getString("action"));
        assertFalse(ev.getBoolean("sent"));
        assertEquals("done-pin-item-a", ev.getJSONObject("post").getJSONObject("body").getJSONArray("ops").getJSONObject(0).getString("id"));

        // The server still lists it (it has not heard yet): it stays hidden.
        Notifier.reconcile(ctx);
        assertNull(shown("pin-item-a"));
    }

    @Test
    public void swipingAPinAwayUnpinsIt() throws Exception {
        plan(pin("pin-list-l1", "Costco"));
        Notifier.reconcile(ctx);
        Notification n = shown("pin-list-l1");
        press(n.deleteIntent);
        nm.cancel("pin-list-l1", 1); // Android took it down
        JSONObject ev = NotifyStore.events(ctx).getJSONObject(0);
        assertEquals("dismissed", ev.getString("action"));
        assertEquals("unpin-pin-list-l1", ev.getJSONObject("post").getJSONObject("body").getJSONArray("ops").getJSONObject(0).getString("id"));
        Notifier.reconcile(ctx);
        assertNull(shown("pin-list-l1"));
    }

    @Test
    public void whatThisPhoneChangedWinsOverThePlan() throws Exception {
        plan(pin("pin-item-a", "Milk"));
        NotifyStore.setOverrides(ctx, new JSONArray()
            .put(new JSONObject().put("id", "pin-item-a").put("removed", true))
            .put(pin("pin-item-b", "Pinned offline")));
        Notifier.reconcile(ctx);
        assertNull(shown("pin-item-a"));
        assertEquals("Pinned offline", title(shown("pin-item-b")));
    }

    @Test
    public void aListPinListsWhatIsLeft() throws Exception {
        plan(pin("pin-list-l1", "Costco").put("lines", new JSONArray().put("Milk").put("Eggs").put("Bread")));
        Notifier.reconcile(ctx);
        CharSequence[] lines = shown("pin-list-l1").extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        assertEquals(3, lines.length);
        assertEquals("Eggs", String.valueOf(lines[1]));
    }

    @Test
    public void tappingItOpensTheAppWithWhereToGo() throws Exception {
        plan(reminder("remind-a", "Call", System.currentTimeMillis() - 1000));
        Notifier.reconcile(ctx);
        PendingIntent open = shown("remind-a").contentIntent;
        assertTrue(shadowOf(open).isActivityIntent());
        Intent i = shadowOf(open).getSavedIntent();
        assertEquals(NotifyPlugin.ACTION_TAP, i.getAction());
        assertEquals("l2", new JSONObject(i.getStringExtra(NotifyPlugin.EXTRA_TAP)).getString("list"));
        assertEquals("remind-a", i.getStringExtra(NotifyPlugin.EXTRA_ID));
    }

    @Test
    public void afterARestartEverythingIsPutBack() throws Exception {
        long now = System.currentTimeMillis();
        plan(pin("pin-item-a", "Milk"), reminder("remind-soon", "Later", now + HOUR), reminder("remind-up", "Already showing", now - 1000),
            reminder("remind-gone", "Swiped before the restart", now - 2000));
        Notifier.reconcile(ctx);
        press(shown("remind-gone").deleteIntent);
        restartPhone();
        assertEquals(0, alarms().size());

        // Android says so twice: before the first unlock, and after it.
        new BootReceiver().onReceive(ctx, new Intent(Intent.ACTION_LOCKED_BOOT_COMPLETED));
        assertNotNull(shown("pin-item-a"));
        assertEquals(1, alarms().size());
        new BootReceiver().onReceive(ctx, new Intent(Intent.ACTION_BOOT_COMPLETED));
        assertEquals(1, logLines("After a restart: put 2 back, 1 alarms set"));
        assertEquals(1, logLines("After a restart"));
        assertNotNull(shown("pin-item-a"));
        assertNotNull(shown("remind-up"));
        assertNull(shown("remind-gone"));
        assertNull(shown("remind-soon"));
        assertEquals(1, alarms().size());
        assertEquals(now + HOUR, alarms().get(0).getTriggerAtMs());
    }

    @Test
    public void aPinTakenDownBehindOurBackComesBackButATappedReminderDoesNot() throws Exception {
        plan(pin("pin-item-a", "Milk"), reminder("remind-a", "Call", System.currentTimeMillis() - 1000));
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertNotNull(shown("remind-a"));
        // The app is force-stopped: Android removes its notifications and alarms, telling nobody.
        nm.cancelAll();
        Notifier.appOpened(ctx);
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertNull(shown("remind-a"));
    }

    @Test
    public void openingTheAppSetsLostAlarmsAgain() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(reminder("remind-a", "Call", at));
        Notifier.reconcile(ctx);
        am.cancel(alarms().get(0).operation); // lost in a force stop
        Notifier.reconcile(ctx);
        assertEquals(0, alarms().size());
        Notifier.appOpened(ctx);
        Notifier.reconcile(ctx);
        assertEquals(1, alarms().size());
        assertEquals(at, alarms().get(0).getTriggerAtMs());
    }

    @Test
    public void aRestartIsNoticedEvenIfAndroidNeverSaysSo() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(pin("pin-item-a", "Milk"), reminder("remind-a", "Later", at));
        Notifier.reconcile(ctx);
        restartPhone();
        // No broadcast: the next thing that runs (the background check, the app) puts it all back.
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertEquals(1, alarms().size());
        assertEquals(at, alarms().get(0).getTriggerAtMs());
    }

    @Test
    public void anAppUpdatePutsEverythingBack() throws Exception {
        plan(pin("pin-item-a", "Milk"), reminder("remind-a", "Later", System.currentTimeMillis() + HOUR));
        Notifier.reconcile(ctx);
        nm.cancelAll();
        for (ShadowAlarmManager.ScheduledAlarm a : new ArrayList<>(alarms())) am.cancel(a.operation);
        new BootReceiver().onReceive(ctx, new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertNotNull(shown("pin-item-a"));
        assertEquals(1, alarms().size());
    }

    @Test
    public void aPinWithATimeWaitsForItThenStays() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        JSONObject waiting = pin("pin-item-a", "Call places").put("at", at).put("channel", "reminders").put("quiet", false);
        plan(waiting);
        Notifier.reconcile(ctx);
        assertNull(shown("pin-item-a"));
        assertEquals(at, alarms().get(0).getTriggerAtMs());

        new AlarmReceiver().onReceive(ctx, shadowOf(alarms().get(0).operation).getSavedIntent());
        Notification n = shown("pin-item-a");
        assertNotNull(n);
        assertTrue((n.flags & Notification.FLAG_ONGOING_EVENT) != 0);
        assertEquals("reminders", n.getChannelId());

        // Taken down behind our back: unlike a plain reminder, a pin goes back up.
        nm.cancelAll();
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        // And after a restart too.
        restartPhone();
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void givingAShowingPinADateHidesItUntilThen() throws Exception {
        plan(pin("pin-item-a", "Call places"));
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));

        long monday = System.currentTimeMillis() + 20 * HOUR;
        plan(pin("pin-item-a", "Call places").put("at", monday).put("quiet", true));
        Notifier.reconcile(ctx);
        assertNull(shown("pin-item-a"));
        assertEquals(monday, alarms().get(0).getTriggerAtMs());

        // The date is taken off again: it is back straight away.
        plan(pin("pin-item-a", "Call places"));
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void aPinWhoseDayPassedWhileThePhoneWasOffStillShows() throws Exception {
        long threeDaysAgo = System.currentTimeMillis() - 72 * HOUR;
        plan(pin("pin-item-a", "Call places").put("at", threeDaysAgo).put("quiet", true),
            reminder("remind-b", "Just a reminder", threeDaysAgo));
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
        assertNull(shown("remind-b"));
    }

    @Test
    public void movingAReminderLaterTakesItDownUntilThen() throws Exception {
        plan(reminder("remind-a", "Call", System.currentTimeMillis() - 1000));
        Notifier.reconcile(ctx);
        assertNotNull(shown("remind-a"));
        long later = System.currentTimeMillis() + HOUR;
        plan(reminder("remind-a", "Call", later));
        Notifier.reconcile(ctx);
        assertNull(shown("remind-a"));
        assertEquals(later, alarms().get(0).getTriggerAtMs());
    }

    @Test
    public void whatOlderAppBuildsSavedIsBroughtOver() throws Exception {
        // App builds up to 0.1.18 kept the plan next to the sign-in, in storage that is locked after a restart.
        SharedPreferences data = ctx.createDeviceProtectedStorageContext().getSharedPreferences("family_notify_data", Context.MODE_PRIVATE);
        data.edit().clear().commit();
        SharedPreferences old = ctx.getSharedPreferences("family_notify", Context.MODE_PRIVATE);
        JSONObject oldState = new JSONObject().put("fired", new JSONObject().put("remind-x@5", 7));
        old.edit().putString("server", "http://example.test").putString("token", "tok")
            .putString("plan", new JSONArray().put(pin("pin-item-a", "Milk")).toString())
            .putString("state", oldState.toString()).commit();

        assertEquals(1, NotifyStore.plan(ctx).length());
        assertTrue(NotifyStore.state(ctx).getJSONObject("fired").has("remind-x@5"));
        assertEquals("tok", NotifyStore.token(ctx));
        assertFalse(old.contains("plan"));
        assertFalse(old.contains("state"));
        Notifier.reconcile(ctx);
        assertNotNull(shown("pin-item-a"));
    }

    @Test
    public void theLogSaysWhatHappened() throws Exception {
        plan(pin("pin-item-a", "Milk"));
        Notifier.reconcile(ctx);
        press(shown("pin-item-a").actions[0].actionIntent);
        assertEquals(1, logLines("Tapped done on: Milk"));
        // It never grows without end.
        for (int i = 0; i < 200; i++) NotifyStore.log(ctx, "line " + i);
        assertEquals(80, NotifyStore.log(ctx).length());
        assertEquals(1, logLines("line 199"));
    }

    @Test
    public void signingOutTakesEverythingDown() throws Exception {
        plan(pin("pin-item-a", "Milk"), reminder("remind-a", "Later", System.currentTimeMillis() + HOUR));
        Notifier.reconcile(ctx);
        Notifier.clear(ctx);
        NotifyStore.setAccount(ctx, "", "");
        assertNull(shown("pin-item-a"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void itSendsButtonsAndFetchesThePlanFromTheServer() throws Exception {
        final List<String> seen = Collections.synchronizedList(new ArrayList<>());
        final JSONArray serverPlan = new JSONArray().put(pin("pin-item-a", "Milk")).put(pin("pin-item-b", "Eggs"));
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String body = request.getBody().readUtf8();
                seen.add(request.getMethod() + " " + request.getPath() + " " + request.getHeader("Authorization") + " " + body);
                String answer = "{}";
                try {
                    if ("/api/notify/plan".equals(request.getPath())) answer = new JSONObject().put("entries", serverPlan).toString();
                    // Like the real server: once it hears Done, the pin is out of the plan.
                    else if (body.contains("done-pin-item-a")) serverPlan.remove(0);
                } catch (Exception e) {
                    return new MockResponse().setResponseCode(500);
                }
                return new MockResponse().setHeader("Content-Type", "application/json").setBody(answer);
            }
        });
        server.start();
        NotifyStore.setAccount(ctx, "http://127.0.0.1:" + server.getPort(), "secret-token");

        assertTrue(Notifier.sync(ctx));
        assertEquals("GET /api/notify/plan Bearer secret-token ", seen.get(0));
        assertNotNull(shown("pin-item-a"));
        assertNotNull(shown("pin-item-b"));

        // Done on Milk, with the server in reach: it is told, and the plan it gives back has only Eggs.
        seen.clear();
        assertTrue(Notifier.acted(ctx, "pin-item-a", "done", post("done-pin-item-a").toString(), true));
        assertTrue(Notifier.sync(ctx));
        assertTrue(seen.get(0).startsWith("POST /api/lists/ops Bearer secret-token {\"ops\":[{\"id\":\"done-pin-item-a\""));
        assertEquals("GET /api/notify/plan Bearer secret-token ", seen.get(1));
        assertTrue(NotifyStore.events(ctx).getJSONObject(0).getBoolean("sent"));
        assertNull(shown("pin-item-a"));
        assertNotNull(shown("pin-item-b"));
        assertEquals(0, NotifyStore.state(ctx).getJSONObject("suppressed").length());

        // A second sync does not send it again.
        seen.clear();
        Notifier.sync(ctx);
        assertEquals(1, seen.size());

        // No server: nothing is lost, and what is showing stays.
        server.shutdown();
        server = null;
        assertTrue(Notifier.acted(ctx, "pin-item-b", "done", post("done-pin-item-b").toString(), true));
        assertFalse(Notifier.sync(ctx));
        assertNull(shown("pin-item-b"));
        JSONArray events = NotifyStore.events(ctx);
        assertFalse(events.getJSONObject(events.length() - 1).getBoolean("sent"));
        assertEquals(1, NotifyStore.plan(ctx).length());
    }

    @Test
    public void aDailyReminderRemindsAgainThenGoesWhenItsTimeIsOver() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(daily("rem-1-a", "Morning pills", at));
        Notifier.reconcile(ctx);
        assertEquals(at, onlyAlarm().getTriggerAtMs());

        ShadowAlarmManager.ScheduledAlarm first = onlyAlarm();
        am.cancel(first.operation);
        new AlarmReceiver().onReceive(ctx, shadowOf(first.operation).getSavedIntent());
        Notification n = shown("rem-1-a");
        assertEquals("Morning pills", title(n));
        assertEquals("8:00 AM", text(n));
        assertEquals(at + 30 * MIN, onlyAlarm().getTriggerAtMs());

        // Swiped away is not Done: it still reminds again.
        press(n.deleteIntent);
        nm.cancel("rem-1-a", 1);
        assertNull(ring(onlyAlarm()));
        assertEquals("Not done yet · 8:00 AM", text(shown("rem-1-a")));
        assertEquals(at + 60 * MIN, onlyAlarm().getTriggerAtMs());
        // (Looking at the plan again doesn't swap the words back.)
        Notifier.reconcile(ctx);
        assertEquals("Not done yet · 8:00 AM", text(shown("rem-1-a")));

        assertNull(ring(onlyAlarm()));
        assertNotNull(shown("rem-1-a"));
        assertEquals(2, logLines("Reminded again: Morning pills"));

        // Then no more reminding; it goes when its time is over.
        assertEquals(at + 12 * HOUR, onlyAlarm().getTriggerAtMs());
        assertNull(ring(onlyAlarm()));
        assertNull(shown("rem-1-a"));
        assertEquals(0, alarms().size());

        // And a restart doesn't bring it back.
        restartPhone();
        Notifier.reconcile(ctx);
        assertNull(shown("rem-1-a"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void doneOnADailyReminderStopsTheRemindingAgain() throws Exception {
        long at = System.currentTimeMillis() + HOUR;
        plan(daily("rem-1-a", "Morning pills", at));
        Notifier.reconcile(ctx);
        ring(onlyAlarm());
        press(shown("rem-1-a").actions[0].actionIntent);
        assertNull(shown("rem-1-a"));
        assertEquals(0, alarms().size());
        JSONObject ev = NotifyStore.events(ctx).getJSONObject(0);
        assertEquals("/api/reminders/done", ev.getJSONObject("post").getString("path"));
        assertEquals("2026-11-11T08:00", ev.getJSONObject("post").getJSONObject("body").getString("occ"));
    }

    @Test
    public void beforeRemindingAgainItAsksTheServerWhetherSomeoneDidIt() throws Exception {
        final String[] answer = { "{\"done\":false}" };
        final List<String> seen = Collections.synchronizedList(new ArrayList<>());
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                seen.add(request.getMethod() + " " + request.getPath() + " " + request.getHeader("Authorization"));
                return new MockResponse().setHeader("Content-Type", "application/json").setBody(answer[0]);
            }
        });
        server.start();
        NotifyStore.setAccount(ctx, "http://127.0.0.1:" + server.getPort(), "secret-token");
        long at = System.currentTimeMillis() + HOUR;
        plan(daily("rem-1-a", "Morning pills", at).put("check", "/api/reminders/check?id=1&occ=x"));
        Notifier.reconcile(ctx);
        assertNull(ring(onlyAlarm()));
        assertEquals(0, seen.size()); // (showing it at its time doesn't ask)

        // Nobody has: it reminds again.
        Notifier.Nudge ask = ring(onlyAlarm());
        assertNotNull(ask);
        Notifier.nudge(ctx, ask);
        assertEquals("GET /api/reminders/check?id=1&occ=x Bearer secret-token", seen.get(0));
        assertEquals("Not done yet · 8:00 AM", text(shown("rem-1-a")));

        // Someone tapped Done on their phone since: it's taken down, and that's the end of it.
        answer[0] = "{\"done\":true}";
        Notifier.nudge(ctx, ring(onlyAlarm()));
        assertNull(shown("rem-1-a"));
        assertEquals(0, alarms().size());
        assertEquals(1, logLines("Someone already did it"));
    }

    @Test
    public void withTheServerOutOfReachItRemindsAgainAnyway() throws Exception {
        NotifyStore.setAccount(ctx, "http://127.0.0.1:9", "secret-token");
        long at = System.currentTimeMillis() + HOUR;
        plan(daily("rem-1-a", "Morning pills", at).put("check", "/api/reminders/check?id=1&occ=x"));
        Notifier.reconcile(ctx);
        ring(onlyAlarm());
        Notifier.nudge(ctx, ring(onlyAlarm()));
        assertEquals("Not done yet · 8:00 AM", text(shown("rem-1-a")));
        assertEquals(at + 60 * MIN, onlyAlarm().getTriggerAtMs());
    }

    @Test
    public void remindersAgainMissedWhileThePhoneWasOffAreSkipped() throws Exception {
        long at = System.currentTimeMillis() - 45 * MIN;
        plan(daily("rem-1-a", "Morning pills", at));
        Notifier.reconcile(ctx);
        // Shown late, once; the 30-minute one went by, the 60-minute one is still to come.
        assertEquals("8:00 AM", text(shown("rem-1-a")));
        assertEquals(at + 60 * MIN, onlyAlarm().getTriggerAtMs());
    }

    @Test
    public void oneWhoseTimeIsOverIsNotShownLate() throws Exception {
        long now = System.currentTimeMillis();
        plan(daily("rem-1-a", "Yesterday evening", now - 3 * HOUR).put("until", now - HOUR));
        Notifier.reconcile(ctx);
        assertNull(shown("rem-1-a"));
        assertEquals(0, alarms().size());
    }

    @Test
    public void aButtonTheServerTurnsDownDoesNotHoldUpTheRest() throws Exception {
        final List<String> seen = Collections.synchronizedList(new ArrayList<>());
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                String body = request.getBody().readUtf8();
                seen.add(request.getMethod() + " " + request.getPath());
                if (body.contains("gone")) return new MockResponse().setResponseCode(404).setBody("{\"error\":\"That reminder is gone\"}");
                String answer = "/api/notify/plan".equals(request.getPath()) ? "{\"entries\":[]}" : "{}";
                return new MockResponse().setHeader("Content-Type", "application/json").setBody(answer);
            }
        });
        server.start();
        NotifyStore.setAccount(ctx, "http://127.0.0.1:" + server.getPort(), "secret-token");
        long now = System.currentTimeMillis();
        NotifyStore.addEvent(ctx, "rem-9-a", "done", "Deleted since", new JSONObject().put("path", "/api/reminders/done").put("body", new JSONObject().put("id", "gone")), now);
        NotifyStore.addEvent(ctx, "pin-item-a", "done", "Milk", post("done-pin-item-a"), now);
        assertTrue(Notifier.sync(ctx));
        assertEquals("POST /api/reminders/done", seen.get(0));
        assertEquals("POST /api/lists/ops", seen.get(1));
        JSONArray events = NotifyStore.events(ctx);
        assertTrue(events.getJSONObject(0).getBoolean("sent"));
        assertTrue(events.getJSONObject(1).getBoolean("sent"));
        assertEquals(1, logLines("The server turned down done on Deleted since (404)"));
    }

    @Test
    public void buttonsTheServerHasAreForgottenAfterADay() throws Exception {
        long now = System.currentTimeMillis();
        NotifyStore.setEvents(ctx, new JSONArray()
            .put(new JSONObject().put("uid", "old-sent").put("sent", true).put("at", now - 48 * HOUR))
            .put(new JSONObject().put("uid", "old-unsent").put("sent", false).put("at", now - 48 * HOUR))
            .put(new JSONObject().put("uid", "new-sent").put("sent", true).put("at", now - HOUR)));
        NotifyStore.addEvent(ctx, "x", "done", "X", null, now);
        JSONArray events = NotifyStore.events(ctx);
        assertEquals(3, events.length());
        assertEquals("old-unsent", events.getJSONObject(0).getString("uid"));
        assertEquals("new-sent", events.getJSONObject(1).getString("uid"));
    }
}
