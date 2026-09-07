# HearU Android

This module bundles the HearU player as an installed Android app.

- The interface is compiled into the APK and loaded locally with `WebViewAssetLoader`.
- The Android entry renders a full-window app surface, without the website's presentation phone frame or notch.
- Android system bar and keyboard insets keep navigation accessible in portrait and landscape.
- The interface and local file playback are available offline; rooms still require internet.
- Android's system audio picker supports selecting multiple local audio files.
- Shared listening rooms continue to use the existing hosted synchronization service.
- The debug APK produced by the workflow is signed automatically and can be sideloaded for testing.

## Build

Run `npm run build:android` from the repository root before compiling this module. The `Build Android APK` GitHub Actions workflow performs both builds, checks the signature, and tests the installed APK on an Android emulator. Its test checks the layout, both themes, landscape, song selection, and local playback without network access. The downloadable artifact is named `HearU-Android-APK`.

This is a debug-signed sideload build. Earlier builds used a new temporary signing key for each CI run, so Android may require uninstalling the previous testing APK before installing a new one. This removes that installation's saved app state, but does not delete original music files from the device.
