/**
 * auth.js — Shared auth utilities
 * Used by pages that need to sync a Supabase session to Flask.
 */

/**
 * Sync an authenticated Supabase user to the Flask session.
 * Must be called after a successful signInWithPassword or signUp.
 * 
 * @param {object} user - Supabase user object (data.user)
 * @param {string} [nameOverride] - Optional name to use instead of user_metadata
 * @returns {boolean} true if Flask sync succeeded
 */
async function syncWithFlask(user, nameOverride) {
    try {
        const res = await fetch('/api/set_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: user.id,
                email: user.email,
                name: nameOverride || user.user_metadata?.full_name || user.email.split('@')[0]
            })
        });
        return res.ok;
    } catch (err) {
        console.error('[syncWithFlask] Network error:', err);
        return false;
    }
}
