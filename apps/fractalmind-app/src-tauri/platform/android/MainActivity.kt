// FractalMind managed Android activity; installed by scripts/android-platform.mjs.
package org.fractalmind.desktop

import android.content.res.Configuration
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.annotation.Keep
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

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

@InvokeArg
class OkrExportArgs {
  var content: String = ""
  var reviewed: Boolean = false
}

/** A single, explicitly consented export. No general file path/URI API. */
@TauriPlugin
class OkrExportPlugin(private val activity: Activity) : Plugin(activity) {
  private data class Pending(val invoke: Invoke, val bytes: ByteArray, val timeout: Runnable)
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Pending? = null
  private var webView: WebView? = null

  override fun load(webView: WebView) { this.webView = webView }

  private fun notice(zh: String, en: String) {
    val chinese = activity.resources.configuration.locales[0].language == "zh"
    Toast.makeText(activity, if (chinese) zh else en, Toast.LENGTH_LONG).show()
  }

  private fun clear(): Pending? {
    val original = pending
    pending = null
    original?.let { handler.removeCallbacks(it.timeout) }
    return original
  }

  @Command
  fun saveOkr(invoke: Invoke) {
    if (pending != null || activity.isFinishing || activity.isDestroyed ||
        webView?.url?.let { android.net.Uri.parse(it) }?.let {
          it.scheme == "http" && it.host == "tauri.localhost" &&
            it.port == -1 && it.userInfo == null
        } != true) {
      invoke.reject("OkrExportUnavailable")
      return
    }
    var bytes: ByteArray? = null
    try {
      val args = invoke.parseArgs(OkrExportArgs::class.java)
      val text = args.content
      bytes = text.toByteArray(Charsets.UTF_8)
      if (!args.reviewed || bytes.size > 262144 ||
          !text.startsWith("# FractalMind OKR\n") ||
          !text.contains("\n```fractalmind-okr-snapshot\n") ||
          !text.contains("\n```fractalmind-okr-proposal\n") ||
          !text.endsWith("\n```\n")) throw IllegalArgumentException()
      val timeout = Runnable {
        if (pending?.invoke?.id == invoke.id) {
          clear()?.bytes?.fill(0)
          notice("导出已过期，请重新导出。", "Export expired. Start a new export.")
          invoke.reject("OkrExportExpired")
        }
      }
      pending = Pending(invoke, bytes, timeout)
      handler.postDelayed(timeout, 120000)
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "text/markdown"
        putExtra(Intent.EXTRA_TITLE, "OKR.md")
      }
      startActivityForResult(invoke, intent, "saveOkrResult")
    } catch (_: Exception) {
      clear()?.bytes?.fill(0)
      bytes?.fill(0)
      invoke.reject("OkrExportUnavailable")
      notice("无法导出文件，请重试。", "Could not export the file. Try again.")
    }
  }

  @ActivityCallback
  fun saveOkrResult(invoke: Invoke, result: ActivityResult) {
    // The original request owns its bytes. Late/duplicate callbacks can never
    // pick up a newer request or write a document after cancellation/expiry.
    if (pending?.invoke?.id != invoke.id) return
    val original = clear() ?: return
    if (result.resultCode != Activity.RESULT_OK) {
      original.bytes.fill(0)
      notice("已取消导出，未保存文件。", "Export cancelled. No file was saved.")
      invoke.resolve(JSObject().put("status", "cancelled"))
      return
    }
    val uri = result.data?.data
    if (uri?.scheme != "content") {
      original.bytes.fill(0)
      invoke.reject("OkrExportInvalidDestination")
      notice("无法保存到所选位置。", "Could not save to the selected location.")
      return
    }
    // Only this callback's user-selected URI is writable, and no persistable
    // permission is taken. The UI has already cleared its private background
    // view; this short-lived native buffer is only for the chosen export.
    Thread {
      try {
        val stream = activity.contentResolver.openOutputStream(uri, "w")
          ?: throw java.io.IOException()
        stream.use { it.write(original.bytes); it.flush() }
        activity.runOnUiThread {
          invoke.resolve(JSObject().put("status", "saved"))
          notice("OKR.md 已保存。", "OKR.md saved.")
        }
      } catch (_: Exception) {
        activity.runOnUiThread {
          invoke.reject("OkrExportWriteFailed")
          notice("保存未完成，请检查所选文件。", "Save did not finish. Check the selected file.")
        }
      } finally {
        original.bytes.fill(0)
      }
    }.start()
  }

  override fun onDestroy(activity: AppCompatActivity) {
    clear()?.let { it.bytes.fill(0); it.invoke.reject("OkrExportCancelled") }
    webView = null
  }
}
