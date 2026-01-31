# typemind-android
An Android input method designed for use with AI.

## Local setup
1. Install the APK on your device/emulator.
2. Open TypeMind IME and enable it in system settings.
3. Select TypeMind IME as your current keyboard.

## Broadcast API (P0)
By default, only shell/root broadcasts are accepted. Use the debug toggle in the
app if you need to accept broadcasts from other apps.

Text input:
```bash
adb shell "am broadcast -a ai.input.TEXT --es text 'Hello 世界'"
```

Send action:
```bash
adb shell "am broadcast -a ai.input.SEND"
```

See `API.md` for more details.
