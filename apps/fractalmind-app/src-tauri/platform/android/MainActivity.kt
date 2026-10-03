// FractalMind managed Android activity; installed by scripts/android-platform.mjs.
package org.fractalmind.desktop

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
    val systemDark = resources.configuration.uiMode and
      Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    fmSetAppearance(getSharedPreferences("fm-appearance-v1", MODE_PRIVATE)
      .getBoolean("dark", systemDark))
  }

  @Keep
  fun fmSetAppearance(dark: Boolean) {
    // Public appearance only. Credentials and business state never enter this store.
    val background = Color.parseColor(if (dark) "#0b0b10" else "#f6f6f8")
    window.decorView.setBackgroundColor(background)
    findViewById<android.view.View>(android.R.id.content).setBackgroundColor(background)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
    getSharedPreferences("fm-appearance-v1", MODE_PRIVATE)
      .edit().putBoolean("dark", dark).apply()
  }
}
