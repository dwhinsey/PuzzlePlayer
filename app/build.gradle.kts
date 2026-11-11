plugins {
    id("com.android.application")
}

android {
    namespace = "com.hinseypuzzles.puzzleplayer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hinseypuzzles.puzzleplayer"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
