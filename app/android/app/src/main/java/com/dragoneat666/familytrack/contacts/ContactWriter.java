package com.dragoneat666.familytrack.contacts;

import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Email;
import android.provider.ContactsContract.CommonDataKinds.Event;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredName;
import android.provider.ContactsContract.CommonDataKinds.StructuredPostal;
import android.provider.ContactsContract.Contacts;
import android.provider.ContactsContract.Data;
import android.provider.ContactsContract.RawContacts;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Writes to the phone's contacts, only when a grown-up asks (Save to my
 * phone / Add to my phone's contacts / Check with my phone). It adds numbers
 * and emails, and sets the address and birthday; it never deletes anything
 * and never changes a name. Changes go into the contact's Google account
 * when it has one, so they reach Google Contacts the usual way.
 */
final class ContactWriter {
    private static final String GOOGLE = "com.google";

    private ContactWriter() {}

    /** What was written: { key: the contact's lookup key, account: the account it's in ("" = this phone only) }. */
    static final class Result {
        final String key;
        final String account;

        Result(String key, String account) {
            this.key = key;
            this.account = account;
        }
    }

    /**
     * key: an existing contact (null = make a new one called name).
     * address / birthday: null = leave as they are. birthday is "1956-03-04" or "--03-04".
     */
    static Result write(Context ctx, String key, String name, JSONArray addPhones, JSONArray addEmails,
                        String address, String birthday) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        long rawId = -1;
        String account = "";
        long contactId = -1;

        if (key != null && !key.isEmpty()) {
            Uri uri = Contacts.lookupContact(cr, Uri.withAppendedPath(Contacts.CONTENT_LOOKUP_URI, key));
            if (uri == null) throw new IllegalStateException("That contact isn't on this phone any more");
            contactId = ContentUris.parseId(uri);
            // Add to its Google part if it has one (a contact can be several accounts' entries joined together).
            String pickedType = null;
            String[] cols = { RawContacts._ID, RawContacts.ACCOUNT_TYPE, RawContacts.ACCOUNT_NAME };
            try (Cursor c = cr.query(RawContacts.CONTENT_URI, cols, RawContacts.CONTACT_ID + " = ? AND " + RawContacts.DELETED + " = 0",
                    new String[] { String.valueOf(contactId) }, null)) {
                while (c != null && c.moveToNext()) {
                    String type = c.getString(1);
                    if (rawId < 0 || (GOOGLE.equals(type) && !GOOGLE.equals(pickedType))) {
                        rawId = c.getLong(0);
                        pickedType = type;
                        account = c.getString(2) == null ? "" : c.getString(2);
                    }
                }
            }
            if (rawId < 0) throw new IllegalStateException("That contact can't be changed");
        } else {
            String[] acct = defaultAccount(cr);
            ops.add(ContentProviderOperation.newInsert(RawContacts.CONTENT_URI)
                .withValue(RawContacts.ACCOUNT_TYPE, acct[0])
                .withValue(RawContacts.ACCOUNT_NAME, acct[1])
                .build());
            account = acct[1] == null ? "" : acct[1];
            ops.add(data(rawId).withValue(Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                .withValue(StructuredName.DISPLAY_NAME, name == null ? "" : name)
                .build());
        }

        for (int i = 0; addPhones != null && i < addPhones.length(); i++) {
            JSONObject p = addPhones.getJSONObject(i);
            String label = p.optString("label", "");
            int type = phoneType(label);
            ContentProviderOperation.Builder b = data(rawId).withValue(Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                .withValue(Phone.NUMBER, p.optString("number", "")).withValue(Phone.TYPE, type);
            if (type == Phone.TYPE_CUSTOM) b.withValue(Phone.LABEL, label);
            ops.add(b.build());
        }
        for (int i = 0; addEmails != null && i < addEmails.length(); i++) {
            JSONObject e = addEmails.getJSONObject(i);
            String label = e.optString("label", "");
            int type = emailType(label);
            ContentProviderOperation.Builder b = data(rawId).withValue(Data.MIMETYPE, Email.CONTENT_ITEM_TYPE)
                .withValue(Email.ADDRESS, e.optString("address", "")).withValue(Email.TYPE, type);
            if (type == Email.TYPE_CUSTOM) b.withValue(Email.LABEL, label);
            ops.add(b.build());
        }

        // The address and birthday the contact already has (to change rather than add a second one).
        long addressRow = -1;
        ArrayList<Long> birthdayRows = new ArrayList<>();
        if (contactId >= 0) {
            String[] cols = { Data._ID, Data.MIMETYPE, Data.DATA2 };
            String order = Data.IS_SUPER_PRIMARY + " DESC, " + Data.IS_PRIMARY + " DESC";
            try (Cursor c = cr.query(Data.CONTENT_URI, cols, Data.CONTACT_ID + " = ?", new String[] { String.valueOf(contactId) }, order)) {
                while (c != null && c.moveToNext()) {
                    String mime = c.getString(1);
                    if (StructuredPostal.CONTENT_ITEM_TYPE.equals(mime) && addressRow < 0) addressRow = c.getLong(0);
                    if (Event.CONTENT_ITEM_TYPE.equals(mime) && !c.isNull(2) && c.getInt(2) == Event.TYPE_BIRTHDAY) birthdayRows.add(c.getLong(0));
                }
            }
        }
        if (address != null && !address.isEmpty()) {
            if (addressRow >= 0) {
                ops.add(ContentProviderOperation.newUpdate(Data.CONTENT_URI)
                    .withSelection(Data._ID + " = ?", new String[] { String.valueOf(addressRow) })
                    .withValue(StructuredPostal.FORMATTED_ADDRESS, address)
                    .withValue(StructuredPostal.STREET, address)
                    .withValue(StructuredPostal.POBOX, null).withValue(StructuredPostal.NEIGHBORHOOD, null)
                    .withValue(StructuredPostal.CITY, null).withValue(StructuredPostal.REGION, null)
                    .withValue(StructuredPostal.POSTCODE, null).withValue(StructuredPostal.COUNTRY, null)
                    .build());
            } else {
                ops.add(data(rawId).withValue(Data.MIMETYPE, StructuredPostal.CONTENT_ITEM_TYPE)
                    .withValue(StructuredPostal.FORMATTED_ADDRESS, address)
                    .withValue(StructuredPostal.STREET, address)
                    .withValue(StructuredPostal.TYPE, StructuredPostal.TYPE_HOME)
                    .build());
            }
        }
        if (birthday != null && !birthday.isEmpty()) {
            if (!birthdayRows.isEmpty()) {
                for (long row : birthdayRows) {
                    ops.add(ContentProviderOperation.newUpdate(Data.CONTENT_URI)
                        .withSelection(Data._ID + " = ?", new String[] { String.valueOf(row) })
                        .withValue(Event.START_DATE, birthday)
                        .build());
                }
            } else {
                ops.add(data(rawId).withValue(Data.MIMETYPE, Event.CONTENT_ITEM_TYPE)
                    .withValue(Event.START_DATE, birthday).withValue(Event.TYPE, Event.TYPE_BIRTHDAY)
                    .build());
            }
        }

        if (ops.isEmpty()) return new Result(key, account);
        ContentProviderResult[] done = cr.applyBatch(ContactsContract.AUTHORITY, ops);
        if (key != null && !key.isEmpty()) return new Result(key, account);
        return new Result(lookupKeyOf(cr, ContentUris.parseId(done[0].uri)), account);
    }

    /** A row for the raw contact rawId, or (rawId < 0) for the one inserted first in this batch. */
    private static ContentProviderOperation.Builder data(long rawId) {
        ContentProviderOperation.Builder b = ContentProviderOperation.newInsert(Data.CONTENT_URI);
        return rawId >= 0 ? b.withValue(Data.RAW_CONTACT_ID, rawId) : b.withValueBackReference(Data.RAW_CONTACT_ID, 0);
    }

    /** The Google account with the most contacts on this phone, else none (kept on this phone only). */
    private static String[] defaultAccount(ContentResolver cr) {
        Map<String, Integer> counts = new HashMap<>();
        String[] cols = { RawContacts.ACCOUNT_NAME };
        try (Cursor c = cr.query(RawContacts.CONTENT_URI, cols, RawContacts.ACCOUNT_TYPE + " = ? AND " + RawContacts.DELETED + " = 0",
                new String[] { GOOGLE }, null)) {
            while (c != null && c.moveToNext()) {
                String n = c.getString(0);
                if (n != null) counts.merge(n, 1, Integer::sum);
            }
        }
        String best = null;
        int most = 0;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() > most) {
                best = e.getKey();
                most = e.getValue();
            }
        }
        return best == null ? new String[] { null, null } : new String[] { GOOGLE, best };
    }

    /** The lookup key of the contact a new raw contact joined (Android may take a moment to join it). */
    private static String lookupKeyOf(ContentResolver cr, long rawId) throws InterruptedException {
        for (int attempt = 0; attempt < 10; attempt++) {
            try (Cursor c = cr.query(RawContacts.CONTENT_URI, new String[] { RawContacts.CONTACT_ID }, RawContacts._ID + " = ?",
                    new String[] { String.valueOf(rawId) }, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) {
                    long contactId = c.getLong(0);
                    try (Cursor k = cr.query(ContentUris.withAppendedId(Contacts.CONTENT_URI, contactId),
                            new String[] { Contacts.LOOKUP_KEY }, null, null, null)) {
                        if (k != null && k.moveToFirst() && k.getString(0) != null) return k.getString(0);
                    }
                }
            }
            Thread.sleep(200);
        }
        return "";
    }

    static int phoneType(String label) {
        switch (label.toLowerCase()) {
            case "mobile": return Phone.TYPE_MOBILE;
            case "home": return Phone.TYPE_HOME;
            case "work": return Phone.TYPE_WORK;
            case "other": case "": return Phone.TYPE_OTHER;
            default: return Phone.TYPE_CUSTOM;
        }
    }

    static int emailType(String label) {
        switch (label.toLowerCase()) {
            case "home": return Email.TYPE_HOME;
            case "work": return Email.TYPE_WORK;
            case "other": case "": return Email.TYPE_OTHER;
            default: return Email.TYPE_CUSTOM;
        }
    }
}
