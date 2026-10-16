package expo.modules.callmonitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Lives for one call placed from the app. It waits for the phone to go off hook (the call is dialling), shows the contact card over
 * the call screen, and when the phone goes idle again takes the card away and opens the app on its "log this call" screen with how
 * long the call lasted. The duration is the time from dialling to hanging up (the phone does not say when the other side answered
 * without reading the call log, which the app does not ask for).
 *
 * It stops itself: when the call ends, when the call never starts (the person backed out of the dialler), or when the app asks.
 */
class CallMonitorService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var data: Bundle = Bundle()
  private var overlay: CallOverlay? = null
  private var offHookAt = 0L
  private var offHookWallClock = 0L
  private var telephony: TelephonyManager? = null
  private var callback: TelephonyCallback? = null
  @Suppress("DEPRECATION") private var legacyListener: PhoneStateListener? = null
  private val giveUp = Runnable { stopSelf() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action != ACTION_START) {
      stopSelf()
      return START_NOT_STICKY
    }
    data = intent.extras ?: Bundle()
    startInForeground()
    listen()
    // The person may back out of the dialler without calling.
    main.postDelayed(giveUp, WAIT_FOR_CALL_MS)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    stopListening()
    overlay?.hide()
    super.onDestroy()
  }

  private fun channel(id: String, name: String, importance: Int) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(id, name, importance))
  }

  private fun startInForeground() {
    channel(CHANNEL_ONGOING, data.getString("channelOngoing").orEmpty(), NotificationManager.IMPORTANCE_LOW)
    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ONGOING)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(data.getString("ongoingTitle"))
      .setContentText(data.getString("name"))
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ONGOING, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ONGOING, notification)
    }
  }

  private fun listen() {
    val manager = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    telephony = manager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val listener = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
          override fun onCallStateChanged(state: Int) = onState(state)
        }
        callback = listener
        manager.registerTelephonyCallback(ContextCompat.getMainExecutor(this), listener)
      } else {
        @Suppress("DEPRECATION")
        val listener = object : PhoneStateListener() {
          @Deprecated("Deprecated in Java")
          override fun onCallStateChanged(state: Int, phoneNumber: String?) = onState(state)
        }
        legacyListener = listener
        @Suppress("DEPRECATION")
        manager.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
      }
    } catch (_: SecurityException) {
      // The phone-state permission was taken away: there is nothing to watch.
      stopSelf()
    }
  }

  private fun stopListening() {
    val manager = telephony ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      callback?.let { manager.unregisterTelephonyCallback(it) }
    } else {
      @Suppress("DEPRECATION")
      legacyListener?.let { manager.listen(it, PhoneStateListener.LISTEN_NONE) }
    }
    callback = null
    legacyListener = null
  }

  private fun onState(state: Int) {
    when (state) {
      TelephonyManager.CALL_STATE_OFFHOOK -> if (offHookAt == 0L) {
        offHookAt = SystemClock.elapsedRealtime()
        offHookWallClock = System.currentTimeMillis()
        main.removeCallbacks(giveUp)
        if (Settings.canDrawOverlays(this)) {
          overlay = CallOverlay(this, data).also { it.show() }
        }
      }
      // The first report is "idle" (the call has not started yet): only an idle after off hook is the end of the call.
      TelephonyManager.CALL_STATE_IDLE -> if (offHookAt != 0L) finishCall()
    }
  }

  private fun summaryIntent(): Intent {
    val seconds = (SystemClock.elapsedRealtime() - offHookAt) / 1000
    val uri = Uri.parse(data.getString("returnUrl").orEmpty()).buildUpon()
      .appendQueryParameter("startedAt", offHookWallClock.toString())
      .appendQueryParameter("durationSec", seconds.toString())
      .build()
    return Intent(Intent.ACTION_VIEW, uri)
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  private fun finishCall() {
    // A call with no contact to log it on has nothing to come back to.
    if (data.getString("returnUrl").isNullOrBlank()) {
      overlay?.hide()
      overlay = null
      stopSelf()
      return
    }
    val intent = summaryIntent()
    var opened = false
    if (Settings.canDrawOverlays(this)) {
      // Opened while the card is still up: a window of the app on screen is what lets it start a screen from the background.
      opened = runCatching { startActivity(intent) }.isSuccess
    }
    overlay?.hide()
    overlay = null
    if (!opened) notifyEnded(intent)
    stopSelf()
  }

  /** Without the overlay permission the app cannot open itself over the phone, so a tap on this notification does. */
  private fun notifyEnded(intent: Intent) {
    channel(CHANNEL_ENDED, data.getString("channelEnded").orEmpty(), NotificationManager.IMPORTANCE_HIGH)
    val tap = PendingIntent.getActivity(
      this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ENDED)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(data.getString("endedTitle"))
      .setContentText(data.getString("endedText"))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ENDED, notification)
  }

  companion object {
    const val ACTION_START = "expo.modules.callmonitor.START"
    const val ACTION_STOP = "expo.modules.callmonitor.STOP"
    private const val CHANNEL_ONGOING = "call_monitor_ongoing"
    private const val CHANNEL_ENDED = "call_monitor_ended"
    private const val NOTIFICATION_ONGOING = 7101
    private const val NOTIFICATION_ENDED = 7102

    /** How long to wait for the call to start before giving up (the dialler may be left open for a while). */
    private const val WAIT_FOR_CALL_MS = 90_000L
  }
}
