package com.dragoneat666.familytrack.cook;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Cooking mode (app/src/recipes/cook.js):
 *  - keepAwake: the screen stays on while cooking mode is open.
 *  - listen / stopListening: "Yes chef, next" and the like. Only Android's
 *    on-device speech recognizer is used (Android 12 and up), so what's said
 *    never leaves the phone and it works with no connection. It listens
 *    only while cooking mode is open and the app is on screen: it stops
 *    when the app goes to the background and comes back with it. What it
 *    hears goes to the app as "heard" events; nothing is kept.
 *  - speak: reads a step or the ingredients out loud (the phone's own
 *    text-to-speech), pausing the listening meanwhile so it doesn't hear itself.
 *  - timers: see CookTimers.
 */
@CapacitorPlugin(
    name = "FamilyCook",
    permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class CookPlugin extends Plugin {
    private static final String TAG = "FamilyCook";
    // SpeechRecognizer error codes (some only named in newer Android versions).
    private static final int ERR_SPEECH_TIMEOUT = 6, ERR_NO_MATCH = 7, ERR_BUSY = 8, ERR_PERMISSIONS = 9,
        ERR_CLIENT = 5, ERR_NOT_SUPPORTED = 12, ERR_UNAVAILABLE = 13;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean wanted; // cooking mode wants listening
    private boolean paused; // the app is in the background
    private boolean speaking;
    private boolean running;
    private int failures;

    private TextToSpeech tts;
    private boolean ttsReady;
    private final Map<String, PluginCall> speaking_calls = new HashMap<>();
    private int utterance;

    @Override
    public void load() {
        CookTimers.listener = (id, what) -> {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("what", what);
            notifyListeners("timer", o);
        };
    }

    @Override
    protected void handleOnDestroy() {
        CookTimers.listener = null;
        wanted = false;
        main.post(this::destroyRecognizer);
        if (tts != null) tts.shutdown();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        paused = true;
        main.post(this::destroyRecognizer);
        if (tts != null) tts.stop();
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        paused = false;
        if (wanted) main.post(this::begin);
        super.handleOnResume();
    }

    // ---------- the screen ----------

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        main.post(() -> {
            if (getActivity() == null) return;
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    // ---------- listening ----------

    private boolean voiceAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    @PluginMethod
    public void voiceStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", voiceAvailable());
        o.put("allowed", getPermissionState("mic") == PermissionState.GRANTED);
        call.resolve(o);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (!voiceAvailable()) {
            call.resolve(result(false, "unavailable"));
            return;
        }
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micDone");
            return;
        }
        startListening();
        call.resolve(result(true, null));
    }

    @PermissionCallback
    private void micDone(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) {
            startListening();
            call.resolve(result(true, null));
        } else {
            call.resolve(result(false, "denied"));
        }
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        wanted = false;
        main.post(this::destroyRecognizer);
        call.resolve();
    }

    private JSObject result(boolean ok, String reason) {
        JSObject o = new JSObject();
        o.put("ok", ok);
        if (reason != null) o.put("reason", reason);
        return o;
    }

    private void startListening() {
        wanted = true;
        failures = 0;
        main.post(this::begin);
    }

    private Intent recognizeIntent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    }

    // On the main thread: start (again) if cooking mode wants it and nothing's in the way.
    private void begin() {
        if (!wanted || paused || speaking || running) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new Listener());
            }
            running = true;
            recognizer.startListening(recognizeIntent());
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't start listening", e);
            running = false;
            destroyRecognizer();
            again(2000);
        }
    }

    private void again(long delay) {
        main.postDelayed(this::begin, delay);
    }

    private void destroyRecognizer() {
        running = false;
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (RuntimeException ignored) { }
            recognizer = null;
        }
    }

    private void state(String s) {
        JSObject o = new JSObject();
        o.put("state", s);
        notifyListeners("voice", o);
    }

    private void heard(Bundle b, boolean last) {
        ArrayList<String> texts = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts == null || texts.isEmpty()) return;
        JSObject o = new JSObject();
        o.put("texts", new JSArray(texts));
        o.put("final", last);
        notifyListeners("heard", o);
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { state("listening"); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onPartialResults(Bundle partial) {
            heard(partial, false);
        }

        @Override
        public void onResults(Bundle results) {
            running = false;
            failures = 0;
            heard(results, true);
            again(50);
        }

        @Override
        public void onError(int error) {
            running = false;
            if (error == ERR_PERMISSIONS) {
                wanted = false;
                state("denied");
                return;
            }
            if (error == ERR_NOT_SUPPORTED || error == ERR_UNAVAILABLE) {
                // The phone doesn't have this language for offline speech yet: ask it to get it.
                if (Build.VERSION.SDK_INT >= 33 && recognizer != null) {
                    try {
                        recognizer.triggerModelDownload(recognizeIntent());
                    } catch (RuntimeException ignored) { }
                }
                state("downloading");
                destroyRecognizer();
                again(30000);
                return;
            }
            if (error == ERR_NO_MATCH || error == ERR_SPEECH_TIMEOUT) {
                again(50); // just quiet: listen again
                return;
            }
            failures++;
            if (error == ERR_CLIENT || error == ERR_BUSY || failures > 2) destroyRecognizer();
            again(failures > 5 ? 3000 : 400);
        }
    }

    // ---------- reading out loud ----------

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        main.post(() -> {
            if (tts == null) {
                tts = new TextToSpeech(getContext(), status -> {
                    ttsReady = status == TextToSpeech.SUCCESS;
                    if (ttsReady) {
                        tts.setOnUtteranceProgressListener(new Spoken());
                        say(call, text);
                    } else {
                        call.reject("This phone can't read out loud");
                    }
                });
            } else if (ttsReady) {
                say(call, text);
            } else {
                call.reject("This phone can't read out loud");
            }
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(() -> {
            if (tts != null) tts.stop();
            finishSpeaking(null);
        });
        call.resolve();
    }

    private void say(PluginCall call, String text) {
        speaking = true;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (RuntimeException ignored) { }
            running = false;
        }
        String id = "u" + (++utterance);
        speaking_calls.put(id, call);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
    }

    private void finishSpeaking(String id) {
        main.post(() -> {
            if (id != null) {
                PluginCall c = speaking_calls.remove(id);
                if (c != null) c.resolve();
            } else {
                for (PluginCall c : speaking_calls.values()) c.resolve();
                speaking_calls.clear();
            }
            if (speaking_calls.isEmpty()) {
                speaking = false;
                again(300);
            }
        });
    }

    private class Spoken extends UtteranceProgressListener {
        @Override public void onStart(String id) { }
        @Override public void onDone(String id) { finishSpeaking(id); }
        @Override public void onError(String id) { finishSpeaking(id); }
        @Override public void onStop(String id, boolean interrupted) { finishSpeaking(id); }
    }

    // ---------- timers ----------

    @PluginMethod
    public void timerStart(PluginCall call) {
        String id = call.getString("id");
        Long endAt = call.getLong("endAt");
        if (id == null || endAt == null) {
            call.reject("id and endAt");
            return;
        }
        CookTimers.start(getContext(), id, call.getString("label", "Timer"), endAt);
        call.resolve();
    }

    @PluginMethod
    public void timerStop(PluginCall call) {
        String id = call.getString("id");
        if (id != null) CookTimers.stop(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void timerList(PluginCall call) {
        JSObject o = new JSObject();
        o.put("timers", CookTimers.list(getContext()));
        call.resolve(o);
    }
}
