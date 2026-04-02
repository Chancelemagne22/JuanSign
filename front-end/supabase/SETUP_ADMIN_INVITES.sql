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
CREATE POLICY "Allow viewing valid unused invites"
    ON public.admin_invites
    FOR SELECT
    USING (
        is_used = false 
        AND expires_at > now()
    );

-- Policy: Allow RPC function to update invites
CREATE POLICY "Allow updating invite status via RPC"
    ON public.admin_invites
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

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

    -- Update user role to admin
    UPDATE profiles
    SET role = 'admin'
    WHERE id = user_id;

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
