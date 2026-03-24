# Supabase Email Configuration for Password Reset

## Status: ✅ ZERO CONFIGURATION NEEDED

Supabase **automatically handles email sending** for password resets. No setup required!

---

## How Supabase Email Works

### Automatic Email Sending

When you call `resetPasswordForEmail()`:

```typescript
await supabase.auth.resetPasswordForEmail('user@example.com', {
  redirectTo: 'https://yourdomain.com/reset-password'
});
```

Supabase **automatically**:
1. Generates a secure token
2. Sends an email to the user's email address
3. Includes a reset link with the token
4. Token expires in 24 hours
5. Link can only be used once

---

## Email Template (Pre-configured)

Supabase provides a default reset password email template. The email includes:

```
Subject: Reset your password

Hello [User Email],

You requested to reset your password. Click the link below to set a new password:

[Reset Link with Token]

This link will expire in 24 hours. If you didn't request this, ignore this email.

---
JuanSign Team
```

---

## Customizing the Email Template (Optional)

If you want to customize the email design or branding:

### Step 1: Open Supabase Dashboard
1. Go to [supabase.com](https://supabase.com)
2. Log in to your project
3. Click your project name

### Step 2: Find Email Templates
1. Click **"Authentication"** in left sidebar
2. Click **"Email Templates"** tab
3. Find **"Reset Password"** template

### Step 3: Edit the Template
1. Click the **"Reset Password"** row
2. Customize:
   - **Subject:** Email subject line
   - **Email Body:** HTML email content
   - **Redirect URL:** Should match `redirectTo` in your code

### Step 4: Save
- Click **"Save"** button
- Changes take effect immediately

### Template Variables

Use these variables in your email template:

```
{{ .ConfirmationURL }}    → Full reset link with token
{{ .Email }}              → User's email address
{{ .SiteURL }}            → Your app's base URL (e.g., https://juansign.com)
{{ .TokenHash }}          → The reset token (advanced)
```

### Example Custom Template

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; }
    .button { 
      display: inline-block; 
      background-color: #2E8B2E; 
      color: white; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 25px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Reset Your JuanSign Password</h1>
    
    <p>Hi {{ .Email }},</p>
    
    <p>We received a request to reset your JuanSign password.</p>
    
    <p>
      <a href="{{ .ConfirmationURL }}" class="button">
        Reset Password Now
      </a>
    </p>
    
    <p style="color: #666;">
      Or copy this link: <br>
      <code>{{ .ConfirmationURL }}</code>
    </p>
    
    <p style="color: #999; font-size: 12px;">
      This link expires in 24 hours.<br>
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
```

---

## Verifying Email Sending is Enabled

### Check 1: Email Templates Exist
1. Go to Supabase Dashboard
2. Auth → Email Templates
3. Verify "Reset Password" template is visible
4. Status should show "Enabled"

### Check 2: Test Email
1. Go to Auth → Email Templates
2. Click "Reset Password"
3. Click "Test Email" button
4. Check your email inbox
5. Confirm you receive the test email

### Check 3: Confirm Redirect URL
The reset password page must be accessible at:
```
https://yourdomain.com/reset-password?token=[token]&type=recovery
```

---

## Email Sending Limits

Supabase has rate limits per project:

- **Free Tier:** 4 emails per hour per user
- **Pro Tier:** 10 emails per hour per user

For JuanSign:
- Users can request password reset every 5 minutes
- This is well below the rate limit
- No additional configuration needed

---

## Troubleshooting Email Issues

### Issue: User doesn't receive reset email

**Check these in order:**

1. **Verify email address is correct**
   - User might have typo in signup
   - Check Supabase Auth table: auth.users

2. **Check spam/junk folder**
   - Gmail, Outlook may filter transactional emails
   - Not a code problem

3. **Verify reset email was sent**
   - Go to Supabase Dashboard
   - Auth → Logs
   - Filter for "password_recovery_sent"
   - Check recent entries

4. **Check email bounce status**
   - Go to Auth → Logs
   - Look for "email_bounce" events
   - Invalid email = bounce

5. **Verify email templates are enabled**
   - Auth → Email Templates
   - Reset Password should be enabled

6. **Check rate limiting**
   - User can't request more than 4 resets/hour
   - Wait an hour and try again

### Issue: Reset link doesn't work

**Check these:**

1. **Verify URL format**
   - Should be: `https://yourdomain.com/reset-password?token=ABC&type=recovery`
   - Check `token` and `type` parameters are present

2. **Check token hasn't expired**
   - Tokens expire after 24 hours
   - Request a new reset link

3. **Verify token is used once**
   - Each token can only be used once
   - If user already reset, request new link

4. **Check redirect URL matches**
   - Code: `redirectTo: 'https://juansign.com/reset-password'`
   - Supabase Dashboard → Auth → Email Templates → Reset Password
   - URLs must match

---

## How Email Sending Works Behind the Scenes

### Step 1: User Requests Reset
```typescript
// Frontend code calls:
await supabase.auth.resetPasswordForEmail('user@example.com', {
  redirectTo: 'https://juansign.com/reset-password'
});
```

### Step 2: Supabase Validates
- Checks if email exists in `auth.users`
- If not found: Returns success anyway (security - doesn't reveal accounts)
- If found: Continues to step 3

### Step 3: Generate Token
- Creates a secure, random token
- Sets expiration to 24 hours from now
- Stores in Supabase auth system

### Step 4: Send Email
- Supabase uses its email service (SendGrid or similar)
- Email includes reset link: `https://juansign.com/reset-password?token=XYZ&type=recovery`
- Uses the email template from "Email Templates"
- Email sent to user's registered email

### Step 5: User Clicks Link
- User's browser navigates to reset-password page with token
- Frontend verifies token is valid via `verifyOtp()`
- If valid: Shows password reset form
- If invalid/expired: Shows error message

### Step 6: User Sets New Password
- User enters new password
- Frontend calls `supabase.auth.updateUser({ password: newPassword })`
- Supabase updates the password hash
- Token is invalidated (one-time use)
- User redirected to login

---

## Webhook for Email Events (Advanced)

If you want to log password resets:

### Option 1: Realtime Listener (Recommended)
```typescript
// Listen for auth changes
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    console.log('Password reset initiated');
    // Log to your database
  }
});
```

### Option 2: Supabase Webhook
Create a webhook in Supabase Dashboard:
1. Database → Webhooks (if you have Pro)
2. Trigger on auth events
3. Send POST request to your API
4. Log the event in your database

```sql
-- Optional: Create a log table
CREATE TABLE password_reset_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Enable RLS
ALTER TABLE password_reset_logs ENABLE ROW LEVEL SECURITY;
```

---

## Email Service Configuration

### Current Setup
- **Service:** Supabase Default (SendGrid)
- **From Address:** noreply@supabase.co (customizable)
- **Rate Limit:** 4-10 emails/hour (depending on tier)
- **Bounce Handling:** Automatic

### Customize "From" Address (Optional)

Go to Supabase Dashboard:
1. Project Settings → Email
2. Update "From Address" 
3. Example: `noreply@juansign.com`
4. Verify domain ownership if using custom domain

---

## Testing Password Reset Locally

### Test with Real Email

```bash
# 1. Sign up with test email
# 2. Go to login → Forgot password
# 3. Enter test email
# 4. Check email for reset link
# 5. Click link and reset password
```

### Test with Fake Email (Won't Receive Link)

```typescript
// Frontend code for testing
const testEmail = 'fakeemail@test.com';

// Request will succeed but email won't be sent
await supabase.auth.resetPasswordForEmail(testEmail);

// Check Supabase logs to verify request was processed
// Go to Supabase Dashboard → Auth → Logs
```

### Mock Email for Testing (Advanced)

Use a tool like [MailHog](https://github.com/mailhog/MailHog) to intercept emails locally:

```bash
# Install MailHog
go install github.com/mailhog/MailHog@latest

# Run MailHog
MailHog

# Access at http://localhost:1025 (SMTP) or http://localhost:8025 (Web UI)
```

Then configure your local Supabase:
```bash
# In Supabase CLI config
# Point to local MailHog instead of SendGrid
```

---

## FAQ

**Q: Do I need to configure SMTP?**  
A: No, Supabase handles SMTP automatically.

**Q: Can I use Gmail or custom SMTP?**  
A: Only on self-hosted Supabase. Supabase Cloud uses their email service.

**Q: How do I track password resets?**  
A: Check Supabase Auth → Logs for "password_recovery_sent" events.

**Q: What if user changes email?**  
A: Reset can't be requested for old email. User must use new email.

**Q: Can I send custom email from my API?**  
A: Yes, but Supabase auth reset emails come from Supabase by default.

**Q: Is email sending secure?**  
A: Yes, all emails use HTTPS and TLS encryption.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Email Service** | Supabase (SendGrid) |
| **Configuration** | ✅ Automatic (zero setup) |
| **Rate Limit** | 4/hour free, 10/hour pro |
| **Token Expiry** | 24 hours |
| **One-time Use** | Yes |
| **Customizable Template** | Yes (optional) |
| **Custom SMTP** | No (Cloud plan) |

---

## Support

For email issues:
- Check Supabase Dashboard → Auth → Logs
- Verify email template is enabled
- Check spam folder
- Confirm email address is correct
- Wait a few minutes (network delays)

---

**Status:** ✅ Email sending is enabled by default  
**Action Needed:** ❌ None (fully automatic)  
**Cost:** ✅ Included in Supabase free tier
