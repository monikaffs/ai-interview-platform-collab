import os
import requests
import json
import re
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "ai_hire_premium_secret_77")

# --- CONFIGURATION ---
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
MODEL_NAME = "google/gemini-2.0-flash-001"

SUPABASE_URL      = os.getenv("SUPABASE_URL",      "https://isofuilekbgleahrxnkc.supabase.co")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "sb_publishable_M7ZeZgexKOn82r8cXzfxdw_ZRNikdVp")

# ─────────────────────────────────────────────────────────────
#  ADMIN EMAILS — add every admin email here (lowercase)
# ─────────────────────────────────────────────────────────────
ADMIN_EMAILS = {
    "alianoassafi@gmail.com",          # Admin's Email for access
    #Recruiter Emails:",
}

try:
    from prompts import SYSTEM_PROMPT, GRADER_PROMPT # type: ignore
except ImportError:
    SYSTEM_PROMPT = "You are a senior technical interviewer. Conduct a professional interview."
    GRADER_PROMPT = ""


# ─────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────

def get_initials(name):
    if not name:
        return "AI"
    parts = name.split()
    return (parts[0][0] + (parts[1][0] if len(parts) > 1 else parts[0][1])).upper()


def login_required(f):
    """Redirect to /login if no active Flask session."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    """Require is_admin flag in session; silently redirect others to /dashboard."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        if not session.get('is_admin'):
            return redirect(url_for('dashboard'))
        return f(*args, **kwargs)
    return decorated_function


# ─────────────────────────────────────────────────────────────
#  AUTH & SESSION ROUTES
# ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/set_session', methods=['POST'])
def set_session():
    """
    Bridge: Frontend Supabase Auth → Flask Session.
    Called after every successful Supabase auth event (login, signup, OAuth callback).
    Sets is_admin=True for emails in ADMIN_EMAILS.
    """
    data = request.get_json(force=True, silent=True) or {}
    user_id = data.get('id')
    email   = data.get('email', '').strip().lower()
    name    = data.get('name', 'User') or 'User'

    if user_id and email:
        session.permanent    = True
        session['user_id']   = user_id
        session['user_name'] = name
        session['email']     = email
        session['initials']  = get_initials(name)
        session['is_admin']  = email in ADMIN_EMAILS # ← key flag email in ADMIN_EMAILS for access
        return jsonify({
            "status":   "success",
            "name":     name,
            "is_admin": session['is_admin']
        }), 200

    return jsonify({"status": "error", "message": "Missing id or email"}), 400


@app.route('/api/me')
def me():
    """Returns current Flask session info as JSON."""
    if 'user_id' in session:
        return jsonify({
            "logged_in": True,
            "user_id":   session['user_id'],
            "name":      session.get('user_name', 'User'),
            "email":     session.get('email', ''),
            "is_admin":  session.get('is_admin', False)
        })
    return jsonify({"logged_in": False}), 401


@app.route('/login')
def login():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/signup')
def signup():
    return render_template('signup.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/auth/callback')
def auth_callback():
    """OAuth redirect landing page — JS reads the token hash and syncs Flask."""
    return render_template('auth_callback.html')


# ─────────────────────────────────────────────────────────────
#  USER PAGE ROUTES
# ─────────────────────────────────────────────────────────────

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template(
        'dashboard.html',
        name=session.get('user_name', 'User'),
        initials=session.get('initials', 'AI'),
        is_admin=session.get('is_admin', False)   # ← passed so Jinja {% if is_admin %} works
    )


@app.route('/view_all')
@login_required
def view_all():
    return render_template('view_all.html',
        name=session.get('user_name', 'User'),
        initials=session.get('initials', 'AI')
    )


@app.route('/explore')
@login_required
def explore():
    return render_template('explore.html',
        name=session.get('user_name', 'User'),
        initials=session.get('initials', 'AI')
    )


@app.route('/profile')
@login_required
def profile():
    return render_template('profile.html',
        name=session.get('user_name', 'User'),
        initials=session.get('initials', 'AI')
    )


@app.route('/results')
@login_required
def results():
    return render_template('results.html',
        name=session.get('user_name', 'User'),
        initials=session.get('initials', 'AI')
    )


@app.route('/setup')
@login_required
def setup():
    return render_template('setup.html')


# ─────────────────────────────────────────────────────────────
#  ADMIN ROUTES
# ─────────────────────────────────────────────────────────────

@app.route('/admin/dashboard')
@admin_required
def admin_dashboard():
    name     = session.get('user_name', 'Recruiter')
    initials = get_initials(name)
    return render_template(
        'admin_dashboard.html',
        name=name,
        initials=initials
    )


@app.route('/admin/analytics')
@admin_required
def admin_analytics():
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/interviews')
@admin_required
def admin_interviews():
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/jobs')
@admin_required
def admin_jobs():
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/settings')
@admin_required
def admin_settings():
    return redirect(url_for('admin_dashboard'))


# Admin API: update candidate status (optional — JS writes direct to Supabase by default)
@app.route('/api/admin/update_status', methods=['POST'])
@admin_required
def admin_update_status():
    data       = request.get_json(silent=True) or {}
    session_id = data.get('session_id')
    new_status = data.get('status')
    ALLOWED    = {'pending', 'completed', 'approved', 'rejected'}
    if not session_id or new_status not in ALLOWED:
        return jsonify({'error': 'Invalid payload'}), 400
    return jsonify({'ok': True, 'status': new_status})


# Admin API: save recruiter notes (optional)
@app.route('/api/admin/save_notes', methods=['POST'])
@admin_required
def admin_save_notes():
    data       = request.get_json(silent=True) or {}
    session_id = data.get('session_id')
    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400
    return jsonify({'ok': True})


# ─────────────────────────────────────────────────────────────
#  AI INTERVIEW CORE
# ─────────────────────────────────────────────────────────────

@app.route('/interview')
@login_required
def interview():
    session['chat_history'] = []
    return render_template('interview.html')


@app.route('/chat', methods=['POST'])
@login_required
def chat():
    user_input = request.json.get("message")
    if not user_input:
        return jsonify({"error": "No message"}), 400

    if 'chat_history' not in session:
        session['chat_history'] = []

    user_context = {
        "name":       session.get("user_name"),
        "role":       session.get("current_role", "Candidate"),
        "experience": session.get("experience_level", "Entry-level")
    }

    session['chat_history'].append({"role": "user", "content": user_input})
    full_system_prompt = (
        f"{SYSTEM_PROMPT}\n"
        f"Candidate: {user_context['name']}\n"
        f"Target Role: {user_context['role']}\n"
        f"Level: {user_context['experience']}"
    )
    messages = [{"role": "system", "content": full_system_prompt}] + session['chat_history']

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": MODEL_NAME, "messages": messages}
        )
        if response.status_code == 200:
            ai_message = response.json()['choices'][0]['message']['content']
            session['chat_history'].append({"role": "assistant", "content": ai_message})
            session.modified = True
            return jsonify({"response": ai_message})
        return jsonify({"error": "AI Engine unavailable"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/generate_report', methods=['POST'])
@login_required
def generate_report():
    data       = request.get_json()
    session_id = data.get('session_id')
    transcript = data.get('transcript')

    if not session_id or not transcript:
        return jsonify({"error": "Missing data"}), 400

    grader_prompt = f"""
    Analyze this interview transcript:
    {transcript}

    Return JSON ONLY:
    {{
      "technical_score": (0-100),
      "communication_score": (0-100),
      "confidence_score": (0-100),
      "overall_score": (0-100),
      "feedback_summary": "Professional summary",
      "roadmap_items": ["3 study topics"]
    }}
    """

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": MODEL_NAME, "messages": [{"role": "system", "content": grader_prompt}]}
        )
        if response.status_code == 200:
            report_raw   = response.json()['choices'][0]['message']['content']
            match        = re.search(r'(\{.*\})', report_raw, re.DOTALL)
            report_clean = match.group(1).strip() if match else report_raw.replace('```json','').replace('```','').strip()
            return jsonify({"status": "success", "report": report_clean}), 200
        return jsonify({"error": "AI Grader failed"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def call_ai(messages, model=None):
    """Shared helper: calls OpenRouter and returns the AI text response."""
    target_model = model or MODEL_NAME
    response = requests.post(
        url="https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
        json={"model": target_model, "messages": messages}
    )
    if response.status_code == 200:
        return response.json()['choices'][0]['message']['content']
    raise Exception(f"OpenRouter error {response.status_code}: {response.text}")


@app.route('/api/evaluate_session', methods=['POST'])
@login_required
def evaluate_session():
    data         = request.get_json()
    session_id   = data.get('session_id')
    qa_pairs     = data.get('qa_pairs', [])
    duration     = data.get('duration_seconds', 0)
    tab_switches = data.get('tab_switches', 0)

    if not session_id or not qa_pairs:
        return jsonify({"error": "Missing session_id or qa_pairs"}), 400

    evaluated = []

    for item in qa_pairs:
        question = item.get('question', '').strip()
        answer   = item.get('answer',   '').strip()
        if not question or not answer:
            continue

        try:
            raw   = call_ai([
                {"role": "system", "content": GRADER_PROMPT},
                {"role": "user",   "content": f"Question: {question}\n\nCandidate Answer: {answer}"}
            ])
            clean  = re.sub(r'```(?:json)?', '', raw).replace('```', '').strip()
            match  = re.search(r'(\{.*\})', clean, re.DOTALL)
            parsed = json.loads(match.group(1)) if match else json.loads(clean)

            relevance   = max(0, min(4, int(parsed.get('relevance',   0))))
            correctness = max(0, min(3, int(parsed.get('correctness', 0))))
            clarity     = max(0, min(3, int(parsed.get('clarity',     0))))
            total       = relevance + correctness + clarity
            feedback    = parsed.get('feedback', 'No feedback generated.')
        except Exception as e:
            relevance = correctness = clarity = total = 0
            feedback  = f"Evaluation unavailable. ({str(e)[:60]})"

        evaluated.append({
            "question":    question,
            "answer":      answer,
            "timestamp":   item.get('timestamp', ''),
            "relevance":   relevance,
            "correctness": correctness,
            "clarity":     clarity,
            "score":       total,
            "feedback":    feedback
        })

    if not evaluated:
        return jsonify({"error": "No valid Q&A pairs to evaluate"}), 422

    num_q           = len(evaluated)
    avg_total       = round(sum(e['score']       for e in evaluated) / num_q, 1)
    avg_correctness = round(sum(e['correctness'] for e in evaluated) / num_q, 1)
    avg_clarity     = round(sum(e['clarity']     for e in evaluated) / num_q, 1)
    avg_relevance   = round(sum(e['relevance']   for e in evaluated) / num_q, 1)

    technical_score     = max(0, min(95, round((avg_correctness / 3) * 100) - 2))
    communication_score = max(0, min(95, round((avg_clarity     / 3) * 100) - 2))
    confidence_score    = max(0, min(95, round((avg_relevance   / 4) * 100) - 2))
    overall_score       = max(0, min(95, round((avg_total / 10) * 100 - 3)))

    verdict = ("Strong Candidate" if avg_total >= 8.5
               else "Average Performance" if avg_total >= 6.0
               else "Needs Improvement")

    high = [e for e in evaluated if e['score'] >= 8]
    low  = [e for e in evaluated if e['score'] <= 4]
    summary_parts = [f"Candidate completed {num_q} question(s) with an average score of {avg_total}/10. Verdict: {verdict}."]
    if high: summary_parts.append(f"Strong performance on {len(high)} question(s).")
    if low:  summary_parts.append(f"Needs improvement on {len(low)} question(s).")

    report_payload = {"qa_breakdown": evaluated, "verdict": verdict, "avg_score": avg_total}

    return jsonify({
        "status": "success",
        "report": {
            "technical_score":     technical_score,
            "communication_score": communication_score,
            "confidence_score":    confidence_score,
            "overall_score":       overall_score,
            "feedback_summary":    " ".join(summary_parts),
            "roadmap_items":       json.dumps(report_payload),
            "verdict":             verdict,
            "avg_score":           avg_total,
            "qa_breakdown":        evaluated
        }
    }), 200


# ─────────────────────────────────────────────────────────────
#  UTILITIES
# ─────────────────────────────────────────────────────────────

@app.route('/api/update_context', methods=['POST'])
@login_required
def update_context():
    data = request.get_json()
    session['current_role']       = data.get('role')
    session['experience_level']   = data.get('experience')
    return jsonify({"status": "Context updated"}), 200


@app.route('/clear')
def clear():
    session.clear()
    return "Session cleared."


if __name__ == '__main__':
    app.run(debug=True, port=5000)
