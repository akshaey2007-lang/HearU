package com.akshaey.hearu;

import android.app.Activity;
import android.net.Uri;
import android.os.CancellationSignal;
import android.webkit.WebView;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;
import java.util.Collections;
import java.util.concurrent.Executor;

/** Only the bundled top-level app can open Google's native account picker. */
final class GoogleAuthBridge {
    private static final String ORIGIN = "https://akshaey2007-lang.github.io";
    private static final String CLIENT_ID = "922402174418-9vcvmgb1u6al78delh4u9j482ulrtqc2.apps.googleusercontent.com";
    private final Activity activity;
    private final WebView webView;
    private final CredentialManager manager;
    private final Executor main;
    private CancellationSignal pending;
    private boolean destroyed;

    GoogleAuthBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.manager = CredentialManager.create(activity);
        this.main = activity::runOnUiThread;
    }

    static boolean trustedPage(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && "akshaey2007-lang.github.io".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && "/HearU/_android/android.html".equals(uri.getPath());
    }

    void install() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(webView, "HearUNative", Collections.singleton(ORIGIN),
                (view, message, origin, isMainFrame, reply) -> {
            if (!isMainFrame || !ORIGIN.equals(origin.toString()) || !trustedPage(view.getUrl())) return;
            String id = "";
            try {
                String raw = message.getData();
                if (raw == null || raw.length() > 2048) return;
                JSONObject request = new JSONObject(raw);
                id = request.optString("id");
                if (!id.matches("[a-zA-Z0-9-]{1,80}")) return;
                String action = request.optString("action");
                if ("signIn".equals(action)) {
                    String nonce = request.optString("nonce");
                    if (!nonce.matches("[a-f0-9]{64}")) {
                        respond(reply, id, null, "Invalid sign-in challenge. Please try again.");
                    } else signIn(reply, id, nonce);
                } else if ("signOut".equals(action)) signOut(reply, id);
                else if ("cancel".equals(action)) {
                    if (pending != null) pending.cancel();
                    respond(reply, id, null, null);
                } else respond(reply, id, null, "Unsupported account action.");
            } catch (Exception exception) {
                respond(reply, id, null, "Google sign-in could not start. Please try again.");
            }
        });
    }

    private void signIn(JavaScriptReplyProxy reply, String id, String nonce) {
        if (pending != null) {
            respond(reply, id, null, "A Google sign-in is already open.");
            return;
        }
        CancellationSignal signal = new CancellationSignal();
        pending = signal;
        try {
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(CLIENT_ID).setNonce(nonce).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
            manager.getCredentialAsync(activity, request, signal, main,
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override public void onResult(GetCredentialResponse result) {
                    if (pending == signal) pending = null;
                    try {
                        Credential credential = result.getCredential();
                        if (!(credential instanceof CustomCredential)
                                || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                            throw new IllegalArgumentException("Unexpected credential type");
                        }
                        String token = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                        respond(reply, id, token, null);
                    } catch (Exception exception) {
                        respond(reply, id, null, "Google returned an unreadable account. Please try again.");
                    }
                }
                @Override public void onError(GetCredentialException error) {
                    if (pending == signal) pending = null;
                    String text = error instanceof GetCredentialCancellationException ? "Sign-in cancelled."
                            : error instanceof NoCredentialException ? "Add a Google account in Android Settings, then try again."
                            : "Google sign-in is unavailable. Check your connection and Google Play services. If it continues, contact HearU support.";
                    respond(reply, id, null, text);
                }
            });
        } catch (Exception exception) {
            pending = null;
            respond(reply, id, null, "Google sign-in could not start. Update Google Play services and try again.");
        }
    }

    private void signOut(JavaScriptReplyProxy reply, String id) {
        if (pending != null) pending.cancel();
        manager.clearCredentialStateAsync(new ClearCredentialStateRequest(), null, main,
                new CredentialManagerCallback<Void, ClearCredentialException>() {
            @Override public void onResult(Void unused) { respond(reply, id, null, null); }
            // Local sign-out must still work when the Google provider is offline.
            @Override public void onError(ClearCredentialException error) { respond(reply, id, null, null); }
        });
    }

    private void respond(JavaScriptReplyProxy reply, String id, String token, String error) {
        if (destroyed || !trustedPage(webView.getUrl())) return;
        try {
            JSONObject result = new JSONObject().put("id", id);
            if (token != null) result.put("credential", token);
            if (error != null) result.put("error", error);
            reply.postMessage(result.toString());
        } catch (Exception ignored) { /* The app may have closed during sign-in. */ }
    }

    void destroy() {
        destroyed = true;
        if (pending != null) pending.cancel();
    }
}
