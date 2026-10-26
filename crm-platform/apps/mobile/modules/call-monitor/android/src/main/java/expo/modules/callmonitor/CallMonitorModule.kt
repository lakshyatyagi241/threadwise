package expo.modules.callmonitor

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge to [CallMonitorService]. The app calls `start` just before it places a call; the service then shows the contact over
 * the phone's call screen and, when the call ends, brings the app back to the "log this call" screen.
 */
class CallMonitorModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("CallMonitor")

    /** Whether the person has allowed "display over other apps" for this app. */
    Function("canDrawOverlays") { Settings.canDrawOverlays(context) }

    /** Opens the phone's page where that switch is (Android has no pop-up prompt for it). */
    Function("openOverlaySettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("start") { options: MonitorOptions ->
      val intent = Intent(context, CallMonitorService::class.java)
        .setAction(CallMonitorService.ACTION_START)
        .putExtras(options.toBundle())
      ContextCompat.startForegroundService(context, intent)
    }

    /** The "log this call" address of the call that just ended, handed over once (null when there is none). */
    Function("takeEndedCall") { CallMonitorService.takeEnded() }

    /**
     * Caller ID: `display` is the card's words and colours (translated and themed in the app), `enabled` the switch. The receiver
     * reads both when a call rings, so they are kept here rather than asked for then.
     */
    Function("configureCallerId") { enabled: Boolean, display: Map<String, String> ->
      CallerDirectory.configure(context, enabled, display)
    }

    /** Replaces the contacts the phone can name; `json` is an array of {id, name, phone}. Answers how many it can name. */
    Function("setCallerDirectory") { json: String -> CallerDirectory.replace(context, json) }

    /** Forgets every contact and switches caller ID off. */
    Function("clearCallerId") { CallerDirectory.clear(context) }

    /** The switch, how many contacts the phone can name, and when they were last updated (milliseconds, 0: never). */
    Function("callerIdStatus") {
      mapOf(
        "enabled" to CallerDirectory.enabled(context),
        "count" to CallerDirectory.count(context),
        "updatedAt" to CallerDirectory.updatedAt(context).toDouble(),
      )
    }

    Function("stop") {
      context.stopService(Intent(context, CallMonitorService::class.java))
    }
  }
}
