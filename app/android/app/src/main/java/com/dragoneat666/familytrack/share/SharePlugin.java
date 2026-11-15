package com.dragoneat666.familytrack.share;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Share → Family Track" from another app (a TikTok, Instagram or Facebook
 * video, a recipe page in the browser): the text that was shared (usually a
 * link, sometimes with the caption) goes to the app, which tries to import
 * it as a recipe (app/src/share.js). Only plain text is accepted.
 *
 * take(): what was shared and not handled yet, or nothing. A share that
 * arrives while the app is open also comes as a "shared" event.
 */
@CapacitorPlugin(name = "FamilyShare")
public class SharePlugin extends Plugin {
    private String pending;

    @Override
    public void load() {
        if (getActivity() != null) keep(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        keep(intent, true);
    }

    private void keep(Intent intent, boolean tell) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        StringBuilder all = new StringBuilder();
        if (subject != null && !subject.trim().isEmpty() && (text == null || !text.toString().contains(subject))) {
            all.append(subject.trim()).append('\n');
        }
        if (text != null) all.append(text);
        String shared = all.toString().trim();
        if (shared.isEmpty()) return;
        if (shared.length() > 10000) shared = shared.substring(0, 10000);
        pending = shared;
        // Handled: a restart of the activity mustn't bring it in again.
        if (getActivity() != null) getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        if (tell) {
            JSObject o = new JSObject();
            o.put("text", shared);
            notifyListeners("shared", o);
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject o = new JSObject();
        if (pending != null) o.put("text", pending);
        pending = null;
        call.resolve(o);
    }
}
