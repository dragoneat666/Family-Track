package com.dragoneat666.familytrack.contacts;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.res.Resources;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds.Email;
import android.provider.ContactsContract.CommonDataKinds.Event;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.provider.ContactsContract.CommonDataKinds.StructuredPostal;
import android.provider.ContactsContract.Data;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "From my phone's contacts" in the contact editor (app/src/contacts/phone.js):
 * the phone's own contact picker opens, and only the one contact picked is
 * read (name, numbers, emails, address, birthday) and handed to the app,
 * with its lookup key. read(key) reads that same contact again, for a
 * contact linked to this phone; it never asks for permission itself.
 * write(...) saves to the phone's contacts when a grown-up asks (see
 * ContactWriter), asking once for permission to change contacts. Nothing is
 * read or written in the background and nothing is sent anywhere from here.
 */
@CapacitorPlugin(
    name = "FamilyContacts",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "write", strings = { Manifest.permission.WRITE_CONTACTS })
    }
)
public class ContactsPlugin extends Plugin {
    private static final String TAG = "FamilyContacts";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "permissionDone");
            return;
        }
        openPicker(call);
    }

    /** That contact again, by its lookup key: { found: false } if it's gone or contacts aren't allowed. */
    @PluginMethod
    public void read(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty() || getPermissionState("contacts") != PermissionState.GRANTED) {
            JSObject none = new JSObject();
            none.put("found", false);
            none.put("allowed", getPermissionState("contacts") == PermissionState.GRANTED);
            call.resolve(none);
            return;
        }
        io.execute(() -> {
            try {
                Uri uri = ContactsContract.Contacts.lookupContact(getContext().getContentResolver(),
                    Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_LOOKUP_URI, key));
                JSObject out;
                if (uri == null) {
                    out = new JSObject();
                    out.put("found", false);
                    out.put("allowed", true);
                } else {
                    out = read(uri);
                    out.put("found", true);
                }
                call.resolve(out);
            } catch (Exception e) {
                Log.w(TAG, "reading a contact again", e);
                call.reject("Couldn't read that contact");
            }
        });
    }

    /**
     * The phone's contact with this number, if there is one: { found, key, name }.
     * Only that number is looked up (to find a family contact on a new or
     * another phone); never asks for permission itself.
     */
    @PluginMethod
    public void findByNumber(PluginCall call) {
        String number = call.getString("number");
        if (number == null || number.trim().isEmpty() || getPermissionState("contacts") != PermissionState.GRANTED) {
            JSObject none = new JSObject();
            none.put("found", false);
            call.resolve(none);
            return;
        }
        io.execute(() -> {
            JSObject out = new JSObject();
            out.put("found", false);
            Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number.trim()));
            String[] cols = { ContactsContract.PhoneLookup.LOOKUP_KEY, ContactsContract.PhoneLookup.DISPLAY_NAME };
            try (Cursor c = getContext().getContentResolver().query(uri, cols, null, null, null)) {
                if (c != null && c.moveToFirst() && c.getString(0) != null) {
                    out.put("found", true);
                    out.put("key", c.getString(0));
                    out.put("name", c.getString(1) == null ? "" : c.getString(1));
                }
            } catch (Exception e) {
                Log.w(TAG, "looking up a number", e);
            }
            call.resolve(out);
        });
    }

    /**
     * Save to the phone's contacts: { key } of a contact on this phone, or
     * { name } for a new one; addPhones, addEmails, and address / birthday to
     * set (left out = as they are). Resolves { key, account }.
     */
    @PluginMethod
    public void write(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED || getPermissionState("write") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[] { "contacts", "write" }, call, "writePermissionDone");
            return;
        }
        doWrite(call);
    }

    @PermissionCallback
    private void writePermissionDone(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED && getPermissionState("write") == PermissionState.GRANTED) doWrite(call);
        else call.reject("Family Track isn't allowed to change this phone's contacts. You can allow it in the phone's settings for the app.", "denied");
    }

    private void doWrite(PluginCall call) {
        io.execute(() -> {
            try {
                ContactWriter.Result r = ContactWriter.write(getContext(), call.getString("key"), call.getString("name"),
                    call.getArray("addPhones"), call.getArray("addEmails"), call.getString("address"), call.getString("birthday"));
                JSObject out = new JSObject();
                out.put("key", r.key == null ? "" : r.key);
                out.put("account", r.account);
                call.resolve(out);
            } catch (Exception e) {
                Log.w(TAG, "writing a contact", e);
                // (Our own messages are IllegalStateExceptions; anything else gets a plain one.)
                call.reject(e instanceof IllegalStateException ? e.getMessage() : "Couldn't save to this phone's contacts");
            }
        });
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) openPicker(call);
        else call.reject("Family Track isn't allowed to see this phone's contacts. You can allow it in the phone's settings for the app.", "denied");
    }

    private void openPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject none = new JSObject();
            none.put("picked", false);
            call.resolve(none);
            return;
        }
        Uri uri = data.getData();
        io.execute(() -> {
            try {
                call.resolve(read(uri));
            } catch (Exception e) {
                Log.w(TAG, "reading the picked contact", e);
                call.reject("Couldn't read that contact");
            }
        });
    }

    private JSObject read(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        Resources res = getContext().getResources();
        long id;
        String name;
        String lookupKey;
        String[] head = { ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME, ContactsContract.Contacts.LOOKUP_KEY };
        try (Cursor c = cr.query(uri, head, null, null, null)) {
            if (c == null || !c.moveToFirst()) throw new IllegalStateException("contact gone");
            id = c.getLong(0);
            name = c.getString(1);
            lookupKey = c.getString(2);
        }

        JSArray phones = new JSArray();
        JSArray emails = new JSArray();
        String address = "";
        String birthday = "";
        String[] cols = { Data.MIMETYPE, Data.DATA1, Data.DATA2, Data.DATA3 };
        String order = Data.IS_SUPER_PRIMARY + " DESC, " + Data.IS_PRIMARY + " DESC";
        try (Cursor c = cr.query(Data.CONTENT_URI, cols, Data.CONTACT_ID + " = ?", new String[] { String.valueOf(id) }, order)) {
            while (c != null && c.moveToNext()) {
                String mime = c.getString(0);
                String value = c.getString(1);
                if (value == null || value.trim().isEmpty()) continue;
                int type = c.isNull(2) ? 0 : c.getInt(2);
                String custom = c.getString(3);
                if (Phone.CONTENT_ITEM_TYPE.equals(mime)) {
                    JSObject p = new JSObject();
                    p.put("label", String.valueOf(Phone.getTypeLabel(res, type, custom)));
                    p.put("number", value.trim());
                    phones.put(p);
                } else if (Email.CONTENT_ITEM_TYPE.equals(mime)) {
                    JSObject e = new JSObject();
                    e.put("label", String.valueOf(Email.getTypeLabel(res, type, custom)));
                    e.put("address", value.trim());
                    emails.put(e);
                } else if (StructuredPostal.CONTENT_ITEM_TYPE.equals(mime) && address.isEmpty()) {
                    address = value.trim();
                } else if (Event.CONTENT_ITEM_TYPE.equals(mime) && type == Event.TYPE_BIRTHDAY && birthday.isEmpty()) {
                    birthday = value.trim(); // "1956-03-04" or "--03-04", worked out in the app
                }
            }
        }

        JSObject out = new JSObject();
        out.put("picked", true);
        out.put("name", name == null ? "" : name);
        out.put("key", lookupKey == null ? "" : lookupKey);
        out.put("phones", phones);
        out.put("emails", emails);
        out.put("address", address);
        out.put("birthday", birthday);
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
    }
}
