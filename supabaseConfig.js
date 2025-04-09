let supa = null;

async function initSupabaseFromConfig() {
    const TEMP_SUPABASE_URL = 'https://pgnlssmozwrxqfchrtav.supabase.co';
    const TEMP_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnbmxzc21vendyeHFmY2hydGF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3NTE1NjMsImV4cCI6MjA1OTMyNzU2M30.7TeUwKyobnQ-QR3FC_b2x5BwsdQnYRlH85ZFdRS4miE'; // Replace with actual anon key

    const tempClient = supabase.createClient(TEMP_SUPABASE_URL, TEMP_SUPABASE_KEY);

    const { data, error } = await tempClient.from('config').select('*');
    if (error) {
        console.error('Failed to load Supabase config:', error);
        return null;
    }

    const config = Object.fromEntries(data.map(item => [item.key.trim(), item.value.trim()]));
    console.log('🧪 Final Supabase config:', config);
;
    supa = supabase.createClient(config.supabase_url, config.supabase_anon_key);
    console.log('✅ Supabase initialized from config');
    return supa;
}
