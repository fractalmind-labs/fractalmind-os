# TypeMind IME Broadcast API

## Overview
TypeMind IME exposes a small broadcast API for text input and send actions.
By default, broadcasts are only accepted from shell/root. You can enable the
"Allow broadcasts from any app" debug toggle in the app if you need to test
from another app.

## Actions
### ai.input.TEXT
Commit text into the current input connection.

```bash
adb shell "am broadcast -a ai.input.TEXT --es text 'Hello 世界'"
```

- Extra: `text` (string, required)
- Max length: 10,000 characters (longer text is truncated)

### ai.input.SEND
Send/submit the current input.

```bash
adb shell "am broadcast -a ai.input.SEND"
```

- No extras
- Uses IME action if available; otherwise sends ENTER.

## Result codes
The receiver sets `resultCode` and `resultData` to indicate success or failure.
When the IME is inactive or no input connection is available, a non-zero result
and a clear error message are returned.
