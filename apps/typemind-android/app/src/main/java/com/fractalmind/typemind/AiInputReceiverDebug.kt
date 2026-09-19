package com.fractalmind.typemind

import android.content.Context

class AiInputReceiverDebug : AiInputReceiver() {
    override fun isSenderAllowed(context: Context): Boolean {
        return isAllowAllSendersEnabled(context)
    }
}
