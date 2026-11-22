package com.dragoneat666.familytrack.wallpaper;

import android.app.WallpaperManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A finished picture puzzle as the phone's or tablet's background
 * (app/src/scenes/wallpaper.js): the home screen, the lock screen, or both.
 * Android lets any app with SET_WALLPAPER (granted at install, no prompt) do
 * this. The picture comes from the app (it already has it); nothing is kept
 * here. Some phones put their own lock screen over it (Samsung's dynamic lock
 * screen, say) until that's turned off.
 */
@CapacitorPlugin(name = "FamilyWallpaper")
public class WallpaperPlugin extends Plugin {
    private static final String TAG = "FamilyWallpaper";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    /** Can this device's background be changed by an app? */
    @PluginMethod
    public void available(PluginCall call) {
        WallpaperManager wm = WallpaperManager.getInstance(getContext());
        JSObject out = new JSObject();
        out.put("available", wm.isWallpaperSupported() && wm.isSetWallpaperAllowed());
        call.resolve(out);
    }

    /** { image: base64 JPEG/PNG, where: "home" | "lock" | "both" } */
    @PluginMethod
    public void set(PluginCall call) {
        String image = call.getString("image");
        String where = call.getString("where", "both");
        if (image == null || image.isEmpty()) {
            call.reject("No picture");
            return;
        }
        io.execute(() -> {
            Bitmap bitmap = null;
            try {
                byte[] bytes = Base64.decode(image, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) {
                    call.reject("That picture can't be used");
                    return;
                }
                WallpaperManager wm = WallpaperManager.getInstance(getContext());
                if (!wm.isWallpaperSupported() || !wm.isSetWallpaperAllowed()) {
                    call.reject("This device doesn't let apps change its background", "NOT_ALLOWED");
                    return;
                }
                int flags = "home".equals(where) ? WallpaperManager.FLAG_SYSTEM
                    : "lock".equals(where) ? WallpaperManager.FLAG_LOCK
                    : WallpaperManager.FLAG_SYSTEM | WallpaperManager.FLAG_LOCK;
                // (No crop given: Android fills the screen from the middle of the picture.)
                wm.setBitmap(bitmap, null, true, flags);
                call.resolve();
            } catch (Exception e) {
                Log.w(TAG, "set failed", e);
                call.reject("Couldn't set the background");
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
        });
    }
}
