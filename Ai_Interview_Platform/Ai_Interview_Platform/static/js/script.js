console.log("Script loaded and running...");

// --- 1. GLOBAL FUNCTIONS FOR VIEW ALL (HISTORY) ---
// This makes the Search and Filter pills work

function filterHistoryTable() {
    const input = document.getElementById("history-search");
    const filter = input.value.toUpperCase();
    const rows = document.querySelectorAll(".history-row");

    rows.forEach(row => {
        const text = row.innerText.toUpperCase();
        row.style.display = text.includes(filter) ? "" : "none";
    });
}

function filterHistoryStatus(status, btn) {
    // 1. Update Active Pill UI
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');

    // 2. Filter Table Rows
    const rows = document.querySelectorAll(".history-row");
    rows.forEach(row => {
        const rowStatus = row.getAttribute('data-status');
        if (status === 'all' || rowStatus === status) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

// --- 2. ELEMENTS (Safely selected) ---
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById("mic-btn"); 
const resetBtn = document.getElementById('reset-btn');
const avatarCircle = document.querySelector('.avatar-circle');
const aiStatusIndicator = document.getElementById("ai-status");

// --- 3. STATE VARIABLES ---
let interviewStarted = false;
let isAiSpeaking = false;

// --- 4. SPEECH RECOGNITION (STT) SETUP ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; 
    recognition.lang = 'en-US';
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (userInput) userInput.value = transcript;
        sendMessage(); 
    };

    recognition.onend = () => {
        if (interviewStarted && !isAiSpeaking) {
            try { recognition.start(); } catch(e) {}
        }
    };
}

// --- 5. SPEECH SYNTHESIS (TTS) ---
function speak(text) {
    if (!text) return;
    isAiSpeaking = true;
    if (recognition) recognition.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes("Samantha") || v.name.includes("Google US English"));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => {
        if (avatarCircle) avatarCircle.classList.add('ai-visual-speaking');
        if (aiStatusIndicator) aiStatusIndicator.style.display = "block";
    };

    utterance.onend = () => {
        if (avatarCircle) avatarCircle.classList.remove('ai-visual-speaking');
        if (aiStatusIndicator) aiStatusIndicator.style.display = "none";
        isAiSpeaking = false;
        if (interviewStarted && recognition) {
            try { recognition.start(); } catch(e) {}
        }
    };
    window.speechSynthesis.speak(utterance);
}

// --- 6. CORE INTERVIEW FUNCTIONS ---
async function sendMessage() {
    if (!userInput || !userInput.value.trim()) return;
    const message = userInput.value.trim();
    appendMessage('user', message);
    userInput.value = '';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });
        const data = await response.json();
        if (data.response) {
            appendMessage('ai', data.response);
            speak(data.response);
            if (data.response.includes("The interview is now concluded")) {
                interviewStarted = false;
                setTimeout(() => { window.location.href = "/results"; }, 5000);
            }
        }
    } catch (error) { console.error("Fetch Error:", error); }
}

function appendMessage(role, text) {
    if (!chatWindow) return;
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role === 'user' ? 'user-message' : 'ai-message');
    msgDiv.innerText = text;
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
}

async function startInterview() {
    console.log("Starting Interview and Camera...");
    
    try {
        // 1. Request Video and Audio
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoElement = document.getElementById('user-video');
        if (videoElement) videoElement.srcObject = stream;

        // 2. HIDE THE RULES OVERLAY
        document.getElementById("rules-screen").style.display = "none";

        // 3. ✅ SHOW THE INTERVIEW HEADER (Timer, Live, End button)
        const header = document.querySelector('.interview-header');
        if (header) {
            header.style.display = 'flex'; // This makes the header appear now!
        }
        
        // 4. Set state and start the session timer
        interviewStarted = true;
        startTimer(); // Starts the 00:00 clock

        // 5. Trigger the first AI message
        setTimeout(() => {
            const greeting = "Hello! I am your AI Interviewer. I've received your application. To begin, please state your name and the role you are applying for today.";
            appendMessage('ai', greeting);
            speak(greeting);
        }, 1000);

    } catch (err) {
        console.error("Hardware Error:", err);
        alert("Camera and Microphone are required. Please check your browser permissions.");
    }
}

// --- 7. PROFILE & UTILITY LOGIC (Safeguarded) ---
function saveProfile() {
    const nameEl = document.getElementById("prof-name");
    const emailEl = document.getElementById("prof-email");
    if(!nameEl) return;

    const skills = [];
    document.querySelectorAll("#selected-skills .skill-chip").forEach(el => skills.push(el.innerText));

    fetch("/update_profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameEl.value, email: emailEl.value, skills: skills })
    });
    const toast = document.getElementById("toast");
    if(toast) {
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2000);
    }
}

// --- 8. DOM CONTENT LOADED (Animations & Initials) ---
document.addEventListener("DOMContentLoaded", () => {
    // Skills Logic
    const chips = document.querySelectorAll(".skill-chip");
    const selectedContainer = document.getElementById("selected-skills");
    if (chips.length > 0 && selectedContainer) {
        chips.forEach(chip => {
            chip.addEventListener("click", () => {
                chip.classList.toggle("active");
                // Logic to update selectedSkills array here...
            });
        });
    }

    // Results Animations
    const scoreRing = document.getElementById("main-score-ring");
    if (scoreRing) {
        const targetScore = parseInt(scoreRing.getAttribute("data-score"));
        const scoreDisplay = scoreRing.querySelector(".big-percent");
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / 2000, 1);
            const currentScore = Math.floor(progress * targetScore);
            scoreDisplay.innerText = currentScore;
            scoreRing.style.background = `conic-gradient(#8a2be2 0deg, #00d2ff ${currentScore * 3.6}deg, #161625 ${currentScore * 3.6}deg)`;
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
        setTimeout(() => {
            document.querySelectorAll(".fat-fill").forEach(bar => {
                bar.style.width = bar.getAttribute("data-width") + "%";
            });
        }, 500);
    }
});

// --- 9. EVENT LISTENERS ---
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (userInput) userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
if (micBtn && recognition) micBtn.addEventListener('click', () => { if (!isAiSpeaking) try { recognition.start(); } catch(e) {} });
const actualStartBtn = document.getElementById('start-interview-btn');
if (actualStartBtn) actualStartBtn.addEventListener('click', startInterview);


let startTime;
let timerInterval;

// 1. START INTERVIEW LOGIC
async function startInterview() {
    try {
        // A. Get hardware access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('user-video').srcObject = stream;

        // B. HIDE Rules Card & SHOW Interview Header
        document.getElementById("rules-screen").style.display = "none";
        document.getElementById("main-header").style.display = "flex"; // REVEAL HEADER

        // C. Start State & Timer
        interviewStarted = true;
        beginTimer(); 

        // D. Initial AI Greeting
        setTimeout(() => {
            const greeting = "Hello! I am your AI Interviewer. The session is now live. Please introduce yourself.";
            appendMessage('ai', greeting);
            speak(greeting);
        }, 1000);

    } catch (err) {
        alert("Camera and Microphone are required to proceed.");
    }
}

// 2. WORKING TIMER LOGIC
function beginTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const totalSecs = Math.floor(elapsed / 1000);
        const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
        const secs = (totalSecs % 60).toString().padStart(2, '0');
        
        const timerDisplay = document.getElementById('session-timer');
        if (timerDisplay) {
            timerDisplay.innerText = `${mins}:${secs}`;
        }
    }, 1000);
}

// 3. CUSTOM MODAL LOGIC
function showEndModal() {
    document.getElementById("custom-confirm-modal").style.display = "flex";
}

function closeEndModal() {
    document.getElementById("custom-confirm-modal").style.display = "none";
}

function finalExit() {
    // Stop the timer
    clearInterval(timerInterval);
    
    // Stop the camera
    const video = document.getElementById('user-video');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    
    // Redirect to Dashboard
    window.location.href = "/dashboard";
}

document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Verifying...';
    btn.disabled = true;

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { data, error } = await window.supabase.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        // PROFESSIONAL ERROR MESSAGES
        let msg = "The email or password you entered is incorrect.";
        if (error.message.includes("Email not confirmed")) msg = "Please verify your email address first.";
        
        showToast(msg, 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
    } else {
        // BRIDGE TO FLASK: Tell Python we are logged in
        const fullName = data.user.user_metadata.full_name || "User";
        
        await fetch('/api/set_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fullName, email: email })
        });

        showToast("Login successful! Accessing dashboard...", 'success');
        setTimeout(() => window.location.href = "/dashboard", 1000);
    }
});

document.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Profile...';

    const fullName = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;

    const { data, error } = await window.supabase.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: fullName } }
    });

    if (error) { 
        showToast(error.message, 'error'); 
        btn.innerHTML = 'Sign Up Now'; 
    } else { 
        // BRIDGE TO FLASK
        await fetch('/api/set_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fullName, email: email })
        });

        showToast("Account created! Welcome to AI Hire.", 'success');
        setTimeout(() => window.location.href = "/dashboard", 1500); 
    }
});

async function handleGoogleAuth() {
    const { data, error } = await window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            // This is the trick: Redirect to a custom route that sets the session
            redirectTo: window.location.origin + '/dashboard' 
        }
    });
}

