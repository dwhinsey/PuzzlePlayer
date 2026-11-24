plugins {
    id("com.android.application")
}

// The upload key for Google Play. CI writes it to a file from the
// UPLOAD_KEYSTORE_BASE64 secret and sets these; without them the release
// bundle is built unsigned. The key itself is never in the repository.
val uploadKeystore: String? = System.getenv("UPLOAD_KEYSTORE")
val uploadPassword: String? = System.getenv("UPLOAD_KEYSTORE_PASSWORD")

android {
    namespace = "com.puzplayer.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.puzplayer.app"
        minSdk = 26
        targetSdk = 36
        // Play needs a higher version code for every upload: CI passes the
        // build number.
        versionCode = System.getenv("VERSION_CODE")?.toInt() ?: 1
        versionName = "1.0"
    }

    signingConfigs {
        if (uploadKeystore != null && uploadPassword != null) {
            create("upload") {
                storeFile = file(uploadKeystore)
                storePassword = uploadPassword
                keyAlias = "upload"
                keyPassword = uploadPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
