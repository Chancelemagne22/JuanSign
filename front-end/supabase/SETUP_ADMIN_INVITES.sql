-- Migration: Create admin_invites table and RPC function
-- File: front-end/supabase/migrations/001_admin_invites.sql
-- Instructions: Run this SQL in your Supabase dashboard under SQL Editor

-- ===== CREATE TABLE =====
CREATE TABLE IF NOT EXISTS public.admin_invites (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text NOT NULL UNIQUE,
    is_used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    used_at timestamp with time zone
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS admin_invites_code_idx ON public.admin_invites(code);
CREATE INDEX IF NOT EXISTS admin_invites_is_used_idx ON public.admin_invites(is_used);

-- ===== ENABLE ROW LEVEL SECURITY =====
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

-- Policy: Super admin can view all invites
DROP POLICY IF EXISTS "Allow super_admin to view admin_invites" ON public.admin_invites;
CREATE POLICY "Allow super_admin to view admin_invites"
    ON public.admin_invites
    FOR SELECT
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles
            WHERE role = 'super_admin'
        )
    );

-- Policy: Super admin can create invites
DROP POLICY IF EXISTS "Allow super_admin to create admin_invites" ON public.admin_invites;
CREATE POLICY "Allow super_admin to create admin_invites"
    ON public.admin_invites
    FOR INSERT
    WITH CHECK (
        auth.uid() IN (
            SELECT id FROM public.profiles
            WHERE role = 'super_admin'
        )
    );

-- Policy: Anyone can view unused valid invites (for validation on setup page)
DROP POLICY IF EXISTS "Allow viewing valid unused invites" ON public.admin_invites;
CREATE POLICY "Allow viewing valid unused invites"
    ON public.admin_invites
    FOR SELECT
    USING (
        is_used = false 
        AND expires_at > now()
    );

-- Policy: Allow RPC function to update invites
DROP POLICY IF EXISTS "Allow updating invite status via RPC" ON public.admin_invites;
CREATE POLICY "Allow updating invite status via RPC"
    ON public.admin_invites
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- ===== ADMINS TABLE RLS POLICIES =====
-- Enable RLS on admins table if not already enabled
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Policy: Any authenticated admin can read their own record
DROP POLICY IF EXISTS "Admins can read own record" ON public.admins;
CREATE POLICY "Admins can read own record"
    ON public.admins
    FOR SELECT
    USING (
        -- Check if the current user's ID matches the auth_user_id in the record
        auth.uid() = auth_user_id
        OR
        -- Also allow if user is an admin
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE auth_user_id = auth.uid()
            AND role IN ('admin', 'pending_admin', 'super_admin')
        )
    );

-- Policy: RPC function can insert admins (for signup)
DROP POLICY IF EXISTS "Allow RPC to insert admins" ON public.admins;
CREATE POLICY "Allow RPC to insert admins"
    ON public.admins
    FOR INSERT
    WITH CHECK (true);

-- Policy: Super admins can read all admin records
DROP POLICY IF EXISTS "Super admins can read all admins" ON public.admins;
CREATE POLICY "Super admins can read all admins"
    ON public.admins
    FOR SELECT
    USING (
        auth.uid() IN (
            SELECT auth_user_id FROM public.profiles
            WHERE role = 'super_admin'
        )
    );

-- ===== CREATE RPC FUNCTION TO FETCH ADMIN INFO =====
-- This function bypasses RLS since it uses SECURITY DEFINER
DROP FUNCTION IF EXISTS get_admin_info(uuid);
CREATE OR REPLACE FUNCTION get_admin_info(p_user_id uuid)
RETURNS TABLE (username text, full_name text) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.username::text, 
        COALESCE(a.full_name, '')::text as full_name
    FROM public.admins a
    WHERE a.auth_user_id = p_user_id
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Make sure authenticated users can execute this function
GRANT EXECUTE ON FUNCTION get_admin_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_info(uuid) TO anon;

-- ===== CREATE RPC FUNCTION =====
CREATE OR REPLACE FUNCTION handle_admin_signup(
    invite_code text,
    user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite_id uuid;
    v_is_used boolean;
    v_expires_at timestamp with time zone;
    v_username text;
    v_email text;
BEGIN
    -- Verify invite code exists and is valid
    SELECT id, is_used, expires_at 
    INTO v_invite_id, v_is_used, v_expires_at
    FROM admin_invites
    WHERE code = invite_code;

    -- Check if invite exists
    IF v_invite_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invite code not found'
        );
    END IF;

    -- Check if invite is already used
    IF v_is_used THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invite code has already been used'
        );
    END IF;

    -- Check if invite is expired
    IF v_expires_at < now() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invite code has expired'
        );
    END IF;

    -- Get username from profiles table
    SELECT username INTO v_username
    FROM profiles
    WHERE auth_user_id = user_id;

    -- If username not found in profiles, generate from auth email
    IF v_username IS NULL THEN
        SELECT email INTO v_email
        FROM auth.users
        WHERE id = user_id;
        
        v_username := COALESCE(
            v_username,
            SPLIT_PART(v_email, '@', 1) || '_' || SUBSTRING(user_id::text, 1, 8)
        );
    END IF;

    -- Update user role to admin
    UPDATE profiles
    SET role = 'admin'
    WHERE auth_user_id = user_id;

    -- Insert into admins table with generated username if needed
    INSERT INTO admins (auth_user_id, username, full_name, created_at)
    VALUES (user_id, v_username, '', now())
    ON CONFLICT (auth_user_id) DO NOTHING;

    -- Mark invite as used
    UPDATE admin_invites
    SET is_used = true, used_by_user_id = user_id, used_at = now()
    WHERE id = v_invite_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Admin role granted successfully'
    );
END;
$$;

-- ===== GRANT PERMISSIONS =====
GRANT EXECUTE ON FUNCTION handle_admin_signup(text, uuid) TO authenticated;
