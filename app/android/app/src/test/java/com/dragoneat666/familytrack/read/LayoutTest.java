package com.dragoneat666.familytrack.read;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Putting a screenshot's lines back into sentences and paragraphs. */
public class LayoutTest {
    private final List<Layout.Line> lines = new ArrayList<>();
    private int y = 100;

    // A line 30 tall, starting at x 25, as wide as its text (25 px a letter, about).
    private void line(String text, int right) {
        lines.add(new Layout.Line(text, 25, y, right, y + 30));
        y += 38;
    }

    private void gap() {
        y += 40;
    }

    @Test
    public void wrappedSentencesJoinListsDont() {
        line("257K", 150);
        lines.add(new Layout.Line("Q950", 175, y - 38, 285, y - 8)); // same row as 257K
        gap();
        line("somecook This is the kind of dinner that takes almost no effort", 835);
        line("but tastes like you spent way more time on it. Just toss", 745);
        line("everything into the slow cooker and let it do the work.", 735);
        gap();
        line("Ingredients:", 180);
        line("• 1 package stew meat (about 2 lbs)", 485);
        line("• 1 bag mini gold potatoes", 360);
        gap();
        line("Directions:", 165);
        line("Add everything to your slow cooker and cook on Low for 6-7", 820);
        line("hours or High for 3-4 hours.", 390);
        line("2. Place your hash browns over each muffin hole and bake for", 825);
        line("10-15 minutes, until softened.", 415);
        line("3. Using the bottom of a spice jar", 450);

        assertEquals(Arrays.asList(
            "257K Q950",
            "",
            "somecook This is the kind of dinner that takes almost no effort but tastes like you spent way more time on it. Just toss everything into the slow cooker and let it do the work.",
            "",
            "Ingredients:",
            "• 1 package stew meat (about 2 lbs)",
            "• 1 bag mini gold potatoes",
            "",
            "Directions:",
            "Add everything to your slow cooker and cook on Low for 6-7 hours or High for 3-4 hours.",
            "2. Place your hash browns over each muffin hole and bake for 10-15 minutes, until softened.",
            "3. Using the bottom of a spice jar"
        ), Layout.paragraphs(lines));
    }

    @Test
    public void aFullLineEndingASentenceStaysPut() {
        line("HOW: Add diced potatoes, onion + pork; pour over broth,", 830);
        line("BBQ, maple + spices. LOW; check pork at 3 hrs. Pull at 145F;", 835);
        line("rest 3 min. Cook potatoes until soft; add corn + cheddar.", 830);
        line("Slice pork and serve.", 300);
        assertEquals(Arrays.asList(
            "HOW: Add diced potatoes, onion + pork; pour over broth, BBQ, maple + spices. LOW; check pork at 3 hrs. Pull at 145F; rest 3 min. Cook potatoes until soft; add corn + cheddar.",
            "Slice pork and serve."
        ), Layout.paragraphs(lines));
    }
}
