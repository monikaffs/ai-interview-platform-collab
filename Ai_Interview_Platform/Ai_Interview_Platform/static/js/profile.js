/**
 * profile.js - Profile Management Logic
 * Depends on window.supabase initialized in supabase_client.js
 */

let unifiedSkillsArray = [];
let resumeFileRemoved = false;

// ==========================================
// INITIAL DATA LOAD
// ==========================================
async function loadProfileData() {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login';
        return;
    }

    // 1. Load Profile
    const { data: profile, error: pErr } = await window.supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    
    if (profile) {
        // Basic Info
        setVal('prof-full-name', profile.full_name);
        setVal('prof-bio', profile.bio);
        setVal('prof-phone', profile.phone_number);
        setVal('prof-location', profile.location);

        // Sidebar identity
        if (profile.full_name) document.getElementById('sidebar-name').innerText = profile.full_name;
        document.getElementById('sidebar-email').innerText = profile.email || user.email;

        // Dropdowns
        setVal('prof-role', profile.primary_role);
        setVal('prof-exp', profile.experience_level);
        setVal('prof-opp', profile.opportunity_type);

        // URLs
        setVal('prof-github', profile.github_url);
        setVal('prof-linkedin', profile.linkedin_url);
        
        // Show Existing Resume Filename (if saved)
        if (profile.resume_url) {
            const parts = profile.resume_url.split('/');
            const filename = parts[parts.length - 1].split('?')[0]; // simple cleanup
            const fDisplay = document.getElementById('file-name-display');
            if (fDisplay) fDisplay.innerText = "Current File: " + decodeURIComponent(filename);
            
            const discardBtn = document.getElementById('remove-resume-btn');
            if (discardBtn) discardBtn.style.display = 'block';
        }

        // Technical Stack & Custom Skills (Unified List)
        if (profile.technical_stack && Array.isArray(profile.technical_stack)) {
            profile.technical_stack.forEach(s => addUnifiedSkill(s, true));
        }
        if (profile.custom_skills && Array.isArray(profile.custom_skills)) {
            profile.custom_skills.forEach(s => addUnifiedSkill(s, true));
        }
        renderUnifiedSkills();

        // Calculate Completion
        updateCompletionProgress(profile);
    }

    // 2. Load Interview Stats (for Avg Score)
    const { data: reports, error: rErr } = await window.supabase
        .from('interview_reports')
        .select('technical_score, communication_score, confidence_score')
        .eq('user_id', user.id);
    
    if (reports && reports.length > 0) {
        let total = 0;
        let count = 0;
        reports.forEach(r => {
            const t = r.technical_score || 0;
            const c = r.communication_score || 0;
            const f = r.confidence_score || 0;
            if (t || c || f) {
                total += (t + c + f) / 3;
                count++;
            }
        });
        
        const avg = count > 0 ? Math.round(total / count) : 0;
        const avgEl = document.getElementById('avg-score-val');
        if (avgEl) avgEl.innerText = avg > 0 ? avg + '%' : '--%';
    }
}

// ==========================================
// SAVE LOGIC
// ==========================================
async function saveProfileData() {
    const btn = document.querySelector('.aurora-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) throw new Error("No session");

        // Split unified stack safely into logical buckets for Supabase profiles structure
        const activePresets = Array.from(document.querySelectorAll('#preset-skills .skill-chip'))
                                   .map(c => c.innerText.trim().toLowerCase());
        
        const technical_stack = [];
        const custom_skills = [];
        
        unifiedSkillsArray.forEach(sk => {
            if (activePresets.includes(sk.toLowerCase())) {
                technical_stack.push(sk);
            } else {
                custom_skills.push(sk);
            }
        });

        // Resume Upload Handling
        let resumePublicUrl = null;
        const resumeFile = document.getElementById('prof-resume-file')?.files[0];
        
        if (resumeFile && !resumeFileRemoved) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Resume...';
            
            const cleanName = resumeFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const filePath = `${user.id}/${Date.now()}_${cleanName}`;
            
            const { data: uploadData, error: uploadErr } = await window.supabase.storage
                .from('resumes')
                .upload(filePath, resumeFile, { upsert: true });
                
            if (uploadErr) {
                console.error("Storage upload error:", uploadErr);
                throw new Error("Failed to upload resume. Ensure 'resumes' bucket exists and permissions are set.");
            }
            
            const { data: urlData } = window.supabase.storage
                .from('resumes')
                .getPublicUrl(uploadData.path);
                
            resumePublicUrl = urlData.publicUrl;
        }

        // Build Payload
        const payload = {
            full_name: getVal('prof-full-name'),
            bio: getVal('prof-bio'),
            phone_number: getVal('prof-phone'),
            location: getVal('prof-location'),
            primary_role: getVal('prof-role'),
            experience_level: getVal('prof-exp'),
            opportunity_type: getVal('prof-opp'),
            github_url: getVal('prof-github'),
            linkedin_url: getVal('prof-linkedin'),
            technical_stack: technical_stack,
            custom_skills: custom_skills
        };
        
        if (resumeFileRemoved && !resumeFile) {
            payload.resume_url = null;
        } else if (resumePublicUrl) {
            payload.resume_url = resumePublicUrl;
        }

        const { error } = await window.supabase
            .from('profiles')
            .update(payload)
            .eq('id', user.id);
        
        if (error) throw error;

        // Update UI
        if (payload.full_name) document.getElementById('sidebar-name').innerText = payload.full_name;
        updateCompletionProgress(payload);
        showToast();

    } catch (err) {
        console.error("Save Error:", err);
        alert("Failed to save profile. " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        resumeFileRemoved = false; // Reset toggle
    }
}

// ==========================================
// COMPLETION BAR LOGIC
// ==========================================
function updateCompletionProgress(profile) {
    const fields = [
        profile.full_name,
        profile.bio,
        profile.primary_role,
        profile.experience_level,
        profile.location,
        profile.github_url,
        profile.linkedin_url,
        (profile.technical_stack && profile.technical_stack.length > 0) || (profile.custom_skills && profile.custom_skills.length > 0)
    ];

    const filledCount = fields.filter(val => {
        if (typeof val === 'string') return val.trim().length > 0;
        if (typeof val === 'boolean') return val === true;
        return val != null;
    }).length;

    const percentage = Math.round((filledCount / fields.length) * 100);
    
    document.getElementById('completion-bar').style.width = percentage + '%';
    document.getElementById('completion-text').innerText = percentage + '%';
}

// ==========================================
// UNIFIED SKILLS & CHIPS UI
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Basic Chips Toggle + Unified Array Insert
    const chips = document.querySelectorAll('#preset-skills .skill-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const skill = chip.innerText.trim();
            if (chip.classList.contains('active')) {
                // Removing
                removeUnifiedSkill(skill);
            } else {
                // Adding
                addUnifiedSkill(skill);
            }
        });
    });

    // Custom Skills Enter Key
    const skillInput = document.getElementById('custom-skill-input');
    if (skillInput) {
        skillInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomSkillFromInput();
            }
        });
    }

    // Load initial data
    loadProfileData();

    // Setup Resume Drag & Drop
    setupResumeUploadUI();
});

function addCustomSkillFromInput() {
    const input = document.getElementById('custom-skill-input');
    const val = input.value.trim();
    if (val) {
        const added = addUnifiedSkill(val);
        if (added) {
            input.value = '';
        } else {
            // Provide subtle feedback if it's a duplicate
            input.value = '';
            input.placeholder = "Skill already exists!";
            setTimeout(() => input.placeholder = "e.g. GraphQL, TailwindCSS", 1500);
        }
    }
}

function addUnifiedSkill(skillStr, skipRender = false) {
    const cleanStr = skillStr.trim();
    if (!cleanStr) return false;
    
    // Case-insensitive duplicate check
    const lower = cleanStr.toLowerCase();
    const exists = unifiedSkillsArray.find(s => s.toLowerCase() === lower);
    
    if (exists) {
        return false; // Already tracking it
    }
    
    unifiedSkillsArray.push(cleanStr);
    
    // Toggle corresponding visual preset chip if exists
    const chips = document.querySelectorAll('#preset-skills .skill-chip');
    chips.forEach(c => {
        if (c.innerText.trim().toLowerCase() === lower) c.classList.add('active');
    });

    if (!skipRender) renderUnifiedSkills();
    return true;
}

function removeUnifiedSkill(skillStr) {
    const lower = skillStr.toLowerCase();
    unifiedSkillsArray = unifiedSkillsArray.filter(s => s.toLowerCase() !== lower);
    
    // Un-toggle visual preset chip
    const chips = document.querySelectorAll('#preset-skills .skill-chip');
    chips.forEach(c => {
        if (c.innerText.trim().toLowerCase() === lower) c.classList.remove('active');
    });

    renderUnifiedSkills();
}

function renderUnifiedSkills() {
    const area = document.getElementById('custom-skills-area');
    area.innerHTML = unifiedSkillsArray.map(skill => `
        <span class="added-skill-tag">
            ${skill} <i class="fas fa-times" onclick="removeUnifiedSkill('${skill.replace(/'/g, "\\'")}')"></i>
        </span>
    `).join('');
}

// ==========================================
// RESUME UPLOAD UI LOGIC
// ==========================================
function setupResumeUploadUI() {
    const fileInput = document.getElementById('prof-resume-file');
    const dropZone = document.getElementById('drop-zone');
    const display = document.getElementById('file-name-display');
    const discardBtn = document.getElementById('remove-resume-btn');

    if (!fileInput || !dropZone) return;

    // Handle File Selection
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            display.innerText = "Selected: " + e.target.files[0].name;
            display.style.color = "#0ea5e9";
            resumeFileRemoved = false;
            if (discardBtn) discardBtn.style.display = 'block';
        }
    });

    // Drag constraints
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, prEvent, false);
    });
    
    function prEvent(e) {
        e.preventDefault(); e.stopPropagation();
    }

    // Highlight
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    // Handle Drop
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type === 'application/pdf') {
                fileInput.files = e.dataTransfer.files;
                display.innerText = "Selected: " + file.name;
                display.style.color = "#0ea5e9";
                resumeFileRemoved = false;
                if (discardBtn) discardBtn.style.display = 'block';
            } else {
                alert("Only PDF files are supported");
            }
        }
    }, false);
}

function discardResume() {
    const fileInput = document.getElementById('prof-resume-file');
    if (fileInput) fileInput.value = ''; // clears user selected DOM file
    
    const display = document.getElementById('file-name-display');
    if (display) {
        display.innerText = '';
        display.style.color = '';
    }
    
    document.getElementById('remove-resume-btn').style.display = 'none';
    resumeFileRemoved = true;
}

// ==========================================
// UTILS
// ==========================================
function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : null;
}

function setVal(id, value) {
    if (value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }
}

function showToast() {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}
