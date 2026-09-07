package com.akshaey.hearu;

import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityTestRule;

import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

@RunWith(AndroidJUnit4.class)
public class AppLayoutTest {
    @Rule
    public ActivityTestRule<MainActivity> activityRule = new ActivityTestRule<>(MainActivity.class);

    private WebView webView() {
        return activityRule.getActivity().findViewById(R.id.web_view);
    }

    private String evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                webView().evaluateJavascript(expression, value -> {
                    result.set(value);
                    done.countDown();
                }));
        assertTrue("WebView did not respond", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitFor(String expression) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 20000;
        do {
            if ("true".equals(evaluate(expression))) return;
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        fail("Condition did not become true: " + expression);
    }

    private void tap(String selector) throws Exception {
        waitFor("!!document.querySelector(" + JSONObject.quote(selector) + ")");
        String position = evaluate("JSON.stringify((() => { const el=document.querySelector("
                + JSONObject.quote(selector) + "); el.scrollIntoView({block:'nearest'});"
                + "const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:innerWidth};})())");
        JSONObject point = new JSONObject(new JSONTokener(position).nextValue().toString());
        int[] offset = new int[2];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> webView().getLocationOnScreen(offset));
        float scale = webView().getWidth() / (float) point.getDouble("w");
        float x = offset[0] + (float) point.getDouble("x") * scale;
        float y = offset[1] + (float) point.getDouble("y") * scale;
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 60, MotionEvent.ACTION_UP, x, y, 0);
        InstrumentationRegistry.getInstrumentation().sendPointerSync(down);
        InstrumentationRegistry.getInstrumentation().sendPointerSync(up);
        down.recycle();
        up.recycle();
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }

    private void assertFullScreen() throws Exception {
        assertEquals("No mock phone or notch may be rendered", "true", evaluate(
                "!document.querySelector('.phone-frame,.dynamic-island,.phone-stage')"));
        assertEquals("The app must fill the actual viewport and keep navigation onscreen", "true", evaluate(
                "(() => { const app=document.querySelector('.app-surface').getBoundingClientRect();"
                + "const nav=document.querySelector('.nav-dock').getBoundingClientRect();"
                + "return Math.abs(app.width-innerWidth)<2 && Math.abs(app.height-innerHeight)<2"
                + "&& Math.abs(app.left)<2 && Math.abs(app.top)<2"
                + "&& nav.bottom<=innerHeight && nav.left>=0 && nav.right<=innerWidth"
                + "&& document.documentElement.scrollWidth<=innerWidth; })()"));
    }

    private void screenshot(String name) throws Exception {
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertTrue("Android screenshot is available", bitmap != null);
        File directory = activityRule.getActivity().getExternalFilesDir("verification");
        assertTrue(directory != null && (directory.isDirectory() || directory.mkdirs()));
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        }
        bitmap.recycle();
    }

    @Test
    public void installedAppFillsScreenAndPlaysLocalSongsOffline() throws Exception {
        waitFor("!!document.querySelector('.app-surface .nav-dock')");
        assertEquals("true", evaluate("document.documentElement.dataset.hearuApp === 'android'"));
        assertFullScreen();
        screenshot("portrait-dark");

        tap("button[aria-label='Open account']");
        tap("button[aria-label='Use dark mode']");
        waitFor("document.documentElement.dataset.theme === 'light'");
        tap("button[aria-label='Close']");
        assertFullScreen();
        screenshot("portrait-light");

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                activityRule.getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
        waitFor("innerWidth > innerHeight");
        assertFullScreen();
        screenshot("landscape-light");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                activityRule.getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        waitFor("innerHeight > innerWidth");

        tap("button[aria-label='Music']");
        waitFor("!!document.querySelector('input[type=file]')");
        // Feed two real WAV files through the app's input/change handler, then
        // use Android touch events to satisfy the media user-gesture policy.
        assertEquals("true", evaluate("(() => {"
                + "const data=new ArrayBuffer(44+16000*2*8), v=new DataView(data);"
                + "const text=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};"
                + "text(0,'RIFF');v.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');"
                + "v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);"
                + "v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);"
                + "v.setUint16(34,16,true);text(36,'data');v.setUint32(40,data.byteLength-44,true);"
                + "const transfer=new DataTransfer();"
                + "transfer.items.add(new File([data],'Local test one.wav',{type:'audio/wav'}));"
                + "transfer.items.add(new File([data],'Local test two.wav',{type:'audio/wav'}));"
                + "const input=document.querySelector('input[type=file]');input.files=transfer.files;"
                + "input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"));
        waitFor("document.querySelectorAll('.local-track-row').length === 2");
        waitFor("document.querySelector('audio.sr-only').readyState >= 1");
        tap(".local-track-row");
        waitFor("(() => {const a=document.querySelector('audio.sr-only'); return !a.paused && a.currentTime>0;})()");
        assertFullScreen();
        screenshot("local-player");
        tap("button[aria-label='Pause']");
        waitFor("document.querySelector('audio.sr-only').paused");
        tap("button[aria-label='Create']");
        waitFor("!!document.querySelector('.create-screen input[type=file]')");
        assertFullScreen();
        screenshot("create-room");
    }
}
