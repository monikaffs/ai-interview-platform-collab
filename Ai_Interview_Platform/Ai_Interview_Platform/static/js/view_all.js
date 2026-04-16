async function loadFullHistory() {
    console.log("[History] Initializing history load...");
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        console.warn("[History] No authorized user found.");
        return;
    }

    console.log("[History] Fetching ALL sessions for user:", user.id);
    const { data: interviews, error } = await window.supabase
        .from('interview_sessions')
        .select(`
            *,
            jobs(title, company),
            interview_reports(technical_score, communication_score, confidence_score)
        `)
        .eq('user_id', user.id)
        // REMOVED: .eq('status', 'completed') - forcing to show all for visibility
        .order('started_at', { ascending: false });

    if (error) {
        console.error("[History] Supabase error:", error);
        return;
    }
    console.log(`[History] Successfully fetched ${interviews ? interviews.length : 0} sessions.`);
    interviews?.forEach(i => console.log(`[History] Session ${i.id} status: ${i.status}`));

    const listContainer = document.getElementById('full-history-list');
    if (listContainer) {
        if (!interviews || interviews.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-history">
                    <i class="fas fa-clipboard-list"></i>
                    <p>No interview sessions found. <a href="/explore" style="color:var(--accent);">Explore the catalog!</a></p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = interviews.map(i => {
            const report = i.interview_reports && i.interview_reports[0];
            let scoreDisplay = 'N/A';
            if (report) {
                const avg = (Number(report.technical_score || 0) + Number(report.communication_score || 0) + Number(report.confidence_score || 0)) / 3;
                scoreDisplay = `${Math.round(avg)}%`;
            }

            const roleName = i.jobs?.title || i.custom_job_title || 'AI Interview';
            const companyName = i.jobs?.company || 'AI Hire Ecosystem';
            const dateStr = new Date(i.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            
            return `
                <div class="history-row" data-status="${i.status}">
                    <div class="job-meta">
                        <span class="j-role">${roleName}</span>
                        <span class="j-company">${companyName}</span>
                    </div>
                    <div class="session-date">${dateStr}</div>
                    <div class="score-pill">${scoreDisplay}</div>
                    <div class="status-glow ${i.status}">
                        <span class="s-dot"></span>${i.status.toUpperCase()}
                    </div>
                    <a href="/results?session_id=${i.id}" class="aurora-link-btn">View Report</a>
                </div>
            `;
        }).join('');
    }
}
document.addEventListener('DOMContentLoaded', loadFullHistory);

