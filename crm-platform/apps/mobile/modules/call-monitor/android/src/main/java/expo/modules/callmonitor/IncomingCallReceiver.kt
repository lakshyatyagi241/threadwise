package expo.modules.callmonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.telephony.TelephonyManager

/**
 * Hears the phone's call state even when the app is closed. A call that rings from a number a contact has shows the caller card
 * ([IncomingCaller]); when the call ends (picked up, cut or missed) the app opens its "Add call" page for that contact. A number that is hidden, unknown or nobody's does nothing, and so does
 * everything while caller ID is off or "display over other apps" is not allowed.
 */
class IncomingCallReceiver : BroadcastReceiver() {
  @Suppress("DEPRECATION")
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
      TelephonyManager.EXTRA_STATE_RINGING -> {
        // The phone sends this twice, the first time without the number; the second one carries it.
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: return
        if (!CallerDirectory.enabled(context) || !Settings.canDrawOverlays(context)) return
        val contact = CallerDirectory.find(context, number) ?: return
        val card = CallerDirectory.display(context) ?: return
        val data = Bundle(card).apply {
          putString("contactId", contact.id)
          putString("name", contact.name)
          putString("phone", contact.phone)
        }
        runCatching { IncomingCaller.show(context, data) }
      }
      TelephonyManager.EXTRA_STATE_OFFHOOK -> IncomingCaller.answered()
      TelephonyManager.EXTRA_STATE_IDLE -> IncomingCaller.ended(context)
    }
  }
}
