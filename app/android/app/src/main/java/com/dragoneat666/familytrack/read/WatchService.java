package com.dragoneat666.familytrack.read;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.dragoneat666.familytrack.MainActivity;
import com.dragoneat666.familytrack.R;

import java.nio.ByteBuffer;

/**
 * "Read a reel as it plays": with the person's "Start recording?" OK, the
 * screen is looked at about twice a second and the text on it read (on the
 * phone; frames are never kept or sent anywhere). A small bubble shows it's
 * happening; tapping it stops, and Family Track opens with what was read
 * (see Collector) to make a recipe from. It stops by itself after ten
 * minutes, or when Android ends the recording.
 */
public class WatchService extends Service {
    private static final String TAG = "FamilyRead";
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    static final String ACTION_STOP = "com.dragoneat666.familytrack.WATCH_STOP";
    /** Family Track opened with what was read: extras "text" and "steady". */
    public static final String ACTION_WATCHED = "com.dragoneat666.familytrack.WATCHED";
    private static final String CHANNEL = "watching";
    private static final int NOTIFICATION_ID = 4;
    private static final long EVERY_MS = 500;
    private static final long MAX_MS = 10 * 60 * 1000L;

    static volatile boolean running;

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler work;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private TextView bubble;
    private final Collector collector = new Collector();
    private volatile boolean reading;
    private int[] lastLook;
    private long startedAt;
    private long lastRead;
    private boolean finished;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            finish(true);
            return START_NOT_STICKY;
        }
        if (running || intent == null) return START_NOT_STICKY;
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        int code = intent.getIntExtra(EXTRA_CODE, 0);
        try {
            // (Android 14 wants the service in the foreground, as screen
            // recording, before the recording starts.)
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);
            MediaProjectionManager m = getSystemService(MediaProjectionManager.class);
            projection = data == null ? null : m.getMediaProjection(code, data);
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't start reading the screen", e);
            projection = null;
        }
        if (projection == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        startedAt = System.currentTimeMillis();
        TextReader.prepare(this);
        thread = new HandlerThread("family-read");
        thread.start();
        work = new Handler(thread.getLooper());
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() { main.post(() -> finish(true)); }
        }, work);
        startDisplay();
        showBubble();
        work.postDelayed(this::look, 800);
        return START_NOT_STICKY;
    }

    // A copy of the screen, at a size the text is still easy to read at.
    private void startDisplay() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float scale = Math.min(1f, 1080f / Math.min(dm.widthPixels, dm.heightPixels));
        int w = Math.round(dm.widthPixels * scale), h = Math.round(dm.heightPixels * scale);
        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        display = projection.createVirtualDisplay("family-track-read", w, h, dm.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, work);
    }

    // On the work thread, every half second: read the screen if it changed
    // (and the last read is done).
    private void look() {
        if (finished) return;
        if (System.currentTimeMillis() - startedAt > MAX_MS) {
            main.post(() -> finish(true));
            return;
        }
        work.postDelayed(this::look, EVERY_MS);
        if (reading || reader == null) return;
        Image image;
        try {
            image = reader.acquireLatestImage();
        } catch (RuntimeException e) {
            return;
        }
        if (image == null) return;
        Bitmap frame = toBitmap(image);
        image.close();
        if (frame == null) return;
        long now = System.currentTimeMillis();
        if (!changed(frame) && now - lastRead < 3000) {
            frame.recycle();
            return;
        }
        reading = true;
        lastRead = now;
        TextReader.read(frame, (lines, error) -> {
            frame.recycle();
            if (!finished) collector.add(lines);
            reading = false;
            main.post(this::updateBubble);
        });
    }

    // Did the screen change since the last look? (A small grey copy, compared.)
    private boolean changed(Bitmap frame) {
        Bitmap small = Bitmap.createScaledBitmap(frame, 27, 48, true);
        int[] px = new int[27 * 48];
        small.getPixels(px, 0, 27, 0, 0, 27, 48);
        small.recycle();
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            px[i] = (Color.red(c) * 3 + Color.green(c) * 6 + Color.blue(c)) / 10;
        }
        int[] before = lastLook;
        lastLook = px;
        if (before == null) return true;
        long diff = 0;
        for (int i = 0; i < px.length; i++) diff += Math.abs(px[i] - before[i]);
        return diff / px.length >= 2;
    }

    private static Bitmap toBitmap(Image image) {
        try {
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer().duplicate();
            buffer.rewind();
            int rowPixels = plane.getRowStride() / plane.getPixelStride();
            Bitmap padded = Bitmap.createBitmap(rowPixels, image.getHeight(), Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            if (rowPixels == image.getWidth()) return padded;
            Bitmap exact = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
            padded.recycle();
            return exact;
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ---------- the bubble ----------

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void showBubble() {
        WindowManager wm = getSystemService(WindowManager.class);
        bubble = new TextView(this);
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        bubble.setPadding(dp(14), dp(10), dp(14), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xE0C0392B);
        bg.setCornerRadius(dp(22));
        bubble.setBackground(bg);
        updateBubble();
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = dp(12);
        lp.y = dp(90);
        // Drag to move it; a tap stops.
        bubble.setOnTouchListener(new android.view.View.OnTouchListener() {
            float downX, downY;
            int startX, startY;
            boolean moved;
            @Override
            public boolean onTouch(android.view.View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY(); startX = lp.x; startY = lp.y; moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                        if (Math.abs(dx) > dp(8) || Math.abs(dy) > dp(8)) moved = true;
                        if (moved) {
                            lp.x = startX - Math.round(dx); // (gravity END: x counts from the right)
                            lp.y = startY + Math.round(dy);
                            try { wm.updateViewLayout(bubble, lp); } catch (RuntimeException ignored) { }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) finish(true);
                        return true;
                    default:
                        return false;
                }
            }
        });
        try {
            wm.addView(bubble, lp);
        } catch (RuntimeException e) {
            Log.w(TAG, "no bubble (overlay not allowed?)", e);
            bubble = null;
        }
    }

    private void updateBubble() {
        if (bubble == null) return;
        int n = collector.found();
        bubble.setText(n == 0 ? "⏺ Reading the screen · tap when done" : "⏺ Reading · " + n + " bits so far · tap when done");
    }

    // ---------- stopping ----------

    private void finish(boolean open) {
        if (finished) return;
        finished = true;
        running = false;
        if (bubble != null) {
            try { getSystemService(WindowManager.class).removeView(bubble); } catch (RuntimeException ignored) { }
            bubble = null;
        }
        Handler w = work;
        Runnable release = () -> {
            if (display != null) display.release();
            if (reader != null) reader.close();
            try { if (projection != null) projection.stop(); } catch (RuntimeException ignored) { }
            display = null; reader = null; projection = null;
            if (thread != null) thread.quitSafely();
        };
        if (w != null) w.post(release); else release.run();
        if (open && startedAt > 0) {
            String[] r = collector.result();
            Intent i = new Intent(this, MainActivity.class)
                .setAction(ACTION_WATCHED)
                .putExtra("text", r[0])
                .putExtra("steady", r[1])
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try {
                startActivity(i);
            } catch (RuntimeException e) {
                Log.w(TAG, "couldn't open the app", e);
            }
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        finish(false);
        super.onDestroy();
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Reading the screen for a recipe", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, WatchService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_family_track)
            .setContentTitle("Reading the screen for a recipe")
            .setContentText("Play the video. Tap Done (or the red bubble) when it's over.")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(stop)
            .addAction(0, "Done", stop)
            .build();
    }

    static boolean isRunning(Context ctx) {
        return running;
    }
}
