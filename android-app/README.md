# HearU Android

This module packages the public HearU web application as a lightweight Android app.

- It opens the production HearU site inside a hardened Android WebView.
- Android's system audio picker supports selecting multiple local audio files.
- Shared listening rooms continue to use the existing hosted synchronization service.
- The debug APK produced by the workflow is signed automatically and can be sideloaded for testing.

## Build

The `Build Android APK` GitHub Actions workflow installs Java, Gradle, and the Android SDK, then builds and verifies the APK. The downloadable artifact is named `HearU-Android-APK`.
