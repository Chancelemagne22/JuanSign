import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: 'Supabase environment variables are missing.' }, { status: 500 });
  }

  const authClient = createClient(url, anonKey);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const formData = await request.formData();
  const photo = formData.get('photo');

  if (!(photo instanceof File) || photo.size <= 0) {
    return NextResponse.json({ error: 'Missing photo file.' }, { status: 400 });
  }

  const serviceClient = createClient(url, serviceRoleKey);

  const ext = photo.name.split('.').pop() || 'jpg';
  const filePath = `${user.id}.${ext}`;
  const buffer = await photo.arrayBuffer();

  const { error: uploadError } = await serviceClient.storage
    .from('avatars')
    .upload(filePath, buffer, { contentType: photo.type, upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data: urlData } = serviceClient.storage.from('avatars').getPublicUrl(filePath);
  const avatarUrl = urlData.publicUrl;

  const { error: profileError } = await serviceClient
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('auth_user_id', user.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ avatarUrl });
}
