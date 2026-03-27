# ⚠️ URGENT: Reset Password Route 404 Fix - Manual Instructions

## Issue
The `/reset-password` route is returning **404 Not Found** when users click the password reset email link.

## Root Cause
The file `app/reset-password.tsx` is not recognized by Next.js 14 App Router because:
- ❌ Next.js only recognizes `page.tsx` files inside directories as routes
- ❌ Root-level `.tsx` files (except special ones) are ignored
- ✅ Correct structure: `app/reset-password/page.tsx`

## Quick Fix (3 steps - 1 minute)

Open **Command Prompt** (cmd.exe) and run these commands:

```batch
cd /d "C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"
mkdir reset-password
move reset-password.tsx reset-password\page.tsx
```

That's it! Then restart your dev server.

---

## Step-by-Step Guide

### Step 1: Open Command Prompt
- Press: **Windows Key + R**
- Type: `cmd`
- Press: **Enter**

### Step 2: Navigate to the app folder
Copy and paste this into Command Prompt:
```batch
cd /d "C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"
```
Press **Enter**

You should see the path in the prompt:
```
C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app>
```

### Step 3: Create the reset-password directory
Type or paste:
```batch
mkdir reset-password
```
Press **Enter**

### Step 4: Move the file
Type or paste:
```batch
move reset-password.tsx reset-password\page.tsx
```
Press **Enter**

Expected output:
```
1 file(s) moved.
```

### Step 5: Verify it worked
Type:
```batch
dir reset-password
```
Press **Enter**

You should see:
```
Directory: reset-password
page.tsx
```

### Step 6: Confirm old file is gone
Type:
```batch
dir reset-password.tsx
```
Press **Enter**

You should see:
```
File not found
```

Perfect! ✅

---

## After the Fix

1. **Restart your dev server:**
   ```bash
   # In your terminal where npm run dev is running:
   # Press Ctrl+C to stop
   # Then run: npm run dev
   ```

2. **Test the password reset:**
   - Click "Forgot Password" on login page
   - Enter your email
   - Check your email for recovery link
   - Click the link
   - ✅ Should now load reset password form (not 404!)

3. **Complete the reset:**
   - Enter new password
   - Should show success message
   - Try logging in with new password

---

## Troubleshooting

### If it still shows 404 after the fix:

**Clear the build cache:**
```batch
cd "C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end"
rmdir /s /q .next
npm run dev
```

### If move command fails:
You can do it manually via File Explorer:
1. Open: `C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app\`
2. Create folder: `reset-password`
3. Cut file: `reset-password.tsx`
4. Paste into: `reset-password\`
5. Rename to: `page.tsx`

---

## What This Fixes

| Before | After |
|--------|-------|
| ❌ `/reset-password` → 404 | ✅ `/reset-password` → Password form |
| ❌ Email link doesn't work | ✅ Email link works |
| ❌ File at `app/reset-password.tsx` | ✅ File at `app/reset-password/page.tsx` |

---

## Why This Works

Next.js 14 App Router file structure:
```
app/
├── page.tsx → route: /
├── dashboard/
│   └── page.tsx → route: /dashboard
├── reset-password/
│   └── page.tsx → route: /reset-password ✅
```

Files must be inside directories to be recognized as routes.

---

## ✅ Checklist

- [ ] Opened Command Prompt
- [ ] Navigated to `front-end\app` folder
- [ ] Created `reset-password` directory
- [ ] Moved `reset-password.tsx` to `reset-password\page.tsx`
- [ ] Verified new file exists: `reset-password\page.tsx`
- [ ] Verified old file removed: `reset-password.tsx`
- [ ] Restarted dev server (npm run dev)
- [ ] Tested password reset link - now works! ✅

---

## Need Help?

If you encounter any issues, check:
1. Correct path: `C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app`
2. File moved, not copied (should only exist in new location)
3. Dev server restarted after fix
4. `.next` folder deleted if still seeing 404

**Status:** Ready to fix! ✅ Run the commands above.
