package com.fractalmind.typemind

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

const val ACTION_TEXT = "ai.input.TEXT"
const val ACTION_SEND = "ai.input.SEND"
const val EXTRA_TEXT = "text"

const val MAX_TEXT_LENGTH = 10_000

private const val PREFS_NAME = "typemind_prefs"
private const val PREF_ALLOW_ALL_SENDERS = "allow_all_senders"

fun isAllowAllSendersEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getBoolean(PREF_ALLOW_ALL_SENDERS, false)
}

fun setAllowAllSendersEnabled(context: Context, enabled: Boolean) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(PREF_ALLOW_ALL_SENDERS, enabled).apply()
    syncReceiverComponents(context)
}

fun syncReceiverComponents(context: Context) {
    val allowAll = isAllowAllSendersEnabled(context)
    setComponentEnabled(context, AiInputReceiver::class.java, !allowAll)
    setComponentEnabled(context, AiInputReceiverDebug::class.java, allowAll)
}

private fun setComponentEnabled(context: Context, klass: Class<*>, enabled: Boolean) {
    val state = if (enabled) {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
    } else {
        PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    }

    context.packageManager.setComponentEnabledSetting(
        ComponentName(context, klass),
        state,
        PackageManager.DONT_KILL_APP,
    )
}
