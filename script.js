// Keep the installed app available offline and check for updated assets.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .catch(error => console.warn('Service worker registration failed:', error));
    });
}

// --- State & Settings ---
    const DB_NAME = "MinimalPloverDB";
    const DB_VERSION = 9; 
    let db;
    let dictionaries = [];
    let searchActiveKeys = new Set();
    let modalCallback = null;
    let pendingImportPayload = null;

    const defaultLayout = {
        num:  ['#','#','#','#','#','#','#','#','#','#','#','#'],
        extL: [' ', ' '], 
        topL: ['S-','T-','P-','H-'], botL: ['S-','K-','W-','R-'],
        topC: ['*','*'], botC: ['*','*'],
        topR: ['-F','-P','-L','-T','-D'], botR: ['-R','-B','-G','-S','-Z'],
        thmbL: [' ', 'A-', 'O-'], thmbR: ['E-', 'U-', ' ']
    };

    let settings = JSON.parse(localStorage.getItem('ploverSettings')) || {};
    
    if (!settings.profiles) {
        settings.profiles = {};
        for(let i=1; i<=5; i++) {
            let legacyLayout = settings.layout ? JSON.parse(JSON.stringify(settings.layout)) : JSON.parse(JSON.stringify(defaultLayout));
            if(!legacyLayout.extL) legacyLayout.extL = [' ', ' '];
            while(legacyLayout.num.length < 12) legacyLayout.num.push('#');
            
            settings.profiles[i] = {
                theme: settings.theme || 'dark',
                layout: legacyLayout,
                showDiagrams: settings.showDiagrams !== undefined ? settings.showDiagrams : true,
                showNumberBar: settings.showNumberBar !== undefined ? settings.showNumberBar : true,
                extraThumbs: settings.extraThumbs !== undefined ? settings.extraThumbs : false,
                extraLeftCol: false,
                practiceSoundFeedback: settings.profiles?.[i]?.audioFeedback || false,
                quoteLanguage: 'lessons/Random Quotes/Random Quote (English).json'
            };
        }
        
        settings.customTheme = settings.customTheme || {
            bg: '#000000', surface: '#111111', surfaceHover: '#222222', 
            border: '#333333', text: '#ffffff', accent: '#ff0055',
            practiceUntyped: '#888888', practiceCorrect: '#ffffff', practiceWrong: '#ff5555', practiceCursor: '#ff0055'
        };
        settings.activeProfile = settings.activeProfile || 1;
        settings.searchMode = settings.searchMode || 'word';
        
        delete settings.theme;
        delete settings.layout;
        delete settings.showDiagrams;
        delete settings.showNumberBar;
        delete settings.extraThumbs;
    } else {
        for(let i=1; i<=5; i++) {
            if(!settings.profiles[i].layout.extL) settings.profiles[i].layout.extL = [' ', ' '];
            while(settings.profiles[i].layout.num.length < 12) settings.profiles[i].layout.num.push('#');
            if(settings.profiles[i].extraLeftCol === undefined) settings.profiles[i].extraLeftCol = false;
            if(settings.profiles[i].showDiagrams === undefined) settings.profiles[i].showDiagrams = true;
            if(settings.profiles[i].practiceSoundFeedback === undefined) {
                settings.profiles[i].practiceSoundFeedback = settings.profiles[i].audioFeedback || false;
            }
            if(settings.profiles[i].quoteLanguage === undefined) {
                settings.profiles[i].quoteLanguage = 'lessons/Random Quotes/Random Quote (English).json';
            }
        }
    }

    settings.customTheme = Object.assign({
        bg: '#000000', surface: '#111111', surfaceHover: '#222222', border: '#333333',
        text: '#ffffff', accent: '#ff0055', practiceUntyped: '#888888', practiceCorrect: '#ffffff',
        practiceWrong: '#ff5555', practiceCursor: '#ff0055'
    }, settings.customTheme || {});

    const legacyPracticeSettings = {
        practiceMaterial: localStorage.getItem('steno_practice_text') || '',
        practiceMode: localStorage.getItem('steno_practice_mode') || 'random',
        strokeVisibility: localStorage.getItem('steno_practice_vis') || 'always',
        strokeHintType: localStorage.getItem('steno_practice_hint') || 'shortest',
        practiceRepeats: localStorage.getItem('steno_practice_repeats') || '0',
        practiceMaxWords: localStorage.getItem('steno_practice_maxWords') || '0',
        practiceProblemWords: localStorage.getItem('steno_practice_problemWords') || '0',
        practiceLesson: 'custom',
        ignoreCaps: localStorage.getItem('steno_ignoreCaps') === '1',
        ignorePunct: localStorage.getItem('steno_ignorePunct') === '1'
    };
    for (let profileId = 1; profileId <= 5; profileId++) {
        const profile = settings.profiles[profileId];
        Object.entries(legacyPracticeSettings).forEach(([key, fallback]) => {
            if (profile[key] === undefined) {
                profile[key] = profileId === Number(settings.activeProfile) ? fallback : (key === 'practiceMaterial' ? '' : fallback);
            }
        });
    }

    function saveSettings() {
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        updateSettingsUI();
        applyThemeStyles();
        renderConfigBoard();
        
        const p = settings.profiles[settings.activeProfile];
        if(settings.searchMode === 'stroke' && p.showDiagrams) {
            document.getElementById('interactiveSearchBoard').style.display = 'block';
            renderInteractiveSearchBoard();
        } else {
            document.getElementById('interactiveSearchBoard').style.display = 'none';
        }
        
        triggerSearch();
    }

    function resetLayout() {
        settings.profiles[settings.activeProfile].layout = JSON.parse(JSON.stringify(defaultLayout));
        saveSettings();
    }

    function toggleProfileSetting(key) {
        const p = settings.profiles[settings.activeProfile];
        p[key] = !p[key];
        saveSettings();
        if (key === 'practiceSoundFeedback' && p[key]) {
            unlockPracticeAudio();
            playPracticeFeedback('correct');
        }
        if (key === 'showDiagrams') renderPersistentProblemWords();
    }

    let practiceAudioContext;
    function unlockPracticeAudio() {
        try {
            practiceAudioContext = practiceAudioContext || new (window.AudioContext || window.webkitAudioContext)();
            if (practiceAudioContext.state === 'suspended') practiceAudioContext.resume();
        } catch (e) {}
    }

    function playPracticeFeedback(kind) {
        const profile = settings.profiles[settings.activeProfile];
        if (!profile.practiceSoundFeedback) return;
        try {
            unlockPracticeAudio();
            const playTone = () => {
                const oscillator = practiceAudioContext.createOscillator();
                const gain = practiceAudioContext.createGain();
                const now = practiceAudioContext.currentTime;
                const isError = kind === 'miss';
                oscillator.type = isError ? 'triangle' : 'sine';
                oscillator.frequency.value = isError ? 440 : 240;
                oscillator.detune.value = isError ? -10 : 0;
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(isError ? 0.44 : 0.64, now + 0.01);
                if (isError) {
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
                } else {
                    oscillator.frequency.exponentialRampToValueAtTime(180, now + 0.1);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
                }
                oscillator.connect(gain).connect(practiceAudioContext.destination);
                oscillator.start(now);
                oscillator.stop(now + (isError ? 0.08 : 0.12));
            };
            if (practiceAudioContext.state === 'suspended') {
                practiceAudioContext.resume().then(playTone).catch(() => {});
            } else {
                playTone();
            }
        } catch (e) {}
    }
    
    function setProfileTheme(theme) {
        settings.profiles[settings.activeProfile].theme = theme;
        saveSettings();
    }

    function updateCustomColor(key, value) {
        settings.customTheme[key] = value;
        saveSettings();
    }

    function applyThemeStyles() {
        const theme = settings.profiles[settings.activeProfile].theme;
        if (theme === 'custom') {
            document.body.className = '';
            document.documentElement.style.setProperty('--bg', settings.customTheme.bg);
            document.documentElement.style.setProperty('--surface', settings.customTheme.surface);
            document.documentElement.style.setProperty('--surface-hover', settings.customTheme.surfaceHover);
            document.documentElement.style.setProperty('--border', settings.customTheme.border);
            document.documentElement.style.setProperty('--text-main', settings.customTheme.text);
            document.documentElement.style.setProperty('--text-muted', settings.customTheme.text); 
            document.documentElement.style.setProperty('--accent', settings.customTheme.accent);
            document.documentElement.style.setProperty('--accent-invert', settings.customTheme.bg);
            document.documentElement.style.setProperty('--practice-untyped', settings.customTheme.practiceUntyped);
            document.documentElement.style.setProperty('--practice-correct', settings.customTheme.practiceCorrect);
            document.documentElement.style.setProperty('--practice-wrong', settings.customTheme.practiceWrong);
            document.documentElement.style.setProperty('--practice-cursor', settings.customTheme.practiceCursor);
            
            document.getElementById('customThemePanel').style.display = 'grid';
        } else {
            document.body.className = `theme-${theme}`;
            document.documentElement.removeAttribute('style');
            document.getElementById('customThemePanel').style.display = 'none';
        }
    }

    function changeProfile(profileId) {
        settings.activeProfile = profileId;
        saveSettings();
        document.getElementById('lblProfileNum').innerText = profileId;
        loadPracticeSettingsForProfile();
        syncQuoteLanguageUI();
        drawPersistentProgressGraph();
        loadDictionaries(true); 
    }

    function savePracticeSettingsForProfile() {
        const profile = settings.profiles[settings.activeProfile];
        ['practiceMaterial', 'practiceMode', 'strokeVisibility', 'strokeHintType', 'practiceRepeats', 'practiceMaxWords', 'practiceProblemWords', 'practiceLesson'].forEach(id => {
            const input = document.getElementById(id);
            if (input) profile[id] = input.value;
        });
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
    }

    function loadPracticeSettingsForProfile() {
        const profile = settings.profiles[settings.activeProfile];
        Object.entries({
            practiceMaterial: 'practiceMaterial',
            practiceMode: 'practiceMode',
            strokeVisibility: 'strokeVisibility',
            strokeHintType: 'strokeHintType',
            practiceRepeats: 'practiceRepeats',
            practiceMaxWords: 'practiceMaxWords',
            practiceProblemWords: 'practiceProblemWords',
            practiceLesson: 'lessonSelect'
        }).forEach(([key, id]) => {
            const input = document.getElementById(id);
            if (input && profile[key] !== undefined) input.value = profile[key];
        });
    }

    function clearPracticeMaterial() {
        document.getElementById('practiceMaterial').value = '';
        document.getElementById('lessonSelect').value = 'custom';
        document.getElementById('newQuoteButton').classList.add('hidden');
        savePracticeSettingsForProfile();
    }

    function showLoader(title, desc) {
        const overlay = document.getElementById('loadingOverlay');
        document.getElementById('loadingTitle').innerText = title;
        if(desc) document.getElementById('loadingDesc').innerText = desc;
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
    }

    function hideLoader() {
        const overlay = document.getElementById('loadingOverlay');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 400);
    }

    function openModal(title, message, callback) {
        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = message;
        modalCallback = callback;
        document.getElementById('customModal').classList.remove('hidden');
    }

    function closeModal() {
        document.getElementById('customModal').classList.add('hidden');
        modalCallback = null;
    }

    document.getElementById('modalBtnConfirm').addEventListener('click', () => {
        if(modalCallback) modalCallback();
        closeModal();
    });

    function promptClearProfile() {
        openModal("Clear Profile Dictionaries", `Are you sure you want to delete all dictionaries for Profile ${settings.activeProfile}?`, async () => {
            const dictsToDelete = dictionaries.map(d => ({id: d.id, name: d.name}));
            if (dictsToDelete.length === 0) return;

            showLoader("Clearing Dictionaries", "Preparing...");
            
            for (let d = 0; d < dictsToDelete.length; d++) {
                const dict = dictsToDelete[d];
                document.getElementById('loadingTitle').innerText = `Clearing File ${d + 1} of ${dictsToDelete.length}`;
                await new Promise((resolve) => {
                    const tx = db.transaction('entries', 'readonly');
                    const req = tx.objectStore('entries').index('dictId').getAllKeys(IDBKeyRange.only(dict.id));
                    
                    req.onsuccess = () => {
                        const keys = req.result;
                        if(!keys.length) {
                            const metaTx = db.transaction('dicts', 'readwrite');
                            metaTx.objectStore('dicts').delete(dict.id);
                            metaTx.oncomplete = resolve;
                            return;
                        }
                        
                        let i = 0;
                        const CHUNK_SIZE = 5000;
                        
                        function deleteNextChunk() {
                            if (i >= keys.length) {
                                const metaTx = db.transaction('dicts', 'readwrite');
                                metaTx.objectStore('dicts').delete(dict.id);
                                metaTx.oncomplete = resolve;
                                return;
                            }
                            
                            document.getElementById('loadingDesc').innerText = `Deleting ${dict.name}... ${Math.round((i/keys.length)*100)}%`;
                            
                            requestAnimationFrame(() => {
                                const chunkTx = db.transaction('entries', 'readwrite');
                                const store = chunkTx.objectStore('entries');
                                const end = Math.min(i + CHUNK_SIZE, keys.length);
                                
                                for(; i < end; i++) {
                                    store.delete(keys[i]);
                                }
                                
                                chunkTx.oncomplete = () => setTimeout(deleteNextChunk, 10);
                            });
                        }
                        deleteNextChunk();
                    };
                });
            }
            loadDictionaries(true);
        });
    }

    function promptClearSettings() {
        openModal("Clear Settings", "Are you sure you want to reset all display, theme, and layout settings back to defaults? (Your dictionaries will be kept).", () => {
            localStorage.removeItem('ploverSettings');
            location.reload();
        });
    }

    function promptClearUserData() {
        openModal("Clear User Data", "Are you sure you want to erase your practice graph and problematic word list?", () => {
            savePersistentProgress({ sessions: [], problematic: {} });
            renderPersistentProblemWords();
            drawPersistentProgressGraph();
        });
    }

    function exportUserData() {
        savePracticeSettingsForProfile();
        const selectedQuoteLanguage = document.getElementById('quoteLanguage')?.value;
        if (selectedQuoteLanguage) {
            settings.profiles[settings.activeProfile].quoteLanguage = selectedQuoteLanguage;
        }
        const payload = {
            format: 'stenodict-user-data',
            version: 2,
            progress: getAllPersistentProgress(),
            settings: settings
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'stenodict-user-data.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function importUserData(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const payload = JSON.parse(reader.result);
                if (payload?.format !== 'stenodict-user-data' || ![1, 2].includes(payload?.version)) {
                    throw new Error('Unsupported user data file.');
                }
                const importedSettings = payload.settings;
                const importedProgress = payload.version === 2 ? payload.progress : { profiles: { [settings.activeProfile]: payload.progress } };
                if (!importedProgress || !importedProgress.profiles || typeof importedProgress.profiles !== 'object' || !importedSettings || typeof importedSettings !== 'object' || !importedSettings.profiles || typeof importedSettings.profiles !== 'object' || !importedSettings.customTheme || typeof importedSettings.customTheme !== 'object') {
                    throw new Error('Invalid user data.');
                }
                pendingImportPayload = { settings: importedSettings, progress: importedProgress };
                showImportProfilesModal(Object.keys(importedSettings.profiles).filter(profileId => importedProgress.profiles[profileId]));
            } catch (error) {
                openModal('Import Failed', 'Unable to import that user data file.', () => {});
            }
        };
        reader.onerror = () => openModal('Import Failed', 'Unable to read that user data file.', () => {});
        reader.readAsText(file);
    }

    function showImportProfilesModal(profileIds) {
        const list = document.getElementById('importProfilesList');
        list.innerHTML = profileIds.map(profileId => `<label><input type="checkbox" value="${profileId}" checked> Profile ${profileId}</label>`).join('');
        document.getElementById('importProfilesModal').classList.remove('hidden');
    }

    function closeImportProfilesModal() {
        document.getElementById('importProfilesModal').classList.add('hidden');
        pendingImportPayload = null;
    }

    function confirmImportProfiles() {
        if (!pendingImportPayload) return;
        const selectedProfiles = Array.from(document.querySelectorAll('#importProfilesList input:checked')).map(input => input.value);
        if (!selectedProfiles.length) return;

        const imported = pendingImportPayload;
        selectedProfiles.forEach(profileId => {
            if (imported.settings.profiles[profileId]) {
                settings.profiles[profileId] = Object.assign({}, settings.profiles[profileId], imported.settings.profiles[profileId]);
                const importedProfile = settings.profiles[profileId];
                const practiceDefaults = {
                    practiceMaterial: '', practiceMode: 'random', practiceLesson: 'custom',
                    strokeVisibility: 'always', strokeHintType: 'shortest',
                    practiceRepeats: '0', practiceMaxWords: '0', practiceProblemWords: '0',
                    ignoreCaps: false, ignorePunct: false,
                    quoteLanguage: 'lessons/Random Quotes/Random Quote (English).json'
                };
                Object.entries(practiceDefaults).forEach(([key, fallback]) => {
                    if (importedProfile[key] === undefined) importedProfile[key] = fallback;
                });
            }
        });
        settings.customTheme = Object.assign({
            bg: '#000000', surface: '#111111', surfaceHover: '#222222', border: '#333333',
            text: '#ffffff', accent: '#ff0055', practiceUntyped: '#888888', practiceCorrect: '#ffffff',
            practiceWrong: '#ff5555', practiceCursor: '#ff0055'
        }, imported.settings.customTheme);
        saveAllPersistentProgress(getAllPersistentProgress(), imported.progress, selectedProfiles);
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        closeImportProfilesModal();
        updateSettingsUI();
        applyThemeStyles();
        renderPersistentProblemWords();
        drawPersistentProgressGraph();
        openModal('User Data Imported', 'The selected profile data, layouts, and settings were imported successfully.', () => {});
    }

    function toggleSearchMenu(event) {
        event.stopPropagation();
        document.getElementById('searchModeMenu').classList.toggle('visible');
    }

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('searchModeMenu');
        if (menu && menu.classList.contains('visible') && !e.target.closest('.search-mode-wrapper')) {
            menu.classList.remove('visible');
        }
    });

    function setSearchMode(mode) {
        document.getElementById('searchModeMenu').classList.remove('visible');
        const input = document.getElementById('searchInput');
        const modeBtn = document.getElementById('searchModeBtn');
        
        if (settings.searchMode !== mode) {
            input.value = '';
            searchActiveKeys.clear();
        }

        settings.searchMode = mode;
        if(mode === 'word') {
            modeBtn.innerHTML = "Word ▾";
            input.placeholder = "Search a word...";
        } else {
            modeBtn.innerHTML = "Stroke ▾";
            input.placeholder = "Enter raw steno (e.g., ST-PB)...";
            searchActiveKeys = parseStrokeToKeys(input.value.toUpperCase());
        }
        
        saveSettings();
    }

    function updateSettingsUI() {
        const p = settings.profiles[settings.activeProfile];
        
        const themes = [
            'dark','neon-cyan','light','oled','dracula','tokyo-night','hacker','synthwave',
            'monokai','nord','gruvbox','catppuccin','solarized-dark','solarized-light',
            'cyberpunk','rose-pine','coffee','emerald','sunset','amethyst','cherry',
            'ocean','amber','charcoal','ruby','arctic','gold','mint','lavender',
            'tangerine','slate','matcha','velvet','midnight','custom'
        ];
        themes.forEach(t => {
            const btn = document.getElementById(`theme-${t}`);
            if(btn) btn.className = p.theme === t ? 'active' : '';
        });

        ['bg', 'surface', 'surfaceHover', 'border', 'text', 'accent', 'practiceUntyped', 'practiceCorrect', 'practiceWrong', 'practiceCursor'].forEach(k => {
            const el = document.getElementById('c_' + k);
            if(el) el.value = settings.customTheme[k];
        });

        document.getElementById('profileSelect').value = settings.activeProfile;
        document.getElementById('lblProfileNum').innerText = settings.activeProfile;

        document.getElementById('btnShowDiagrams').style.borderColor = p.showDiagrams ? 'var(--accent)' : 'var(--border)';
        document.getElementById('btnShowDiagrams').style.color = p.showDiagrams ? 'var(--text-main)' : 'var(--text-muted)';
        
        document.getElementById('btnNumBar').style.borderColor = p.showNumberBar ? 'var(--accent)' : 'var(--border)';
        document.getElementById('btnNumBar').style.color = p.showNumberBar ? 'var(--text-main)' : 'var(--text-muted)';
        
        document.getElementById('btnExtraThumbs').style.borderColor = p.extraThumbs ? 'var(--accent)' : 'var(--border)';
        document.getElementById('btnExtraThumbs').style.color = p.extraThumbs ? 'var(--text-main)' : 'var(--text-muted)';

        document.getElementById('btnExtraLeftCol').style.borderColor = p.extraLeftCol ? 'var(--accent)' : 'var(--border)';
        document.getElementById('btnExtraLeftCol').style.color = p.extraLeftCol ? 'var(--text-main)' : 'var(--text-muted)';

        document.getElementById('btnPracticeSoundFeedback').style.borderColor = p.practiceSoundFeedback ? 'var(--accent)' : 'var(--border)';
        document.getElementById('btnPracticeSoundFeedback').style.color = p.practiceSoundFeedback ? 'var(--text-main)' : 'var(--text-muted)';
    }

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const menuToggle = document.getElementById('menuToggle');
        sidebar.classList.toggle('open');
        
        if (sidebar.classList.contains('open')) {
            menuToggle.innerHTML = '&#10095;'; 
        } else {
            menuToggle.innerHTML = '&#10094;'; 
        }
    }

    // Practice toggles: ignore capitalization & ignore punctuation
    function togglePracticeOption(key) {
        const profile = settings.profiles[settings.activeProfile];
        profile[key] = !profile[key];
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        updatePracticeTogglesUI();
        try { renderMonkeyText(); skipHiddenPunctuationTokens(); updateMonkeyVisuals(); } catch (e) {}
    }

    function updatePracticeTogglesUI() {
        try {
            const profile = settings.profiles[settings.activeProfile];
            const ic = profile.ignoreCaps;
            const ip = profile.ignorePunct;
            if (typeof practiceState !== 'undefined') {
                practiceState.ignoreCaps = ic;
                practiceState.ignorePunct = ip;
            }
            const btnIC = document.getElementById('btnIgnoreCaps');
            const btnIP = document.getElementById('btnIgnorePunct');
            if (btnIC) btnIC.classList.toggle('active', ic);
            if (btnIP) btnIP.classList.toggle('active', ip);
        } catch (e) { console.warn(e); }
    }

    // Skip over punctuation tokens when Ignore Punctuation is enabled
    function skipHiddenPunctuationTokens() {
        try {
            const ignorePunct = practiceState.ignorePunct;
            if (!ignorePunct || !practiceState || !practiceState.words) return;
                 const isPunct = (w) => (/^[\.,!?;:\"()\[\]{}<>]+$/).test(w);
            while (practiceState.currentIndex < practiceState.words.length && isPunct(practiceState.words[practiceState.currentIndex])) {
                practiceState.currentIndex++;
            }
            // Also ensure typedWords length aligns
            if (practiceState.typedWords && practiceState.typedWords.length < practiceState.words.length) {
                const filled = new Array(practiceState.words.length).fill('');
                for (let i=0;i<practiceState.typedWords.length;i++) filled[i]=practiceState.typedWords[i];
                practiceState.typedWords = filled;
            }
        } catch (e) { console.warn(e); }
    }

    // Normalization used for comparisons (respect toggles)
    function normalizeForComparison(s) {
        if (s === undefined || s === null) return '';
        let out = String(s);
        const ignoreCaps = practiceState.ignoreCaps;
        const ignorePunct = practiceState.ignorePunct;
            if (ignorePunct) out = out.replace(/[\.,!?;:\"()\[\]{}<>]/g, '');
            if (ignoreCaps) out = out.toLowerCase();
        return out;
    }

    // Initialize practice toggles UI on load
    window.addEventListener('load', updatePracticeTogglesUI);

    function updateKey(el, group, idx) {
        let newVal = el.textContent.trim() || ' ';
        settings.profiles[settings.activeProfile].layout[group][idx] = newVal;
        saveSettings(); 
    }

    function generateBoardHTML(activeSet = null, mode = 'display') {
        const p = settings.profiles[settings.activeProfile];
        const s = p.layout;

        const h = (group, idx) => {
            const val = s[group][idx] || ' ';
            const displayVal = val.replace(/-/g, '').trim(); 
            
            const isActive = activeSet ? activeSet.has(val) : false;

            if (mode === 'config') {
                return `<div class="key ${isActive ? 'active' : ''}" 
                             contenteditable="true" 
                             spellcheck="false"
                             onfocus="this.textContent = '${val}'"
                             onblur="updateKey(this, '${group}', ${idx})"
                             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                             title="Underlying map: '${val}'">${displayVal}</div>`;
            } else if (mode === 'search') {
                if(val.trim() === '') return `<div class="key"></div>`; 
                return `<div class="key interactive-key ${isActive ? 'active' : ''}" 
                             onclick="toggleSearchKey('${val}')">${displayVal}</div>`;
            } else {
                return `<div class="key ${isActive ? 'active' : ''}">${displayVal}</div>`;
            }
        };

        const renderGroup = (g, start, end) => {
            let html = '';
            for(let i = start; i < end; i++) html += h(g, i);
            return html;
        };

        let numLeftCount = p.extraLeftCol ? 6 : 5;
        let numRightCount = 6;

        let leftHTML = `<div class="board-half">`;
        if (p.showNumberBar) leftHTML += `<div class="board-row justify-end">${renderGroup('num', 0, numLeftCount)}</div>`;
        leftHTML += `<div class="board-row justify-end">${p.extraLeftCol ? renderGroup('extL', 0, 1) : ''}${renderGroup('topL', 0, 4)}${renderGroup('topC', 0, 1)}</div>`;
        leftHTML += `<div class="board-row justify-end">${p.extraLeftCol ? renderGroup('extL', 1, 2) : ''}${renderGroup('botL', 0, 4)}${renderGroup('botC', 0, 1)}</div>`;
        leftHTML += `<div class="board-row justify-end">`;
        leftHTML += p.extraThumbs ? renderGroup('thmbL', 0, 3) : renderGroup('thmbL', 1, 3);
        leftHTML += `</div></div>`;

        let rightHTML = `<div class="board-half">`;
        if (p.showNumberBar) rightHTML += `<div class="board-row justify-start">${renderGroup('num', numLeftCount, numLeftCount + numRightCount)}</div>`;
        rightHTML += `<div class="board-row justify-start">${renderGroup('topC', 1, 2)}${renderGroup('topR', 0, 5)}</div>`;
        rightHTML += `<div class="board-row justify-start">${renderGroup('botC', 1, 2)}${renderGroup('botR', 0, 5)}</div>`;
        rightHTML += `<div class="board-row justify-start">`;
        rightHTML += p.extraThumbs ? renderGroup('thmbR', 0, 3) : renderGroup('thmbR', 0, 2);
        rightHTML += `</div></div>`;

        return `<div class="board-container"><div class="split-board">${leftHTML}${rightHTML}</div></div>`;
    }

    function renderConfigBoard() {
        document.getElementById('configBoard').innerHTML = generateBoardHTML(null, 'config');
    }

    function renderInteractiveSearchBoard() {
        document.getElementById('searchBoardRender').innerHTML = generateBoardHTML(searchActiveKeys, 'search');
    }

    function keysToStroke(activeKeysMap) {
        const activeKeys = new Set(activeKeysMap); 
        let leftStr = "";
        let midStr = "";
        let rightStr = "";
        let hasNum = activeKeys.has('#');

        const leftOrder = ['S-','T-','K-','P-','W-','H-','R-'];
        const midOrder = ['A-','O-','*','E-','U-'];
        const rightOrder = ['-F','-R','-P','-B','-L','-G','-T','-S','-D','-Z'];

        leftOrder.forEach(k => { if(activeKeys.has(k)) { leftStr += k[0]; activeKeys.delete(k); } });
        midOrder.forEach(k => { if(activeKeys.has(k)) { midStr += k[0]; activeKeys.delete(k); } });
        rightOrder.forEach(k => { if(activeKeys.has(k)) { rightStr += k[1]; activeKeys.delete(k); } });

        activeKeys.forEach(k => {
            if (k === '#') return;
            if (k.endsWith('-') && !midOrder.includes(k)) leftStr += k.replace('-','');
            else if (k.startsWith('-')) rightStr += k.replace('-','');
            else midStr += k; 
        });

        let stroke = "";
        if (hasNum) stroke += "#";
        stroke += leftStr;
        stroke += midStr;
        
        if (midStr === "" && rightStr !== "") {
            stroke += "-" + rightStr;
        } else {
            stroke += rightStr;
        }
        return stroke;
    }

    function toggleSearchKey(val) {
        if(searchActiveKeys.has(val)) searchActiveKeys.delete(val);
        else searchActiveKeys.add(val);

        const input = document.getElementById('searchInput');
        input.value = keysToStroke(searchActiveKeys);
        
        renderInteractiveSearchBoard();
        triggerSearch();
    }

    function parseStrokeToKeys(stroke) {
        stroke = String(stroke || '').toUpperCase();
        let keys = new Set();
        let isRight = false;

        if (stroke.includes('#') || /[1-90]/.test(stroke)) {
            keys.add('#');
        }

        if(stroke.includes('1')) keys.add('S-');
        if(stroke.includes('2')) keys.add('T-');
        if(stroke.includes('3')) keys.add('P-');
        if(stroke.includes('4')) keys.add('H-');
        if(stroke.includes('5')) keys.add('A-');
        if(stroke.includes('0')) keys.add('O-');
        if(stroke.includes('6')) keys.add('E-');
        if(stroke.includes('7')) keys.add('U-');
        if(stroke.includes('8')) keys.add('-F');
        if(stroke.includes('9')) keys.add('-P');

        for (let i = 0; i < stroke.length; i++) {
            let c = stroke[i];
            if (/[1-90#]/.test(c)) continue; 

            if (c === '-') { isRight = true; continue; }
            if (['A', 'O', '*', 'E', 'U'].includes(c)) {
                keys.add(c + '-'); 
                if (c === '*') keys.add('*'); 
                isRight = true; 
                continue;
            }

            keys.add(isRight ? '-' + c : c + '-');
        }
        return keys;
    }

    function initDB() {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (database.objectStoreNames.contains('dicts')) database.deleteObjectStore('dicts');
            if (database.objectStoreNames.contains('entries')) database.deleteObjectStore('entries');
            
            database.createObjectStore('dicts', { keyPath: 'id' });
            const es = database.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
            
            es.createIndex('word_lower', 'word_lower', { unique: false });
            es.createIndex('stroke', 'stroke', { unique: false });
            es.createIndex('dictId', 'dictId', { unique: false });
        };
        
        req.onsuccess = (e) => { 
            db = e.target.result; 
            
            const tx = db.transaction('entries', 'readonly');
            if (!tx.objectStore('entries').indexNames.contains('stroke')) {
                indexedDB.deleteDatabase(DB_NAME);
                location.reload();
                return;
            }
            
            loadDictionaries(true); 
        };
        
        req.onerror = (e) => {
            console.error("Database failed to open", e);
        };
    }

    function loadDictionaries(hideAfter = false) {
        if (!db) return;
        try {
            const tx = db.transaction('dicts', 'readonly');
            const req = tx.objectStore('dicts').getAll();
            req.onsuccess = () => {
                const allDicts = req.result || [];
                dictionaries = allDicts.filter(d => d.profile === settings.activeProfile)
                                       .sort((a, b) => b.priority - a.priority);
                renderDictList();
                triggerSearch(); 
                renderPersistentProblemWords();
                
                if (hideAfter) {
                    hideLoader();
                }
            };
        } catch (e) {
            console.error("Failed to load dictionaries", e);
            if (hideAfter) hideLoader();
        }
    }

    function renderDictList() {
        const list = document.getElementById('dictList');
        if (!dictionaries.length) {
            list.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem;">No dictionaries added in Profile ${settings.activeProfile}.</div>`;
            return;
        }
        list.innerHTML = dictionaries.map((d, i) => `
            <div class="dict-card">
                <div>
                    <div class="dict-name">${d.name}</div>
                    <div class="dict-priority">Priority: ${dictionaries.length - i}</div>
                </div>
                <button onclick="removeDict('${d.id}', '${d.name.replace(/'/g, "\\'")}')">✕</button>
            </div>
        `).join('');
    }

    document.getElementById('fileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if(files.length === 0) return;
        
        e.target.disabled = true;
        
        for (let i=0; i < files.length; i++) {
            const file = files[i];
            showLoader(`Processing File ${i+1} of ${files.length}`, `Reading ${file.name}...`);
            await new Promise(r => setTimeout(r, 50)); 
            await importDictionary(file);
        }
        
        e.target.value = '';
        e.target.disabled = false;
        
        hideLoader();
    });

    function importDictionary(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const dictId = 'dict_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    const newPriority = dictionaries.length ? dictionaries[0].priority + 1 : 1;

                    const entries = [];
                    for (const [stroke, word] of Object.entries(data)) {
                        if (typeof word === 'string') {
                            entries.push({ dictId, stroke, word, word_lower: word.toLowerCase() });
                        }
                    }

                    if (entries.length === 0) {
                        openModal("Invalid Dictionary", `No valid string entries found in ${file.name}.`, null);
                        resolve();
                        return;
                    }

                    const tx = db.transaction('dicts', 'readwrite');
                    tx.objectStore('dicts').put({ 
                        id: dictId, 
                        name: file.name, 
                        priority: newPriority,
                        profile: settings.activeProfile 
                    });

                    tx.oncomplete = () => {
                        let i = 0;
                        const CHUNK_SIZE = 5000;
                        
                        function insertNextChunk() {
                            if (i >= entries.length) {
                                loadDictionaries(false); 
                                resolve();
                                return;
                            }

                            document.getElementById('loadingDesc').innerText = `Saving ${file.name}... ${Math.round((i/entries.length)*100)}%`;
                            
                            requestAnimationFrame(() => {
                                try {
                                    const chunkTx = db.transaction('entries', 'readwrite');
                                    const store = chunkTx.objectStore('entries');
                                    const end = Math.min(i + CHUNK_SIZE, entries.length);

                                    for (; i < end; i++) {
                                        store.put(entries[i]); 
                                    }

                                    chunkTx.oncomplete = () => {
                                        setTimeout(insertNextChunk, 10); 
                                    };
                                    chunkTx.onerror = (err) => {
                                        console.error('Chunk error:', err);
                                        openModal("Database Error", `Failed to save entries for ${file.name}.`, null);
                                        resolve();
                                    };
                                } catch(err) {
                                    console.error('Transaction initiation error:', err);
                                    openModal("Database Lockup", `Transaction blocked while saving ${file.name}.`, null);
                                    resolve();
                                }
                            });
                        }
                        insertNextChunk();
                    };

                    tx.onerror = (err) => {
                        console.error('Metadata transaction error:', err);
                        openModal("Database Error", `Error writing dict metadata for ${file.name}.`, null);
                        resolve();
                    };
                } catch (err) { 
                    console.error('Parse Error:', err);
                    openModal("Parse Error", `Error parsing JSON in ${file.name}. Ensure it's valid JSON format.`, null);
                    resolve(); 
                }
            };
            reader.readAsText(file);
        });
    }

    function removeDict(id, name) {
        showLoader("Removing Dictionary", `Preparing to delete ${name}...`);
        
        const tx = db.transaction('entries', 'readonly');
        const req = tx.objectStore('entries').index('dictId').getAllKeys(IDBKeyRange.only(id));
        
        req.onsuccess = () => {
            const keys = req.result;
            if(!keys.length) {
                finishRemoveDict(id);
                return;
            }
            
            let i = 0;
            const CHUNK_SIZE = 5000;
            
            function deleteNextChunk() {
                if (i >= keys.length) {
                    finishRemoveDict(id);
                    return;
                }
                
                document.getElementById('loadingDesc').innerText = `Deleting ${name}... ${Math.round((i/keys.length)*100)}%`;
                
                requestAnimationFrame(() => {
                    const chunkTx = db.transaction('entries', 'readwrite');
                    const store = chunkTx.objectStore('entries');
                    const end = Math.min(i + CHUNK_SIZE, keys.length);
                    
                    for(; i < end; i++) {
                        store.delete(keys[i]);
                    }
                    
                    chunkTx.oncomplete = () => setTimeout(deleteNextChunk, 10);
                    chunkTx.onerror = () => {
                        console.error('Delete chunk error');
                        hideLoader();
                    };
                });
            }
            deleteNextChunk();
        };
    }

    function finishRemoveDict(id) {
        const tx = db.transaction('dicts', 'readwrite');
        tx.objectStore('dicts').delete(id);
        tx.oncomplete = () => loadDictionaries(true);
    }

    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        if(settings.searchMode === 'stroke') {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
            
            const strokes = e.target.value.split('/');
            searchActiveKeys = parseStrokeToKeys(strokes[strokes.length - 1] || '');
            
            const p = settings.profiles[settings.activeProfile];
            if (p.showDiagrams) {
                renderInteractiveSearchBoard();
            }
        }
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(triggerSearch, 150);
    });

    function triggerSearch() {
        if(!db) return;
        
        const query = document.getElementById('searchInput').value.trim();
        const resultsEl = document.getElementById('results');

        if (!query) {
            resultsEl.innerHTML = '<div class="empty-state">Ready to search.</div>';
            return;
        }
        if (!dictionaries.length) {
            resultsEl.innerHTML = `<div class="empty-state">Add a dictionary to Profile ${settings.activeProfile} to search.</div>`;
            return;
        }

        try {
            const dictMap = new Map(dictionaries.map(d => [d.id, d.priority]));
            const tx = db.transaction('entries', 'readonly');
            
            const isStrokeMode = settings.searchMode === 'stroke';
            const indexName = isStrokeMode ? 'stroke' : 'word_lower';
            const searchQuery = isStrokeMode ? query.toUpperCase() : query.toLowerCase();
            
            const index = tx.objectStore('entries').index(indexName);
            const matches = [];

            const req = index.openCursor(IDBKeyRange.bound(searchQuery, searchQuery + '\uffff'));
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && matches.length < 150) { 
                    if(dictMap.has(cursor.value.dictId)) {
                        matches.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    renderResults(query, matches, dictMap);
                }
            };
        } catch(e) {
            console.error("Search failed", e);
        }
    }

    function renderResults(query, matches, dictMap) {
        const resultsEl = document.getElementById('results');
        if (!matches.length) {
            resultsEl.innerHTML = `<div class="empty-state">No matches found in Profile ${settings.activeProfile}.</div>`;
            return;
        }

        const grouped = new Map();
        matches.forEach(m => {
            if (!grouped.has(m.word)) grouped.set(m.word, []);
            grouped.get(m.word).push(m);
        });

        resultsEl.innerHTML = '';
        for (const [word, entries] of grouped) {
            entries.sort((a, b) => dictMap.get(b.dictId) - dictMap.get(a.dictId));
            
            const seenStrokes = new Set();
            const uniqueEntries = [];
            for(const e of entries) {
                if(!seenStrokes.has(e.stroke)) {
                    seenStrokes.add(e.stroke);
                    uniqueEntries.push(e);
                }
            }

            const card = document.createElement('div');
            card.className = 'result-card';
            
            let strokesHTML = '';
            for (const entry of uniqueEntries) {
                const subStrokes = entry.stroke.split('/');
                
                let graphHTML = '';
                const p = settings.profiles[settings.activeProfile];
                
                if (p.showDiagrams) {
                    graphHTML = `<div class="graph-container">` + subStrokes.map((s, idx) => {
                        const keys = parseStrokeToKeys(s);
                        let res = `<div class="stroke-graph-step">`;
                        res += generateBoardHTML(keys, 'display');
                        res += `</div>`;
                        if (idx < subStrokes.length - 1) res += `<span class="arrow">➔</span>`;
                        return res;
                    }).join('') + `</div>`;
                }

                strokesHTML += `
                    <div class="stroke-row">
                        <div class="raw-steno">${entry.stroke.replace(/</g, '&lt;')}</div>
                        ${graphHTML}
                    </div>
                `;
            }

            card.innerHTML = `<div class="word-title">${word.replace(/</g, '&lt;')}</div>${strokesHTML}`;
            resultsEl.appendChild(card);
        }
    }

    // --- Practice Mode Logic ---
    let practiceState = {
        words: [],
        normalizedWords: [],
        typedWords: [],
        strokeCounts: [],
        maxStrokesMap: {}, 
        currentIndex: 0,
        lastScrolledIndex: -1,
        lastScrolledLineTop: -1,
        lockedScrollTop: 0,
        scrollTriggerIndices: new Set(),
        scrollTriggerTops: {},
        extraTypedWords: [],
        mismatchIndex: -1,
        typedEndIndex: -1,
        incorrectWordIndices: new Set(),
        eraseErrorWords: new Set(),
        errorEvents: 0,
        wordScores: [],
        wordUnitCounts: [],
        correctPracticeIndices: new Set(),
        mistakePracticeIndices: new Set(),
        statsIndex: 0,
        statsCorrectChars: 0,
        statsCorrectWords: 0,
        statsTotalStrokes: 0,
        currentStreak: 0,
        longestStreak: 0,
        mode: 'random',
        hintType: 'shortest',
        visibility: 'always',
        missed: new Set(),
        inefficient: new Set(),
        // endless mode removed; keep simple session flags
        isEndless: false,
        customDict: null,
        
        sessionStartTime: 0,
        lastInputTime: 0,
        lastInputValue: '',
        lastStrokeTime: 0,
        lastStrokeKind: '',
        strokeTypingWindow: 100,
        lastCheckedInput: '',
        pendingSnapshotTimer: 0,
        pendingEraseTimer: 0,
        idleGaps: [],
        avgIdle: 0,
        statsHistory: [],
        graphSelectedIndex: -1,
        graphHoverIndex: -1,
        completedIndices: new Set(),
        lastCompletedIndex: -1,
        ignoreCaps: false,
        ignorePunct: false,
        lastLiveStatsPaint: 0,
        lastVisualIndex: -1,
        renderedStart: 0,
        renderedEnd: -1,
        logicalInput: '',
        pendingDeleteCount: 0,
        pendingDeleteTimer: 0,
        replacementBurstTimer: 0,
        replacementIndex: -1,
        reportedPracticeIndices: new Set()
    };

    let statsInterval;
    const PROGRESS_STORAGE_KEY = 'steno_practice_progress_v1';
    const MAX_PROBLEMATIC_WORDS = 200;
    const MAX_PROGRESS_SESSIONS = 500;

    function getPersistentProgress() {
        try {
            const stored = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY));
            if (stored && stored.profiles && typeof stored.profiles === 'object') {
                return normalizeProgress(stored.profiles[settings.activeProfile]);
            }
            const progress = normalizeProgress(stored);
            saveAllPersistentProgress({ profiles: { [settings.activeProfile]: progress } });
            return progress;
        } catch (e) {
            return normalizeProgress(null);
        }
    }

    function normalizeProgress(progress) {
        progress = progress && typeof progress === 'object' ? progress : {};
        progress.sessions = (Array.isArray(progress.sessions) ? progress.sessions : [])
            .filter(session => Number(session.words) >= 10).slice(-MAX_PROGRESS_SESSIONS);
        const problematicEntries = Object.entries(progress.problematic && typeof progress.problematic === 'object' ? progress.problematic : {})
            .slice(0, MAX_PROBLEMATIC_WORDS);
        progress.problematic = Object.fromEntries(problematicEntries);
        return progress;
    }

    function getAllPersistentProgress() {
        try {
            const stored = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY));
            if (stored && stored.profiles && typeof stored.profiles === 'object') {
                const profiles = {};
                for (let profileId = 1; profileId <= 5; profileId++) profiles[profileId] = normalizeProgress(stored.profiles[profileId]);
                return { profiles };
            }
            const profiles = {};
            for (let profileId = 1; profileId <= 5; profileId++) profiles[profileId] = normalizeProgress(profileId === Number(settings.activeProfile) ? stored : null);
            return { profiles };
        } catch (e) {
            const profiles = {};
            for (let profileId = 1; profileId <= 5; profileId++) profiles[profileId] = normalizeProgress(null);
            return { profiles };
        }
    }

    function saveAllPersistentProgress(progress, importedProgress = null, selectedProfiles = []) {
        const current = progress && progress.profiles ? progress : getAllPersistentProgress();
        if (importedProgress) {
            selectedProfiles.forEach(profileId => {
                if (importedProgress.profiles[profileId]) current.profiles[profileId] = normalizeProgress(importedProgress.profiles[profileId]);
            });
        }
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(current));
    }

    function savePersistentProgress(progress) {
        const allProgress = getAllPersistentProgress();
        allProgress.profiles[settings.activeProfile] = normalizeProgress(progress);
        saveAllPersistentProgress(allProgress);
    }

    function registerCorrectPracticeWord(word) {
        if (!word) return;
        const progress = getPersistentProgress();
        const entry = progress.problematic[word];
        if (!entry) return;
        entry.correct = (entry.correct || 0) + 1;
        if (entry.correct >= 5) delete progress.problematic[word];
        savePersistentProgress(progress);
    }

    function registerProblemPracticeWord(word) {
        if (!word) return;
        const progress = getPersistentProgress();
        if (!progress.problematic[word] && Object.keys(progress.problematic).length >= MAX_PROBLEMATIC_WORDS) return;
        const entry = progress.problematic[word] || { errors: 0, correct: 0 };
        entry.errors++;
        entry.correct = 0;
        progress.problematic[word] = entry;
        savePersistentProgress(progress);
    }

        function refreshPracticeAccuracy() {
            const totalWords = practiceState.wordUnitCounts && practiceState.wordUnitCounts.length
                ? practiceState.wordUnitCounts.reduce((total, count) => total + count, 0)
                : (practiceState.words ? practiceState.words.length : 0);
        if (totalWords === 0) {
            const liveAccuracy = document.getElementById('liveAcc');
            if (liveAccuracy) liveAccuracy.innerText = '100.00%';
            return 100;
        }

        const misses = Array.from(practiceState.mistakePracticeIndices).reduce((total, index) => {
            return total + (practiceState.wordUnitCounts[index] || 1);
        }, 0);
        const accuracy = Math.max(0, 100 - (misses / totalWords) * 100);
        
        const liveAccuracy = document.getElementById('liveAcc');
        if (liveAccuracy) liveAccuracy.innerText = accuracy.toFixed(2) + '%';
        
        return accuracy;
    }

    function recordCompletedPracticeWord(index, typedValue) {
        if (practiceState.reportedPracticeIndices.has(index)) return;
        practiceState.reportedPracticeIndices.add(index);

        const word = practiceState.words[index];
        const typed = typedValue || '';
        const normalizedTyped = normalizeForComparison(typed);
        const normalizedWord = practiceState.normalizedWords[index] || normalizeForComparison(word);
        // A miss is ONLY a wrong word — stroke count errors are handled separately in handleTyping.
        const missed = normalizedTyped !== normalizedWord;
        if (missed) {
            practiceState.eraseErrorWords.add(word);
            registerProblemPracticeWord(word);
            practiceState.currentStreak = 0;
        } else {
            registerCorrectPracticeWord(word);
            practiceState.currentStreak += practiceState.wordUnitCounts[index] || 1;
            practiceState.longestStreak = Math.max(practiceState.longestStreak, practiceState.currentStreak);
        }

        practiceState.wordScores[index] = !missed ? 1 : 0;
        if (!missed) practiceState.correctPracticeIndices.add(index);
        // Only flag a miss if the word was typed incorrectly (stroke excess is already caught live).
        if (missed && !practiceState.mistakePracticeIndices.has(index)) {
            practiceState.mistakePracticeIndices.add(index);
            playPracticeFeedback('miss');
        }
        if (practiceState.wordScores[index]) playPracticeFeedback('correct');
        refreshPracticeAccuracy();
    }

    async function renderPersistentProblemWords() {
        const list = document.getElementById('persistentProblemWords');
        if (!list) return;
        const problematic = getPersistentProgress().problematic;
        const words = Object.keys(problematic);
        if (!words.length) {
            list.innerHTML = '<div style="color:var(--text-muted);">None yet.</div>';
            return;
        }
        const profile = settings.profiles[settings.activeProfile];
        const hintType = document.getElementById('strokeHintType')?.value || 'shortest';
        const cards = [];
        for (const word of words) {
            const limits = practiceState.maxStrokesMap[word] || await getStrokeLimitsAndOutlines(word);
            const stroke = hintType === 'longest'
                ? (limits.longest || limits.shortest || '')
                : (limits.shortest || limits.longest || '');
            const strokes = stroke ? stroke.split('/') : [];
            let outline = '';
            if (stroke && profile.showDiagrams) {
                outline = `<div class="graph-container" style="margin-top:10px;">${strokes.map((part, index) => {
                    let html = `<div class="stroke-graph-step">${generateBoardHTML(parseStrokeToKeys(part), 'display')}</div>`;
                    if (index < strokes.length - 1) html += '<span class="arrow">➔</span>';
                    return html;
                }).join('')}</div>`;
            } else if (stroke) {
                outline = `<div class="raw-steno" style="margin-top:8px;">${escapeHtml(stroke)}</div>`;
            }
            cards.push(`<div class="dict-card"><div style="width:100%;"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;"><div class="dict-name">${escapeHtml(word)}</div><div class="dict-priority">Errors: ${problematic[word].errors || 0} | Correct: ${problematic[word].correct || 0}/5</div></div>${outline}</div></div>`);
        }
        list.innerHTML = cards.join('');
    }

    function switchTab(tab) {
        const isSearch = tab === 'search';
        document.getElementById('searchView').style.display = isSearch ? 'block' : 'none';
        document.getElementById('practiceView').style.display = isSearch ? 'none' : 'block';
        
        document.querySelectorAll('.view-tabs button')[0].classList.toggle('active', isSearch);
        document.querySelectorAll('.view-tabs button')[1].classList.toggle('active', !isSearch);
    }

    function getLessonText(lessonData) {
        if (typeof lessonData === 'string') return lessonData;
        if (lessonData && typeof lessonData.text === 'string') return lessonData.text;
        if (lessonData && typeof lessonData.content === 'string') return lessonData.content;
        throw new Error('Lesson JSON must contain text.');
    }

    function getLessonTitle(fileName) {
        return fileName.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    }

    async function readLessonResponse(response) {
        const source = await response.text();
        try {
            return getLessonText(JSON.parse(source));
        } catch (error) {
            return source;
        }
    }

    const practiceQuoteFiles = new Map();
    const practiceQuotePools = new Map();
    const lastPracticeQuoteIndexes = new Map();

    function getRandomPracticeQuote(quotes, source) {
        if (quotes.length < 2) return quotes[0] || '';
        const previousIndex = lastPracticeQuoteIndexes.get(source);
        let quoteIndex;
        do {
            quoteIndex = Math.floor(Math.random() * quotes.length);
        } while (quoteIndex === previousIndex);
        lastPracticeQuoteIndexes.set(source, quoteIndex);
        return quotes[quoteIndex];
    }

    async function loadPracticeQuotes(source) {
        if (practiceQuotePools.has(source)) return practiceQuotePools.get(source);
        try {
            const response = await fetch(source, { cache: 'no-cache' });
            if (!response.ok) throw new Error('Quote file unavailable.');
            const quotes = await response.json();
            const pool = Array.isArray(quotes) ? quotes.filter(quote => typeof quote === 'string' && quote.trim()) : [];
            practiceQuotePools.set(source, pool);
            return pool;
        } catch (error) {
            console.warn('Unable to load random quotes:', error);
            return [];
        }
    }

    async function chooseNewQuote() {
        const language = document.getElementById('quoteLanguage');
        const source = language.value;
        if (!source) return;
        const quotes = await loadPracticeQuotes(source);
        if (!quotes.length) {
            openModal('Random Quote Unavailable', 'The quote file could not be loaded.', () => {});
            return;
        }
        document.getElementById('practiceMaterial').value = getRandomPracticeQuote(quotes, source);
        document.getElementById('practiceMode').value = 'ordered';
        document.getElementById('newQuoteButton').classList.remove('hidden');
        savePracticeSettingsForProfile();
    }

    function syncQuoteLanguageUI() {
        const quoteLanguage = document.getElementById('quoteLanguage');
        const newQuoteButton = document.getElementById('newQuoteButton');
        if (!quoteLanguage || !newQuoteButton) return;
        const profileLanguage = settings.profiles[settings.activeProfile].quoteLanguage;
        const hasProfileLanguage = profileLanguage && Array.from(quoteLanguage.options).some(option => option.value === profileLanguage);
        quoteLanguage.value = hasProfileLanguage ? profileLanguage : '';
        newQuoteButton.classList.toggle('hidden', !quoteLanguage.value);
    }

    function getRandomDictionaryWords(count = 500) {
        return new Promise((resolve) => {
            if (!db || !dictionaries.length) {
                resolve([]);
                return;
            }
            const activeDictIds = new Set(dictionaries.map(dictionary => dictionary.id));
            const seenWords = new Set();
            const selectedWords = [];
            const request = db.transaction('entries', 'readonly').objectStore('entries').openCursor();
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    const entry = cursor.value;
                    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
                    const wordKey = word.toLowerCase();
                    const isOrdinaryWord = /^\p{L}+(?:['-]\p{L}+)*$/u.test(word);
                    if (activeDictIds.has(entry.dictId) && isOrdinaryWord && !seenWords.has(wordKey)) {
                        seenWords.add(wordKey);
                        if (selectedWords.length < count) {
                            selectedWords.push(word);
                        } else {
                            const replacementIndex = Math.floor(Math.random() * seenWords.size);
                            if (replacementIndex < count) {
                                selectedWords[replacementIndex] = word;
                            }
                        }
                    }
                    cursor.continue();
                    return;
                }
                resolve(shuffleArray(selectedWords));
            };
            request.onerror = () => resolve([]);
        });
    }

    async function loadLessons() {
        const select = document.getElementById('lessonSelect');
        const material = document.getElementById('practiceMaterial');
        if (!select || !material) return;
        const fallbackLessonFiles = [];

        material.addEventListener('input', () => {
            if (select.value !== 'custom') select.value = 'custom';
            document.getElementById('newQuoteButton').classList.add('hidden');
            settings.profiles[settings.activeProfile].practiceLesson = 'custom';
            settings.profiles[settings.activeProfile].practiceMaterial = material.value;
            localStorage.setItem('ploverSettings', JSON.stringify(settings));
        });

        const quoteLanguage = document.getElementById('quoteLanguage');
        quoteLanguage.addEventListener('change', () => {
            settings.profiles[settings.activeProfile].quoteLanguage = quoteLanguage.value;
            saveSettings();
            document.getElementById('newQuoteButton').classList.toggle('hidden', !quoteLanguage.value);
        });

        ['practiceMode', 'strokeHintType', 'strokeVisibility', 'practiceRepeats', 'practiceMaxWords', 'practiceProblemWords'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('input', savePracticeSettingsForProfile);
            input.addEventListener('change', savePracticeSettingsForProfile);
        });

        const problematicOption = document.createElement('option');
        problematicOption.value = 'problematic';
        problematicOption.textContent = 'Problematic Words';
        select.insertBefore(problematicOption, select.options[1] || null);

        let lessonFiles = [];
        try {
            const manifestResponse = await fetch('index.json', { cache: 'no-cache' });
            if (!manifestResponse.ok) throw new Error('Lesson manifest unavailable.');
            const manifest = await manifestResponse.json();
            lessonFiles = Array.isArray(manifest) ? manifest : manifest.lessons;
            if (!Array.isArray(lessonFiles)) throw new Error('Lesson manifest must be an array.');
        } catch (error) {
            console.warn('Unable to load lessons:', error);
            lessonFiles = fallbackLessonFiles;
        }

        lessonFiles.forEach(fileName => {
            if (typeof fileName !== 'string' || !/^[^<>:"|?*]+\.json$/i.test(fileName)) return;
            const quoteMatch = fileName.match(/^lessons\/Random Quotes\/Random Quote \((.+)\)\.json$/i);
            if (quoteMatch) {
                const languageName = quoteMatch[1];
                const option = document.createElement('option');
                option.value = fileName;
                option.textContent = languageName;
                quoteLanguage.appendChild(option);
                practiceQuoteFiles.set(fileName, languageName);
                return;
            }
            const option = document.createElement('option');
            option.value = fileName;
            option.textContent = getLessonTitle(fileName);
            select.appendChild(option);
        });
        syncQuoteLanguageUI();
        loadPracticeSettingsForProfile();

        select.addEventListener('change', async () => {
            document.getElementById('newQuoteButton').classList.add('hidden');
            settings.profiles[settings.activeProfile].practiceLesson = select.value;
            savePracticeSettingsForProfile();
            if (select.value === 'custom') return;
            if (select.value === 'random-dictionary') {
                select.disabled = true;
                const words = await getRandomDictionaryWords();
                if (!words.length) {
                    openModal('Random Words Unavailable', 'Add a dictionary to the current profile before choosing random words.', () => {});
                } else {
                    material.value = words.join(' ');
                    document.getElementById('practiceMode').value = 'random';
                    savePracticeSettingsForProfile();
                }
                select.disabled = false;
                return;
            }
            if (select.value === 'problematic') {
                const problematicWords = Object.keys(getPersistentProgress().problematic);
                material.value = problematicWords.join(' ');
                document.getElementById('practiceMode').value = 'ordered';
                savePracticeSettingsForProfile();
                select.disabled = false;
                return;
            }
            select.disabled = true;
            try {
                const response = await fetch(select.value, { cache: 'no-cache' });
                if (!response.ok) throw new Error('Lesson file unavailable.');
                material.value = await readLessonResponse(response);
                savePracticeSettingsForProfile();
            } catch (error) {
                alert('Unable to load that lesson.');
                select.value = 'custom';
            } finally {
                select.disabled = false;
            }
        });
    }

    window.addEventListener('load', loadLessons);

    function generatePracticeQueue(rawText, mode) {
        practiceState.customDict = null;
        const ignorePunct = settings.profiles[settings.activeProfile].ignorePunct;
        const cleanPracticeWord = word => ignorePunct
            ? String(word).replace(/[\.,!?;:"()\[\]{}<>-]/g, '')
            : String(word);
        
        const clippyEntries = parseClippyTape(rawText);
        if (clippyEntries.length) {
            practiceState.customDict = Object.fromEntries(clippyEntries.map(entry => [entry.word, entry.stroke]));
            return mode === 'random' ? shuffleArray(clippyEntries.map(entry => entry.word)) : clippyEntries.map(entry => entry.word);
        }

        // Check for Typey Type format (Word [tab or spaces] Stroke) line by line
        const lines = rawText.trim().split('\n');
        let isTypeyType = false; 
        let typeyDict = {};
        let baseWords = [];

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            // Split by tab or multiple spaces
            const parts = line.split(/\t+|\s{2,}/); 
            if (parts.length === 2) {
                const word = cleanPracticeWord(parts[0]);
                if (word) {
                    baseWords.push(word);
                    typeyDict[word] = parts[1];
                    isTypeyType = true;
                }
            }
        }

        if (isTypeyType && baseWords.length > 0) {
            practiceState.customDict = typeyDict;
        } else {
            // Standard parsing fallback
            const tokens = rawText.match(/[\w'-]+|[.,!?;:"()[\]{}<>]/g) || [];
            baseWords = tokens.map(cleanPracticeWord).filter(w => w.trim().length > 0);
        }
        
        if (baseWords.length === 0) return [];

        const uniqueWords = [...new Set(baseWords)];
        const shuffle = (array) => array.slice().sort(() => Math.random() - 0.5);

        let queue = [];
        switch (mode) {
            case 'ordered':
                queue = baseWords;
                break;
            case 'random':
                queue = shuffle(uniqueWords);
                break;
            case 'ordered-pyramid':
                for (let i = 0; i < baseWords.length; i++) {
                    for (let j = 0; j <= i; j++) queue.push(baseWords[j]);
                }
                break;
            case 'random-pyramid':
                const shuf = shuffle(uniqueWords);
                for (let i = 0; i < shuf.length; i++) {
                    for (let j = 0; j <= i; j++) queue.push(shuf[j]);
                }
                break;
            // 'endless' mode removed
        }
        return queue;
    }

    function parseClippyTape(rawText) {
        const hintType = document.getElementById('strokeHintType')?.value || 'shortest';
        const entries = [];
        for (const sourceLine of String(rawText || '').split(/\r?\n/)) {
            const line = sourceLine.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
            const separatorIndex = line.indexOf('||');
            if (separatorIndex < 0) continue;
            const word = line.slice(0, separatorIndex).trim();
            const outlineText = line.slice(separatorIndex + 2);
            const arrowIndex = outlineText.indexOf('->');
            if (!word || arrowIndex < 0) continue;
            const alternatives = outlineText.slice(arrowIndex + 2)
                .split(',')
                .map(outline => outline.trim())
                .filter(Boolean);
            if (!alternatives.length) continue;
            const score = outline => outline.split('/').filter(Boolean).length;
            const selected = alternatives.reduce((best, outline) => {
                if (!best) return outline;
                const comparison = score(outline) - score(best);
                return hintType === 'longest' ? (comparison > 0 ? outline : best) : (comparison < 0 ? outline : best);
            }, '');
            entries.push({ word, stroke: selected });
        }
        return entries;
    }

    // Helper: shuffle an array non-destructively
    function shuffleArray(arr) {
        return arr.slice().sort(() => Math.random() - 0.5);
    }

    async function getStrokeLimitsAndOutlines(word) {
        if (practiceState.customDict && practiceState.customDict[word]) {
            const stroke = practiceState.customDict[word];
            const count = stroke.split('/').length;
            return { min: count, max: count, shortest: stroke, longest: stroke };
        }
        
        return new Promise((resolve) => {
            if (!db) return resolve({ min: 1, max: 1, shortest: '', longest: '' });
            const tx = db.transaction('entries', 'readonly');
            const index = tx.objectStore('entries').index('word_lower');
            const req = index.getAll(IDBKeyRange.only(word.toLowerCase()));
            req.onsuccess = (e) => {
                const matches = e.target.result;
                if (!matches || matches.length === 0) return resolve({ min: 1, max: 1, shortest: '', longest: '' });
                let max = -1;
                let min = 999;
                let shortest = '';
                let longest = '';
                const activeDictIds = new Set(dictionaries.map(d => d.id));
                matches.forEach(m => {
                    if (activeDictIds.has(m.dictId)) {
                        const strokes = m.stroke.split('/').length;
                        if (strokes > max) { max = strokes; longest = m.stroke; }
                        if (strokes < min) { min = strokes; shortest = m.stroke; }
                    }
                });
                if (min === 999) min = 1;
                if (max === -1) max = 1;
                resolve({ min, max, shortest, longest });
            };
        });
    }

    async function startPractice() {
        const text = document.getElementById('practiceMaterial').value;
        const mode = document.getElementById('practiceMode').value;
        const vis = document.getElementById('strokeVisibility').value;
        const hintType = document.getElementById('strokeHintType').value;

        savePracticeSettingsForProfile();

        practiceState.isEndless = false;
        practiceState.words = generatePracticeQueue(text, mode);

        // Repeats: allow duplicating the entire text N times (default 0)
        const repeats = parseInt(document.getElementById('practiceRepeats') ? document.getElementById('practiceRepeats').value : '0', 10) || 0;
        if (repeats > 0) {
            const original = practiceState.words.slice();
            for (let r = 0; r < repeats; r++) practiceState.words = practiceState.words.concat(original);
        }

        // If ignore punctuation is enabled, remove punctuation tokens entirely from the practice queue
        if (settings.profiles[settings.activeProfile].ignorePunct) {
            practiceState.words = practiceState.words.filter(w => !(/^[\.,!?;:\"()\[\]{}<>]+$/).test(w));
        }
        // Max words cap: 0 means no cap
        const maxWords = parseInt(document.getElementById('practiceMaxWords') ? document.getElementById('practiceMaxWords').value : '0', 10) || 0;
        const problemWordCount = parseInt(document.getElementById('practiceProblemWords') ? document.getElementById('practiceProblemWords').value : '0', 10) || 0;
        if (maxWords > 0) {
            practiceState.words = practiceState.words.slice(0, maxWords);
        }

        // Inject problem words after capping the material so the requested count is added.
        const problematicWords = Object.keys(getPersistentProgress().problematic);
        if (problemWordCount > 0 && problematicWords.length) {
            const injectedWords = problematicWords.slice(0, problemWordCount);
            injectedWords.forEach(word => {
                const position = Math.floor(Math.random() * (practiceState.words.length + 1));
                practiceState.words.splice(position, 0, word);
            });
        }
        if (practiceState.words.length === 0) {
            alert("Please enter valid text/format to practice.");
            return;
        }

        showLoader("Preparing Session", "Analyzing dictionary for stroke limits...");
        practiceState.maxStrokesMap = {};
        for (let w of new Set(practiceState.words)) {
            practiceState.maxStrokesMap[w] = await getStrokeLimitsAndOutlines(w);
        }
        // Ensure typedWords and strokeCounts arrays align with words
        practiceState.typedWords = new Array(practiceState.words.length).fill('');
        practiceState.strokeCounts = new Array(practiceState.words.length).fill(0);
        practiceState.wordUnitCounts = practiceState.words.map(word => {
            const units = String(word).match(/[\w'-]+/g);
            return units && units.length ? units.length : 1;
        });
        hideLoader();
        practiceState.currentIndex = 0;
        practiceState.lastScrolledIndex = -1;
        practiceState.statsIndex = 0;
        practiceState.statsCorrectChars = 0;
        practiceState.statsCorrectWords = 0;
        practiceState.statsTotalStrokes = 0;
        practiceState.currentStreak = 0;
        practiceState.longestStreak = 0;
        practiceState.wordScores = [];
        practiceState.correctPracticeIndices = new Set();
        practiceState.mistakePracticeIndices = new Set();
        practiceState.mode = mode;
        practiceState.visibility = vis;
        practiceState.hintType = hintType;
        practiceState.ignoreCaps = settings.profiles[settings.activeProfile].ignoreCaps;
        practiceState.ignorePunct = settings.profiles[settings.activeProfile].ignorePunct;
        practiceState.normalizedWords = practiceState.words.map(word => normalizeForComparison(word));
        practiceState.missed.clear();
        practiceState.inefficient.clear();
        for (const word of new Set(practiceState.words)) {
            const limits = practiceState.maxStrokesMap[word] || { min: 1, max: 1 };
            const targetStrokes = hintType === 'longest'
                ? (limits.max || limits.min || 1)
                : (limits.min || limits.max || 1);
            if (targetStrokes >= 2) practiceState.inefficient.add(word);
        }
        practiceState.idleGaps = [];
        practiceState.avgIdle = 0;
        
        practiceState.sessionStartTime = performance.now();
        practiceState.lastInputTime = 0;
        practiceState.lastInputValue = '';
        practiceState.lastStrokeTime = 0;
        practiceState.lastStrokeKind = '';
        practiceState.lastCheckedInput = '';
        if (practiceState.pendingSnapshotTimer) clearTimeout(practiceState.pendingSnapshotTimer);
        practiceState.pendingSnapshotTimer = 0;
        if (practiceState.pendingEraseTimer) clearTimeout(practiceState.pendingEraseTimer);
        practiceState.pendingEraseTimer = 0;
        practiceState.statsHistory = [];
        practiceState.graphSelectedIndex = -1;
        practiceState.graphHoverIndex = -1;
        practiceState.completedIndices = new Set();
        practiceState.lastCompletedIndex = -1;
        practiceState.lastLiveStatsPaint = 0;
        practiceState.lastVisualIndex = -1;
        practiceState.renderedStart = 0;
        practiceState.renderedEnd = -1;
        practiceState.logicalInput = '';
        practiceState.pendingDeleteCount = 0;
        if (practiceState.pendingDeleteTimer) clearTimeout(practiceState.pendingDeleteTimer);
        practiceState.pendingDeleteTimer = 0;
        if (practiceState.replacementBurstTimer) clearTimeout(practiceState.replacementBurstTimer);
        practiceState.replacementBurstTimer = 0;
        practiceState.replacementIndex = -1;
        practiceState.reportedPracticeIndices = new Set();
        const graphLabel = document.getElementById('graphPointLabel');
        if (graphLabel) graphLabel.style.display = 'none';
        
        clearInterval(statsInterval);
        statsInterval = setInterval(recordHistoryStat, 1000);
        
        document.getElementById('liveWpm').innerText = "0";
        document.getElementById('liveAcc').innerText = "100.00%";
        document.getElementById('liveIdle').innerText = "0.000s";
        document.getElementById('liveAvgStr').innerText = "0";
        
        document.getElementById('practiceSetup').style.display = 'none';
        document.getElementById('practiceResults').style.display = 'none';
        document.getElementById('practiceArena').style.display = 'flex';

        if (practiceScrollFrame) cancelAnimationFrame(practiceScrollFrame);
        practiceScrollFrame = 0;
        practiceState.lastScrolledLineTop = -1;
        practiceState.lockedScrollTop = 0;
        practiceState.extraTypedWords = [];
        practiceState.mismatchIndex = -1;
        practiceState.typedEndIndex = -1;
        practiceState.incorrectWordIndices = new Set();
        practiceState.eraseErrorWords = new Set();
        practiceState.errorEvents = 0;
        document.getElementById('monkeyContainer').scrollTop = 0;
        
        renderMonkeyText();
        
        const input = document.getElementById('practiceInput');
        input.value = "";
        input.focus();

        document.getElementById('monkeyContainer').onclick = () => input.focus();
    }

    function renderMonkeyText() {
        const container = document.getElementById('monkeyText');
        container.innerHTML = "";
        const ignoreCaps = practiceState.ignoreCaps;
        const ignorePunct = practiceState.ignorePunct;
        const activeIndex = practiceState.currentIndex;
        const windowSize = 15;
        const startIndex = activeIndex;
        const endIndex = Math.min(practiceState.words.length - 1, activeIndex + windowSize - 1);
        practiceState.renderedStart = startIndex;
        practiceState.renderedEnd = endIndex;
        document.getElementById('monkeyContainer').scrollTop = 0;
        practiceState.lockedScrollTop = 0;

        for (let index = startIndex; index <= endIndex; index++) {
            const word = practiceState.words[index];
            const isPunct = (/^[\.,!?;:\"()\[\]{}<>]+$/).test(word);
            // If punctuation should be ignored visually, skip rendering its characters entirely
            if (isPunct && ignorePunct) {
                // still create a placeholder container so id lookups remain consistent
                const wordDiv = document.createElement('div');
                wordDiv.className = 'monkey-word punct hidden-punct';
                wordDiv.id = `word-${index}`;
                container.appendChild(wordDiv);
                continue;
            }

            const wordDiv = document.createElement('div');
            wordDiv.className = 'monkey-word' + (isPunct ? ' punct' : '');
            wordDiv.id = `word-${index}`;

            if (index >= startIndex && index <= endIndex) {
                for(let i=0; i<word.length; i++) {
                    const span = document.createElement('span');
                    span.className = 'letter';
                    span.innerText = ignoreCaps ? word[i].toLowerCase() : word[i];
                    wordDiv.appendChild(span);
                }
            } else {
                wordDiv.textContent = ignoreCaps ? word.toLowerCase() : word;
            }
            container.appendChild(wordDiv);
        }

        practiceState.scrollTriggerIndices = new Set();
        practiceState.scrollTriggerTops = {};
        let previousLineTop = null;
        const lineHeight = parseFloat(getComputedStyle(container).lineHeight) || 43;
        container.querySelectorAll('.monkey-word').forEach((wordDiv) => {
            if (wordDiv.classList.contains('hidden-punct')) return;
            const lineTop = wordDiv.offsetTop;
            if (previousLineTop === null || Math.abs(lineTop - previousLineTop) >= lineHeight * 0.5) {
                const index = Number(wordDiv.id.slice(5));
                practiceState.scrollTriggerIndices.add(index);
                practiceState.scrollTriggerTops[index] = lineTop;
                previousLineTop = lineTop;
            }
        });
        
        // If punctuation is being ignored, skip any punctuation tokens so they don't act as "phantom" words
        try { skipHiddenPunctuationTokens(); } catch(e) {}
        updateMonkeyVisuals();
    }

    let practiceScrollFrame = 0;

    function animatePracticeScroll(container, targetTop) {
        if (practiceScrollFrame) cancelAnimationFrame(practiceScrollFrame);

        const startTop = container.scrollTop;
        const distance = targetTop - startTop;
        if (Math.abs(distance) < 1) return;

        const startTime = performance.now();
        const duration = Math.min(220, Math.max(120, Math.abs(distance) * 1.5));

        function step(now) {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            container.scrollTop = startTop + distance * eased;
            if (progress < 1) practiceScrollFrame = requestAnimationFrame(step);
            else practiceScrollFrame = 0;
        }

        practiceScrollFrame = requestAnimationFrame(step);
    }

    function scrollToActiveWord() {
        const container = document.getElementById('monkeyContainer');
        if (!container) return;

        // Non-trigger words must never be able to move the viewport.
        if (!practiceState.scrollTriggerIndices.has(practiceState.currentIndex)) {
            container.scrollTop = practiceState.lockedScrollTop;
            return;
        }

        // Never move the viewport backward when the user erases input.
        if (practiceState.currentIndex <= practiceState.lastScrolledIndex) {
            container.scrollTop = practiceState.lockedScrollTop;
            return;
        }

        const activeWord = document.getElementById(`word-${practiceState.currentIndex}`);
        if (!activeWord) return;

        const lineHeight = parseFloat(getComputedStyle(activeWord).lineHeight) || 43;

        practiceState.lastScrolledIndex = practiceState.currentIndex;
        const lineTop = practiceState.scrollTriggerTops[practiceState.currentIndex];
        practiceState.lastScrolledLineTop = lineTop;

        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const targetTop = Math.min(maxScrollTop, Math.max(container.scrollTop, lineTop - lineHeight));
        practiceState.lockedScrollTop = targetTop;
        container.scrollTop = targetTop;

        // Keep the active line around the second visible line.
    }

    function renderTypedExtras() {
        const container = document.getElementById('monkeyText');
        let wordDiv = document.getElementById('typed-extra');
        const hiddenTarget = container.querySelector('.practice-hidden');
        if (hiddenTarget) hiddenTarget.classList.remove('practice-hidden');

        if (practiceState.mismatchIndex < 0 || practiceState.extraTypedWords.length === 0) {
            if (wordDiv) wordDiv.remove();
            return;
        }

        const targetWord = document.getElementById(`word-${practiceState.mismatchIndex}`);
        if (!targetWord) return;
        targetWord.classList.add('practice-hidden');

        const typedText = practiceState.extraTypedWords.join(' ');
        const targetText = String(practiceState.words[practiceState.mismatchIndex]);
        const displayCharacters = typedText + targetText.slice(typedText.length);
        if (!wordDiv) {
            wordDiv = document.createElement('div');
            wordDiv.className = 'monkey-word typed-extra';
            wordDiv.id = 'typed-extra';
            container.insertBefore(wordDiv, targetWord);
        } else if (wordDiv.nextElementSibling !== targetWord) {
            container.insertBefore(wordDiv, targetWord);
        }

        const letters = wordDiv.children;
        for (let i = 0; i < displayCharacters.length; i++) {
            const character = displayCharacters[i];
            const letter = letters[i] || wordDiv.appendChild(document.createElement('span'));
            letter.className = 'letter' + (i < typedText.length ? ' incorrect' : '');
            if (letter.textContent !== character) letter.textContent = character;
        }
        while (wordDiv.children.length > displayCharacters.length) wordDiv.lastElementChild.remove();
    }

    function updateMonkeyVisuals() {
        const needsWindow = practiceState.currentIndex !== practiceState.renderedStart;
        if (needsWindow) renderMonkeyText();

        // Remove any stray cursors first to avoid multiple blinking cursors
        const oldCursor = document.querySelector('#monkeyText .monkey-cursor');
        if (oldCursor) oldCursor.remove();
        renderTypedExtras();

        const startIdx = Math.max(0, practiceState.currentIndex - 1);
        const endIdx = Math.min(practiceState.words.length - 1, Math.max(practiceState.currentIndex, practiceState.typedEndIndex));

        for (let i = startIdx; i <= endIdx; i++) {
            const targetWord = practiceState.words[i];
            const wordDiv = document.getElementById(`word-${i}`);
            if (!wordDiv) continue;
            if (wordDiv.classList.contains('practice-hidden')) continue;

            let typed = practiceState.typedWords[i] || "";
            
            if (i < practiceState.currentIndex) {
                wordDiv.classList.remove('active');
                const normalizedTyped = normalizeForComparison(typed);
                const normalizedTarget = normalizeForComparison(targetWord);
                Array.from(wordDiv.children).forEach((span, idx) => {
                    if (span.classList.contains('monkey-cursor')) return;
                    const targetChar = targetWord[idx] || '';
                    const typedChar = typed[idx] || '';
                    const equal = ignoreCaps
                        ? typedChar.toLowerCase() === targetChar.toLowerCase()
                        : typedChar === targetChar;
                    span.className = 'letter' + (normalizedTyped === normalizedTarget || (typedChar && equal) ? ' correct' : '');
                    span.innerText = ignoreCaps ? targetChar.toLowerCase() : targetChar;
                });
            } else if (i === practiceState.currentIndex) {
                wordDiv.classList.add('active');
            } else {
                wordDiv.classList.remove('active', 'error');
                const ignoreCapsAhead = practiceState.ignoreCaps;
                if (typed) {
                    // Render later input literally so wrong text keeps its width.
                    wordDiv.innerHTML = '';
                    for (let j = 0; j < typed.length; j++) {
                        const span = document.createElement('span');
                        span.className = 'letter ' + (normalizeForComparison(typed) === normalizeForComparison(targetWord) ? 'correct' : 'incorrect');
                        span.innerText = ignoreCapsAhead ? typed[j].toLowerCase() : typed[j];
                        wordDiv.appendChild(span);
                    }
                    continue;
                } else {
                Array.from(wordDiv.children).forEach((span, idx) => { 
                    if(span.classList.contains('monkey-cursor')) return;
                    span.className = 'letter'; 
                    if (targetWord[idx]) span.innerText = (ignoreCapsAhead ? targetWord[idx].toLowerCase() : targetWord[idx]);
                });
                Array.from(wordDiv.children).forEach(el => {
                    if(!el.classList.contains('monkey-cursor') && Array.prototype.indexOf.call(wordDiv.children, el) >= targetWord.length) {
                        el.remove();
                    }
                });
                continue; 
                }
            }

            const existingCursor = wordDiv.querySelector('.monkey-cursor');
            if (existingCursor) existingCursor.remove();

            const letters = Array.from(wordDiv.children).filter(el => !el.classList.contains('monkey-cursor'));

            const ignoreCaps = practiceState.ignoreCaps;
            const ignorePunct = practiceState.ignorePunct;
            const isPunct = (/^[\.,!?;:\"()\[\]{}<>]+$/).test(targetWord);

            for (let j = 0; j < targetWord.length; j++) {
                const span = letters[j];
                if (!span) continue;

                if (j < typed.length) {
                    const typedChar = typed[j] || '';
                    const targetChar = targetWord[j] || '';
                    let equal = typedChar === targetChar;
                    if (ignoreCaps) equal = (typedChar.toLowerCase() === targetChar.toLowerCase());
                    if (isPunct && ignorePunct) {
                        // If punctuation is being ignored, don't mark it incorrect and hide it visually
                        span.className = 'letter';
                        span.innerText = '';
                        continue;
                    }
                    if (equal) {
                        span.className = 'letter correct';
                        span.innerText = ignoreCaps ? targetChar.toLowerCase() : targetChar;
                    } else {
                        span.className = 'letter incorrect';
                        span.innerText = ignoreCaps ? typedChar.toLowerCase() : typedChar;
                    }
                } else {
                    span.className = 'letter';
                    span.innerText = ignoreCaps ? targetWord[j].toLowerCase() : targetWord[j];
                }
            }

            while(letters.length > targetWord.length) {
                wordDiv.removeChild(letters.pop());
            }

            if (typed.length > targetWord.length) {
                for (let j = targetWord.length; j < typed.length; j++) {
                    const extraSpan = document.createElement('span');
                    extraSpan.className = 'letter extra';
                    extraSpan.innerText = (ignoreCaps ? (typed[j] || '').toLowerCase() : (typed[j] || ''));
                    wordDiv.appendChild(extraSpan);
                }
            }
            
            if (i < practiceState.currentIndex) {
                const limits = practiceState.maxStrokesMap[targetWord] || {min: 1, max: 1};
                const targetLimit = limits.min;
                const actualStrokes = practiceState.strokeCounts[i] || 1;
                
                if (typed !== targetWord || actualStrokes > targetLimit) {
                    wordDiv.classList.add('error');
                } else {
                    wordDiv.classList.remove('error');
                }
            }
        }

        const cursorHost = practiceState.extraTypedWords.length > 0
            ? document.querySelector('.typed-extra')
            : document.getElementById(`word-${practiceState.currentIndex}`);
        if (cursorHost) {
            const cursor = document.createElement('span');
            cursor.className = 'monkey-cursor';
            const cursorIndex = practiceState.extraTypedWords.length > 0
                ? practiceState.extraTypedWords.join(' ').length
                : Math.min((practiceState.typedWords[practiceState.currentIndex] || '').length, cursorHost.children.length);
            const letters = Array.from(cursorHost.children).filter(el => !el.classList.contains('monkey-cursor'));
            cursorHost.insertBefore(cursor, letters[cursorIndex] || null);
        }
        
        updateHint();
        practiceState.lastVisualIndex = practiceState.currentIndex;
    }

        function updateHint() {
        const hintEl = document.getElementById('strokeHint');
        const targetWord = practiceState.words[practiceState.currentIndex];
        
        if (!targetWord) { hintEl.innerHTML = ""; return; }

        const limits = practiceState.maxStrokesMap[targetWord] || {min: 1, max: 1, shortest: '', longest: ''};
        const targetLimit = practiceState.hintType === 'longest' ? (limits.max || limits.min || 1) : (limits.min || 1);
        const targetStroke = practiceState.hintType === 'longest' ? (limits.longest || limits.shortest || '') : (limits.shortest || limits.longest || '');
        
        const currentStrokes = practiceState.strokeCounts[practiceState.currentIndex] || 0;
        const p = settings.profiles[settings.activeProfile];

        refreshPracticeAccuracy();

        // Decide whether to reveal stroke diagrams / outlines
        const shouldShowStrokes = (practiceState.visibility === 'always') || (practiceState.visibility === 'error' && currentStrokes > targetLimit);
        const renderKey = JSON.stringify([targetWord, targetLimit, targetStroke, practiceState.visibility, shouldShowStrokes, p.showDiagrams]);

        if (hintEl.dataset.renderKey !== renderKey) {
            let displayHTML = '';
            if (shouldShowStrokes && targetStroke) {
                const subStrokes = targetStroke.split('/');
                if (p.showDiagrams) {
                    displayHTML = `<div class="graph-container" style="justify-content:center; margin-top:10px;">` + subStrokes.map((s, idx) => {
                        const keys = parseStrokeToKeys(s);
                        let res = `<div class="stroke-graph-step">` + generateBoardHTML(keys, 'display') + `</div>`;
                        if (idx < subStrokes.length - 1) res += `<span class="arrow">➔</span>`;
                        return res;
                    }).join('') + `</div>`;
                } else {
                    displayHTML = `<div class="raw-steno" style="display:inline-block; margin-top:10px;">${escapeHtml(targetStroke)}</div>`;
                }
                displayHTML += `<div class="stroke-hint" style="margin-top:8px;">Normally: ${subStrokes.length} stroke${subStrokes.length>1?'s':''}</div>`;
            }
            hintEl.innerHTML = `<div class="practice-summary"></div>${displayHTML}`;
            hintEl.dataset.renderKey = renderKey;
        }

        const summaryEl = hintEl.querySelector('.practice-summary');
        if (summaryEl) summaryEl.textContent = `Target: ${targetLimit} stroke${targetLimit > 1 ? 's' : ''} | Used: ${currentStrokes}`;
        hintEl.style.color = (currentStrokes > targetLimit) ? '#ff5555' : 'var(--text-muted)';
    }

    function schedulePracticeSnapshotCheck() {
        if (practiceState.pendingSnapshotTimer) return;
        practiceState.pendingSnapshotTimer = setTimeout(() => {
            practiceState.pendingSnapshotTimer = 0;
            const liveInput = document.getElementById('practiceInput');
            const snapshot = liveInput.value;
            if (!snapshot.trim()) return;
            handleTyping({ inputType: 'insertText', data: null }, true);
            if (liveInput.value.trim()) schedulePracticeSnapshotCheck();
        }, 80);
    }

    function handleTyping(event, forceSnapshot = false) {
        const now = performance.now();

        let inputVal = document.getElementById('practiceInput').value;
        let previousInput = practiceState.lastInputValue;
        const inputType = event.inputType || '';
        const isInsertion = !inputType || inputType.startsWith('insert');
        const isDeletion = inputType.startsWith('delete');
        const input = document.getElementById('practiceInput');
        const insertedSpace = isInsertion && /\s$/.test(inputVal);
        const deletedSpace = isDeletion && /\s$/.test(previousInput);
        const strokeKind = isDeletion ? 'delete' : 'insert';
        const isStrokeChange = inputVal !== previousInput && (isInsertion || isDeletion) && !insertedSpace && !deletedSpace;

        if (isInsertion && inputVal.trim() && !forceSnapshot) {
            practiceState.logicalInput = inputVal;
            practiceState.lastInputValue = inputVal;
            schedulePracticeSnapshotCheck();
            schedulePracticeVisualUpdate();
            return;
        }

        if (inputVal !== previousInput) {
            if (practiceState.lastInputTime > 0) {
                const gap = Math.max(0, now - practiceState.lastInputTime);
                practiceState.idleGaps.push(gap);
                if (practiceState.idleGaps.length > 50) practiceState.idleGaps.shift();
                practiceState.avgIdle = practiceState.idleGaps.reduce((total, value) => total + value, 0) / practiceState.idleGaps.length / 1000;
            }
            practiceState.lastInputTime = now;
        }

        if (isDeletion) {
            practiceState.pendingDeleteCount++;
            practiceState.lastInputValue = inputVal;
            if (practiceState.pendingDeleteTimer) clearTimeout(practiceState.pendingDeleteTimer);
            practiceState.pendingDeleteTimer = setTimeout(() => {
                const liveInput = document.getElementById('practiceInput');
                const deletedValue = liveInput.value;
                practiceState.logicalInput = deletedValue;
                if (practiceState.currentIndex < practiceState.words.length) {
                    // Backspace only updates the visual; it does NOT register as a miss.
                    practiceState.typedWords[practiceState.currentIndex] = practiceState.logicalInput;
                    practiceState.mismatchIndex = -1;
                    practiceState.extraTypedWords = [];
                }
                practiceState.lastInputValue = practiceState.logicalInput;
                schedulePracticeVisualUpdate();
                practiceState.pendingDeleteCount = 0;
                practiceState.pendingDeleteTimer = 0;
            }, 80);
            return;
        }

        if (practiceState.pendingDeleteCount > 0) {
            if (practiceState.pendingDeleteTimer) clearTimeout(practiceState.pendingDeleteTimer);
            practiceState.pendingDeleteCount = 0;
            practiceState.pendingDeleteTimer = 0;
        }
        practiceState.logicalInput = inputVal;

        if (isInsertion && inputVal.trim() === '' && inputVal.length > 0) {
            input.value = '';
            practiceState.lastInputValue = '';
            return;
        }

        if (isInsertion && practiceState.pendingEraseTimer) {
            clearTimeout(practiceState.pendingEraseTimer);
            practiceState.pendingEraseTimer = 0;
        }

        if (forceSnapshot && inputVal !== practiceState.lastCheckedInput) {
            const strokeTarget = practiceState.words[practiceState.currentIndex];
            const strokeLimits = practiceState.maxStrokesMap[strokeTarget] || {min: 1, max: 1};
            practiceState.strokeCounts[practiceState.currentIndex] =
                (practiceState.strokeCounts[practiceState.currentIndex] || 0) + 1;
            practiceState.lastCheckedInput = inputVal;
            {
                // Use the MAX stroke count so multi-stroke words only error when you exceed their maximum.
                const strokeTargetLimit = practiceState.hintType === 'longest'
                    ? (strokeLimits.max || strokeLimits.min || 1)
                    : (strokeLimits.max || strokeLimits.min || 1);
                if ((practiceState.strokeCounts[practiceState.currentIndex] || 0) > strokeTargetLimit) {
                    if (!practiceState.mistakePracticeIndices.has(practiceState.currentIndex)) {
                        practiceState.mistakePracticeIndices.add(practiceState.currentIndex);
                        practiceState.currentStreak = 0;
                        playPracticeFeedback('miss');
                        refreshPracticeAccuracy();
                    }
                }
            }
        }

        practiceState.lastInputValue = inputVal;

        // Split into non-empty segments so spaces inside Typey Type phrases
        // can be consumed as part of one practice target.
        const typedArray = inputVal.match(/\S+/g) || [];
        const isMultiWordInsertion = isInsertion && typedArray.length > 1;
        // Map typed segments to token-wise typedWords (support glued punctuation like "another.")
        const words = practiceState.words || [];

        // Most input events only change the current single-word token. Avoid
        // rescanning the complete lesson until a boundary or special case occurs.
        const currentTarget = words[practiceState.currentIndex];
        const currentSegmentMatch = inputVal.match(/\S*$/);
        const currentSegment = currentSegmentMatch ? currentSegmentMatch[0] : '';

        // A space after a mistyped ordinary word must stay on the current word.
        // Sending it through the legacy parser would rescan from index zero.
        if (insertedSpace && typedArray.length <= 1 && currentTarget && !/\s/.test(currentTarget) && inputVal.trim()) {
            const completedSegment = inputVal.trim();
            const normalizedTarget = practiceState.normalizedWords[practiceState.currentIndex] || normalizeForComparison(currentTarget);
            if (normalizeForComparison(completedSegment) === normalizedTarget) {
                practiceState.typedWords[practiceState.currentIndex] = completedSegment;
                practiceState.logicalInput = completedSegment;
                if (!practiceState.completedIndices.has(practiceState.currentIndex)) {
                    practiceState.completedIndices.add(practiceState.currentIndex);
                    registerCorrectPracticeWord(currentTarget);
                }
                recordCompletedPracticeWord(practiceState.currentIndex, completedSegment);
                practiceState.lastCompletedIndex = practiceState.currentIndex;
                practiceState.mismatchIndex = -1;
                practiceState.currentIndex++;
                if (practiceState.ignorePunct) {
                    while (practiceState.currentIndex < words.length && (/^[\.,!?;:"()\[\]{}<>]+$/).test(words[practiceState.currentIndex])) {
                        practiceState.currentIndex++;
                    }
                }
                input.value = '';
                practiceState.lastInputValue = '';
                practiceState.lastStrokeKind = '';
                practiceState.lastStrokeTime = 0;
                practiceState.lastCheckedInput = '';
                practiceState.extraTypedWords = [];
            } else {
                practiceState.logicalInput = completedSegment;
                practiceState.lastInputValue = inputVal;
                practiceState.typedWords[practiceState.currentIndex] = completedSegment;
                practiceState.mismatchIndex = -1;
                practiceState.extraTypedWords = [];
                practiceState.incorrectWordIndices.add(practiceState.currentIndex);
                practiceState.eraseErrorWords.add(currentTarget);
                registerProblemPracticeWord(currentTarget);
            }
            schedulePracticeVisualUpdate();
            if (practiceState.currentIndex >= words.length) endPractice();
            return;
        }

        if (!insertedSpace && !deletedSpace && typedArray.length <= 1 && currentTarget && !/\s/.test(currentTarget) && !forceSnapshot) {
            const normalizedTarget = practiceState.normalizedWords[practiceState.currentIndex] || normalizeForComparison(currentTarget);
            const normalizedSegment = normalizeForComparison(currentSegment);
            practiceState.typedWords[practiceState.currentIndex] = currentSegment;
            practiceState.typedEndIndex = practiceState.currentIndex;
            practiceState.mismatchIndex = normalizedTarget.startsWith(normalizedSegment)
                ? -1
                : practiceState.currentIndex;
            practiceState.extraTypedWords = [];
            if (!normalizedTarget.startsWith(normalizedSegment)) {
                practiceState.incorrectWordIndices.add(practiceState.currentIndex);
            }
            schedulePracticeVisualUpdate();
            return;
        }

        const typedPerToken = practiceState.typedWords.slice();
        let wIdx = practiceState.currentIndex;
        let tIdx = 0;
        const mappingStartIndex = wIdx;
        let firstMismatch = -1;
        let completedItem = false;
        while (tIdx < typedArray.length && wIdx < words.length) {
            const target = String(words[wIdx]);
            const targetParts = target.split(/\s+/).filter(Boolean);
            const typedParts = typedArray.slice(tIdx, tIdx + targetParts.length);
            const hasAllParts = typedParts.length === targetParts.length && typedParts.every(Boolean);

            // Typey Type phrases are one target, even though they contain spaces.
            const normalizedTarget = practiceState.normalizedWords[wIdx] || normalizeForComparison(target);
            if (targetParts.length > 1) {
                const phraseTyped = typedParts.join(' ');
                if (hasAllParts && normalizeForComparison(phraseTyped) === normalizedTarget) {
                    typedPerToken[wIdx] = phraseTyped;
                    if (isMultiWordInsertion && tIdx > 0) practiceState.strokeCounts[wIdx] = 0;
                    if (!practiceState.completedIndices.has(wIdx)) {
                        practiceState.completedIndices.add(wIdx);
                        registerCorrectPracticeWord(target);
                    }
                    recordCompletedPracticeWord(wIdx, phraseTyped);
                    practiceState.lastCompletedIndex = wIdx;
                    completedItem = true;
                    tIdx += targetParts.length;
                    wIdx++;
                    break;
                }

                if (phraseTyped && normalizedTarget.startsWith(normalizeForComparison(phraseTyped))) {
                    typedPerToken[wIdx] = phraseTyped;
                    break;
                }

                if (firstMismatch < 0) firstMismatch = wIdx;
                practiceState.incorrectWordIndices.add(wIdx);
                break;
            }

            const seg = typedArray[tIdx];
            if (normalizeForComparison(seg) === normalizedTarget) {
                typedPerToken[wIdx] = seg;
                if (!practiceState.completedIndices.has(wIdx)) {
                    practiceState.completedIndices.add(wIdx);
                    registerCorrectPracticeWord(target);
                }
                recordCompletedPracticeWord(wIdx, seg);
                if (isMultiWordInsertion && tIdx > 0) practiceState.strokeCounts[wIdx] = 0;
                practiceState.lastCompletedIndex = wIdx;
                tIdx++;
                wIdx++;
                continue;
            }

            // Check for glued punctuation: base + punct (e.g., "another.")
            const m = String(seg).match(/^(.*?)([\.,!?;:\"()\[\]{}<>]+)$/);
            if (m && wIdx + 1 < words.length) {
                const base = m[1];
                const punct = m[2];
                if (normalizeForComparison(base) === normalizedTarget && words[wIdx+1] === punct) {
                    typedPerToken[wIdx] = base;
                    typedPerToken[wIdx+1] = punct;
                    if (!practiceState.completedIndices.has(wIdx)) {
                        practiceState.completedIndices.add(wIdx);
                        registerCorrectPracticeWord(target);
                    }
                    if (!practiceState.completedIndices.has(wIdx + 1)) {
                        practiceState.completedIndices.add(wIdx + 1);
                        registerCorrectPracticeWord(punct);
                    }
                    recordCompletedPracticeWord(wIdx, base);
                    recordCompletedPracticeWord(wIdx + 1, punct);
                    if (isMultiWordInsertion) {
                        if (tIdx > 0) practiceState.strokeCounts[wIdx] = 0;
                        practiceState.strokeCounts[wIdx + 1] = 0;
                    }
                    practiceState.lastCompletedIndex = wIdx + 1;
                    tIdx++;
                    wIdx += 2;
                    continue;
                }
            }

            // Keep mapping later input so mistakes remain visible, but leave the
            // active target at the first mismatching word.
            typedPerToken[wIdx] = seg;
            firstMismatch = wIdx;
            if (!normalizedTarget.startsWith(normalizeForComparison(seg))) {
                practiceState.incorrectWordIndices.add(wIdx);
            }
            break;
        }

        practiceState.mismatchIndex = firstMismatch;
        practiceState.extraTypedWords = firstMismatch >= 0 ? typedArray.slice(tIdx) : [];
        practiceState.typedEndIndex = Math.max(-1, wIdx - 1);

        // If ignore punctuation is enabled, auto-skip remaining punctuation tokens when counting completed words
        if (firstMismatch < 0 && practiceState.ignorePunct) {
            while (wIdx < words.length && (/^[\.,!?;:\"()\[\]{}<>]+$/).test(words[wIdx])) wIdx++;
        }

        practiceState.typedWords = typedPerToken;
        if (firstMismatch >= 0) {
            const missedWord = words[firstMismatch];
            if (missedWord && !practiceState.eraseErrorWords.has(missedWord)) {
                practiceState.eraseErrorWords.add(missedWord);
                registerProblemPracticeWord(missedWord);
            }
        }
        practiceState.currentIndex = Math.max(0, firstMismatch >= 0 ? firstMismatch : wIdx);

        if (firstMismatch < 0 && (completedItem || wIdx > mappingStartIndex)) {
            input.value = '';
            practiceState.lastInputValue = '';
            practiceState.lastStrokeKind = '';
            practiceState.lastStrokeTime = 0;
            practiceState.extraTypedWords = [];
        }

        // no endless mode: do not append copies

        schedulePracticeVisualUpdate();
        
        if (practiceState.currentIndex >= practiceState.words.length) {
            endPractice();
        }
    }

    let practiceVisualFrame = 0;

    function schedulePracticeVisualUpdate() {
        if (practiceVisualFrame) return;
        practiceVisualFrame = requestAnimationFrame(() => {
            practiceVisualFrame = 0;
            updateMonkeyVisuals();
            practiceState.lastLiveStatsPaint = performance.now();
            calculateLiveStats();
        });
    }

        function calculateLiveStats() {
        const now = performance.now();
        const minutes = (now - practiceState.sessionStartTime) / 60000;
        
            const completedItems = Math.min(practiceState.currentIndex, practiceState.words.length);
            const wordUnitCount = index => practiceState.wordUnitCounts[index] || 1;
            practiceState.statsCorrectWords = Array.from(practiceState.correctPracticeIndices)
                .reduce((total, index) => total + wordUnitCount(index), 0);
        practiceState.statsCorrectChars = 0;
        practiceState.statsTotalStrokes = 0;
            let completedWordUnits = 0;
            for (let i = 0; i < completedItems; i++) {
                completedWordUnits += wordUnitCount(i);
            if (practiceState.correctPracticeIndices.has(i)) {
                practiceState.statsCorrectChars += practiceState.words[i].length + 1;
            }
            practiceState.statsTotalStrokes += practiceState.strokeCounts[i] || 0;
        }
            practiceState.statsIndex = completedWordUnits;

        const wpm = minutes > 0 ? Math.round((practiceState.statsCorrectChars / 5) / minutes) : 0;
        const totalPracticeWords = practiceState.wordUnitCounts.reduce((total, count) => total + count, 0);
        
        const misses = Array.from(practiceState.mistakePracticeIndices)
            .reduce((total, index) => total + wordUnitCount(index), 0);
        const acc = totalPracticeWords > 0
            ? Math.max(0, 100 - (misses / totalPracticeWords) * 100)
            : 100;
        
        const avgStr = practiceState.statsIndex > 0 ? (practiceState.statsTotalStrokes / practiceState.statsIndex).toFixed(2) : 0;
        const idle = practiceState.avgIdle || 0;

        const liveWpm = document.getElementById('liveWpm');
        const liveAcc = document.getElementById('liveAcc');
        const liveAvgStr = document.getElementById('liveAvgStr');
        const liveIdle = document.getElementById('liveIdle');
        const liveStreak = document.getElementById('liveStreak');
        const liveLongestStreak = document.getElementById('liveLongestStreak');

        if (liveWpm) liveWpm.innerText = wpm;
        if (liveAcc) liveAcc.innerText = acc.toFixed(2) + '%';
        if (liveAvgStr) liveAvgStr.innerText = avgStr;
        if (liveIdle) liveIdle.innerText = idle.toFixed(3) + 's';
        if (liveStreak) liveStreak.innerText = practiceState.currentStreak;
        if (liveLongestStreak) liveLongestStreak.innerText = practiceState.longestStreak;
        
        return { wpm, acc, avgStr, idle, streak: practiceState.currentStreak, longestStreak: practiceState.longestStreak };
    }

    function recordHistoryStat() {
        if (!practiceState.sessionStartTime) return;
        const stats = calculateLiveStats();
        stats.word = practiceState.words[Math.max(0, practiceState.currentIndex - 1)] || practiceState.words[practiceState.currentIndex] || '';
        practiceState.statsHistory.push(stats);
    }

    function escapeHtml(s) { return String(s).replace(/</g, '&lt;'); }

    function endPractice() {
        clearInterval(statsInterval);
        if (practiceState.pendingEraseTimer) {
            clearTimeout(practiceState.pendingEraseTimer);
            practiceState.pendingEraseTimer = 0;
            practiceState.errorEvents++;
            playPracticeFeedback('miss');
            refreshPracticeAccuracy();
            const erasedWord = practiceState.words[practiceState.currentIndex];
            if (erasedWord) {
                practiceState.eraseErrorWords.add(erasedWord);
                registerProblemPracticeWord(erasedWord);
            }
        }
        document.getElementById('practiceArena').style.display = 'none';
        document.getElementById('practiceResults').style.display = 'block';

        const finalStats = calculateLiveStats();

        const progress = getPersistentProgress();
        const completedWords = Math.max(0, practiceState.statsIndex);
        if (completedWords >= 10) {
            progress.sessions.push({
                date: new Date().toISOString(),
                mode: practiceState.mode,
                words: completedWords,
                wpm: finalStats.wpm,
                acc: Number(finalStats.acc.toFixed(2)),
                idle: finalStats.idle,
                avgStr: Number(finalStats.avgStr) || 0,
                longestStreak: practiceState.longestStreak
            });
        }
        if (progress.sessions.length > MAX_PROGRESS_SESSIONS) progress.sessions = progress.sessions.slice(-MAX_PROGRESS_SESSIONS);
        savePersistentProgress(progress);
        renderPersistentProblemWords();
        drawPersistentProgressGraph();

        document.getElementById('resWpm').innerText = finalStats.wpm;
        document.getElementById('resAcc').innerText = finalStats.acc.toFixed(2) + "%";
        document.getElementById('resStr').innerText = finalStats.avgStr;
        document.getElementById('resIdle').innerText = finalStats.idle.toFixed(3) + "s";
        document.getElementById('resStreak').innerText = practiceState.longestStreak;

        const missedEl = document.getElementById('missedWordsList');
        const p = settings.profiles[settings.activeProfile];
        const problematicWords = new Set(practiceState.eraseErrorWords);
        if (problematicWords.size === 0) {
            missedEl.innerHTML = '<div style="color:var(--text-muted);">None! Great job.</div>';
        } else {
            missedEl.innerHTML = Array.from(problematicWords).map(w => {
                // Choose display stroke according to the hintType the user selected
                const map = practiceState.maxStrokesMap[w] || {};
                let displayStroke = (practiceState.customDict && practiceState.customDict[w]) || '';
                if (!displayStroke) {
                    if (practiceState.hintType === 'longest') displayStroke = map.longest || map.shortest || '';
                    else displayStroke = map.shortest || map.longest || '';
                }

                let diagramHTML = '';
                let strokeCount = 1;
                if (displayStroke) {
                    const subStrokes = displayStroke.split('/');
                    strokeCount = subStrokes.length || 1;
                    if (p.showDiagrams) {
                        diagramHTML = `<div class="graph-container">` + subStrokes.map((s, idx) => {
                            const keys = parseStrokeToKeys(s);
                            let res = `<div class="stroke-graph-step">` + generateBoardHTML(keys, 'display') + `</div>`;
                            if (idx < subStrokes.length - 1) res += `<span class="arrow">➔</span>`;
                            return res;
                        }).join('') + `</div>`;
                    } else {
                        diagramHTML = `<div class="raw-steno" style="margin-top:8px;">${escapeHtml(displayStroke)}</div>`;
                    }
                }

                return `<div class="dict-card"><div style="width:100%"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><div class="dict-name">${escapeHtml(w)}</div><div class="stroke-hint">Normally: ${strokeCount} stroke${strokeCount>1?'s':''}</div></div><div style="margin-top:8px;">${diagramHTML}</div></div></div>`;
            }).join('');
        }

        const ineffEl = document.getElementById('inefficientWordsList');
        if (practiceState.inefficient.size === 0) {
            ineffEl.innerHTML = '<div style="color:var(--text-muted);">None! Perfectly optimized.</div>';
        } else {
            ineffEl.innerHTML = Array.from(practiceState.inefficient).map(w => {
                const map = practiceState.maxStrokesMap[w] || {};
                const displayStroke = (practiceState.customDict && practiceState.customDict[w]) || map.shortest || '';

                let diagramHTML = '';
                let strokeCount = 0;
                if (displayStroke && displayStroke.split('/').length === 1) {
                    const subStrokes = displayStroke.split('/');
                    strokeCount = 1;
                    if (p.showDiagrams) {
                        diagramHTML = `<div class="graph-container">` + subStrokes.map((s, idx) => {
                            const keys = parseStrokeToKeys(s);
                            let res = `<div class="stroke-graph-step">` + generateBoardHTML(keys, 'display') + `</div>`;
                            if (idx < subStrokes.length - 1) res += `<span class="arrow">➔</span>`;
                            return res;
                        }).join('') + `</div>`;
                    } else {
                        diagramHTML = `<div class="raw-steno" style="margin-top:8px;">${escapeHtml(displayStroke)}</div>`;
                    }
                } else {
                    diagramHTML = '<div class="stroke-hint" style="margin-top:8px;">No brief found</div>';
                }

                const strokeLabel = strokeCount ? `Normally: ${strokeCount} stroke` : 'No 1-stroke brief found';
                return `<div class="dict-card"><div style="width:100%"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><div class="dict-name">${escapeHtml(w)}</div><div class="stroke-hint">${strokeLabel}</div></div><div style="margin-top:8px;">${diagramHTML}</div></div></div>`;
            }).join('');
        }

        setTimeout(drawResultsGraph, 100);
    }

    function drawSmoothGraphLine(ctx, points, color, lineWidth = 3) {
        if (!points.length) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.moveTo(points[0].x, points[0].y);
        if (points.length === 1) {
            ctx.stroke();
            return;
        }
        for (let index = 1; index < points.length - 1; index++) {
            const midpointX = (points[index].x + points[index + 1].x) / 2;
            const midpointY = (points[index].y + points[index + 1].y) / 2;
            ctx.quadraticCurveTo(points[index].x, points[index].y, midpointX, midpointY);
        }
        const last = points[points.length - 1];
        const previous = points[points.length - 2];
        ctx.quadraticCurveTo(previous.x, previous.y, last.x, last.y);
        ctx.stroke();
    }

    const practiceGraphPadding = { top: 22, right: 78, bottom: 42, left: 78 };

    function drawMetricLanes(canvas, records, selectedIndex, hoverIndex, getValues, emptyMessage) {
        const ctx = canvas.getContext('2d');
        const root = getComputedStyle(document.body);
        const border = root.getPropertyValue('--border').trim() || '#555555';
        const colors = ['--stat-wpm', '--stat-acc', '--stat-str', '--stat-idle', '--stat-streak'].map(name => root.getPropertyValue(name).trim());
        const metrics = [
            { name: 'WPM', suffix: '', step: 20, fallback: 100 },
            { name: 'Accuracy', suffix: '%', step: 10, fixedMax: 100 },
            { name: 'Avg Strokes', suffix: '', step: 0.5, fallback: 2 },
            { name: 'Idle Time', suffix: 's', step: 0.5, fallback: 2 },
            { name: 'Streak', suffix: '', step: 1, fallback: 10 },
        ];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!records.length) {
            ctx.fillStyle = root.getPropertyValue('--text-muted').trim();
            ctx.font = '14px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(emptyMessage, 24, 45);
            return;
        }

        const plotWidth = canvas.width - practiceGraphPadding.left - practiceGraphPadding.right;
        const plotHeight = canvas.height - practiceGraphPadding.top - practiceGraphPadding.bottom;
        const laneGap = 12;
        const laneHeight = (plotHeight - laneGap * (metrics.length - 1)) / metrics.length;
        const xAt = index => practiceGraphPadding.left + (records.length === 1 ? plotWidth / 2 : plotWidth * index / (records.length - 1));
        ctx.font = '11px monospace';
        ctx.textBaseline = 'middle';

        metrics.forEach((metric, metricIndex) => {
            const values = getValues(metricIndex);
            const maxValue = metric.fixedMax || Math.max(metric.fallback, Math.ceil(Math.max(...values, 0) * 1.1 / metric.step) * metric.step);
            const top = practiceGraphPadding.top + metricIndex * (laneHeight + laneGap);
            const bottom = top + laneHeight;
            const points = values.map((value, index) => ({
                x: xAt(index),
                y: bottom - Math.max(0, Math.min(1, value / maxValue)) * laneHeight
            }));
            ctx.strokeStyle = border;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            for (let grid = 0; grid <= 2; grid++) {
                const y = top + laneHeight * grid / 2;
                ctx.beginPath(); ctx.moveTo(practiceGraphPadding.left, y); ctx.lineTo(canvas.width - practiceGraphPadding.right, y); ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.fillStyle = colors[metricIndex];
            ctx.textAlign = 'right';
            ctx.fillText(`${maxValue}${metric.suffix}`, practiceGraphPadding.left - 10, top);
            ctx.fillText(`0${metric.suffix}`, practiceGraphPadding.left - 10, bottom);

            const rawColor = metricIndex === 2
                ? 'rgba(216, 195, 106, 0.4)'
                : metricIndex === 4 ? colors[metricIndex] : `${colors[metricIndex]}55`;
            ctx.beginPath(); ctx.strokeStyle = rawColor; ctx.lineWidth = 1.5;
            points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
            ctx.stroke();
            points.forEach((point, index) => {
                ctx.beginPath(); ctx.fillStyle = rawColor;
                ctx.arc(point.x, point.y, index === selectedIndex || index === hoverIndex ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
            });
            drawSmoothGraphLine(ctx, points, colors[metricIndex], 2.5);
        });
    }

    function drawResultsGraph() {
        const canvas = document.getElementById('resultGraph');
        const history = practiceState.statsHistory || [];
        drawMetricLanes(canvas, history, practiceState.graphSelectedIndex, practiceState.graphHoverIndex, metricIndex => history.map(point => {
            if (metricIndex === 0) return Number(point.wpm) || 0;
            if (metricIndex === 1) return Number(point.acc) || 0;
            if (metricIndex === 2) return Number(point.avgStr) || 0;
            if (metricIndex === 3) return Number(point.idle) || 0;
            return Number(point.streak) || 0;
        }), 'Complete more words to draw the session graph.');
        setupGraphInteractions();
    }

    function setupGraphInteractions() {
        const canvas = document.getElementById('resultGraph');
        const wrap = document.getElementById('resultGraphWrap');
        const label = document.getElementById('graphPointLabel');
        if (!canvas || !wrap || !label || canvas.dataset.graphReady) return;
        canvas.dataset.graphReady = '1';
        canvas.style.cursor = 'crosshair';

        const showPointLabel = (index, clientX, clientY) => {
            const point = practiceState.statsHistory[index];
            if (!point) return;
            label.textContent = point.word || 'Exercise point';
            label.style.display = 'block';
            const rect = canvas.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            label.style.left = `${Math.max(0, clientX - wrapRect.left + 8)}px`;
            label.style.top = `${Math.max(0, clientY - wrapRect.top - 28)}px`;
        };

        canvas.addEventListener('mousemove', (event) => {
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) * canvas.width / rect.width;
            const paddingLeft = practiceGraphPadding.left;
            const paddingRight = practiceGraphPadding.right;
            const plotWidth = canvas.width - paddingLeft - paddingRight;
            const count = practiceState.statsHistory.length;
            if (count < 2 || x < paddingLeft - 8 || x > canvas.width - paddingRight + 8) return;
            const index = Math.max(0, Math.min(count - 1, Math.round((x - paddingLeft) / (plotWidth / (count - 1)))));
            practiceState.graphHoverIndex = index;
            showPointLabel(index, event.clientX, event.clientY);
            drawResultsGraph();
        });

        canvas.addEventListener('click', () => {
            practiceState.graphSelectedIndex = practiceState.graphHoverIndex;
            drawResultsGraph();
        });

        canvas.addEventListener('mouseleave', () => {
            practiceState.graphHoverIndex = -1;
            if (practiceState.graphSelectedIndex < 0) label.style.display = 'none';
            drawResultsGraph();
        });
    }

    function drawPersistentProgressGraph() {
        const canvas = document.getElementById('progressGraph');
        const wrap = document.getElementById('progressGraphWrap');
        const label = document.getElementById('progressGraphLabel');
        if (!canvas || !wrap || !label) return;
        const sessions = getPersistentProgress().sessions;
        const average = key => sessions.length
            ? sessions.reduce((total, session) => total + (Number(session[key]) || 0), 0) / sessions.length
            : 0;
        document.getElementById('progressWpm').textContent = sessions.length ? Math.round(average('wpm')) : '0';
        document.getElementById('progressAcc').textContent = sessions.length ? `${average('acc').toFixed(2)}%` : '100.00%';
        document.getElementById('progressIdle').textContent = sessions.length ? `${average('idle').toFixed(3)}s` : '0.000s';
        document.getElementById('progressStr').textContent = sessions.length ? average('avgStr').toFixed(2) : '0';
        const longestStreak = sessions.length
            ? Math.max(...sessions.map(session => Number(session.longestStreak) || 0))
            : 0;
        document.getElementById('progressStreak').textContent = longestStreak;
        drawMetricLanes(canvas, sessions, -1, -1, metricIndex => sessions.map(session => {
            if (metricIndex === 0) return Number(session.wpm) || 0;
            if (metricIndex === 1) return Number(session.acc) || 0;
            if (metricIndex === 2) return Number(session.avgStr) || 0;
            if (metricIndex === 3) return Number(session.idle) || 0;
            return Number(session.longestStreak) || 0;
        }), 'Complete a practice session to build progress.');
        if (canvas.dataset.ready) return;
        canvas.dataset.ready = '1'; canvas.style.cursor = 'crosshair';
        canvas.addEventListener('mousemove', event => {
            const currentSessions = getPersistentProgress().sessions;
            if (!currentSessions.length) return;
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) * canvas.width / rect.width;
            const plotWidth = canvas.width - practiceGraphPadding.left - practiceGraphPadding.right;
            const index = currentSessions.length === 1 ? 0 : Math.max(0, Math.min(currentSessions.length - 1, Math.round((x - practiceGraphPadding.left) / (plotWidth / (currentSessions.length - 1)))));
            const session = currentSessions[index];
            label.textContent = `${new Date(session.date).toLocaleString()} | ${session.mode} | ${session.words} words`;
            const wrapRect = wrap.getBoundingClientRect();
            label.style.left = `${Math.max(0, event.clientX - wrapRect.left + 8)}px`;
            label.style.top = `${Math.max(0, event.clientY - wrapRect.top - 30)}px`;
            label.style.display = 'block';
        });
        canvas.addEventListener('mouseleave', () => { label.style.display = 'none'; });
    }

    function resetPracticeUI() {
        document.getElementById('practiceResults').style.display = 'none';
        document.getElementById('practiceSetup').style.display = 'block';
        drawPersistentProgressGraph();
        renderPersistentProblemWords();
    }

    window.onload = () => {
        updateSettingsUI();
        applyThemeStyles();
        renderConfigBoard();
        // Ensure the search mode button and internals are synced to stored settings
        try { setSearchMode(settings.searchMode || 'word'); } catch(e) {}
        renderPersistentProblemWords();
        drawPersistentProgressGraph();
        initDB();
    };
