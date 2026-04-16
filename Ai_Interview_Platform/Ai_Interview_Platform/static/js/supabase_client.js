/**
 * AI Hire - Supabase Master Client
 * 
 * IMPORTANT: This file is loaded ONLY on pages that don't already
 * initialize their own inline client (i.e., pages other than login/signup).
 * 
 * login.html, signup.html, and auth_callback.html each initialize
 * their own client inline to avoid load-order issues with the CDN script.
 * 
 * This file is used by: dashboard, profile, interview, results, etc.
 */

// Guard: only initialize if not already done by an inline script
if (!window._supabaseInitialized) {
    window._supabaseInitialized = true;

    const SUPABASE_URL = 'https://isofuilekbgleahrxnkc.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_M7ZeZgexKOn82r8cXzfxdw_ZRNikdVp';

    // The CDN exposes supabase as the library; createClient gives us the instance
    const _lib = window.supabase;
    const _client = _lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabase = _client;

    // Listen for auth state changes (silent - for logging/debugging)
    window.supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Supabase Auth]', event, session ? 'session active' : 'no session');
    });
}

/**
 * =====================================================
 * SHARED HELPERS (available globally to all pages)
 * =====================================================
 */

/** Sign the user out of both Supabase and Flask */
window.signOutUser = async function () {
    await window.supabase.auth.signOut();
    window.location.href = '/logout'; // Flask clears its session cookie
};

/** Trigger Google OAuth login flow */
window.handleGoogleAuth = async function () {
    const { error } = await window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + '/auth/callback'
        }
    });
    if (error) showToast('Google Login Failed: ' + error.message, 'error');
};

/** Fetch the current Supabase user's full profile row from `profiles` table */
async function getCurrentUserProfile() {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await window.supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error) console.error('[Profile] Error fetching profile:', error.message);
    return data;
}

/** Update profile intelligence fields */
async function updateProfileIntelligence(profileData) {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) throw new Error('No user logged in');

    const { data, error } = await window.supabase
        .from('profiles')
        .update({
            full_name: profileData.full_name,
            primary_role: profileData.primary_role,
            experience_level: profileData.experience_level,
            technical_stack: profileData.technical_stack,
            custom_skills: profileData.custom_skills,
            opportunity_type: profileData.opportunity_type,
            location: profileData.location,
            github_url: profileData.github_url,
            linkedin_url: profileData.linkedin_url,
            phone_number: profileData.phone_number,
            resume_url: profileData.resume_url,
            updated_at: new Date()
        })
        .eq('id', user.id);

    if (error) throw error;
    return data;
}

/** Upload a resume PDF to Supabase Storage */
async function uploadResumeFile(file) {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}_${Date.now()}.${fileExt}`;
    const filePath = `resumes/${fileName}`;

    const { error: uploadError } = await window.supabase.storage
        .from('resumes')
        .upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data } = window.supabase.storage
        .from('resumes')
        .getPublicUrl(filePath);

    return data.publicUrl;
}

/**
 * =====================================================
 * TOAST NOTIFICATION UTILITY
 * =====================================================
 */
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed; bottom: 24px; right: 24px;
            display: flex; flex-direction: column; gap: 10px;
            z-index: 9999;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const isSuccess = type === 'success';
    toast.style.cssText = `
        background: ${isSuccess ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};
        border: 1px solid ${isSuccess ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'};
        color: ${isSuccess ? '#86efac' : '#f87171'};
        padding: 14px 20px; border-radius: 14px;
        font-family: Inter, sans-serif; font-size: 0.9rem; font-weight: 600;
        display: flex; align-items: center; gap: 10px;
        backdrop-filter: blur(10px);
        animation: toastIn 0.3s ease;
        max-width: 320px;
    `;
    toast.innerHTML = `<i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${message}</span>`;

    // Inject keyframes once
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes toastIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
            @keyframes toastOut { from { opacity:1; } to { opacity:0; transform:translateY(10px); } }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
