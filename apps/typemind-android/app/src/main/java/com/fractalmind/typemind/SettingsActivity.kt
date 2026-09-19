package com.fractalmind.typemind

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        findViewById<Button>(R.id.open_settings_button).setOnClickListener {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        }

        findViewById<Button>(R.id.show_picker_button).setOnClickListener {
            val imm = getSystemService(InputMethodManager::class.java)
            imm?.showInputMethodPicker()
        }

        syncReceiverComponents(this)

        val allowAll = findViewById<CheckBox>(R.id.allow_all_broadcasts_checkbox)
        allowAll.isChecked = isAllowAllSendersEnabled(this)
        allowAll.setOnCheckedChangeListener { _, isChecked ->
            setAllowAllSendersEnabled(this, isChecked)
        }
    }
}
