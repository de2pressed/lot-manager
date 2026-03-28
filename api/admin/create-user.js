import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function parseBody(req) {
  if (typeof req.body === 'object' && req.body !== null) {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }

  return {};
}

async function getCaller(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return { error: 'Invalid token', status: 401 };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    return { error: 'Admin only', status: 403 };
  }

  return { user };
}

export default async function handler(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const caller = await getCaller(req);
  if (caller.error) {
    return res.status(caller.status).json({ error: caller.error });
  }

  if (req.method === 'POST') {
    const { email, password, username, role } = await parseBody(req);

    if (!email || !password || !username || !role) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (createError) {
      return res.status(500).json({ error: createError.message });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ username, role, created_by: caller.user.id })
      .eq('id', newUser.user.id);

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    return res.status(200).json({ success: true, userId: newUser.user.id });
  }

  const { userId } = await parseBody(req);
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true });
}
