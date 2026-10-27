package expo.modules.callmonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.telephony.TelephonyManager

/**
 * Hears the phone's call state even when the app is closed. A call that rings from a number a contact has, or one placed from the
 * phone's own dialler to such a number, shows the caller card ([IncomingCaller]); when the call ends (picked up, cut or missed) the
 * app opens its "Add call" page for that contact. A number that is hidden, unknown or nobody's does nothing, and so does everything
 * while caller ID is off or "display over other apps" is not allowed. A call placed from the app itself has its own card
 * ([CallMonitorService]), so this one stays out of its way.
 */
class IncomingCallReceiver : BroadcastReceiver() {
  @Suppress("DEPRECATION")
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_NEW_OUTGOING_CALL) {
      // Sent when a call is about to be placed; this is the only place the number of an outgoing call is given. It is left as it is
      // (the broadcast is ordered, and the call goes on to be placed unchanged).
      val number = intent.getStringExtra(Intent.EXTRA_PHONE_NUMBER) ?: return
      if (CallMonitorService.running) return
      showCard(context, number, outgoing = true)
      return
    }
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
      TelephonyManager.EXTRA_STATE_RINGING -> {
        // The phone sends this twice, the first time without the number; the second one carries it.
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: return
        showCard(context, number, outgoing = false)
      }
      TelephonyManager.EXTRA_STATE_OFFHOOK -> IncomingCaller.answered()
      TelephonyManager.EXTRA_STATE_IDLE -> IncomingCaller.ended(context)
    }
  }

  /** Draws the card for `number` when caller ID is on and a contact has that number; `outgoing` is a call the person is placing. */
  private fun showCard(context: Context, number: String, outgoing: Boolean) {
    if (!CallerDirectory.enabled(context) || !Settings.canDrawOverlays(context)) return
    val contact = CallerDirectory.find(context, number) ?: return
    val card = CallerDirectory.display(context) ?: return
    val data = Bundle(card).apply {
      putString("contactId", contact.id)
      putString("name", contact.name)
      putString("phone", contact.phone)
      MissedCalls.row(context, number, card)?.let { putString("missedWhen", it) }
    }
    runCatching { IncomingCaller.show(context, data, outgoing) }
  }
}
