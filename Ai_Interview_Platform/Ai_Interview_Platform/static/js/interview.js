// static/js/interview.js

// --- Global State ---
let userSessionId = null;
let currentDbSessionId = null;
let interviewActive = false;
let timerInterval = null;
let secondsElapsed = 0;
let tabSwitchCount = 0;

// Media & Audio
let mediaStream = null;
let audioContext = null;
let analyserNode = null;
let animationFrameId = null;

// Speech Recognition & Synthesis
let recognition = null;
let isRecording = false;
const synth = window.speechSynthesis;

// --- Q&A TRACKING STATE ---
// Flat transcript buffer (for legacy fallback)
let fullTranscriptBuffer = [];

// Structured Q&A pairs — the core of the evaluation system
let qaPairs = [];         // [{question, answer, timestamp}]
let currentQuestion = null; // Holds the latest AI question waiting for a user answer

// --- DOM Elements ---
const dom = {
    // Modals
    preModal: document.getElementById('pre-interview-modal'),
    endModal: document.getElementById('end-session-modal'),
    focusModal: document.getElementById('focus-warning-modal'),

    // Core Layout
    header: document.getElementById('interview-header'),
    main: document.getElementById('interview-main'),
    timer: document.getElementById('session-timer'),

    // AI Pane
    aiCore: document.getElementById('ai-core'),
    aiStatus: document.getElementById('ai-status-text'),

    // User Pane
    videoFeed: document.getElementById('user-video'),
    micFill: document.getElementById('mic-volume-fill'),

    // Chat Pane
    messages: document.getElementById('chat-messages'),
    input: document.getElementById('chat-input'),
    sendBtn: document.getElementById('chat-send-btn'),
    micBtn: document.getElementById('stt-toggle-btn'),

    // Action Buttons
    startBtn: document.getElementById('start-interview-btn'),
    confirmEndBtn: document.getElementById('confirm-end-btn')
};

// ==========================================
// UTILITY: Detect if a message is a question
// ==========================================
function isQuestion(text) {
    if (!text || text.trim().length < 5) return false;
    const t = text.trim();
    // Ends with ? OR contains common interview question patterns
    if (t.endsWith('?')) return true;
    const patterns = [
        /^(can you|could you|would you|tell me|describe|explain|what|how|why|when|where|which|who)/i,
        /^(walk me through|give me an example|have you|do you|are you|is there)/i,
        /^(talk about|share|discuss|elaborate)/i
    ];
    return patterns.some(p => p.test(t));
}

// ==========================================
// 1. INITIALIZATION & PERMISSIONS
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure Authenticated
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login';
        return;
    }
    userSessionId = user.id;

    // Set UI Details from URL
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title");
    const company = params.get("company");
    const titleEl = document.getElementById("interviewTitle");
    if (titleEl) {
        if (title && company) {
            titleEl.innerText = `${title} at ${company}`;
        } else if (title) {
            titleEl.innerText = title;
        } else {
            titleEl.innerText = "Custom Interview Session";
        }
    }

    // Button Listeners
    dom.startBtn.addEventListener('click', initializeSession);
    dom.confirmEndBtn.addEventListener('click', terminateSession);
    dom.micBtn.addEventListener('click', toggleSTT);

    // Fallback manual send if STT fails completely
    dom.sendBtn.addEventListener('click', () => handleUserSendMessage());

    // Enter key to send
    dom.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleUserSendMessage();
        }
    });

    // Focus Tracker
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && interviewActive) {
            tabSwitchCount++;

            const countEl = document.getElementById('violation-count');
            if (countEl) countEl.innerText = tabSwitchCount;
            dom.focusModal.classList.remove('hidden');

            fullTranscriptBuffer.push(`\n[SYSTEM EVENT]: Candidate switched tabs or lost focus. Total violations: ${tabSwitchCount}.\n`);

            try {
                window.supabase.from('interview_messages').insert([{
                    session_id: currentDbSessionId,
                    sender: 'system',
                    content: `Focus Violation #${tabSwitchCount}`
                }]);
            } catch (dbErr) { }
        }
    });

    initWebSpeech();
});

// ==========================================
// 2. LAUNCH INTERVIEW & HARDWARE
// ==========================================
async function initializeSession() {
    dom.startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting Setup...';
    dom.startBtn.disabled = true;

    try {
        dom.startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting Camera...';
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        dom.videoFeed.srcObject = mediaStream;

        console.log("[Evaluator] Initializing DB session...");
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const jobId   = urlParams.get("job_id");
            const title   = urlParams.get("title")   || "AI Interview Session";
            const company = urlParams.get("company") || "AI Hire";

            const { data: sData, error: sErr } = await window.supabase
                .from('interview_sessions')
                .insert([{
                    user_id:           userSessionId,
                    job_id:            jobId || null,
                    custom_job_title:  title,
                    status:            'in_progress', // Standardized status
                    started_at:        new Date().toISOString()
                }])
                .select();

            if (sErr) throw sErr;

            if (sData && sData.length > 0) {
                currentDbSessionId = sData[0].id;
                console.log("[DB] Session created successfully ID:", currentDbSessionId);
            } else {
                throw new Error("No session data returned from Supabase.");
            }
        } catch (dbErr) {
            console.error("[DB] Session initialization FAILED:", dbErr);
            currentDbSessionId = 'temp-id-' + Date.now();
            console.warn("[Evaluator] Using temporary session ID (History will not be saved).");
        }

        // UI Transition
        dom.preModal.classList.add('hidden');
        dom.header.classList.remove('hidden');
        dom.main.classList.remove('hidden');

        interviewActive = true;
        startTimer();
        startAudioMeter();

        // Initial AI Greeting (not a question we track)
        const greeting = "Welcome to your AI evaluation session. I am ready when you are. Please tell me a bit about your current technical experience and the role you are targeting.";
        performAITurn(greeting, true);

    } catch (err) {
        console.error("Hardware Initialization Failed:", err);
        alert(`Hardware Access Failed. Please ensure your camera and microphone are connected and allowed in your browser settings.`);
        dom.startBtn.innerHTML = 'Grant Permissions & Start';
        dom.startBtn.disabled = false;
    }
}

// ==========================================
// 3. TIMERS & AUDIO METERS
// ==========================================
function startTimer() {
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const m = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const s = (secondsElapsed % 60).toString().padStart(2, '0');
        dom.timer.innerText = `${m}:${s}`;
    }, 1000);
}

function startAudioMeter() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    function drawMeter() {
        if (!interviewActive) return;
        analyserNode.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;
        let percent = Math.min((average / 128) * 100, 100);
        dom.micFill.style.height = `${percent}%`;
        animationFrameId = requestAnimationFrame(drawMeter);
    }

    drawMeter();
}

// ==========================================
// 4. CHAT SYSTEM & AI LOGIC
// ==========================================

async function performAITurn(textResponse, isGreeting = false) {
    appendMessage(textResponse, 'ai');
    fullTranscriptBuffer.push(`AI Interviewer: ${textResponse}`);

    // --- QUESTION DETECTION ---
    // If this AI message looks like a question, mark it as the current question
    // (skip the greeting since it's an intro, not an evaluable question)
    if (!isGreeting && isQuestion(textResponse)) {
        currentQuestion = textResponse.trim();
        console.log('[Q&A Tracker] New question captured:', currentQuestion.substring(0, 60) + '...');
    }

    // Save to DB (Non-blocking but logged)
    try {
        await window.supabase.from('interview_messages').insert([{
            session_id: currentDbSessionId,
            sender: 'ai',
            content: textResponse
        }]);
        console.log(`[DB] AI message saved for session ${currentDbSessionId}`);
    } catch (e) {
        console.warn("[DB] Failed to save AI message:", e);
    }

    speakText(textResponse);
}

async function handleUserSendMessage(transcriptText = null) {
    const text = transcriptText || dom.input.value.trim();
    if (!text || !interviewActive) return;

    dom.input.value = '';
    if (isRecording) {
        isRecording = false;
        recognition.stop();
        dom.micBtn.classList.remove('recording');
    }

    appendMessage(text, 'user');
    fullTranscriptBuffer.push(`Candidate: ${text}`);

    // --- ANSWER CAPTURE ---
    // If there's a pending question, pair this answer with that question
    if (currentQuestion) {
        const pair = {
            question:  currentQuestion,
            answer:    text,
            timestamp: new Date().toISOString()
        };
        qaPairs.push(pair);
        console.log(`[Q&A Tracker] Pair #${qaPairs.length} captured. Q: "${pair.question.substring(0,40)}..." A: "${pair.answer.substring(0,40)}..."`);
        currentQuestion = null; // Reset — wait for next AI question
    }

    // Save to DB (Non-blocking but logged)
    try {
        await window.supabase.from('interview_messages').insert([{
            session_id: currentDbSessionId,
            sender: 'user',
            content: text
        }]);
        console.log(`[DB] User message saved for session ${currentDbSessionId}`);
    } catch (e) {
        console.warn("[DB] Failed to save User message:", e);
    }

    setAIStatus('processing');

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });

        const data = await response.json();
        if (data.response) {
            performaAITurnAfterFetch(data.response);
        } else {
            performaAITurnAfterFetch("I'm sorry, my synthesis engine experienced a delay. Could you repeat that?");
        }
    } catch (err) {
        console.error(err);
        performaAITurnAfterFetch("Network stability issue detected. Please stand by.");
    }
}

function performaAITurnAfterFetch(text) {
    setAIStatus('idle');
    performAITurn(text);
}

// UI Append
function appendMessage(text, role) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(role === 'ai' ? 'msg-ai' : 'msg-user');
    div.innerHTML = text.replace(/\n/g, '<br>');
    dom.messages.appendChild(div);
    setTimeout(() => {
        dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: 'smooth' });
    }, 100);
}

function setAIStatus(state) {
    dom.aiCore.className = 'ai-core';
    if (state === 'speaking') {
        dom.aiCore.classList.add('speaking');
        dom.aiStatus.innerText = "ASSISTANT SPEAKING";
        dom.aiStatus.style.color = "var(--accent)";
    } else if (state === 'processing') {
        dom.aiCore.classList.add('processing');
        dom.aiStatus.innerText = "COGNITIVE PROCESSING...";
        dom.aiStatus.style.color = "#a855f7";
    } else {
        dom.aiStatus.innerText = "LISTENING...";
        dom.aiStatus.style.color = "var(--text-dim)";
    }
}

// ==========================================
// 5. WEB SPEECH API (STT & TTS)
// ==========================================

function initWebSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onstart = () => {
            isRecording = true;
            dom.micBtn.classList.add('recording');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[event.results.length - 1][0].transcript.trim();
            handleUserSendMessage(transcript);
        };

        recognition.onerror = (e) => {
            console.warn("STT Error:", e.error);
            if (e.error !== 'no-speech' && isRecording) toggleSTT();
        };

        recognition.onend = () => {
            if (isRecording) {
                try { recognition.start(); } catch (e) { }
            } else {
                dom.micBtn.classList.remove('recording');
            }
        };
    } else {
        dom.micBtn.style.display = 'none';
        console.warn("SpeechRecognition not supported in this browser.");
    }
}

function toggleSTT() {
    if (!recognition) return;
    if (isRecording) {
        isRecording = false;
        recognition.stop();
        dom.micBtn.classList.remove('recording');
    } else {
        if (dom.input.value.length > 0) dom.input.value = '';
        try { recognition.start(); } catch (e) { }
    }
}

function speakText(text) {
    if (!synth) return;
    synth.cancel();

    const wasRecording = isRecording;
    if (isRecording) {
        isRecording = false;
        recognition.stop();
        dom.micBtn.classList.remove('recording');
    }

    setAIStatus('speaking');
    const utterance = new SpeechSynthesisUtterance(text);

    const voices = synth.getVoices();
    const preferredVoice = voices.find(v => (v.name.includes("Google") || v.name.includes("Natural")) && v.lang.startsWith("en")) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.lang = "en-US";

    utterance.onend = () => {
        if (interviewActive) {
            setAIStatus('idle');
            if (text.toLowerCase().includes("thank you")) {
                terminateSession();
            } else {
                try {
                    isRecording = true;
                    dom.micBtn.classList.add('recording');
                    recognition.start();
                } catch (e) { }
            }
        }
    };

    synth.speak(utterance);
}

window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };

// ==========================================
// 6. TERMINATE & EVALUATE SESSION
// ==========================================

async function terminateSession() {
    dom.confirmEndBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Evaluating...';
    dom.confirmEndBtn.disabled = true;

    interviewActive = false;
    clearInterval(timerInterval);
    cancelAnimationFrame(animationFrameId);

    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    if (isRecording) toggleSTT();
    synth.cancel();

    // Validate Q&A pairs — need at least 1
    if (qaPairs.length === 0) {
        console.warn('[Evaluator] No Q&A pairs captured. Attempting to build from transcript...');

        // Fallback: if no pairs captured, create a dummy pair from transcript so we still evaluate
        const lines = fullTranscriptBuffer.filter(l => l.startsWith('Candidate:'));
        const aiLines = fullTranscriptBuffer.filter(l => l.startsWith('AI Interviewer:') && l.includes('?'));
        if (aiLines.length > 0 && lines.length > 0) {
            for (let i = 0; i < Math.min(aiLines.length, lines.length); i++) {
                qaPairs.push({
                    question: aiLines[i].replace('AI Interviewer: ', '').trim(),
                    answer:   lines[i].replace('Candidate: ', '').trim(),
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    console.log(`[Evaluator] Sending ${qaPairs.length} Q&A pair(s) for evaluation.`);

    // --- NO-FAIL TERMINATION FLOW ---
    console.log('[Evaluator] Terminating interview session...');
    updateStatusDisplay('Evaluating answers...', 'fa-brain fa-spin');

    // 1. Collect all data
    const reportData = {
        session_id:       currentDbSessionId,
        qa_pairs:         qaPairs,
        duration_seconds: secondsElapsed,
        tab_switches:     tabSwitchCount,
        timestamp:        new Date().toISOString()
    };

    try {
        // 2. Call AI Evaluator (Backend)
        const response = await fetch('/api/evaluate_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportData)
        });

        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.error || 'Evaluation failed on server.');
        }

        const report = data.report;
        console.log('[Evaluator] AI evaluation complete. Building report object...');

        // 3. SECURE LOCALSTORAGE SAVE (Primary Data Source)
        // This ensures the results page ALWAYS works, even if Supabase fails.
        const urlParams = new URLSearchParams(window.location.search);
        const finalReport = {
            ...report,
            session_id:      currentDbSessionId,
            seconds_elapsed: secondsElapsed,
            role_title:      urlParams.get("title") || "AI Interview Session",
            company_name:    urlParams.get("company") || "AI Hire",
            timestamp:       new Date().toISOString()
        };
        localStorage.setItem('latest_interview_report', JSON.stringify(finalReport));
        console.log('[Evaluator] Report saved to localStorage.');

        // --- STEP 4: SUPABASE SYNC ---
        updateStatusDisplay('Syncing data...', 'fa-file-export fa-spin');
        console.log("[DB] Starting final sync for session:", currentDbSessionId);
        
        try {
            // A. Insert Report
            const { error: rErr } = await window.supabase
                .from('interview_reports')
                .insert([{
                    session_id:          currentDbSessionId,
                    user_id:             userSessionId,
                    technical_score:     report.technical_score,
                    communication_score: report.communication_score,
                    confidence_score:    report.confidence_score,
                    feedback_summary:    report.feedback_summary,
                    roadmap_items:       report.roadmap_items
                }]);
            
            if (rErr) console.warn("[DB] Report save error:", rErr);
            else console.log("[DB] Report saved successfully.");

            // B. Update Session Status (Crucial for History page)
            const { error: sUpdateErr } = await window.supabase
                .from('interview_sessions')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    total_time_seconds: secondsElapsed
                })
                .eq('id', currentDbSessionId);

            if (sUpdateErr) console.error("[DB] Status update FAILED:", sUpdateErr);
            else console.log("[DB] Session status updated to 'completed'.");

            console.log('[DB] Final sync complete.');
        } catch (dbErr) {
            console.error('[DB] Final sync exception:', dbErr);
        }

        // --- STEP 5: REDIRECT ---
        updateStatusDisplay('Complete! Redirecting...', 'fa-check-circle');
        setTimeout(() => {
            window.location.href = `/results?session_id=${currentDbSessionId}`;
        }, 800);

    } catch (err) {
        console.error('[Evaluator] Evaluation failed. Creating fallback report...');
        
        // --- FALLBACK: BASIC REPORT (No AI) ---
        const fallbackReport = {
            qa_breakdown: qaPairs.map(q => ({
                question: q.question,
                answer: q.answer,
                score: 0,
                feedback: 'AI evaluation unavailable for this question.'
            })),
            avg_score: 0,
            verdict: 'Evaluation Unavailable',
            feedback_summary: 'We were unable to generate an AI evaluation at this time, but your transcript is saved below.',
            technical_score: 0,
            communication_score: 0,
            confidence_score: 0,
            overall_score: 0
        };
        
        localStorage.setItem('latest_interview_report', JSON.stringify(fallbackReport));
        window.location.href = `/results?session_id=${currentDbSessionId}&fallback=true`;
    }
}

/** Helper to update the UI status during termination */
function updateStatusDisplay(text, iconClass) {
    const statusText = document.querySelector('.status-text span');
    const statusIcon = document.querySelector('.status-text i');
    if (statusText) statusText.innerText = text;
    if (statusIcon) {
        statusIcon.className = `fas ${iconClass}`;
    }
}
