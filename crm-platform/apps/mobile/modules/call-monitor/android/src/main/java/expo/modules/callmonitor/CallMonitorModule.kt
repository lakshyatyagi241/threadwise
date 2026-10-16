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

    Function("stop") {
      context.stopService(Intent(context, CallMonitorService::class.java))
    }
  }
}
