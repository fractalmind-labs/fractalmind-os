package com.fractalmind.typemind

import android.inputmethodservice.InputMethodService
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo

class TypeMindImeService : InputMethodService() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onCreateInputView(): View {
        return layoutInflater.inflate(R.layout.ime_view, null)
    }

    fun commitText(text: String): Boolean {
        val connection = currentInputConnection ?: return false
        return connection.commitText(text, 1)
    }

    fun performSendAction(): Boolean {
        val connection = currentInputConnection ?: return false
        val editorInfo = currentInputEditorInfo
        val action = editorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION) ?: EditorInfo.IME_ACTION_NONE
        if (action != EditorInfo.IME_ACTION_NONE) {
            return connection.performEditorAction(action)
        }

        val down = connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
        val up = connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        return down && up
    }

    companion object {
        @Volatile
        private var instance: TypeMindImeService? = null

        fun getInstance(): TypeMindImeService? = instance
    }
}
