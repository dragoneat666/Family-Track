package com.dragoneat666.familytrack.read;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;

import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Reading the text in a picture (a screenshot, or a frame of the screen while
 * a video plays), on the phone: Google's text recognition from Play services.
 * Nothing leaves the phone; the picture isn't kept. The reader itself comes
 * from Play services the first time (prepare() asks for it early).
 */
public final class TextReader {
    public interface Done { void done(List<String> lines, String error); }

    private static TextRecognizer recognizer;

    private TextReader() {}

    static synchronized TextRecognizer get() {
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return recognizer;
    }

    /** Ask Play services for the reader now, if this phone doesn't have it yet. */
    public static void prepare(Context ctx) {
        try {
            ModuleInstallClient client = ModuleInstall.getClient(ctx);
            TextRecognizer r = get();
            client.areModulesAvailable(r).addOnSuccessListener((a) -> {
                if (!a.areModulesAvailable()) client.installModules(ModuleInstallRequest.newBuilder().addApi(r).build());
            });
        } catch (RuntimeException ignored) { }
    }

    public static void read(Bitmap bitmap, Done done) {
        read(InputImage.fromBitmap(bitmap, 0), done);
    }

    public static void read(InputImage image, Done done) {
        try {
            get().process(image)
                .addOnSuccessListener((t) -> done.done(lines(t), null))
                .addOnFailureListener((e) -> done.done(Collections.emptyList(), message(e)));
        } catch (RuntimeException e) {
            done.done(Collections.emptyList(), message(e));
        }
    }

    /** Marks where one picture's text ends and the next one's starts. */
    public static final String NEXT_PICTURE = "\f";

    /**
     * Several pictures in turn: their text (see lines()), a NEXT_PICTURE line
     * between pictures, and lines already read in an earlier picture (where
     * screenshots overlap) left out.
     */
    public static void readAll(List<InputImage> images, Done done) {
        List<String> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        next(images, 0, out, seen, null, done);
    }

    private static void next(List<InputImage> images, int i, List<String> out, Set<String> seen, String error, Done done) {
        if (i >= images.size()) {
            done.done(out, out.isEmpty() ? error : null);
            return;
        }
        read(images.get(i), (lines, err) -> {
            if (i > 0 && !lines.isEmpty()) out.add(NEXT_PICTURE);
            for (String l : lines) {
                String k = Collector.key(l);
                if (k.isEmpty()) out.add(l);
                else if (!readBefore(seen, k)) {
                    seen.add(k);
                    out.add(l);
                }
            }
            next(images, i + 1, out, seen, err != null ? err : error, done);
        });
    }

    private static boolean readBefore(Set<String> seen, String k) {
        if (seen.contains(k)) return true;
        if (k.length() < 12) return false;
        for (String s : seen) if (s.contains(k)) return true;
        return false;
    }

    // The lines put back into sentences and paragraphs (Layout); an empty
    // line between paragraphs.
    static List<String> lines(Text t) {
        List<Layout.Line> all = new ArrayList<>();
        for (Text.TextBlock b : t.getTextBlocks()) {
            for (Text.Line l : b.getLines()) {
                String s = l.getText().trim();
                if (s.isEmpty()) continue;
                Rect r = l.getBoundingBox();
                if (r == null) r = b.getBoundingBox();
                if (r == null) r = new Rect(0, 0, 0, 0);
                all.add(new Layout.Line(s, r.left, r.top, r.right, r.bottom));
            }
        }
        return Layout.paragraphs(all);
    }

    static String message(Exception e) {
        if (e instanceof MlKitException && ((MlKitException) e).getErrorCode() == MlKitException.UNAVAILABLE) {
            return "The phone is still getting its text reader from Google Play services. Try again in a minute.";
        }
        return "Couldn't read the text in that picture.";
    }
}
