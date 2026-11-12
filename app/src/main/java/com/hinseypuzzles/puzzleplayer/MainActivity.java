package com.hinseypuzzles.puzzleplayer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Hosts the puzzle library and solver, which are written in HTML/JS and live
 * in assets/www. This class only supplies what a web page cannot do itself:
 * the system file picker, durable storage, window insets and the back button.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final int LIGHT_BACKGROUND = 0xFFE9EEF4;
    private static final int DARK_BACKGROUND = 0xFF1C2027;
    static final int REQUEST_PICK_PUZZLES = 41;

    private WebView webView;
    private PuzzleBridge bridge;
    private OnBackInvokedCallback backCallback;

    /** Last known insets, in CSS pixels: top, right, bottom, left, keyboard. */
    private final float[] insets = new float[5];
    private boolean pageLoaded = false;
    /** Files handed over by another app before the page had loaded. */
    private List<Uri> pendingIncoming = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Phones solve in portrait only: in landscape the keyboard leaves no
        // room for the grid. Tablets have the height to spare either way.
        if (getResources().getConfiguration().smallestScreenWidthDp < 600) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }

        setUpEdgeToEdge();

        // Debug builds can be inspected from desktop Chrome (chrome://inspect),
        // which the emulator test in CI also uses.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHapticFeedbackEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // The solver lays itself out to the screen; system font scaling would
        // only push the keyboard off the bottom.
        settings.setTextZoom(100);
        // The WebView otherwise draws no text below 8px, which blew grid
        // numbers up on small squares (a 21x21 grid on a phone) until they
        // crowded the letters. Sizes are left to the CSS (css/app.css).
        settings.setMinimumFontSize(1);
        settings.setMinimumLogicalFontSize(1);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        bridge = new PuzzleBridge(this, webView);
        webView.addJavascriptInterface(bridge, "AndroidBridge");
        // Paint the right background before the page has loaded, so a
        // dark-mode launch doesn't flash light.
        applyBackground(savedThemeIsDark());
        applySplashTheme(savedTheme());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) {
                    return false;
                }
                // Links in puzzle notes open in the browser, not in the app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                pushInsets();
                if (pendingIncoming != null) {
                    bridge.deliverPickedFiles(pendingIncoming, true);
                    pendingIncoming = null;
                }
            }
        });

        // The solver asks before clearing or resetting with window.confirm(),
        // which a WebView only shows if the app supplies the dialog.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (isFinishing()) return false;
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                if (isFinishing()) return false;
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });

        webView.setOnApplyWindowInsetsListener((v, windowInsets) -> {
            readInsets(windowInsets);
            pushInsets();
            return windowInsets;
        });

        setContentView(webView);
        // Only once the window has its content: before that it has no decor
        // view, and the insets controller call below crashes on Android 11+.
        setBarAppearance(false, true);
        webView.loadUrl(START_URL);

        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::dispatchBackToPage;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }

        // Opened from another app with a file. Not when Android is recreating
        // the activity or reopening it from Recents, which replays the
        // original intent: that file was dealt with the first time.
        Intent intent = getIntent();
        if (savedInstanceState == null && intent != null
                && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            handleIncomingFiles(intent);
        }
    }

    /** "Open with" or "Share" while the app is already running. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingFiles(intent);
    }

    /**
     * Imports the files another app sent (a tapped email attachment, a file
     * in a file manager, or a Share) and opens the puzzle.
     */
    private void handleIncomingFiles(Intent intent) {
        List<Uri> uris = incomingUris(intent);
        if (uris.isEmpty()) return;
        if (pageLoaded) {
            bridge.deliverPickedFiles(uris, true);
        } else {
            pendingIncoming = uris;
        }
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> incomingUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            List<Uri> list = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) {
                for (Uri uri : list) if (uri != null) uris.add(uri);
            }
        }
        return uris;
    }

    boolean isSystemNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The appearance setting saved by the page (js/settings.js). */
    /** The appearance setting: "light", "dark" or "system". */
    private String savedTheme() {
        try {
            String json = bridge.read("settings.json");
            // Matches js/settings.js: no choice yet means follow the phone.
            return json == null ? "system" : new JSONObject(json).optString("theme", "system");
        } catch (Exception e) {
            return "system";
        }
    }

    private boolean savedThemeIsDark() {
        String theme = savedTheme();
        return "dark".equals(theme) || ("system".equals(theme) && isSystemNight());
    }

    /**
     * Android draws its launch screen before the app runs, from a theme. On
     * Android 13+ the app can say which theme to use next time, so a light or
     * dark choice made in Settings applies there too. "system" (and older
     * Android versions) use AppTheme, which follows the phone's dark mode.
     */
    void applySplashTheme(String theme) {
        if (Build.VERSION.SDK_INT < 33) return;
        int style = "dark".equals(theme) ? R.style.SplashDark
                : "light".equals(theme) ? R.style.SplashLight
                : android.content.res.Resources.ID_NULL;
        try {
            getSplashScreen().setSplashScreenTheme(style);
        } catch (Exception ignored) {
            // Cosmetic only.
        }
    }

    void applyBackground(boolean dark) {
        int color = dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
        getWindow().getDecorView().setBackgroundColor(color);
        if (webView != null) webView.setBackgroundColor(color);
    }

    /** The phone switched between light and dark while the app was open. */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView != null && pageLoaded) {
            webView.evaluateJavascript("window.Settings && Settings.setSystemDark(" + isSystemNight() + ")", null);
        }
    }

    private void setUpEdgeToEdge() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /**
     * @param darkStatusIcons dark icons for a light status bar background
     * @param darkNavIcons    dark icons for a light navigation bar background
     */
    @SuppressWarnings("deprecation")
    void setBarAppearance(boolean darkStatusIcons, boolean darkNavIcons) {
        Window window = getWindow();
        if (window.peekDecorView() == null) return;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int appearance = 0;
            if (darkStatusIcons) appearance |= WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
            if (darkNavIcons) appearance |= WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(appearance,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = darkStatusIcons
                    ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            flags = darkNavIcons
                    ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                    : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets windowInsets) {
        float density = getResources().getDisplayMetrics().density;
        int top, right, bottom, left, ime = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            top = bars.top;
            right = bars.right;
            bottom = bars.bottom;
            left = bars.left;
            ime = windowInsets.getInsets(WindowInsets.Type.ime()).bottom;
        } else {
            // Before API 30 the bottom inset already includes the keyboard.
            top = windowInsets.getSystemWindowInsetTop();
            right = windowInsets.getSystemWindowInsetRight();
            bottom = windowInsets.getSystemWindowInsetBottom();
            left = windowInsets.getSystemWindowInsetLeft();
        }
        insets[0] = top / density;
        insets[1] = right / density;
        insets[2] = bottom / density;
        insets[3] = left / density;
        insets[4] = ime / density;
    }

    String insetsJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("top", insets[0]);
            o.put("right", insets[1]);
            o.put("bottom", insets[2]);
            o.put("left", insets[3]);
            o.put("ime", insets[4]);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private void pushInsets() {
        if (!pageLoaded || webView == null) return;
        webView.evaluateJavascript(
                "window.App && App.setInsets(" + insetsJson() + ")", null);
    }

    /** Lets the page close a dialog, leave the solver or go up a folder first. */
    private void dispatchBackToPage() {
        if (webView == null || !pageLoaded) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript("window.App ? App.handleBack() : false", value -> {
            if (!"true".equals(value)) {
                moveTaskToBack(true);
            }
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Only reached below API 33; newer versions use the callback above.
        dispatchBackToPage();
    }

    void openFilePicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // .puz, .ipuz and .jpz have no dependable MIME types, so offer
        // everything and sort the files out by content after they are picked.
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(intent, REQUEST_PICK_PUZZLES);
        } catch (ActivityNotFoundException e) {
            bridge.deliverPickedFiles(new ArrayList<>(), false);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PICK_PUZZLES) return;

        List<Uri> uris = new ArrayList<>();
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri != null) uris.add(uri);
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        bridge.deliverPickedFiles(uris, false);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null && pageLoaded) {
            // Stops the timer and flushes progress before the app can be killed.
            webView.evaluateJavascript("window.App && App.onAppPause()", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (bridge != null) bridge.shutdown();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
