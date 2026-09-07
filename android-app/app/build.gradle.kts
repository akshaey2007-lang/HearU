plugins {
    id("com.android.application")
}

android {
    namespace = "com.akshaey.hearu"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.akshaey.hearu"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "1.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/hearu-assets"))
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}

val bundleApp by tasks.registering(Sync::class) {
    val webBuild = rootProject.file("../dist-android")
    from(webBuild)
    into(layout.buildDirectory.dir("generated/hearu-assets/web"))
    doFirst {
        check(webBuild.resolve("android.html").isFile) {
            "Missing HearU app bundle. Run npm run build:android before building the APK."
        }
    }
}
tasks.named("preBuild") { dependsOn(bundleApp) }
