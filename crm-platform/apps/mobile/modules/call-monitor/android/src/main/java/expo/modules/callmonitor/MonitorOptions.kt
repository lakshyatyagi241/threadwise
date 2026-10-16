package expo.modules.callmonitor

import android.os.Bundle
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Everything the service needs, handed over by the app when a call is placed. The words come from the app (they are translated
 * there) and so do the colours (they follow the theme), so nothing is written twice.
 */
class MonitorOptions : Record {
  @Field val name: String = ""
  @Field val subtitle: String = ""
  @Field val phone: String = ""

  /** The app's own link for the "log this call" screen; the service adds how long the call took. */
  @Field val returnUrl: String = ""
  @Field val appName: String = ""
  @Field val closeLabel: String = ""
  @Field val ongoingTitle: String = ""
  @Field val endedTitle: String = ""
  @Field val endedText: String = ""
  @Field val channelOngoing: String = ""
  @Field val channelEnded: String = ""
  @Field val surfaceColor: String = "#FFFFFF"
  @Field val textColor: String = "#121B2E"
  @Field val mutedColor: String = "#4B5872"
  @Field val primaryColor: String = "#1A56DB"
  @Field val onPrimaryColor: String = "#FFFFFF"

  fun toBundle() = Bundle().apply {
    putString("name", name)
    putString("subtitle", subtitle)
    putString("phone", phone)
    putString("returnUrl", returnUrl)
    putString("appName", appName)
    putString("closeLabel", closeLabel)
    putString("ongoingTitle", ongoingTitle)
    putString("endedTitle", endedTitle)
    putString("endedText", endedText)
    putString("channelOngoing", channelOngoing)
    putString("channelEnded", channelEnded)
    putString("surfaceColor", surfaceColor)
    putString("textColor", textColor)
    putString("mutedColor", mutedColor)
    putString("primaryColor", primaryColor)
    putString("onPrimaryColor", onPrimaryColor)
  }
}
