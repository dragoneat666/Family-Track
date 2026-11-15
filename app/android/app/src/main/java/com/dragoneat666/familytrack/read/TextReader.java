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

    /** Several pictures in turn: all their lines, with repeats (screenshots that overlap) left out. */
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
            for (String l : lines) if (seen.add(Collector.key(l))) out.add(l);
            next(images, i + 1, out, seen, err != null ? err : error, done);
        });
    }

    // Top to bottom by block, each block's lines in order.
    static List<String> lines(Text t) {
        List<Text.TextBlock> blocks = new ArrayList<>(t.getTextBlocks());
        Collections.sort(blocks, (a, b) -> Integer.compare(top(a.getBoundingBox()), top(b.getBoundingBox())));
        List<String> out = new ArrayList<>();
        for (Text.TextBlock b : blocks) {
            for (Text.Line l : b.getLines()) {
                String s = l.getText().trim();
                if (!s.isEmpty()) out.add(s);
            }
        }
        return out;
    }

    private static int top(Rect r) {
        return r == null ? 0 : r.top;
    }

    static String message(Exception e) {
        if (e instanceof MlKitException && ((MlKitException) e).getErrorCode() == MlKitException.UNAVAILABLE) {
            return "The phone is still getting its text reader from Google Play services. Try again in a minute.";
        }
        return "Couldn't read the text in that picture.";
    }
}
