#!/usr/bin/env bash
set -euo pipefail

sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
avd="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
adb="$ANDROID_HOME/platform-tools/adb"
export ANDROID_AVD_HOME="$RUNNER_TEMP/hearu-avd"
mkdir -p "$ANDROID_AVD_HOME"

"$sdk" "system-images;android-35;google_apis;x86_64" "emulator" "platform-tools"
echo no | "$avd" create avd --name hearu-test --package "system-images;android-35;google_apis;x86_64" --device pixel_2
sudo chmod 666 /dev/kvm
mkdir -p android-verification
"$ANDROID_HOME/emulator/emulator" -avd hearu-test -no-window -no-audio -no-boot-anim -no-snapshot -gpu swangle -feature -Vulkan -cores 2 -memory 3072 > "$RUNNER_TEMP/hearu-emulator.log" 2>&1 &
emulator_pid=$!
logcat_pid=''
finish() {
  cp "$RUNNER_TEMP/hearu-emulator.log" android-verification/emulator.log || true
  if [[ -n "$logcat_pid" ]]; then kill "$logcat_pid" 2>/dev/null || true; fi
  kill "$emulator_pid" 2>/dev/null || true
}
trap finish EXIT

booted=false
for attempt in {1..120}; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    cat "$RUNNER_TEMP/hearu-emulator.log"
    exit 1
  fi
  if ! "$adb" devices | grep -q 'emulator-.*device$'; then sleep 2; continue; fi
  if [[ "$("$adb" shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; then
    booted=true
    break
  fi
  sleep 2
done
if [[ "$booted" != "true" ]]; then cat "$RUNNER_TEMP/hearu-emulator.log"; exit 1; fi

"$adb" shell input keyevent 82
"$adb" shell settings put global window_animation_scale 0
"$adb" shell settings put global transition_animation_scale 0
"$adb" shell settings put global animator_duration_scale 0
"$adb" shell wm size 1080x2400
"$adb" shell wm density 420
"$adb" install -r android-app/app/build/outputs/apk/debug/app-debug.apk
"$adb" install -r android-app/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

# The interface and local player must work on first launch without internet.
"$adb" shell svc wifi disable
"$adb" shell svc data disable
"$adb" logcat -c
"$adb" logcat -v threadtime > android-verification/logcat.txt 2>&1 &
logcat_pid=$!
# Retain diagnostics even if adb or the emulator exits before JUnit finishes.
set +e
timeout 240 "$adb" shell am instrument -w com.akshaey.hearu.test/androidx.test.runner.AndroidJUnitRunner | tee "$RUNNER_TEMP/hearu-instrumentation.txt"
instrumentation_status=${PIPESTATUS[0]}
set -e
timeout 20 "$adb" pull /sdcard/Android/data/com.akshaey.hearu/files/verification android-verification/ || true
cp "$RUNNER_TEMP/hearu-instrumentation.txt" android-verification/results.txt
if [[ "$instrumentation_status" != "0" ]]; then exit "$instrumentation_status"; fi
grep -q 'OK (1 test)' "$RUNNER_TEMP/hearu-instrumentation.txt"
