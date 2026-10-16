package expo.modules.callmonitor

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The contact card drawn over the phone's call screen while a call placed from the app is on: the app's name with a close button,
 * and under it the contact's initials, name, what they are, and the number. It takes no focus, so the call screen stays usable.
 */
class CallOverlay(private val context: Context, private val data: android.os.Bundle) {
  private val windows = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private var view: View? = null

  private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
  private fun color(key: String, fallback: String) =
    runCatching { Color.parseColor(data.getString(key)) }.getOrDefault(Color.parseColor(fallback))

  private fun rounded(fill: Int, radius: Int) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = dp(radius).toFloat()
  }

  private fun label(text: String, size: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
    this.text = text
    textSize = size
    setTextColor(color)
    if (bold) setTypeface(typeface, Typeface.BOLD)
    maxLines = 1
    ellipsize = android.text.TextUtils.TruncateAt.END
  }

  private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = when {
      parts.isEmpty() -> "?"
      parts.size == 1 -> parts[0].take(1)
      else -> parts[0].take(1) + parts.last().take(1)
    }
    return letters.uppercase()
  }

  private fun build(onClose: () -> Unit): View {
    val surface = color("surfaceColor", "#FFFFFF")
    val text = color("textColor", "#121B2E")
    val muted = color("mutedColor", "#4B5872")
    val primary = color("primaryColor", "#1A56DB")
    val onPrimary = color("onPrimaryColor", "#FFFFFF")
    val name = data.getString("name").orEmpty()

    val header = FrameLayout(context).apply {
      addView(
        label(data.getString("appName").orEmpty(), 16f, text, bold = true),
        FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(48), Gravity.CENTER_VERTICAL or Gravity.START),
      )
      addView(
        TextView(context).apply {
          this.text = "✕"
          textSize = 20f
          gravity = Gravity.CENTER
          setTextColor(text)
          contentDescription = data.getString("closeLabel")
          setOnClickListener { onClose() }
        },
        FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER_VERTICAL or Gravity.END),
      )
    }

    val avatar = TextView(context).apply {
      this.text = initials(name)
      textSize = 16f
      gravity = Gravity.CENTER
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(primary)
      background = rounded(onPrimary, 24).apply { shape = GradientDrawable.OVAL }
    }

    val words = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      addView(label(name, 17f, onPrimary, bold = true))
      addView(label(data.getString("subtitle").orEmpty(), 14f, onPrimary))
      addView(label(data.getString("phone").orEmpty(), 14f, onPrimary))
    }

    val card = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(16), dp(16), dp(16), dp(16))
      background = rounded(primary, 16)
      addView(avatar, LinearLayout.LayoutParams(dp(48), dp(48)))
      addView(words, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) })
    }

    return LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(4), dp(8), dp(16))
      background = rounded(surface, 24)
      elevation = dp(8).toFloat()
      addView(header)
      addView(card, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
  }

  fun show() {
    if (view != null) return
    val metrics = context.resources.displayMetrics
    val params = WindowManager.LayoutParams(
      metrics.widthPixels - dp(16),
      WindowManager.LayoutParams.WRAP_CONTENT,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      // Under the number and the name, above the call buttons: where the contact card sits on the stock call screen.
      y = (metrics.heightPixels * 0.36f).toInt()
    }
    val created = build { hide() }
    windows.addView(created, params)
    view = created
  }

  fun hide() {
    val shown = view ?: return
    view = null
    runCatching { windows.removeView(shown) }
  }
}
