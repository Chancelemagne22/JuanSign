# 🔍 Password Reset Token Verification Issue - Debugging Guide

## Issue
After clicking the password reset link in email, the page shows:
```
"Invalid or expired reset link. Please request a new one."
```

Even though the email was sent and the link was received.

---

## Root Causes to Check

### 1. Token Format Issue
**The token might not be what verifyOtp expects**

Supabase sends recovery links like:
```
https://yourdomain.com/reset-password?token=abc123&type=recovery
```

The `token` parameter might be:
- A raw token (needs to be used as-is)
- A token that needs hashing
- A different format entirely

### 2. Supabase Configuration Issue
**The redirect URL might not match**

In `ForgotPasswordModal.tsx`, the redirect is set to:
```typescript
redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`
```

If the user is testing on:
- ✅ `http://localhost:3000` → redirects to `http://localhost:3000/reset-password` ✓
- ❌ `http://localhost:3001` → redirects to `http://localhost:3001/reset-password` ✗ (different port!)

### 3. Session Not Established
**verifyOtp might not be setting up the session correctly**

After verifying, we need to ensure the session is active before updating password.

---

## Debugging Steps

### Step 1: Check Email Link Format
1. **Go to login page**
2. **Click "Forgot Password"**
3. **Enter your test email**
4. **Check email inbox**
5. **Copy the full recovery link**
6. **Check format:**
   - Should look like: `http://localhost:3000/reset-password?token=...&type=recovery`
   - Should have `?token=` parameter
   - Should have `&type=recovery` parameter

### Step 2: Check Browser Console
When the page loads with the recovery link:
1. **Open DevTools** (F12)
2. **Go to Console tab**
3. **Look for error messages like:**
   - `[reset] Token verification error: ...`
   - `[reset] No user returned after token verification`
   - `[reset] ✓ Token verified successfully` (if it works!)

### Step 3: Check Network Tab
1. **Open DevTools** (F12)
2. **Go to Network tab**
3. **Reload the page with recovery link**
4. **Look for requests to Supabase:**
   - Should see: `/auth/v1/verify` request
   - Check response: Should have user data if successful

### Step 4: Verify URL Parameters
1. **Click recovery link**
2. **Look at browser address bar**
3. **Verify it shows:**
   ```
   http://localhost:3000/reset-password?token=eyJ...&type=recovery
   ```
   - ✅ Has token parameter
   - ✅ Has type=recovery
   - ✅ URL is complete (not truncated)

---

## Common Issues & Fixes

### Issue 1: Token is Missing or Empty
**Symptom:** URL shows `/reset-password?&type=recovery` (empty token)

**Cause:** Email link wasn't properly generated or copy-pasted

**Fix:** Request new password reset email

### Issue 2: URL Parameters Truncated
**Symptom:** URL is cut off or incomplete

**Cause:** Email client might have truncated the link

**Fix:** Try a different email client or copy the full URL

### Issue 3: Type Parameter Missing or Wrong
**Symptom:** URL shows `/reset-password?token=...&type=email` (wrong type)

**Cause:** Supabase sent wrong type

**Fix:** Check Supabase Auth settings

### Issue 4: Token Expired (>24 hours)
**Symptom:** "Invalid or expired reset link"

**Cause:** Recovery tokens expire after 24 hours

**Fix:** Request a fresh password reset email

### Issue 5: Different Domain/Port
**Symptom:** Works on localhost:3000 but not on other URLs

**Cause:** Redirect URL doesn't match where app is running

**Fix:** Check that `window.location.origin` matches the domain in email

---

## Detailed Debugging Code

Add this to browser console when on the reset page:

```javascript
// Check what parameters the page received
const params = new URLSearchParams(window.location.search);
console.log('Token:', params.get('token'));
console.log('Type:', params.get('type'));
console.log('Token length:', params.get('token')?.length);
console.log('Token first 50 chars:', params.get('token')?.substring(0, 50));
console.log('Full URL:', window.location.href);
```

Expected output:
```
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Type: recovery
Token length: 500+
Token first 50 chars: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Full URL: http://localhost:3000/reset-password?token=...&type=recovery
```

---

## Solution Checklist

- [ ] **Check email link format** - Has token and type=recovery
- [ ] **Open browser console** - Check for error messages
- [ ] **Verify URL parameters** - Token is present and type=recovery
- [ ] **Check token length** - Should be 500+ characters (JWT format)
- [ ] **Verify token format** - Should start with `eyJ` (base64 encoded)
- [ ] **Check Supabase logs** - Any errors in Supabase dashboard
- [ ] **Test with fresh email** - Request new password reset
- [ ] **Check redirect URL** - Should match window.location.origin

---

## If Still Having Issues

### Enable Debug Logging
In `ResetPasswordPage.tsx`, we added console.log statements. Check browser DevTools Console for:
- `[reset] Token verification error: ...` → Shows exact error
- `[reset] No user returned after token verification` → User not found
- `[reset] ✓ Token verified successfully` → Token is valid

### Check Supabase Auth Settings
In Supabase dashboard:
1. Go to: **Authentication** → **Providers** → **Email**
2. Check: **Email templates**
3. Look for: **Recovery template**
4. Verify: Recovery email has correct reset link

### Verify Redirect URL
Make sure the redirect URL in code matches where app is running:

**ForgotPasswordModal.tsx line 39:**
```typescript
redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`
```

This should work for:
- ✅ `http://localhost:3000`
- ✅ `http://localhost:3001`
- ✅ `https://yourdomain.com`
- ✅ Any domain the app runs on

---

## Next Steps

1. **Run debugging steps above** (5 minutes)
2. **Check browser console** for error messages
3. **Report the error message** if one appears
4. **We can then apply the specific fix** based on the actual error

Once we know the exact error, we can fix it!

---

## Reference: What Should Happen

**Correct Flow:**
1. User clicks recovery link from email ✅
2. Page loads with token in URL ✅
3. Page calls verifyOtp with token ✅
4. Supabase returns user data ✅
5. setTokenValid(true) and form appears ✅
6. User enters new password ✅
7. Page calls updateUser with new password ✅
8. Success message appears ✅
9. Redirect to login page ✅

If any step fails, we get the "Invalid or expired" error.

---

## Getting More Help

If debugging doesn't work:
1. **Check exact error in console** - Copy the full error message
2. **Check Supabase dashboard** - Look for auth errors
3. **Try a fresh reset email** - Sometimes tokens are genuinely expired
4. **Check network connection** - Ensure requests reach Supabase
