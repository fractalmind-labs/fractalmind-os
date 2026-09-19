package com.fractalmind.typemind

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

open class AiInputReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return

        if (!isSenderAllowed(context)) {
            fail("Broadcast sender not allowed")
            return
        }

        val service = TypeMindImeService.getInstance()
        if (service == null || service.currentInputConnection == null) {
            fail("IME not active or no input connection")
            return
        }

        when (action) {
            ACTION_TEXT -> handleText(service, intent)
            ACTION_SEND -> handleSend(service)
            else -> fail("Unsupported action: $action")
        }
    }

    private fun handleText(service: TypeMindImeService, intent: Intent) {
        val rawText = intent.getStringExtra(EXTRA_TEXT)
        if (rawText == null) {
            fail("Missing text extra")
            return
        }

        val text = rawText.take(MAX_TEXT_LENGTH)
        if (service.commitText(text)) {
            success("OK")
        } else {
            fail("Failed to commit text")
        }
    }

    private fun handleSend(service: TypeMindImeService) {
        if (service.performSendAction()) {
            success("OK")
        } else {
            fail("Failed to send")
        }
    }

    protected open fun isSenderAllowed(context: Context): Boolean {
        return !isAllowAllSendersEnabled(context)
    }

    private fun success(message: String) {
        setResultCode(RESULT_OK_CODE)
        setResultData(message)
    }

    private fun fail(message: String) {
        setResultCode(RESULT_ERROR_CODE)
        setResultData(message)
    }

    companion object {
        private const val RESULT_OK_CODE = 0
        private const val RESULT_ERROR_CODE = 1
    }
}
