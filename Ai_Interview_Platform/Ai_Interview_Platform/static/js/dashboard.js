/**
 * dashboard.js — FIXED (No redirect loop)
 */

async function guardDashboard() {
    try {
        const { data: { session } } = await window.supabase.auth.getSession();

        // ❗ IMPORTANT: DO NOT redirect automatically
        if (!session) {
            console.warn("No Supabase session — skipping redirect");
            return true;
        }

        // Sync with Flask session if missing
        const flaskSessionEl = document.getElementById('flask-user-id');

        if (!flaskSessionEl || !flaskSessionEl.dataset.userId) {
            const user = session.user;

            await fetch('/api/set_session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: user.id,
                    email: user.email,
                    name: user.user_metadata?.full_name || user.email
                })
            });

            console.log("Flask session synced");
        }

        return true;

    } catch (err) {
        console.error("Guard error:", err);
        return true;
    }
}

// =============================
// MAIN INIT
// =============================
async function initDashboard() {
    await guardDashboard();

    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        console.warn("No user found — but not redirecting");
        return;
    }

    // ===== STATS =====
    const { data: sessions } = await window.supabase
        .from('interview_sessions')
        .select('status, interview_reports(technical_score, communication_score, confidence_score)')
        .eq('user_id', user.id);

    if (sessions) {
        const completed  = sessions.filter(s => s.status === 'completed');
        const inProgress = sessions.filter(s => s.status === 'in_progress');

        let total = 0, count = 0;

        completed.forEach(s => {
            const r = s.interview_reports?.[0];
            if (r) {
                total += (r.technical_score + r.communication_score + r.confidence_score) / 3;
                count++;
            }
        });

        const avg = count ? Math.round(total / count) : 0;

        setStat('stat-total', sessions.length);
        setStat('stat-completed', completed.length);
        setStat('stat-pending', inProgress.length);
        setStat('stat-avg-score', avg ? avg + '%' : '--');
    }

    // ===== HISTORY =====
    const { data: history } = await window.supabase
        .from('interview_sessions')
        .select(`id, started_at, status`)
        .eq('user_id', user.id)
        .limit(5);

    const container = document.getElementById('recent-history-list');

    if (container) {
        if (!history || history.length === 0) {
            container.innerHTML = '<p>No sessions yet</p>';
        } else {
            container.innerHTML = history.map(h => `
                <div class="history-row">
                    <span>${new Date(h.started_at).toLocaleDateString()}</span>
                    <span>${h.status}</span>
                </div>
            `).join('');
        }
    }
}

// =============================
function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

// =============================
document.addEventListener('DOMContentLoaded', initDashboard);