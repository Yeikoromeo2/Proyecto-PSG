package io.github.yeikoromeo2.psg;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Ventana para jugar a PokéSurvivor con el motor de Chrome del sistema (Android System WebView)
 * y el ayudante PSG dentro.
 *
 * Abre la web oficial tal cual, con su propio inicio de sesión y sus guardados en la nube: la app
 * no cambia nada del juego. Sólo añade pantalla completa en horizontal, pantalla siempre
 * encendida, prioridad alta para el motor del juego y el ayudante (assets/pokesurvivor-ayudante.user.js),
 * que se mete al empezar a cargar cada página del juego, antes que el propio juego, como hace
 * Violentmonkey con «document-start».
 *
 * Dos modos (se recuerda el último):
 *   - ayudante: el juego en una WebView con el ayudante. El botón de Google del juego no funciona
 *     aquí (Google no permite su inicio de sesión dentro de ventanas integradas).
 *   - Google: el juego se abre con Chrome dentro de la app (Custom Tab), donde Google sí funciona
 *     y la sesión se queda guardada en Chrome. En este modo no se puede meter el ayudante.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://pokesurvivor.com/";
    private static final String HELPER = "pokesurvivor-ayudante.user.js";

    private static final String PREFS = "psg", KEY_MODE = "mode", MODE_HELPER = "ayudante", MODE_GOOGLE = "google";

    private WebView web;
    private String helperJs = "";
    private boolean helperAtStart = false;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (MODE_GOOGLE.equals(prefs.getString(KEY_MODE, MODE_HELPER))) {
            showGoogleScreen();
            if (state == null) openGoogleTab();              // al abrir la app, directo al juego
        } else {
            startHelperMode();
        }
        immersive();
    }

    // ---------------------------------------------------------------- modo ayudante (WebView)

    @SuppressLint("SetJavaScriptEnabled")
    private void startHelperMode() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // La WebView va dentro de un marco que deja libre la cámara/muesca de la pantalla.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // El proceso que dibuja el juego, con prioridad alta: menos riesgo de que Android lo frene o lo cierre.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.setOnApplyWindowInsetsListener(this::applyInsets);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // partida local, ajustes del juego y del ayudante
        s.setMediaPlaybackRequiresUserGesture(false);    // la música y los efectos suenan sin tocar antes
        s.setTextZoom(100);                              // el tamaño de letra del sistema no descoloca el juego
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        // Sin menú de «copiar» al dejar el dedo quieto (el joystick y los ataques se mantienen pulsados).
        web.setOnLongClickListener(v -> true);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);

        helperJs = readAsset(HELPER);
        if (!helperJs.isEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Set<String> origins = new HashSet<>();
            origins.add("https://pokesurvivor.com");
            origins.add("https://www.pokesurvivor.com");
            WebViewCompat.addDocumentStartJavaScript(web, helperJs, origins);
            helperAtStart = true;
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isGame(u) || !req.isForMainFrame()) return false;
                if (isGoogleLogin(u)) {
                    googleLoginNotice();
                    return true;
                }
                openOutside(u);                          // YouTube, Discord, etc.: en su app o en el navegador
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // WebView muy antiguo, sin «document-start»: se mete lo antes posible.
                if (!helperAtStart && !helperJs.isEmpty() && isGame(Uri.parse(url))) {
                    view.evaluateJavascript(helperJs, null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        web.loadUrl(HOME);
    }

    // ---------------------------------------------------------------- modo Google (Chrome en la app)

    /** Pantalla de la app en modo Google: se ve al cerrar el juego (botón «atrás» o la ✕ de arriba). */
    private void showGoogleScreen() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.rgb(0x10, 0x18, 0x30));
        int pad = dp(24);
        box.setPadding(pad, pad, pad, pad);
        box.addView(label(getString(R.string.app_name), 26, true));
        box.addView(label(getString(R.string.google_mode_info), 15, false));
        box.addView(button(getString(R.string.google_play), v -> openGoogleTab()));
        box.addView(button(getString(R.string.firefox_open), v -> openInFirefox()));
        box.addView(button(getString(R.string.google_switch), v -> switchToHelper()));
        setContentView(box);
        box.setOnApplyWindowInsetsListener(this::applyInsets);
    }

    /** El juego con Chrome dentro de la app: ahí el inicio con Google funciona y la sesión se guarda. */
    private void openGoogleTab() {
        CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(Color.rgb(0x10, 0x18, 0x30))
                .build();
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(false)
                .setUrlBarHidingEnabled(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                .build();
        try {
            tab.launchUrl(this, Uri.parse(HOME));
        } catch (ActivityNotFoundException e) {
            openOutside(Uri.parse(HOME));
        }
    }

    private void switchToGoogle() {
        prefs.edit().putString(KEY_MODE, MODE_GOOGLE).apply();
        if (web != null) {
            web.destroy();
            web = null;
        }
        showGoogleScreen();
        openGoogleTab();
    }

    private void switchToHelper() {
        prefs.edit().putString(KEY_MODE, MODE_HELPER).apply();
        startHelperMode();
        immersive();
    }

    private TextView label(String text, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(sp);
        t.setTextColor(Color.WHITE);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, 0, 0, dp(16));
        return t;
    }

    private Button button(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ---------------------------------------------------------------- navegación

    private static boolean isGame(Uri u) {
        if (u == null || !"https".equals(u.getScheme())) return false;
        String h = u.getHost();
        return "pokesurvivor.com".equals(h) || "www.pokesurvivor.com".equals(h);
    }

    /** El botón de Google del juego: Google no lo permite dentro de una app (sí en el navegador). */
    private static boolean isGoogleLogin(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost();
        String p = u.getPath() == null ? "" : u.getPath();
        return "accounts.google.com".equals(h) || (h.endsWith(".firebaseapp.com") && p.startsWith("/__/auth/"));
    }

    /**
     * Se ha tocado «Iniciar con Google» en el modo ayudante. Google no deja entrar aquí; se ofrece:
     * abrir el juego en Firefox (Google + ayudante con Violentmonkey) o el modo Google (sin ayudante).
     */
    private void googleLoginNotice() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.google_title)
                .setMessage(R.string.google_text)
                .setPositiveButton(R.string.firefox_open, (d, w) -> openInFirefox())
                .setNeutralButton(R.string.google_use, (d, w) -> switchToGoogle())
                .setNegativeButton(R.string.close, null)
                .show();
    }

    /** Firefox para Android (normal, beta o nightly); si no está, su página en la Play Store. */
    private void openInFirefox() {
        String[] firefox = {"org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix"};
        for (String pkg : firefox) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(HOME)).setPackage(pkg));
                return;
            } catch (ActivityNotFoundException e) {
                // no está instalado: se prueba el siguiente
            }
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=org.mozilla.firefox")));
        } catch (ActivityNotFoundException e) {
            openOutside(Uri.parse("https://play.google.com/store/apps/details?id=org.mozilla.firefox"));
        }
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            // Nada que lo abra: se ignora.
        }
    }

    // ---------------------------------------------------------------- pantalla

    /** Deja libre la muesca de la cámara y, al escribir (inicio de sesión), el teclado. */
    private WindowInsets applyInsets(View v, WindowInsets insets) {
        int l = 0, t = 0, r = 0, b = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {      // la muesca existe desde Android 9
            DisplayCutout dc = insets.getDisplayCutout();
            if (dc != null) {
                l = dc.getSafeInsetLeft();
                t = dc.getSafeInsetTop();
                r = dc.getSafeInsetRight();
                b = dc.getSafeInsetBottom();
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            b = Math.max(b, insets.getInsets(WindowInsets.Type.ime()).bottom);
        }
        v.setPadding(l, t, r, b);
        return insets;
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    // ---------------------------------------------------------------- ciclo de vida

    @Override
    protected void onPause() {
        super.onPause();
        // Como una pestaña en segundo plano: el juego se pausa solo (no se paran los temporizadores
        // para no cortar el cooperativo si sales un momento).
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        immersive();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** «Atrás» va al juego (que pausa la partida o vuelve al menú); fuera del juego, sale. */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------------------------------------------------------------- utilidades

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return "";
        }
    }
}
