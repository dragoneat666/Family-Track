package com.dragoneat666.familytrack.read;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;

/**
 * Recipes from the screen (app/src/recipes/screen.js):
 *  - readImages: the text in screenshots picked in the app.
 *  - watch: "Read a reel as it plays" (WatchService). Needs "Display over
 *    other apps" (for the bubble; asked once, in Android's settings) and the
 *    "Start recording?" OK each time. Family Track steps aside (back to the
 *    app it came from) so the video can be played; what was read comes back
 *    through FamilyShare as a "watched" share.
 */
@CapacitorPlugin(name = "FamilyRead")
public class ReadPlugin extends Plugin {

    @Override
    public void load() {
        TextReader.prepare(getContext());
    }

    @PluginMethod
    public void readImages(PluginCall call) {
        JSArray images = call.getArray("images");
        List<InputImage> list = new ArrayList<>();
        try {
            for (int i = 0; images != null && i < images.length() && i < 10; i++) {
                String s = images.getString(i);
                int comma = s.indexOf(',');
                byte[] bytes = Base64.decode(comma >= 0 ? s.substring(comma + 1) : s, Base64.DEFAULT);
                Bitmap b = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (b != null) list.add(InputImage.fromBitmap(b, 0));
            }
        } catch (JSONException | IllegalArgumentException e) {
            call.reject("Those pictures couldn't be opened");
            return;
        }
        if (list.isEmpty()) {
            call.reject("Those pictures couldn't be opened");
            return;
        }
        TextReader.readAll(list, (lines, error) -> {
            JSObject o = new JSObject();
            o.put("text", String.join("\n", lines));
            if (error != null) o.put("error", error);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void watchStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", Build.VERSION.SDK_INT >= 29);
        o.put("overlay", Settings.canDrawOverlays(getContext()));
        o.put("running", WatchService.running);
        call.resolve(o);
    }

    @PluginMethod
    public void watch(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.resolve(answer(false, "old"));
            return;
        }
        if (WatchService.running) {
            call.resolve(answer(true, null));
            return;
        }
        if (!Settings.canDrawOverlays(getContext())) {
            // Android's own page for "Display over other apps", for Family Track.
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())));
            } catch (RuntimeException ignored) { }
            call.resolve(answer(false, "overlay"));
            return;
        }
        MediaProjectionManager m = getContext().getSystemService(MediaProjectionManager.class);
        // Android 14+ starts the question on "one app" with a picker; the
        // whole screen is what's wanted (the video plays in another app).
        Intent ask = Build.VERSION.SDK_INT >= 34
            ? m.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            : m.createScreenCaptureIntent();
        startActivityForResult(call, ask, "recordingAnswer");
    }

    @ActivityCallback
    private void recordingAnswer(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(answer(false, "denied"));
            return;
        }
        Intent start = new Intent(getContext(), WatchService.class)
            .putExtra(WatchService.EXTRA_CODE, result.getResultCode())
            .putExtra(WatchService.EXTRA_DATA, result.getData());
        try {
            ContextCompat.startForegroundService(getContext(), start);
        } catch (RuntimeException e) {
            call.resolve(answer(false, "failed"));
            return;
        }
        // Back to the app before this one (the video), Family Track behind it.
        if (getActivity() != null) getActivity().moveTaskToBack(true);
        call.resolve(answer(true, null));
    }

    private JSObject answer(boolean ok, String reason) {
        JSObject o = new JSObject();
        o.put("ok", ok);
        if (reason != null) o.put("reason", reason);
        return o;
    }
}
