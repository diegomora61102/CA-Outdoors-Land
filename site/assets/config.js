// Public settings for the website. The anon key is meant to be public: Supabase row-level security
// (supabase/schema.sql) decides what it can read and write. Never put the service-role key here.
window.APP_CONFIG = {
  supabaseUrl: 'https://jkofqhhyimfuidxrvjcn.supabase.co',
  supabaseAnonKey: 'sb_publishable_gaBERIFx4Greu75xZ8wP1Q_C8JYSYxB',   // publishable (public) key
  googleSignIn: false     // set true after enabling Google under Authentication -> Providers
};
