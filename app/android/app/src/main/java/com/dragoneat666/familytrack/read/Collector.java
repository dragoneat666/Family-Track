package com.dragoneat666.familytrack.read;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * What was on screen while a video played, read a frame at a time. Text that
 * comes and goes (captions, "2 cups flour" popping up, spoken words shown as
 * auto-captions) is the recipe, kept in the order it first showed up. Text
 * that's there the whole time (the username, buttons, counts) is set aside.
 * The same words read slightly differently from frame to frame count as one,
 * and a caption that grows word by word keeps its longest version.
 *
 * Pure Java (no Android), so it's tested on the build machine.
 */
public final class Collector {
    static final class Entry {
        String text;
        final String key;
        String longest;
        int first;
        int seen;
        Entry(String text, String key, int frame) {
            this.text = text;
            this.key = key;
            this.longest = key;
            this.first = frame;
        }
    }

    // Counts, times and the apps' own buttons: never part of a recipe.
    private static final Pattern NOISE = Pattern.compile(
        "^(?:[\\d.,]+\\s*[kKmM]?|\\d{1,2}:\\d{2}(?::\\d{2})?|\\d+\\s*[smhdw]|reply|replies|see translation|more|less|follow|following|"
            + "like|likes|share|send|save|saved|comment|comments|remix|sponsored|suggested for you|search|home|reels|friends|inbox|profile|"
            + "for you|explore|live|add comment.*|add a comment.*|liked by .*|view all .* comments|original audio.*|.*· original audio|"
            + "see more|\\.\\.\\.\\s*more|…\\s*more|.*tap when done.*|.*reading the screen.*|family track.*)$",
        Pattern.CASE_INSENSITIVE);

    private final List<Entry> entries = new ArrayList<>();
    private int frames;

    /** Lower case, letters and numbers only: for telling lines apart. */
    public static String key(String line) {
        return line.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    public synchronized void add(List<String> lines) {
        frames++;
        List<Entry> hit = new ArrayList<>();
        for (String raw : lines) {
            String text = raw.trim();
            String key = key(text);
            if (key.length() < 2 || NOISE.matcher(text).matches() || key.matches("[\\d ]+")) continue;
            Entry e = find(key);
            if (e == null) {
                e = new Entry(text, key, frames);
                entries.add(e);
            } else if (key.length() > e.longest.length()) {
                e.longest = key;
                e.text = text;
            }
            if (!hit.contains(e)) {
                hit.add(e);
                e.seen++;
            }
        }
    }

    private Entry find(String key) {
        for (int i = entries.size() - 1; i >= 0; i--) {
            Entry e = entries.get(i);
            if (e.key.equals(key) || e.longest.equals(key)) return e;
            if (key.length() >= 8 && e.longest.length() >= 8 && (e.longest.contains(key) || key.contains(e.longest))) return e;
            if (similar(e.longest, key)) return e;
        }
        return null;
    }

    // Close enough (one or two letters read wrong).
    static boolean similar(String a, String b) {
        int la = a.length(), lb = b.length();
        if (Math.min(la, lb) < 6 || Math.abs(la - lb) > Math.max(la, lb) / 5) return false;
        int[] prev = new int[lb + 1], cur = new int[lb + 1];
        for (int j = 0; j <= lb; j++) prev[j] = j;
        for (int i = 1; i <= la; i++) {
            cur[0] = i;
            for (int j = 1; j <= lb; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[lb] <= Math.max(la, lb) * 0.15;
    }

    public synchronized int frames() {
        return frames;
    }

    /** How many different bits of text so far (for the bubble). */
    public synchronized int found() {
        int n = 0;
        for (Entry e : entries) if (!steady(e)) n++;
        return n;
    }

    // There nearly the whole time: part of the app, not the recipe.
    private boolean steady(Entry e) {
        return frames >= 6 && e.seen >= frames * 0.85;
    }

    /** [the recipe text, line by line; what stayed on screen the whole time]. */
    public synchronized String[] result() {
        StringBuilder changing = new StringBuilder(), steady = new StringBuilder();
        List<Entry> sorted = new ArrayList<>(entries);
        sorted.sort((a, b) -> Integer.compare(a.first, b.first));
        for (Entry e : sorted) {
            // A flicker seen in one frame only is usually a misread mid-swipe.
            if (frames >= 8 && e.seen < 2) continue;
            (steady(e) ? steady : changing).append(e.text).append('\n');
        }
        return new String[] { changing.toString().trim(), steady.toString().trim() };
    }

    @Override
    public String toString() {
        return String.format(Locale.ROOT, "Collector(%d frames, %d entries)", frames, entries.size());
    }
}
