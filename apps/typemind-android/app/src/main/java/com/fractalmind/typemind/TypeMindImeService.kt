package com.fractalmind.typemind

import android.inputmethodservice.InputMethodService
import android.view.View

class TypeMindImeService : InputMethodService() {
    override fun onCreateInputView(): View {
        return layoutInflater.inflate(R.layout.ime_view, null)
    }
}
