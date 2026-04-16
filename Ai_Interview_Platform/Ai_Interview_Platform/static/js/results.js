/**
 * results.js — AI Hire Performance Report Driver
 *
 * Fetches the interview_reports row for the given session_id.
 * Parses the roadmap_items JSON column which now contains:
 *   { qa_breakdown: [...], verdict: "...", avg_score: X }
 *
 * Renders:
 *   1. Overall score ring (avg_score / 10 → out of 10, displayed as /10)
 *   2. Final verdict badge (Strong / Average / Needs Improvement)
 *   3. Competency metric bars (Technical, Communication, Relevance)
 *   4. Per-question Q&A cards with score badges and feedback
 *   5. AI behavioral insight summary
 */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReport);
} else {
    initReport();
}

async function initReport() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id') || urlParams.get('session');
    console.log("[Results] Initializing for session_id:", sessionId);

    const loadingEl = document.getElementById('results-loading');
    const contentEl = document.getElementById('results-content');
    const statusEl = document.getElementById('report-status');
    const tokenEl = document.getElementById('session-token-display');

    if (!sessionId) {
        // Fallback: Show Global Analytics instead of "Report Unavailable"
        console.log('[Results] No session ID. Showing global analytics.');
        initGlobalAnalytics(loadingEl, contentEl);
        return;
    }

    // Display short hash of session ID (First 8 chars)
    if (tokenEl) {
        if (!sessionId) {
            tokenEl.style.display = 'none'; // Hide if no session in URL
        } else {
            const shortHash = sessionId.substring(0, 8).toUpperCase();

            // Try to get name from the highlight span rendered by Flask, fallback to 'User'
            const nameEl = document.querySelector('.welcome-text .highlight');
            const userName = nameEl ? nameEl.innerText.trim() : 'Candidate';

            tokenEl.style.display = 'block';
            tokenEl.innerHTML = `Session: <strong style="color:var(--accent);">#${shortHash}</strong> | User: <strong style="color:var(--accent);">${userName}</strong>`;
        }
    }

    try {
        // --- STEP 1: CHECK LOCALSTORAGE (Instant Load) ---
        // This is our primary data source for the session we just finished.
        const localData = localStorage.getItem('latest_interview_report');
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                // Only use it if it matches the current session in URL
                if (!sessionId || parsed.session_id === sessionId) {
                    console.log('[Results] Loading report from localStorage (Instant)');
                    renderFullReport(parsed);
                    return;
                }
            } catch (e) {
                console.warn('[Results] Could not parse localStorage report:', e);
            }
        }

        // --- STEP 2: FALLBACK TO SUPABASE ---
        // Used when viewing history or if localStorage was cleared.
        console.log('[Results] Fetching from Supabase (Historical)');
        const { data: report, error: fetchErr } = await window.supabase
            .from('interview_reports')
            .select(`
                *,
                interview_sessions (
                    total_time_seconds,
                    custom_job_title,
                    jobs (title, company)
                )
            `)
            .eq('session_id', sessionId)
            .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (!report) {
            console.warn('[Results] No report found in database for session:', sessionId);
            throw new Error('No report found for this session.');
        }

        console.log('[Results] Report data retrieved:', report);
        renderFullReport(report);

    } catch (err) {
        console.error('[Results] Page Load Error:', err);
        const loadingEl = document.getElementById('results-loading');
        showError(loadingEl, err.message || 'Failed to load report.');
    }
}

/** 
 * Modular rendering function to handle both localStorage and Supabase data sources
 */
function renderFullReport(report) {
    console.log('[Results] Rendering report:', report);

    // --- PARSE ROADMAP_ITEMS ---
    let qaBreakdown = [];
    let verdict = null;
    let avgScore = null;

    const raw = report.roadmap_items;
    try {
        // Handle both parsed objects (localStorage) and raw JSON/strings (Supabase)
        const parsed = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
        if (parsed && parsed.qa_breakdown) {
            qaBreakdown = parsed.qa_breakdown;
            verdict = parsed.verdict;
            avgScore = parsed.avg_score;
        }
    } catch (e) {
        // If it's already an object (from localStorage) but not in roadmap_items key
        if (report.qa_breakdown) {
            qaBreakdown = report.qa_breakdown;
            verdict = report.verdict;
            avgScore = report.avg_score;
        } else {
            console.error('[Results] Data parse error:', e);
        }
    }

    // --- SCORES ---
    const tScore = Number(report.technical_score || 0);
    const cScore = Number(report.communication_score || 0);
    const rScore = Number(report.confidence_score || 0);

    // CALCULATE OVERALL ON THE FLY (Standard 0-10 Scale)
    const oScore = (tScore + cScore + rScore) / 3;
    const displayScore = (avgScore !== null && avgScore !== undefined)
        ? Number(avgScore)
        : parseFloat(oScore.toFixed(1));

    // --- EXTRACT METADATA ---
    const session = report.interview_sessions;
    const roleTitle = session?.jobs?.title || session?.custom_job_title || report.role_title || 'AI Evaluation';
    const company = session?.jobs?.company || report.company_name || 'AI Hire';
    const duration = session?.total_time_seconds || report.seconds_elapsed || 0;

    // UI Updates
    const loadingEl = document.getElementById('results-loading');
    const contentEl = document.getElementById('results-content');

    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';

    // Populate NEW Horizontal Card
    const roleEl = document.getElementById('display-role');
    const compEl = document.getElementById('display-company');
    const timeEl = document.getElementById('display-duration');
    const scoreEl = document.getElementById('overall-score-text');

    if (roleEl) roleEl.innerText = roleTitle;
    if (compEl) compEl.innerText = company;
    if (timeEl) {
        const m = Math.floor(duration / 60);
        const s = duration % 60;
        timeEl.innerText = `${m} mins ${s} sec`;
    }
    if (scoreEl) scoreEl.innerHTML = `${displayScore.toFixed(1)}<span>/10</span>`;

    // Render Components
    const ringEl = document.getElementById('main-score-ring');
    if (ringEl) animateScoreRing(displayScore, ringEl);

    renderVerdict(verdict, displayScore);

    animateBar('bar-technical', 'val-technical', tScore);
    animateBar('bar-communication', 'val-communication', cScore);
    animateBar('bar-confidence', 'val-confidence', rScore);

    renderQACards(qaBreakdown);

    const summaryEl = document.getElementById('ai-summary-text');
    if (summaryEl) {
        summaryEl.innerText = report.feedback_summary
            || 'Session evaluated successfully. See breakdown below.';
    }
}


// ==========================================
// RENDER VERDICT BADGE
// ==========================================
function renderVerdict(verdict, avgScore) {
    const iconEl = document.getElementById('verdict-icon');
    const titleEl = document.getElementById('verdict-title');
    const descEl = document.getElementById('verdict-description');
    if (!iconEl || !titleEl || !descEl) return;

    // Determine verdict from score if not passed
    let finalVerdict = verdict;
    if (!finalVerdict) {
        if (avgScore >= 8) finalVerdict = 'Strong Candidate';
        else if (avgScore >= 5) finalVerdict = 'Average Performance';
        else finalVerdict = 'Needs Improvement';
    }

    const configs = {
        'Strong Candidate': {
            icon: '<i class="fas fa-trophy"></i>',
            bg: 'rgba(34,197,94,0.15)',
            color: '#4ade80',
            desc: `Outstanding performance! Your answers demonstrated strong technical knowledge, clear communication, and excellent relevance. You are a strong hire candidate.`
        },
        'Average Performance': {
            icon: '<i class="fas fa-chart-line"></i>',
            bg: 'rgba(245,158,11,0.15)',
            color: '#fbbf24',
            desc: `Solid performance overall. Some answers were strong while others need refinement. With targeted preparation you can significantly improve your score.`
        },
        'Needs Improvement': {
            icon: '<i class="fas fa-seedling"></i>',
            bg: 'rgba(239,68,68,0.15)',
            color: '#f87171',
            desc: `Your answers need significant improvement in relevance, correctness, or clarity. Review the per-question feedback below for specific guidance.`
        }
    };

    const cfg = configs[finalVerdict] || configs['Needs Improvement'];

    iconEl.style.background = cfg.bg;
    iconEl.style.color = cfg.color;
    iconEl.innerHTML = cfg.icon;
    titleEl.innerText = finalVerdict;
    titleEl.style.color = cfg.color;
    descEl.innerText = cfg.desc;
}

// ==========================================
// RENDER PER-QUESTION Q&A CARDS
// ==========================================
function renderQACards(qaBreakdown) {
    const container = document.getElementById('qa-cards-container');
    if (!container) return;

    if (!qaBreakdown || qaBreakdown.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--text-dim);">
                <i class="fas fa-comment-slash" style="font-size:2rem; margin-bottom:12px; opacity:0.4; display:block;"></i>
                No per-question breakdown available for this session.
            </div>`;
        return;
    }

    container.innerHTML = qaBreakdown.map((item, index) => {
        const score = Number(item.score || 0);
        const relevance = Number(item.relevance || 0);
        const correctness = Number(item.correctness || 0);
        const clarity = Number(item.clarity || 0);
        const feedback = item.feedback || 'No feedback available.';

        // Score tier
        let scoreClass = 'score-low';
        if (score >= 8) scoreClass = 'score-high';
        else if (score >= 5) scoreClass = 'score-mid';

        // Feedback border color
        let feedbackBorder = '#ef4444';
        if (score >= 8) feedbackBorder = '#22c55e';
        else if (score >= 5) feedbackBorder = '#f59e0b';

        // Format question (truncate very long questions at 200 chars for header)
        const questionDisplay = item.question
            ? item.question.trim()
            : 'Question not recorded.';

        // Format answer
        const answerDisplay = item.answer
            ? item.answer.trim()
            : 'No answer recorded.';

        return `
        <div class="qa-card" style="animation: fadeInUp 0.4s ease ${index * 0.08}s both;">
            <div class="qa-card-header">
                <div class="qa-question-wrap">
                    <div class="q-number">Question ${index + 1}</div>
                    <div class="q-text">${escapeHtml(questionDisplay)}</div>
                </div>
                <div class="score-badge ${scoreClass}">
                    <span class="s-num">${score}</span>
                    <span class="s-den">/10</span>
                </div>
            </div>

            <div class="qa-card-body">
                <!-- User Answer -->
                <div class="qa-answer-box">
                    <div class="answer-label"><i class="fas fa-user" style="margin-right:5px;"></i>Your Answer</div>
                    <div class="answer-text">${escapeHtml(answerDisplay)}</div>
                </div>

                <!-- Sub-scores -->
                <div class="sub-scores">
                    <span class="sub-chip">
                        <i class="fas fa-bullseye" style="margin-right:4px; color:var(--accent);"></i>
                        Relevance: ${relevance}/4
                    </span>
                    <span class="sub-chip">
                        <i class="fas fa-check-circle" style="margin-right:4px; color:var(--accent);"></i>
                        Correctness: ${correctness}/3
                    </span>
                    <span class="sub-chip">
                        <i class="fas fa-comments" style="margin-right:4px; color:var(--accent);"></i>
                        Clarity: ${clarity}/3
                    </span>
                </div>

                <!-- AI Feedback -->
                <div class="qa-feedback" style="border-left-color: ${feedbackBorder};">
                    <i class="fas fa-robot"></i>
                    <p>${escapeHtml(feedback)}</p>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// SCORE RING ANIMATION (0 → displayScore out of 10)
// ==========================================
function animateScoreRing(targetScore, ringEl) {
    const scoreEl = ringEl.querySelector('.big-score');
    // Target is /10 — convert to 0-360 degrees
    const targetDeg = (targetScore / 10) * 360;

    let start = null;
    const duration = 1800;

    // Color based on score
    let ringColor = 'var(--accent)';
    if (targetScore < 5) ringColor = '#ef4444';
    else if (targetScore < 8) ringColor = '#f59e0b';

    function step(ts) {
        if (!start) start = ts;
        const prog = Math.min((ts - start) / duration, 1);
        const ease = prog * (2 - prog); // ease-out quad

        const curScore = parseFloat((ease * targetScore).toFixed(1));
        const curDeg = ease * targetDeg;

        if (scoreEl) scoreEl.innerText = curScore.toFixed(1);
        ringEl.style.background = `conic-gradient(${ringColor} ${curDeg}deg, var(--surface2) 0deg)`;

        if (prog < 1) {
            requestAnimationFrame(step);
        } else {
            ringEl.style.boxShadow = `0 0 30px rgba(14,165,233,0.35)`;
        }
    }

    requestAnimationFrame(step);
}

// ==========================================
// METRIC BAR ANIMATIONS
// ==========================================
function animateBar(barId, textId, value) {
    const bar = document.getElementById(barId);
    const txt = document.getElementById(textId);

    if (txt) {
        let cur = 0;
        const target = Math.round(value);
        const step = Math.max(1, Math.floor(target / 40));
        const intvl = setInterval(() => {
            cur = Math.min(cur + step, target);
            txt.innerText = cur + '%';
            if (cur >= target) clearInterval(intvl);
        }, 20);
    }

    if (bar) {
        setTimeout(() => {
            bar.style.width = Math.round(value) + '%';
        }, 200);
    }
}

// ==========================================
// UTILITIES
// ==========================================
/**
 * initGlobalAnalytics — Fetches all past reports and renders a summary
 */
async function initGlobalAnalytics(loadingEl, contentEl) {
    try {
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) throw new Error("Please log in to view analytics.");

        // Fetch all reports for this user
        console.log("[History] Fetching ALL sessions for user:", user.id);
        const { data: interviews, error } = await window.supabase
            .from('interview_sessions')
            .select(`
                *,
                jobs(title, company),
                interview_reports(technical_score, communication_score, confidence_score)
            `)
            .eq('user_id', user.id)
            .order('started_at', { ascending: false });

        if (error) {
            console.error("[History] Supabase error:", error);
            return;
        }
        console.log(`[History] Successfully fetched ${interviews ? interviews.length : 0} sessions.`);
        interviews?.forEach(i => console.log(`[History] Session ${i.id} status: ${i.status}`));

        if (loadingEl) loadingEl.style.display = 'none';
        const globalSection = document.getElementById('global-analytics-content');
        if (globalSection) globalSection.style.display = 'block';

        const avgEl = document.getElementById('global-avg-score');
        const listEl = document.getElementById('global-scores-list');

        if (!reports || reports.length === 0) {
            if (avgEl) avgEl.innerText = '0%';
            if (listEl) {
                listEl.innerHTML = `
                    <div style="text-align:center; padding:40px 20px; background:var(--surface2); border-radius:24px; border:1px dashed var(--border); margin-top:20px;">
                        <i class="fas fa-clipboard-check" style="font-size:3rem; color:var(--text-dim); margin-bottom:20px; display:block; opacity:0.3;"></i>
                        <p style="color:var(--text); font-size:1.1rem; font-weight:600; margin-bottom:12px;">You have no reports yet.</p>
                        <p style="color:var(--text-dim); margin-bottom:24px; font-size:0.95rem; line-height:1.5;">Take your first interview to see your performance insights.</p>
                        <a href="/explore" class="aurora-btn" style="text-decoration:none; display:inline-flex; align-items:center; gap:10px; padding:12px 28px; background:var(--accent); color:white; border-radius:14px; font-weight:700; transition:0.2s;">
                            <i class="fas fa-play"></i> Start Interview
                        </a>
                    </div>
                `;
            }
            return;
        }

        // Calculate Average across all (Tech + Comm + Conf)
        let grandTotal = 0;
        reports.forEach(r => {
            const rowAvg = (Number(r.technical_score || 0) + Number(r.communication_score || 0) + Number(r.confidence_score || 0)) / 3;
            grandTotal += rowAvg;
        });
        const finalAvg = Math.round(grandTotal / reports.length);
        if (avgEl) avgEl.innerText = finalAvg + '%';

        // Render List (Top 5)
        if (listEl) {
            listEl.innerHTML = reports.slice(0, 5).map(r => {
                const d = new Date(r.created_at).toLocaleDateString();
                const s = Math.round((Number(r.technical_score || 0) + Number(r.communication_score || 0) + Number(r.confidence_score || 0)) / 3);
                return `
                    <a href="/results?session_id=${r.session_id}" class="glass-pill" style="display:flex; justify-content:space-between; text-decoration:none; width:100%; padding:12px 20px;">
                        <span><i class="fas fa-calendar-alt" style="margin-right:10px; color:var(--accent);"></i>${d}</span>
                        <strong style="color:var(--accent);">${s}%</strong>
                    </a>
                `;
            }).join('');
        }

    } catch (err) {
        console.error('[Results] Global Analytics Error:', err);
        showError(loadingEl, err.message);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showError(loadingEl, message) {
    if (loadingEl) {
        loadingEl.innerHTML = `
            <div class="spinner" style="color:#f87171;"><i class="fas fa-exclamation-circle"></i></div>
            <h3 style="color:#f87171;">Report Unavailable</h3>
            <p>${message}</p>
        `;
    }
}