package expo.modules.callmonitor

import android.content.Context
import android.os.Bundle
import android.provider.CallLog
import android.text.format.DateFormat
import java.util.Calendar
import java.util.Date

/**
 * When the contact last called and was not answered, for the caller card ("Last Missed Call  12:07 pm Today"). It reads the phone's
 * call log (the permission the app already holds to be given the caller's number) for that one number and keeps nothing.
 */
object MissedCalls {
  /** The newest missed calls looked through for the number: a person with a longer run of other missed calls shows none. */
  private const val SCAN_LIMIT = 300

  /** The time of the contact's last missed call, in milliseconds since 1970, or null when there is none (or the log cannot be read). */
  fun lastAt(context: Context, number: String?): Long? {
    val key = CallerDirectory.keyOf(number) ?: return null
    return runCatching {
      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE),
        "${CallLog.Calls.TYPE} = ?",
        arrayOf(CallLog.Calls.MISSED_TYPE.toString()),
        "${CallLog.Calls.DATE} DESC",
      )?.use { cursor ->
        var scanned = 0
        while (cursor.moveToNext() && scanned < SCAN_LIMIT) {
          scanned += 1
          if (CallerDirectory.keyOf(cursor.getString(0)) == key) return@use cursor.getLong(1)
        }
        null
      }
    }.getOrNull()
  }

  /** "12:07 pm Today", "9:30 am Yesterday" or "9:30 am 24 Oct 2026": the phone's own time and date formats, the card's words for the day. */
  fun whenText(context: Context, at: Long, today: String, yesterday: String): String {
    val time = DateFormat.getTimeFormat(context).format(Date(at))
    val day = Calendar.getInstance().apply { timeInMillis = at }
    val now = Calendar.getInstance()
    fun sameDay(a: Calendar, b: Calendar) =
      a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    val before = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }
    val label = when {
      sameDay(day, now) -> today
      sameDay(day, before) -> yesterday
      else -> DateFormat.getMediumDateFormat(context).format(Date(at))
    }
    return "$time $label"
  }

  /**
   * The card's last row: the time of the last missed call, or the card's "no missed calls" words. Null when the card has no words for
   * the row (an older list kept on the phone), or the call log could not be read: the row is then left off.
   */
  fun row(context: Context, number: String?, card: Bundle): String? {
    if (card.getString("missedLabel").isNullOrEmpty()) return null
    val at = lastAt(context, number)
    return if (at == null) card.getString("missedNone")
    else whenText(context, at, card.getString("today").orEmpty(), card.getString("yesterday").orEmpty())
  }
}
