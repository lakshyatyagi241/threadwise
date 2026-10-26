package expo.modules.callmonitor

import android.content.Context
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The contacts the phone can name when a call comes in: an id, a name and a number each, kept in a file of the app's own private
 * storage (nothing else on the phone can read it) and matched in memory. It exists so a ringing phone never needs the network or the
 * app's sign-in: the app fills it while it is open, and the receiver only reads it. The caller-ID switch and the words and colours
 * of the card (written in the app, so translated and themed there) are kept with it.
 */
object CallerDirectory {
  class Entry(val id: String, val name: String, val phone: String)

  private const val FILE = "caller-directory.json"
  private const val PREFS = "caller_id"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_DISPLAY = "display"
  private const val KEY_UPDATED = "updatedAt"

  /** Fewer digits than this are an extension or a service code, never a contact's number. */
  private const val MIN_DIGITS = 6

  /** Numbers match on their last digits, so +91 98765 43210, 098765 43210 and 98765 43210 are the same person. */
  private const val SUFFIX_DIGITS = 10

  private val lock = Any()
  @Volatile private var loaded: Map<String, Entry>? = null

  /** The part of a number that names it: its last digits, or null when it is too short to name anyone. */
  fun keyOf(number: String?): String? {
    val digits = number.orEmpty().filter { it.isDigit() }
    return if (digits.length < MIN_DIGITS) null else digits.takeLast(SUFFIX_DIGITS)
  }

  private fun file(context: Context) = File(context.applicationContext.filesDir, FILE)
  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Replaces the whole list with `json`, a JSON array of `{id, name, phone}`; answers how many contacts it can name. */
  fun replace(context: Context, json: String): Int = synchronized(lock) {
    val parsed = JSONArray(json)
    val kept = JSONArray()
    val map = HashMap<String, Entry>()
    for (i in 0 until parsed.length()) {
      val row = parsed.optJSONObject(i) ?: continue
      val id = row.optString("id")
      val name = row.optString("name")
      val phone = row.optString("phone")
      val key = keyOf(phone) ?: continue
      if (id.isEmpty() || name.isEmpty()) continue
      map[key] = Entry(id, name, phone)
      kept.put(JSONObject().put("id", id).put("name", name).put("phone", phone))
    }
    val target = file(context)
    val temp = File(target.parentFile, "$FILE.tmp")
    temp.writeText(kept.toString())
    if (!temp.renameTo(target)) {
      target.writeText(kept.toString())
      temp.delete()
    }
    loaded = map
    prefs(context).edit().putLong(KEY_UPDATED, System.currentTimeMillis()).apply()
    map.size
  }

  private fun entries(context: Context): Map<String, Entry> {
    loaded?.let { return it }
    return synchronized(lock) {
      loaded ?: run {
        val map = HashMap<String, Entry>()
        val source = file(context)
        if (source.exists()) {
          runCatching {
            val rows = JSONArray(source.readText())
            for (i in 0 until rows.length()) {
              val row = rows.getJSONObject(i)
              val phone = row.getString("phone")
              val key = keyOf(phone) ?: continue
              map[key] = Entry(row.getString("id"), row.getString("name"), phone)
            }
          }
        }
        loaded = map
        map
      }
    }
  }

  /** The contact whose number is `number`, or null when none is (or the number is hidden or too short). */
  fun find(context: Context, number: String?): Entry? {
    val key = keyOf(number) ?: return null
    return entries(context)[key]
  }

  fun count(context: Context): Int = entries(context).size

  fun updatedAt(context: Context): Long = prefs(context).getLong(KEY_UPDATED, 0L)

  /** Switches caller ID on or off and keeps the words and colours the card is drawn with. */
  fun configure(context: Context, enabled: Boolean, display: Map<String, String>) {
    val shown = JSONObject()
    for ((key, value) in display) shown.put(key, value)
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).putString(KEY_DISPLAY, shown.toString()).apply()
  }

  fun enabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  /** The card's words and colours as the service takes them, or null when the app has not given any. */
  fun display(context: Context): Bundle? {
    val raw = prefs(context).getString(KEY_DISPLAY, null) ?: return null
    val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    return Bundle().apply {
      val keys = json.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        putString(key, json.optString(key))
      }
    }
  }

  /** Forgets every contact, the switch and the settings (turned off, or the person signed out). */
  fun clear(context: Context) = synchronized(lock) {
    file(context).delete()
    loaded = HashMap()
    prefs(context).edit().clear().apply()
  }
}
