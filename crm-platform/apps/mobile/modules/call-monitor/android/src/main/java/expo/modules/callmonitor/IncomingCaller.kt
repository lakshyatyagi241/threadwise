package expo.modules.callmonitor

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock

/**
 * The caller card of a call that rings from a contact, and what happens when that call ends. Android does not let an app that is
 * closed start a service from a broadcast, but "display over other apps" does let it draw a window, so the receiver shows the card
 * itself. A window on screen also keeps the app's process alive for as long as the call lasts.
 *
 * - A tap on the card opens the contact.
 * - When the call ends, whether it was answered, cut or missed, the app opens its "Add call" page for that contact (how long it
 *   lasted, and "Not answered" when it was never picked up). The page is opened while the card is still up, because a window of the
 *   app on screen is what lets it start a screen from the background; a call that was never shown for a contact does nothing.
 */
object IncomingCaller {
  private var overlay: CallOverlay? = null

  /** The call being tracked: the card's data, when it began ringing, and when (if ever) it was picked up. */
  private var data: Bundle? = null
  private var ringingWallClock = 0L
  private var offHookAt = 0L
  private var offHookWallClock = 0L

  /** Shows the card for `card` (the contact and the card's words) and starts tracking this call; a second ring signal for the same call only redraws it. */
  fun show(context: Context, card: Bundle) {
    overlay?.hide()
    overlay = null
    if (data == null) {
      ringingWallClock = System.currentTimeMillis()
      offHookAt = 0L
      offHookWallClock = 0L
    }
    data = card
    val app = context.applicationContext
    overlay = CallOverlay(app, card, onOpen = { open(app, card) }).also { it.show() }
  }

  /** The call was picked up (the phone's "off hook"); only a call that is being tracked cares. */
  fun answered() {
    if (data == null || offHookAt != 0L) return
    offHookAt = SystemClock.elapsedRealtime()
    offHookWallClock = System.currentTimeMillis()
  }

  /** The call is over: open its "Add call" page for the contact, then take the card away. */
  fun ended(context: Context) {
    val card = data
    if (card != null) runCatching { context.applicationContext.startActivity(summaryIntent(context, card)) }
    data = null
    offHookAt = 0L
    overlay?.hide()
    overlay = null
  }

  private fun summaryIntent(context: Context, card: Bundle): Intent {
    val answered = offHookAt != 0L
    val seconds = if (answered) (SystemClock.elapsedRealtime() - offHookAt) / 1000 else 0L
    val uri = Uri.parse(card.getString("summaryUrl").orEmpty()).buildUpon()
      .appendQueryParameter("contactId", card.getString("contactId").orEmpty())
      .appendQueryParameter("name", card.getString("name").orEmpty())
      .appendQueryParameter("startedAt", (if (answered) offHookWallClock else ringingWallClock).toString())
      .appendQueryParameter("durationSec", seconds.toString())
      .apply { if (!answered) appendQueryParameter("status", "notAnswered") }
      .build()
    return Intent(Intent.ACTION_VIEW, uri)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  /** Opens the app on the contact: the app's own address for a contact, with this one's id in it. The card goes; the call goes on being tracked. */
  private fun open(context: Context, card: Bundle) {
    val template = card.getString("openUrl").orEmpty()
    val id = card.getString("contactId").orEmpty()
    if (template.isEmpty() || id.isEmpty()) return
    val uri = Uri.parse(template.replace("__ID__", Uri.encode(id)))
    val intent = Intent(Intent.ACTION_VIEW, uri)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    runCatching { context.startActivity(intent) }
    overlay?.hide()
    overlay = null
  }
}
