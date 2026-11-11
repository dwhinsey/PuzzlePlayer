package com.hinseypuzzles.puzzleplayer;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * The page's window.AndroidBridge. Methods annotated @JavascriptInterface run
 * on the WebView's own background thread, not the UI thread.
 *
 * Storage is a flat directory of small files under the app's private files
 * directory: library.json plus one parsed-puzzle file and one progress file
 * per puzzle. It survives restarts and is removed only when the app is.
 */
public class PuzzleBridge {

    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,120}");
    private static final long MAX_PUZZLE_BYTES = 8L * 1024 * 1024;

    private final MainActivity activity;
    private final WebView webView;
    private final File dataDir;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    PuzzleBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.dataDir = new File(activity.getFilesDir(), "data");
        //noinspection ResultOfMethodCallIgnored
        dataDir.mkdirs();
    }

    void shutdown() {
        io.shutdown();
    }

    private File fileFor(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches() || name.contains("..")) {
            throw new IllegalArgumentException("Bad storage name: " + name);
        }
        return new File(dataDir, name);
    }

    // ----- Storage -----

    @JavascriptInterface
    public String read(String name) {
        try {
            File f = fileFor(name);
            if (!f.exists()) return null;
            return new String(readAll(new FileInputStream(f), Long.MAX_VALUE), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean write(String name, String content) {
        File target;
        try {
            target = fileFor(name);
        } catch (IllegalArgumentException e) {
            return false;
        }
        // Write a temporary file and rename it over the old one, so a crash
        // mid-write never leaves a half-written library or progress file.
        File tmp = new File(dataDir, name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        }
        return tmp.renameTo(target);
    }

    @JavascriptInterface
    public boolean remove(String name) {
        try {
            File f = fileFor(name);
            return !f.exists() || f.delete();
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    // ----- Window -----

    @JavascriptInterface
    public String getInsets() {
        return activity.insetsJson();
    }

    @JavascriptInterface
    public void setBarStyle(boolean darkStatusIcons, boolean darkNavIcons) {
        activity.runOnUiThread(() -> activity.setBarAppearance(darkStatusIcons, darkNavIcons));
    }

    // ----- File picking -----

    @JavascriptInterface
    public void pickFiles() {
        activity.runOnUiThread(activity::openFilePicker);
    }

    /** Reads the picked files off the UI thread and hands them to the page. */
    void deliverPickedFiles(List<Uri> uris) {
        io.execute(() -> {
            JSONArray result = new JSONArray();
            ContentResolver resolver = activity.getContentResolver();
            for (Uri uri : uris) {
                JSONObject item = new JSONObject();
                try {
                    item.put("name", displayName(resolver, uri));
                    try (InputStream in = resolver.openInputStream(uri)) {
                        if (in == null) throw new IOException("Could not open file");
                        byte[] bytes = readAll(in, MAX_PUZZLE_BYTES);
                        item.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    }
                } catch (Exception e) {
                    try {
                        item.put("error", e.getMessage() == null ? "Could not read file" : e.getMessage());
                    } catch (Exception ignored) {
                    }
                }
                result.put(item);
            }
            String js = "window.App && App.onFilesPicked(" + JSONObject.quote(result.toString()) + ")";
            activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
        });
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor c = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null) return name;
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "puzzle" : last;
    }

    private static byte[] readAll(InputStream in, long limit) throws IOException {
        try (InputStream input = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            long total = 0;
            int n;
            while ((n = input.read(buf)) != -1) {
                total += n;
                if (total > limit) throw new IOException("File is too large to be a puzzle");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }
}
