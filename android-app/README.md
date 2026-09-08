# HearU Android

This module bundles the HearU player as an installed Android app.

- The interface is compiled into the APK and loaded locally with `WebViewAssetLoader`.
- The Android entry renders a full-window app surface, without the website's presentation phone frame or notch.
- Android system bar and keyboard insets keep navigation accessible in portrait and landscape.
- The interface and local file playback are available offline; rooms still require internet.
- Android's system audio picker supports selecting multiple local audio files.
- Shared listening rooms continue to use the existing hosted synchronization service.
- Profile → Continue with Google opens Android Credential Manager for sign-up or sign-in. The server verifies Google's ID token, audience, issuer, expiry, verified email and a session-bound nonce before issuing an app session.
- Local listening remains available without an account. Signing out clears the app session and Credential Manager state, without opening a website layout.
- The debug APK produced by the workflow is signed automatically and can be sideloaded for testing.

## Build

Run `npm run build:android` from the repository root before compiling this module. The `Build Android APK` GitHub Actions workflow performs both builds, checks the signature, and tests the installed APK on an Android emulator. Its test checks the layout, both themes, landscape, song selection, and local playback without network access. The downloadable artifact is named `HearU-Android-APK`.

Version 1.3 and later use a fixed, private signing key held in GitHub Actions encrypted secrets (`HEARU_KEYSTORE_BASE64`, `HEARU_KEYSTORE_PASSWORD`). The key and password must never be committed. CI fails if they are unavailable. The local encrypted backup belongs to the project owner and is not part of this repository.

This is a debug-mode sideload build, not a Play Store release. Versions before 1.3 used temporary signing keys, so uninstall the older APK once before installing 1.3. This resets HearU's saved app state but does not delete original music files. Subsequent builds signed with the fixed key can be installed as updates.

## Google OAuth registration

In the same Google Cloud project as the existing Web OAuth client, create an Android OAuth client with:

- Package: `com.akshaey.hearu`
- SHA-1: `13:EF:8E:89:5D:C3:3C:B8:44:06:20:53:00:C8:17:5A:7E:D8:C7:1B`
- The existing Web client ID remains the server audience and native request's server client ID. Never use an OAuth client secret in the APK.

Google Play services and an internet connection are needed for Google sign-in. Local builds using a different signing key require their own Android OAuth registration. The bundled Google icon is Google's official asset from https://developers.google.com/identity/branding-guidelines.
