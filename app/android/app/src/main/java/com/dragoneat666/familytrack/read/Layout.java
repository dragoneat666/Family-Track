package com.dragoneat666.familytrack.read;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Text read off a picture comes back one screen line at a time, so a caption's
 * sentence that runs over three lines arrives as three bits. This puts it back
 * together from where the lines sit: things on the same row become one line,
 * a line that ran to the edge carries on into the next, and a bigger gap
 * between lines is a new paragraph (an empty line). Pure Java, so it's tested
 * without a phone (LayoutTest).
 */
public final class Layout {
    public static final class Line {
        final String text;
        final int left, top, right, bottom;

        public Line(String text, int left, int top, int right, int bottom) {
            this.text = text;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }

        int height() {
            return Math.max(1, bottom - top);
        }
    }

    // A line that starts a new item: a bullet, a dash, "3." or "Step 3".
    private static final Pattern ITEM = Pattern.compile("^(?:[•·*▪◦‣●○■□✓✔➤►>\\-–—]|\\d{1,2}[.)]\\s|step\\s*\\d).*", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENDS = Pattern.compile(".*[.!?:)]$");

    private Layout() {}

    public static List<String> paragraphs(List<Line> in) {
        List<Line> lines = new ArrayList<>();
        for (Line l : in) if (l.text != null && !l.text.trim().isEmpty()) lines.add(l);
        if (lines.isEmpty()) return new ArrayList<>();
        Collections.sort(lines, (a, b) -> a.top != b.top ? Integer.compare(a.top, b.top) : Integer.compare(a.left, b.left));

        // Same row (overlapping by more than half a line): one line, left to right.
        List<Line> rows = new ArrayList<>();
        List<Line> row = new ArrayList<>();
        for (Line l : lines) {
            if (!row.isEmpty()) {
                Line first = row.get(0);
                int overlap = Math.min(first.bottom, l.bottom) - Math.max(first.top, l.top);
                if (overlap < Math.min(first.height(), l.height()) / 2) {
                    rows.add(join(row));
                    row = new ArrayList<>();
                }
            }
            row.add(l);
        }
        rows.add(join(row));

        // How tall a line is, and where the text column's edges are.
        List<Integer> heights = new ArrayList<>();
        for (Line r : rows) heights.add(r.height());
        Collections.sort(heights);
        int h = heights.get(heights.size() / 2);
        int colLeft = Integer.MAX_VALUE, colRight = Integer.MIN_VALUE;
        for (Line r : rows) {
            if (r.text.length() < 25) continue;
            colLeft = Math.min(colLeft, r.left);
            colRight = Math.max(colRight, r.right);
        }
        int width = colRight - colLeft;

        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder(rows.get(0).text.trim());
        for (int i = 1; i < rows.size(); i++) {
            Line a = rows.get(i - 1), b = rows.get(i);
            String next = b.text.trim();
            int gap = b.top - a.bottom;
            if (gap > h * 0.7) {
                out.add(cur.toString());
                out.add("");
                cur = new StringBuilder(next);
                continue;
            }
            if (carriesOn(a, cur.toString(), next, width, colRight)) cur.append(' ').append(next);
            else {
                out.add(cur.toString());
                cur = new StringBuilder(next);
            }
        }
        out.add(cur.toString());
        return out;
    }

    // Does line a run on into b (a sentence wrapped at the edge)?
    private static boolean carriesOn(Line a, String aText, String b, int width, int colRight) {
        if (width <= 0 || ITEM.matcher(b).matches()) return false;
        char first = b.charAt(0);
        boolean lower = Character.isLowerCase(first);
        if (ENDS.matcher(aText).matches() && !lower) return false;
        boolean full = a.right >= colRight - width * 0.2;
        return full || (lower && a.right >= colRight - width * 0.4);
    }

    private static Line join(List<Line> row) {
        if (row.size() == 1) return row.get(0);
        List<Line> r = new ArrayList<>(row);
        Collections.sort(r, (a, b) -> Integer.compare(a.left, b.left));
        StringBuilder s = new StringBuilder();
        int left = Integer.MAX_VALUE, top = Integer.MAX_VALUE, right = Integer.MIN_VALUE, bottom = Integer.MIN_VALUE;
        for (Line l : r) {
            if (s.length() > 0) s.append(' ');
            s.append(l.text.trim());
            left = Math.min(left, l.left);
            top = Math.min(top, l.top);
            right = Math.max(right, l.right);
            bottom = Math.max(bottom, l.bottom);
        }
        return new Line(s.toString(), left, top, right, bottom);
    }
}
