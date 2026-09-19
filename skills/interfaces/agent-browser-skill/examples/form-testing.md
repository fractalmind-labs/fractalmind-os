# Form Testing

Use agent-browser to automate form filling and submission testing.

## Login Form Example

```bash
# 1. Open login page
npx agent-browser open "https://app.example.com/login" --session login-test

# 2. Discover form fields
npx agent-browser snapshot -i
# Expected output:
# - textbox "Email" [ref=e3]
# - textbox "Password" [ref=e4]
# - button "Sign In" [ref=e5]

# 3. Fill in credentials
npx agent-browser fill @e3 "test@example.com"
npx agent-browser fill @e4 "testpassword123"

# 4. Submit
npx agent-browser click @e5

# 5. Wait for navigation
npx agent-browser wait 2000

# 6. Verify login success
npx agent-browser snapshot -i
# Look for: dashboard elements, user menu, logout button
npx agent-browser screenshot /tmp/login-result.png

# 7. Cleanup
npx agent-browser close --session login-test
```

## Multi-Step Form Example

```bash
# Step 1: Personal info
npx agent-browser open "https://app.example.com/register" --session register
npx agent-browser snapshot -i
npx agent-browser fill @e3 "John"           # First name
npx agent-browser fill @e4 "Doe"            # Last name
npx agent-browser fill @e5 "john@test.com"  # Email
npx agent-browser click @e6                  # Next button
npx agent-browser wait 1000

# Step 2: Preferences
npx agent-browser snapshot -i               # Re-snapshot after page change!
npx agent-browser select @e3 "English"      # Language dropdown
npx agent-browser check @e4                 # Terms checkbox
npx agent-browser click @e5                  # Submit
npx agent-browser wait 2000

# Verify
npx agent-browser snapshot -i
npx agent-browser screenshot /tmp/register-result.png
npx agent-browser close --session register
```

## Tips

- **Always re-snapshot after navigation** — element refs change when the DOM updates
- **Use `wait`** between form submission and verification to allow page load
- **Use sessions** to preserve cookies/auth state across steps
- **Screenshot on failure** to capture the error state for debugging
