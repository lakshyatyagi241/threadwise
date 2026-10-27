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
 * The contact card drawn over the phone's call screen while a call is on (one placed from the app, or one from a contact that rang): the app's name with a close button
 * on a deep panel, and in it the contact's card: initials, name, what they are and the number, and (for a contact that rang) a "Last Missed Call" row with when. It takes no focus, so the call screen stays usable.
 */
class CallOverlay(
  private val context: Context,
  private val data: android.os.Bundle,
  /** When given, the card can be pressed (an incoming caller opens its contact in the app). */
  private val onOpen: (() -> Unit)? = null,
) {
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
    // The panel is the deep brand colour and the contact's card the brighter primary one, with white words on both.
    val panel = color("panelColor", "#0B2A5C")
    val onPanel = color("onPanelColor", "#FFFFFF")
    val primary = color("primaryColor", "#1A56DB")
    val onPrimary = color("onPrimaryColor", "#FFFFFF")
    val name = data.getString("name").orEmpty()
    val missedWhen = data.getString("missedWhen")

    val header = FrameLayout(context).apply {
      addView(
        label(data.getString("appName").orEmpty(), 18f, onPanel, bold = true),
        FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(48), Gravity.CENTER_VERTICAL or Gravity.START).apply { marginStart = dp(4) },
      )
      addView(
        TextView(context).apply {
          this.text = "✕"
          textSize = 22f
          gravity = Gravity.CENTER
          setTextColor(onPanel)
          contentDescription = data.getString("closeLabel")
          setOnClickListener { onClose() }
        },
        FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER_VERTICAL or Gravity.END),
      )
    }

    val avatar = TextView(context).apply {
      this.text = initials(name)
      textSize = 18f
      gravity = Gravity.CENTER
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.parseColor("#121B2E"))
      background = rounded(onPrimary, 28).apply { shape = GradientDrawable.OVAL }
    }

    val words = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      addView(label(name, 20f, onPrimary, bold = true))
      addView(label(data.getString("subtitle").orEmpty(), 15f, onPrimary))
      addView(label(data.getString("phone").orEmpty(), 15f, onPrimary))
    }

    val who = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(avatar, LinearLayout.LayoutParams(dp(56), dp(56)))
      addView(words, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(14) })
    }

    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(18), dp(18), dp(18))
      background = rounded(primary, 20)
      if (onOpen != null) {
        isClickable = true
        contentDescription = name
        setOnClickListener { onOpen.invoke() }
      }
      addView(who, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
      // "Last Missed Call" and when: only a card that was given the row (a contact that rang) has it.
      if (missedWhen != null) {
        addView(
          View(context).apply { setBackgroundColor(Color.argb(77, Color.red(onPrimary), Color.green(onPrimary), Color.blue(onPrimary))) },
          LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(16); bottomMargin = dp(14) },
        )
        addView(
          LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(label(data.getString("missedLabel").orEmpty(), 16f, onPrimary), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(label(missedWhen, 16f, onPrimary, bold = true))
          },
          LinearLayout.LayoutParams.MATCH_PARENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    }

    return LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(4), dp(12), dp(14))
      background = rounded(panel, 24)
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
