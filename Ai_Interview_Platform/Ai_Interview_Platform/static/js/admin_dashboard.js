/* ============================================================
   ADMIN_DASHBOARD.JS — Recruiter Dashboard Logic
   Place in: static/js/admin_dashboard.js
   Depends on: supabase_client.js (window.supabase)
   Reads from Supabase table: interview_sessions
   ============================================================

   Expected table columns:
     id                  uuid / text
     user_id             uuid
     user_name           text
     user_email          text
     job_title           text
     company             text
     score               numeric (0–10)
     status              text  (pending | completed | approved | rejected)
     created_at          timestamptz
     duration_seconds    integer
     questions           jsonb  — array of { q, a, score, feedback }
     technical_score     numeric (0–100)
     communication_score numeric (0–100)
     relevance_score     numeric (0–100)
     ai_summary          text
     focus_violations    integer
     recruiter_notes     text
*/

'use strict';

/* ── State ──────────────────────────────────────────────────── */
let ALL_CANDIDATES     = [];
let FILTERED           = [];
let CURRENT_STATUS     = 'all';
let CURRENT_ID         = null;

const AVATAR_CLASSES   = ['av-0','av-1','av-2','av-3','av-4','av-5'];

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadCandidates();
    // Esc closes modal
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
});

/* ============================================================
   DATA — Supabase fetch
   ============================================================ */
async function loadCandidates() {
    try {
        const client = window.supabase;
        if (!client) throw new Error('Supabase client not initialised');

        const { data, error } = await client
            .from('interview_sessions')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        ALL_CANDIDATES = data || [];

    } catch (err) {
        console.warn('[Admin] Supabase error — using demo data:', err.message);
        ALL_CANDIDATES = _demoData();
        showToast('Demo mode — connect Supabase for live data', 'info');
    }

    FILTERED = [...ALL_CANDIDATES];
    renderStats();
    renderTable();
}

/* ============================================================
   STATS
   ============================================================ */
function renderStats() {
    const total     = ALL_CANDIDATES.length;
    const completed = ALL_CANDIDATES.filter(c => ['completed','approved','rejected'].includes(c.status)).length;
    const approved  = ALL_CANDIDATES.filter(c => c.status === 'approved').length;
    const rejected  = ALL_CANDIDATES.filter(c => c.status === 'rejected').length;
    const scores    = ALL_CANDIDATES.map(c => parseFloat(c.score) || 0).filter(s => s > 0);
    const avg       = scores.length ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : '—';

    _el('stat-total').textContent     = total;
    _el('stat-completed').textContent = completed;
    _el('stat-approved').textContent  = approved;
    _el('stat-rejected').textContent  = rejected;
    _el('stat-avg').textContent       = avg !== '—' ? avg + '/10' : '—';
    _el('total-count-label').textContent = `reviewing ${total} candidate${total !== 1 ? 's' : ''}`;
}

/* ============================================================
   TABLE RENDER
   ============================================================ */
function renderTable() {
    // Remove skeleton / loading placeholder
    const loading = _el('admin-loading');
    if (loading) loading.remove();

    const list = _el('candidates-list');

    if (!FILTERED.length) {
        list.innerHTML = `
            <div class="admin-empty">
                <i class="fas fa-users-slash"></i>
                <p>No candidates match this filter.</p>
            </div>`;
        return;
    }

    list.innerHTML = FILTERED.map((c, idx) => {
        const sc        = _normaliseScore(c.score);  // 0–10
        const scDisplay = sc.toFixed(1);
        const scClass   = _scoreClass(sc);
        const avClass   = _avatarClass(c.user_name);
        const init      = _initials(c.user_name);
        const status    = c.status || 'pending';

        return `
        <div class="candidate-row"
             data-status="${status}"
             data-id="${c.id}"
             onclick="openModal(${idx})">

            <!-- Candidate -->
            <div class="candidate-identity">
                <div class="cand-avatar ${avClass}">${init}</div>
                <div>
                    <div class="cand-name">${_esc(c.user_name || 'Unknown')}</div>
                    <div class="cand-email">${_esc(c.user_email || '—')}</div>
                </div>
            </div>

            <!-- Role -->
            <div>
                <div class="cand-role">${_esc(c.job_title || '—')}</div>
                <div class="cand-company">${_esc(c.company || '—')}</div>
            </div>

            <!-- Score -->
            <div>
                <div class="admin-score-bubble ${scClass}">${scDisplay}</div>
            </div>

            <!-- Date -->
            <div class="date-cell">${_fmtDate(c.created_at)}</div>

            <!-- Duration -->
            <div class="date-cell">${_fmtDuration(c.duration_seconds)}</div>

            <!-- Status -->
            <div>
                <span class="status-glow ${status}">
                    <span class="s-dot"></span>
                    ${_cap(status)}
                </span>
            </div>

            <!-- Actions (stop row click propagation) -->
            <div class="row-actions" onclick="event.stopPropagation()">
                <button class="row-btn row-btn-view"
                        onclick="openModal(${idx})" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="row-btn row-btn-approve"
                        onclick="quickStatus(${idx},'approved')" title="Approve">
                    <i class="fas fa-check"></i>
                </button>
                <button class="row-btn row-btn-reject"
                        onclick="quickStatus(${idx},'rejected')" title="Reject">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

/* ============================================================
   FILTER & SORT
   ============================================================ */
function filterCandidates() {
    const q = (_el('candidate-search').value || '').toLowerCase();
    FILTERED = ALL_CANDIDATES.filter(c => {
        const matchSearch = !q ||
            (c.user_name  || '').toLowerCase().includes(q) ||
            (c.user_email || '').toLowerCase().includes(q) ||
            (c.job_title  || '').toLowerCase().includes(q) ||
            (c.company    || '').toLowerCase().includes(q);
        const matchStatus = CURRENT_STATUS === 'all' || c.status === CURRENT_STATUS;
        return matchSearch && matchStatus;
    });
    sortAndRender();
}

function filterByStatus(status, btn) {
    document.querySelectorAll('.glass-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    CURRENT_STATUS = status;
    filterCandidates();
}

function sortAndRender() {
    const val = (_el('sort-select') || {}).value || 'date_desc';
    FILTERED.sort((a, b) => {
        switch (val) {
            case 'date_desc':   return new Date(b.created_at) - new Date(a.created_at);
            case 'date_asc':    return new Date(a.created_at) - new Date(b.created_at);
            case 'score_desc':  return _normaliseScore(b.score) - _normaliseScore(a.score);
            case 'score_asc':   return _normaliseScore(a.score) - _normaliseScore(b.score);
            case 'name_asc':    return (a.user_name || '').localeCompare(b.user_name || '');
            default:            return 0;
        }
    });
    renderTable();
}

/* ============================================================
   MODAL — OPEN
   ============================================================ */
function openModal(idx) {
    const c = FILTERED[idx];
    if (!c) return;
    CURRENT_ID = c.id;

    const sc        = _normaliseScore(c.score);
    const scDisplay = sc.toFixed(1);
    const init      = _initials(c.user_name);
    const avClass   = _avatarClass(c.user_name);
    const status    = c.status || 'pending';

    /* --- Header --- */
    const avatar = _el('modal-avatar');
    avatar.textContent  = init;
    avatar.className    = 'admin-modal-avatar ' + avClass;
    _el('modal-name').textContent  = c.user_name  || 'Unknown';
    _el('modal-email').textContent = c.user_email || '—';

    const statusBadge = _el('modal-status-badge');
    statusBadge.className   = 'status-glow ' + status;
    statusBadge.innerHTML   = `<span class="s-dot"></span> ${_cap(status)}`;

    /* --- Score ring --- */
    const { deg, color } = _ringStyle(sc);
    const ring = _el('modal-score-ring');
    ring.style.background = `conic-gradient(${color} ${deg}deg, #1e293b ${deg}deg)`;
    ring.style.boxShadow  = `0 0 28px ${color}44`;
    const scoreEl = _el('modal-score-num');
    scoreEl.textContent   = scDisplay;
    scoreEl.style.color   = color;

    /* --- Details --- */
    _el('modal-role-title').textContent   = c.job_title || '—';
    _el('modal-company-line').textContent = `${c.company || '—'} · ${_fmtDate(c.created_at)}`;
    _el('modal-duration').textContent     = _fmtDuration(c.duration_seconds);
    _el('modal-q-count').textContent      = (c.questions || []).length || '—';
    _el('modal-violations').textContent   = c.focus_violations || 0;

    /* Rank */
    const sorted = [...ALL_CANDIDATES].sort((a,b) => _normaliseScore(b.score) - _normaliseScore(a.score));
    const rank   = sorted.findIndex(x => x.id === c.id) + 1;
    _el('modal-rank').textContent = `#${rank}`;

    /* --- Competency bars (reset to 0 first, animate after render) --- */
    const tech = Math.round(c.technical_score     || sc * 10);
    const comm = Math.round(c.communication_score || sc * 9);
    const rel  = Math.round(c.relevance_score     || sc * 9.5);
    _setBar('bar-tech', 'val-tech', 0);
    _setBar('bar-comm', 'val-comm', 0);
    _setBar('bar-rel',  'val-rel',  0);

    /* --- Q&A accordion --- */
    const qs     = c.questions || [];
    const qaList = _el('modal-qa-list');
    if (qs.length) {
        qaList.innerHTML = qs.map((q, i) => {
            const qsc   = parseFloat(q.score) || 0;
            const qcls  = _scoreClass(qsc);
            return `
            <div class="admin-qa-card">
                <div class="admin-qa-header" onclick="toggleQA(this)">
                    <div class="admin-qa-meta">
                        <div class="admin-q-num">Question ${i + 1}</div>
                        <div class="admin-q-text">${_esc(q.q)}</div>
                    </div>
                    <div class="admin-qa-score-badge ${qcls}">
                        <span class="qs-num">${qsc.toFixed(1)}</span>
                        <span class="qs-den">/10</span>
                    </div>
                </div>
                <div class="admin-qa-body">
                    <div class="admin-answer-box">
                        <div class="admin-answer-label">Candidate's Response</div>
                        <div class="admin-answer-text">${_esc(q.a || 'No response recorded.')}</div>
                    </div>
                    <div class="admin-qa-feedback">
                        <i class="fas fa-robot"></i>
                        <p>${_esc(q.feedback || 'No AI feedback available.')}</p>
                    </div>
                </div>
            </div>`;
        }).join('');
    } else {
        qaList.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem;">No question data available.</p>';
    }

    /* --- AI insight --- */
    _el('modal-ai-insight').textContent = c.ai_summary || 'No AI insight available for this session.';

    /* --- Recruiter notes --- */
    _el('modal-recruiter-notes').value = c.recruiter_notes || '';

    /* --- Action button visibility --- */
    _el('modal-approve-btn').style.display = status === 'approved' ? 'none' : 'flex';
    _el('modal-reject-btn').style.display  = status === 'rejected'  ? 'none' : 'flex';

    /* --- Open overlay --- */
    _el('candidateModal').classList.add('open');
    document.body.style.overflow = 'hidden';

    /* Animate bars after a tick */
    setTimeout(() => {
        _setBar('bar-tech', 'val-tech', tech);
        _setBar('bar-comm', 'val-comm', comm);
        _setBar('bar-rel',  'val-rel',  rel);
    }, 80);
}

function closeModal() {
    _el('candidateModal').classList.remove('open');
    document.body.style.overflow = '';
    CURRENT_ID = null;
}

function handleModalBackdropClick(e) {
    if (e.target === _el('candidateModal')) closeModal();
}

function toggleQA(headerEl) {
    headerEl.nextElementSibling.classList.toggle('open');
}

/* ============================================================
   STATUS UPDATES
   ============================================================ */
async function updateStatus(newStatus) {
    if (!CURRENT_ID) return;
    await _persistStatus(CURRENT_ID, newStatus);
    closeModal();
}

async function quickStatus(idx, newStatus) {
    const c = FILTERED[idx];
    if (!c) return;
    await _persistStatus(c.id, newStatus);
}

async function _persistStatus(id, newStatus) {
    /* Optimistic update */
    _applyStatus(id, newStatus);
    renderStats();
    renderTable();
    showToast(_cap(newStatus) + ' ✓', newStatus === 'approved' ? 'success' : 'error');

    if (window.supabase) {
        try {
            await window.supabase
                .from('interview_sessions')
                .update({ status: newStatus })
                .eq('id', id);
        } catch (e) {
            console.warn('[Admin] Status update failed:', e.message);
        }
    }
}

function _applyStatus(id, newStatus) {
    const ai = ALL_CANDIDATES.findIndex(c => c.id === id);
    if (ai !== -1) ALL_CANDIDATES[ai].status = newStatus;
    const fi = FILTERED.findIndex(c => c.id === id);
    if (fi !== -1) FILTERED[fi].status = newStatus;
}

/* ============================================================
   RECRUITER NOTES
   ============================================================ */
async function saveNotes() {
    if (!CURRENT_ID) return;
    const notes = _el('modal-recruiter-notes').value;
    const ai    = ALL_CANDIDATES.findIndex(c => c.id === CURRENT_ID);
    if (ai !== -1) ALL_CANDIDATES[ai].recruiter_notes = notes;

    if (window.supabase) {
        try {
            await window.supabase
                .from('interview_sessions')
                .update({ recruiter_notes: notes })
                .eq('id', CURRENT_ID);
        } catch (e) {
            console.warn('[Admin] Notes save failed:', e.message);
        }
    }
    showToast('Notes saved', 'success');
}

/* ============================================================
   EMAIL
   ============================================================ */
function emailCandidate() {
    if (!CURRENT_ID) return;
    const c = ALL_CANDIDATES.find(x => x.id === CURRENT_ID);
    if (c?.user_email) {
        window.open(`mailto:${c.user_email}?subject=Your AI Hire Interview Results`);
    }
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
function exportCSV() {
    const headers = ['Name','Email','Role','Company','Score','Status','Date','Duration','Technical%','Communication%','Relevance%'];
    const rows    = FILTERED.map(c => [
        c.user_name          || '',
        c.user_email         || '',
        c.job_title          || '',
        c.company            || '',
        _normaliseScore(c.score).toFixed(1),
        c.status             || '',
        _fmtDate(c.created_at),
        _fmtDuration(c.duration_seconds),
        c.technical_score     || '',
        c.communication_score || '',
        c.relevance_score     || ''
    ]);

    const csv  = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `candidates_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast('CSV exported', 'success');
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg, type = 'info') {
    const t    = _el('admin-toast');
    const icons = { success: 'check-circle', error: 'times-circle', info: 'info-circle' };
    t.className = `toast ${type} show`;
    t.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${msg}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ============================================================
   HELPERS
   ============================================================ */
function _el(id)          { return document.getElementById(id); }
function _esc(str)        { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _cap(str)        { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

function _normaliseScore(raw) {
    const n = parseFloat(raw) || 0;
    return n > 10 ? n / 10 : n;   // handles 0–10 or 0–100
}

function _scoreClass(sc) {
    if (sc >= 7.5) return 'score-high';
    if (sc >= 5)   return 'score-mid';
    return 'score-low';
}

function _avatarClass(name) {
    let h = 0;
    for (const ch of (name || '')) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
    return AVATAR_CLASSES[h % AVATAR_CLASSES.length];
}

function _initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _fmtDuration(secs) {
    if (!secs) return '—';
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}m ${s}s`;
}

function _ringStyle(sc) {
    const pct   = Math.min(100, Math.max(0, (sc / 10) * 100));
    const deg   = (pct / 100) * 360;
    const color = sc >= 7.5 ? '#22c55e' : sc >= 5 ? '#f59e0b' : '#ef4444';
    return { deg, color };
}

function _setBar(barId, valId, pct) {
    const b = _el(barId), v = _el(valId);
    if (b) b.style.width    = pct + '%';
    if (v) v.textContent    = pct + '%';
}

/* ============================================================
   DEMO DATA  (used when Supabase is not connected)
   ============================================================ */
function _demoData() {
    return [
        {
            id:'demo-1', user_name:'Aria Chen', user_email:'aria.chen@email.com',
            job_title:'Senior Software Engineer', company:'Google',
            score:8.7, status:'approved', created_at:'2025-03-28T10:30:00Z',
            duration_seconds:720, technical_score:90, communication_score:85, relevance_score:88,
            focus_violations:0,
            ai_summary:'Aria demonstrated exceptional problem-solving and communicated complex concepts clearly. Strong hire for a senior role.',
            recruiter_notes:'',
            questions:[
                { q:'Explain the difference between process and thread.',
                  a:'A process is an independent program in execution with its own memory space. A thread is a lightweight unit within a process sharing memory.',
                  score:9, feedback:'Excellent — clear distinction with appropriate depth.' },
                { q:'What is a REST API and how does it differ from GraphQL?',
                  a:'REST uses fixed endpoints per resource. GraphQL uses one endpoint with flexible queries so clients request exactly what they need.',
                  score:8, feedback:'Good comparison. Could mention N+1 problem as a GraphQL advantage.' },
                { q:'Describe a time you debugged a complex production issue.',
                  a:'We had a memory leak in our Node.js service. I used heap snapshots to identify retained objects from a third-party library.',
                  score:9, feedback:'Specific, structured, and outcome-focused. Excellent.' }
            ]
        },
        {
            id:'demo-2', user_name:'Marcus Osei', user_email:'marcus.o@gmail.com',
            job_title:'Full Stack Developer', company:'Microsoft',
            score:6.4, status:'completed', created_at:'2025-03-27T14:15:00Z',
            duration_seconds:580, technical_score:65, communication_score:70, relevance_score:62,
            focus_violations:2,
            ai_summary:'Marcus has solid fundamentals but struggled with advanced system design. Recommend a follow-up technical round focused on scalability.',
            recruiter_notes:'',
            questions:[
                { q:'How does the event loop work in Node.js?',
                  a:'Node.js is single-threaded. The event loop handles async operations by checking the call stack and callback queue.',
                  score:7, feedback:'Correct but lacked detail on phases like timers and I/O callbacks.' },
                { q:'Explain database indexing.',
                  a:'Indexes speed up queries by creating a lookup structure.',
                  score:5, feedback:'Too brief. Expected B-tree discussion and trade-offs with write performance.' },
                { q:'What is CI/CD?',
                  a:'Continuous integration and deployment — automating testing and releasing code.',
                  score:7, feedback:'Accurate high-level answer. Could mention specific tools like GitHub Actions.' }
            ]
        },
        {
            id:'demo-3', user_name:'Leila Nazari', user_email:'leila.naz@outlook.com',
            job_title:'Frontend Engineer', company:'Meta',
            score:9.1, status:'approved', created_at:'2025-03-26T09:00:00Z',
            duration_seconds:810, technical_score:94, communication_score:91, relevance_score:89,
            focus_violations:0,
            ai_summary:'Outstanding performance. Deep expertise in React internals, accessibility, and performance optimisation. Highly recommended.',
            recruiter_notes:'',
            questions:[
                { q:'Explain the React reconciliation algorithm.',
                  a:'React uses a virtual DOM and diffs against the previous version with a heuristic O(n) algorithm assuming stable keys.',
                  score:10, feedback:'Perfect — included time complexity and key role.' },
                { q:'How would you optimise a slow React application?',
                  a:'Profile with React DevTools, use memo/useCallback, code-split with lazy loading, virtualise long lists with react-window.',
                  score:9,  feedback:'Comprehensive and correctly prioritised.' },
                { q:'What is WCAG and why does it matter?',
                  a:'Web Content Accessibility Guidelines — ensures web content is usable by people with disabilities. Critical for inclusive design and legal compliance.',
                  score:9,  feedback:'Strong answer covering ethical and legal dimensions.' }
            ]
        },
        {
            id:'demo-4', user_name:'Jayden Brooks', user_email:'jaydenb@proton.me',
            job_title:'Data Scientist', company:'Amazon',
            score:4.2, status:'rejected', created_at:'2025-03-25T16:45:00Z',
            duration_seconds:390, technical_score:40, communication_score:48, relevance_score:43,
            focus_violations:5,
            ai_summary:'Struggled with fundamental ML concepts. Answers were vague and lacked technical depth required for the role.',
            recruiter_notes:'',
            questions:[
                { q:'What is overfitting and how do you prevent it?',
                  a:'When the model learns noise. You can use more data.',
                  score:4, feedback:'Incomplete — did not mention regularisation, dropout, or cross-validation.' },
                { q:'Explain gradient descent.',
                  a:'It is an optimisation algorithm that minimises loss.',
                  score:5, feedback:'Needs more: learning rate, variants (SGD, Adam), convergence.' },
                { q:'What is a confusion matrix?',
                  a:'It shows true/false positives and negatives.',
                  score:4, feedback:'Correct idea but did not explain precision, recall, or F1.' }
            ]
        },
        {
            id:'demo-5', user_name:'Priya Kapoor', user_email:'priya.k@techco.in',
            job_title:'DevOps Engineer', company:'Spotify',
            score:7.8, status:'completed', created_at:'2025-03-24T11:20:00Z',
            duration_seconds:660, technical_score:80, communication_score:75, relevance_score:79,
            focus_violations:1,
            ai_summary:'Strong practical knowledge of Kubernetes and CI/CD pipelines. Recommended for a second round with a system design focus.',
            recruiter_notes:'',
            questions:[
                { q:'Explain Kubernetes pod lifecycle.',
                  a:'Pods go through Pending, Running, Succeeded, Failed states. The kubelet manages restarts based on the restart policy.',
                  score:8, feedback:'Good lifecycle phase understanding.' },
                { q:'What is infrastructure as code?',
                  a:'Defining and managing infrastructure via config files like Terraform or Ansible instead of manual setup.',
                  score:8, feedback:'Clear and accurate with good tool examples.' },
                { q:'How do you handle secrets in a pipeline?',
                  a:'Use a secrets manager like Vault or AWS Secrets Manager, never hardcode in env files.',
                  score:8, feedback:'Correct. Could mention RBAC and secret rotation.' }
            ]
        },
        {
            id:'demo-6', user_name:'Samuel Rivera', user_email:'sam.rivera@corp.com',
            job_title:'Senior Software Engineer', company:'Google',
            score:5.9, status:'pending', created_at:'2025-03-23T08:00:00Z',
            duration_seconds:540, technical_score:58, communication_score:63, relevance_score:61,
            focus_violations:0,
            ai_summary:'Moderate technical knowledge. Awaiting session completion before recommending a decision.',
            recruiter_notes:'',
            questions:[
                { q:'What are SOLID principles?',
                  a:'Single responsibility, open/closed, Liskov, interface segregation, dependency inversion.',
                  score:6, feedback:'Named them correctly but did not elaborate on each.' },
                { q:'Explain microservices vs monolith.',
                  a:'Microservices split the app into small independent services. A monolith is one big app.',
                  score:6, feedback:'Correct but shallow. Expected trade-off discussion.' }
            ]
        }
    ];
}
