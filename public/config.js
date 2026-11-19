// Supabase connection for the Prayer Wall.
// Find both values in Supabase → Project Settings → API (or "Connect" → App Frameworks).
// The key here is the PUBLIC "publishable" (or legacy "anon") key: it is safe to publish,
// because the database only allows the checked functions in supabase/schema.sql.
// Never put the "secret" / "service_role" key in this file.
window.PRAYER_WALL_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
