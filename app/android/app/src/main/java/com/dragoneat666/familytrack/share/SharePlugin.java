package com.dragoneat666.familytrack.share;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.dragoneat666.familytrack.read.TextReader;
import com.dragoneat666.familytrack.read.WatchService;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Things coming into Family Track to make a recipe from (app/src/share.js):
 *  - "Share → Family Track" from another app: text (usually a link, maybe
 *    with the caption), or screenshots, whose text is read on the phone
 *    (read/TextReader) and only the text passed on.
 *  - What "Read a reel as it plays" read (read/WatchService).
 *
 * Each arrives as { id, text, from: 'share' | 'screenshots' | 'screen',
 * steady?, error? }: take() for one that came while the page wasn't
 * listening yet, and a "shared" event (kept until heard) otherwise.
 */
@CapacitorPlugin(name = "FamilyShare")
public class SharePlugin extends Plugin {
    private JSObject pending;
    private int count;

    @Override
    public void load() {
        if (getActivity() != null) keep(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        keep(intent);
    }

    private void keep(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        String type = intent.getType() == null ? "" : intent.getType();
        if (WatchService.ACTION_WATCHED.equals(action)) {
            JSObject o = item(intent.getStringExtra("text"), "screen");
            o.put("steady", intent.getStringExtra("steady") == null ? "" : intent.getStringExtra("steady"));
            handled();
            deliver(o);
        } else if (Intent.ACTION_SEND.equals(action) && type.startsWith("text/")) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            StringBuilder all = new StringBuilder();
            if (subject != null && !subject.trim().isEmpty() && (text == null || !text.toString().contains(subject))) {
                all.append(subject.trim()).append('\n');
            }
            if (text != null) all.append(text);
            String shared = all.toString().trim();
            handled();
            if (!shared.isEmpty()) deliver(item(shared, "share"));
        } else if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) && type.startsWith("image/")) {
            List<Uri> uris = images(intent);
            handled();
            readScreenshots(uris);
        }
    }

    // Done with it: the activity coming back mustn't bring it in again.
    private void handled() {
        if (getActivity() != null) getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> images(Intent intent) {
        List<Uri> out = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> many = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) out.addAll(many);
        } else {
            Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) out.add(one);
        }
        return out.size() > 10 ? out.subList(0, 10) : out;
    }

    // (Read straight away, while Family Track is allowed to open them.)
    private void readScreenshots(List<Uri> uris) {
        List<InputImage> list = new ArrayList<>();
        for (Uri u : uris) {
            try {
                list.add(InputImage.fromFilePath(getContext(), u));
            } catch (IOException | RuntimeException ignored) { }
        }
        if (list.isEmpty()) {
            JSObject o = item("", "screenshots");
            o.put("error", "Those pictures couldn't be opened.");
            deliver(o);
            return;
        }
        TextReader.readAll(list, (lines, error) -> {
            JSObject o = item(String.join("\n", lines), "screenshots");
            if (error != null) o.put("error", error);
            deliver(o);
        });
    }

    private JSObject item(String text, String from) {
        JSObject o = new JSObject();
        o.put("id", System.currentTimeMillis() + "-" + (++count));
        String t = text == null ? "" : text;
        o.put("text", t.length() > 10000 ? t.substring(0, 10000) : t);
        o.put("from", from);
        return o;
    }

    private void deliver(JSObject o) {
        pending = o;
        notifyListeners("shared", o, true);
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject o = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(o);
    }
}
