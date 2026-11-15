package com.dragoneat666.familytrack.read;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** What "Read a reel as it plays" keeps from the frames it read. */
public class CollectorTest {
    private static List<String> frame(String... lines) {
        List<String> l = new ArrayList<>(Arrays.asList("@chefsomebody", "Follow", "12.3K", "Original audio", "Add comment..."));
        l.addAll(Arrays.asList(lines));
        return l;
    }

    @Test
    public void keepsWhatComesAndGoesInOrder() {
        Collector c = new Collector();
        c.add(frame("Creamy garlic pasta"));
        c.add(frame("Creamy garlic pasta"));
        c.add(frame("2 cups pasta"));
        c.add(frame("2 cups pasta"));
        c.add(frame("2 cups pasta"));
        c.add(frame("4 cloves garlic"));
        c.add(frame("4 cIoves garlic")); // misread
        c.add(frame("1 cup heavy cream"));
        c.add(frame("1 cup heavy cream"));
        c.add(frame("Simmer for 5"));
        c.add(frame("Simmer for 5 minutes")); // caption growing
        c.add(frame("Simmer for 5 minutes"));
        String[] r = c.result();
        assertEquals("Creamy garlic pasta\n2 cups pasta\n4 cloves garlic\n1 cup heavy cream\nSimmer for 5 minutes", r[0]);
        assertFalse(r[0].contains("Follow"));
        assertFalse(r[0].contains("12.3K"));
        assertTrue(r[1].contains("@chefsomebody"));
    }

    @Test
    public void textThereTheWholeTimeIsSetAside() {
        Collector c = new Collector();
        for (int i = 0; i < 10; i++) c.add(Arrays.asList("Best ever banana bread", i < 3 ? "3 ripe bananas" : "Bake 350 for 25 minutes"));
        String[] r = c.result();
        assertEquals("3 ripe bananas\nBake 350 for 25 minutes", r[0]);
        assertEquals("Best ever banana bread", r[1]);
    }

    @Test
    public void ignoresItsOwnBubbleAndOneFrameFlickers() {
        Collector c = new Collector();
        for (int i = 0; i < 9; i++) {
            c.add(Arrays.asList("⏺ Reading · 2 bits so far · tap when done", i == 4 ? "Xq3 ~blur" : i < 4 ? "Add the onions" : "Cook until golden"));
        }
        assertEquals("Add the onions\nCook until golden", c.result()[0]);
    }

    @Test
    public void similar() {
        assertTrue(Collector.similar("4 cloves garlic minced", "4 cioves garlic minced"));
        assertFalse(Collector.similar("1 cup sugar", "1 cup flour"));
    }
}
