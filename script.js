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
        extL: ['^', '+'], 
        topL: ['S-','T-','P-','H-'], botL: ['S-','K-','W-','R-'],
        topC: ['*','*'], botC: ['*','*'],
        topR: ['-F','-P','-L','-T','-D'], botR: ['-R','-B','-G','-S','-Z'],
        thmbL: [' ', 'A-', 'O-'], thmbR: ['E-', 'U-', ' ']
    };

    let settings = {};
    try {
        const savedSettings = localStorage.getItem('ploverSettings');
        settings = savedSettings ? JSON.parse(savedSettings) : {};
    } catch (error) {
        console.warn('Saved settings could not be loaded. Starting with defaults.', error);
        try {
            const unreadableSettings = localStorage.getItem('ploverSettings');
            if (unreadableSettings) localStorage.setItem('ploverSettings_corrupt_backup', unreadableSettings);
            localStorage.removeItem('ploverSettings');
        } catch (backupError) {
            console.warn('Unable to back up unreadable settings.', backupError);
        }
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
    
    if (!settings.profiles) {
        settings.profiles = {};
        for(let i=1; i<=5; i++) {
            let legacyLayout = settings.layout ? JSON.parse(JSON.stringify(settings.layout)) : JSON.parse(JSON.stringify(defaultLayout));
            if (!Array.isArray(legacyLayout.extL) || legacyLayout.extL.length < 2 || legacyLayout.extL.every(value => !String(value).trim())) legacyLayout.extL = ['^', '+'];
            while(legacyLayout.num.length < 12) legacyLayout.num.push('#');
            
            settings.profiles[i] = {
                theme: settings.theme || 'blue',
                layout: legacyLayout,
                showDiagrams: settings.showDiagrams !== undefined ? settings.showDiagrams : true,
                showNumberBar: settings.showNumberBar !== undefined ? settings.showNumberBar : true,
                extraThumbs: settings.extraThumbs !== undefined ? settings.extraThumbs : false,
                extraLeftCol: false,
                practiceSoundFeedback: settings.profiles?.[i]?.audioFeedback || false,
                speechEnabled: false,
                speechVoice: '',
                blindMode: false,
                quoteLanguage: 'lessons/Random Quotes/Random Quote (English).json',
                practiceList: 'problematic'
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
            if (!settings.profiles[i] || typeof settings.profiles[i] !== 'object') {
                settings.profiles[i] = {
                    theme: 'blue',
                    layout: JSON.parse(JSON.stringify(defaultLayout)),
                    showDiagrams: true,
                    showNumberBar: true,
                    extraThumbs: false,
                    extraLeftCol: false,
                    practiceSoundFeedback: false,
                    speechEnabled: false,
                    speechVoice: '',
                    blindMode: false,
                    quoteLanguage: 'lessons/Random Quotes/Random Quote (English).json',
                    practiceList: 'problematic'
                };
            }
            if (!settings.profiles[i].layout || typeof settings.profiles[i].layout !== 'object') settings.profiles[i].layout = JSON.parse(JSON.stringify(defaultLayout));
            if (!Array.isArray(settings.profiles[i].layout.extL) || settings.profiles[i].layout.extL.length < 2 || settings.profiles[i].layout.extL.every(value => !String(value).trim())) settings.profiles[i].layout.extL = ['^', '+'];
            while(settings.profiles[i].layout.num.length < 12) settings.profiles[i].layout.num.push('#');
            if(settings.profiles[i].extraLeftCol === undefined) settings.profiles[i].extraLeftCol = false;
            if(settings.profiles[i].showDiagrams === undefined) settings.profiles[i].showDiagrams = true;
            if(settings.profiles[i].practiceSoundFeedback === undefined) {
                settings.profiles[i].practiceSoundFeedback = settings.profiles[i].audioFeedback || false;
            }
            if (settings.profiles[i].speechEnabled === undefined) settings.profiles[i].speechEnabled = false;
            if (settings.profiles[i].speechVoice === undefined) settings.profiles[i].speechVoice = '';
            if (settings.profiles[i].blindMode === undefined) settings.profiles[i].blindMode = false;
            if(settings.profiles[i].quoteLanguage === undefined) {
                settings.profiles[i].quoteLanguage = 'lessons/Random Quotes/Random Quote (English).json';
            }
            if(settings.profiles[i].practiceList === undefined) settings.profiles[i].practiceList = 'problematic';
        }
    }

    const DEFAULT_CUSTOM_THEME = {
        bg: '#000000', surface: '#111111', surfaceHover: '#222222', border: '#333333',
        text: '#ffffff', textMuted: '#888888', accent: '#ff0055', accentInvert: '#000000',
        practiceUntyped: '#888888', practiceCorrect: '#ffffff', practiceWrong: '#ff5555', practiceCursor: '#ff0055',
        practiceProblematic: '#63b8ff', practiceBrief: '#70d6a5',
        statWpm: '#3a86ff', statAcc: '#2ec4b6', statStr: '#ff9f1c', statStreak: '#f15bb5'
    };
    const normalizeCustomTheme = (theme, fallback = DEFAULT_CUSTOM_THEME) => Object.fromEntries(
        Object.entries(DEFAULT_CUSTOM_THEME).map(([key, defaultValue]) => {
            const value = theme?.[key] ?? fallback?.[key] ?? defaultValue;
            return [key, typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : defaultValue];
        })
    );
    settings.customTheme = normalizeCustomTheme(settings.customTheme);
    for (let profileId = 1; profileId <= 5; profileId++) {
        const profile = settings.profiles[profileId];
        profile.customTheme = normalizeCustomTheme(profile.customTheme, settings.customTheme);
    }
    settings.customTheme = settings.profiles[settings.activeProfile].customTheme;

    const legacyPracticeSettings = {
        practiceMaterial: localStorage.getItem('steno_practice_text') || '',
        practiceMode: localStorage.getItem('steno_practice_mode') || 'random',
        practiceTestMode: 'quote',
        practiceQuoteLength: 'medium',
        practiceTestDuration: '60',
        practiceTestWords: '50',
        practiceTestQuotes: '5',
        practiceNumberGroups: '50',
        practiceNumberDigits: '6',
        practiceNumberFormat: 'digits',
        practiceSymbolCount: '50',
        jeffPhraseCount: '25',
        jeffPhraseForm: 'simple',
        jeffStarters: 'that, if, when, what, where, who, why, but, for',
        jeffPronouns: 'I, we, he, she, you, they, it',
        jeffVerbs: 'ask, are, become, believe, call, can, care, change, come, consider, do, expect, feel, find, forget, get, give, go, have, happen, hear, hope, imagine, just, keep, know, learn, leave, let, like, live, look, love, make, may, mean, move, must, need, put, read, realize, really, recall, remember, remain, run, say, see, seem, set, shall, show, take, tell, think, try, understand, use, want, will, wish, work',
        jeffIncludeHave: true,
        jeffFullStarters: 'I, you, he, she, it, we, they, this, that, there, there-plural, is, are',
        jeffFullVerbs: 'ask, are, become, believe, call, can, care, change, come, consider, do, expect, feel, find, forget, get, give, go, have, happen, hear, hope, imagine, just, keep, know, learn, leave, let, like, live, look, love, make, may, mean, move, must, need, put, read, realize, really, recall, remember, remain, run, say, see, seem, set, shall, show, take, tell, think, try, understand, use, want, will, wish, work',
        jeffAuxiliaries: 'do, can, shall, will',
        jeffStructures: 'plain, negative, have, negative-have, be, negative-be, been, negative-been, still, negative-still, never, even, always, negative-always, just, negative-just',
        jeffSimpleSuffixes: 'T,S',
        jeffSimplePast: 'D,Z',
        jeffFullSuffixes: 'T,S',
        jeffFullPast: 'D,Z',
        strokeVisibility: localStorage.getItem('steno_practice_vis') || 'always',
        strokeHintType: localStorage.getItem('steno_practice_hint') || 'shortest',
        practiceRepeats: localStorage.getItem('steno_practice_repeats') || '0',
        practiceMaxWords: localStorage.getItem('steno_practice_maxWords') || '0',
        practiceProblemWords: localStorage.getItem('steno_practice_problemWords') || '0',
        practiceBriefWords: localStorage.getItem('steno_practice_briefWords') || '0',
        practiceStartWord: localStorage.getItem('steno_practice_startWord') || '1',
        practiceEndWord: localStorage.getItem('steno_practice_endWord') || '0',
        blindMode: false,
        practiceBlindWpm: '60',
        practiceBlindMode: 'wait',
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
        settings.customTheme = settings.profiles[settings.activeProfile].customTheme;
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
        if (key === 'speechEnabled') triggerSearch();
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
                oscillator.type = 'sine';
                oscillator.frequency.value = isError ? 360 : 520;
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(isError ? 0.045 : 0.035, now + 0.015);
                if (isError) {
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                } else {
                    oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.09);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                }
                oscillator.connect(gain).connect(practiceAudioContext.destination);
                oscillator.start(now);
                oscillator.stop(now + 0.13);
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
        const profileTheme = settings.profiles[settings.activeProfile].customTheme;
        if (!(key in DEFAULT_CUSTOM_THEME) || !/^#[\da-f]{6}$/i.test(value)) return;
        profileTheme[key] = value;
        settings.customTheme = profileTheme;
        saveSettings();
    }

    function applyThemeStyles() {
        const profile = settings.profiles[settings.activeProfile];
        const theme = profile.theme;
        if (theme === 'custom') {
            document.body.className = '';
            const themeColors = normalizeCustomTheme(profile.customTheme);
            const cssProperties = {
                bg: '--bg', surface: '--surface', surfaceHover: '--surface-hover', border: '--border',
                text: '--text-main', textMuted: '--text-muted', accent: '--accent', accentInvert: '--accent-invert',
                practiceUntyped: '--practice-untyped', practiceCorrect: '--practice-correct',
                practiceWrong: '--practice-wrong', practiceProblematic: '--practice-problematic',
                practiceBrief: '--practice-brief', practiceCursor: '--practice-cursor',
                statWpm: '--stat-wpm', statAcc: '--stat-acc', statStr: '--stat-str', statStreak: '--stat-streak'
            };
            Object.entries(cssProperties).forEach(([key, property]) =>
                document.documentElement.style.setProperty(property, themeColors[key]));
            
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
        updatePracticeTogglesUI();
        updatePracticeBlindControls();
        syncQuoteLanguageUI();
        renderPracticeDashboard();
        drawPersistentProgressGraph();
        loadDictionaries(true); 
    }

    function savePracticeSettingsForProfile() {
        const profile = settings.profiles[settings.activeProfile];
        ['practiceMaterial', 'practiceMode', 'practiceTestMode', 'practiceQuoteLength', 'practiceTestDuration', 'practiceTestWords', 'practiceTestQuotes', 'practiceNumberGroups', 'practiceNumberDigits', 'practiceNumberFormat', 'practiceSymbolCount', 'jeffPhraseCount', 'jeffPhraseForm', 'jeffStarters', 'jeffPronouns', 'jeffVerbs', 'jeffFullStarters', 'jeffFullVerbs', 'jeffAuxiliaries', 'jeffStructures', 'jeffSimpleSuffixes', 'jeffSimplePast', 'jeffFullSuffixes', 'jeffFullPast', 'strokeVisibility', 'strokeHintType', 'practiceRepeats', 'practiceMaxWords', 'practiceProblemWords', 'practiceBriefWords', 'practiceStartWord', 'practiceEndWord', 'practiceLesson'].forEach(id => {
            const input = document.getElementById(id);
            if (input) profile[id] = input.value;
        });
        ['jeffIncludeHave'].forEach(id => {
            const input = document.getElementById(id);
            if (input) profile[id] = input.checked;
        });
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        updatePracticeCapWarning();
    }

    function getSavedMaterials(profile = settings.profiles[settings.activeProfile]) {
        if (!Array.isArray(profile.savedMaterials)) profile.savedMaterials = [];
        profile.savedMaterials = profile.savedMaterials.filter(material =>
            material && typeof material.title === 'string' && typeof material.content === 'string'
        );
        return profile.savedMaterials;
    }

    function renderSavedMaterials() {
        const select = document.getElementById('savedMaterialSelect');
        if (!select) return;
        const selectedValue = select.value;
        const materials = getSavedMaterials();
        select.innerHTML = '<option value="">Load saved material...</option>';
        [['problematic', 'Problematic Words'], ['briefs', 'My Briefs']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = `list:${value}`;
            option.textContent = label;
            select.appendChild(option);
        });
        materials.forEach((material, index) => {
            const option = document.createElement('option');
            option.value = `saved:${index}`;
            option.textContent = material.title;
            select.appendChild(option);
        });
        if (Array.from(select.options).some(option => option.value === selectedValue)) select.value = selectedValue;
        document.getElementById('deleteMaterialButton').disabled = !select.value;
    }

    function resetSavedMaterialSelection() {
        const select = document.getElementById('savedMaterialSelect');
        if (!select) return;
        select.value = '';
        document.getElementById('deleteMaterialButton').disabled = true;
    }

    function clearSavedMaterialTitle() {
        const title = document.getElementById('savedMaterialTitle');
        if (title) title.value = '';
    }

    function parseSavedListMaterial(content) {
        const entries = [];
        const lines = String(content).split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(/\t+|\s{2,}/);
            const word = parts[0].trim().normalize('NFC');
            if (!word) continue;
            entries.push({ word, stroke: parts[1]?.trim() || '' });
        }
        if (entries.length) return entries;
        return (content.match(/[\p{L}\p{M}\p{N}_'’-]+/gu) || []).map(word => ({ word: word.normalize('NFC'), stroke: '' }));
    }

    function updatePracticeListFromMaterial(listName, content) {
        const entries = parseSavedListMaterial(content);
        if (!entries.length) return false;
        const progress = getPersistentProgress();
        progress[listName] = Object.fromEntries(entries.map(({ word, stroke }) => [word,
            listName === 'briefs' ? { stroke } : { errors: 0, correct: 0, stroke }
        ]));
        savePersistentProgress(progress);
        renderPersistentProblemWords();
        return true;
    }

    function saveCustomMaterial() {
        const titleInput = document.getElementById('savedMaterialTitle');
        const materialInput = document.getElementById('practiceMaterial');
        const title = titleInput.value.trim();
        const content = materialInput.value;
        if (!title || !content.trim()) {
            openModal('Cannot Save Material', 'Enter a title and some practice material first.', () => {});
            return;
        }
        const listName = title.toLowerCase() === 'problematic words'
            ? 'problematic'
            : title.toLowerCase() === 'my briefs' ? 'briefs' : '';
        if (listName && !updatePracticeListFromMaterial(listName, content)) {
            openModal('Cannot Update List', 'Enter at least one word before saving this list.', () => {});
            return;
        }
        if (listName) {
            resetSavedMaterialSelection();
            document.getElementById('savedMaterialSelect').value = `list:${listName}`;
            document.getElementById('deleteMaterialButton').disabled = true;
            return;
        }
        const materials = getSavedMaterials();
        const existingIndex = materials.findIndex(material => material.title.toLowerCase() === title.toLowerCase());
        const material = { title, content };
        if (existingIndex >= 0) materials[existingIndex] = material;
        else materials.push(material);
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        renderSavedMaterials();
        document.getElementById('savedMaterialSelect').value = String(existingIndex >= 0 ? existingIndex : materials.length - 1);
        document.getElementById('deleteMaterialButton').disabled = false;
    }

    function deleteCustomMaterial() {
        const select = document.getElementById('savedMaterialSelect');
        if (!select?.value.startsWith('saved:')) return;
        const index = Number(select.value.slice(6));
        const materials = getSavedMaterials();
        if (!Number.isInteger(index) || !materials[index]) return;
        materials.splice(index, 1);
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        renderSavedMaterials();
    }

    function loadSavedMaterial(index) {
        if (String(index).startsWith('list:')) {
            const listName = String(index).slice(5);
            getPracticeListMaterial(listName).then(content => {
                document.getElementById('practiceMaterial').value = content;
                document.getElementById('savedMaterialTitle').value = listName === 'briefs' ? 'My Briefs' : 'Problematic Words';
                document.getElementById('lessonSelect').value = 'custom';
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
            });
            return;
        }
        const material = getSavedMaterials()[Number(String(index).replace(/^saved:/, ''))];
        if (!material) return;
        document.getElementById('practiceMaterial').value = material.content;
        document.getElementById('savedMaterialTitle').value = material.title;
        document.getElementById('lessonSelect').value = 'custom';
        savePracticeSettingsForProfile();
        updatePracticeEstimate();
    }

    function loadPracticeSettingsForProfile() {
        const profile = settings.profiles[settings.activeProfile];
        Object.entries({
            practiceMaterial: 'practiceMaterial',
            practiceMode: 'practiceMode',
            practiceTestMode: 'practiceTestMode',
            practiceQuoteLength: 'practiceQuoteLength',
            practiceTestDuration: 'practiceTestDuration',
            practiceTestWords: 'practiceTestWords',
            practiceTestQuotes: 'practiceTestQuotes',
            practiceNumberGroups: 'practiceNumberGroups',
            practiceNumberDigits: 'practiceNumberDigits',
            practiceNumberFormat: 'practiceNumberFormat',
            practiceSymbolCount: 'practiceSymbolCount',
            jeffPhraseCount: 'jeffPhraseCount',
            jeffPhraseForm: 'jeffPhraseForm',
            jeffStarters: 'jeffStarters',
            jeffPronouns: 'jeffPronouns',
            jeffVerbs: 'jeffVerbs',
            jeffFullStarters: 'jeffFullStarters',
            jeffFullVerbs: 'jeffFullVerbs',
            jeffAuxiliaries: 'jeffAuxiliaries',
            jeffStructures: 'jeffStructures',
            jeffSimpleSuffixes: 'jeffSimpleSuffixes',
            jeffSimplePast: 'jeffSimplePast',
            jeffFullSuffixes: 'jeffFullSuffixes',
            jeffFullPast: 'jeffFullPast',
            strokeVisibility: 'strokeVisibility',
            strokeHintType: 'strokeHintType',
            practiceRepeats: 'practiceRepeats',
            practiceMaxWords: 'practiceMaxWords',
            practiceProblemWords: 'practiceProblemWords',
            practiceBriefWords: 'practiceBriefWords',
            practiceStartWord: 'practiceStartWord',
            practiceEndWord: 'practiceEndWord',
            practiceLesson: 'lessonSelect'
        }).forEach(([key, id]) => {
            const input = document.getElementById(id);
            if (input && profile[key] !== undefined) input.value = profile[key];
        });
        ['jeffIncludeHave'].forEach(id => {
            const input = document.getElementById(id);
            if (input && profile[id] !== undefined) input.checked = Boolean(profile[id]);
        });
        renderJeffPhraseOptions();
        clearSavedMaterialTitle();
        resetSavedMaterialSelection();
        renderSavedMaterials();
        updatePracticeCapWarning();
        updatePracticeTestControls();
    }

    function clearPracticeMaterial() {
        document.getElementById('practiceMaterial').value = '';
        clearSavedMaterialTitle();
        resetSavedMaterialSelection();
        document.getElementById('lessonSelect').value = 'custom';
        document.getElementById('practiceTestMode').value = 'lesson';
        updatePracticeTestControls();
        document.getElementById('newQuoteButton').classList.add('hidden');
        savePracticeSettingsForProfile();
        updatePracticeEstimate();
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
        openModal("Clear User Data", "Are you sure you want to erase your practice graph, problematic words, and briefs?", () => {
            savePersistentProgress({ sessions: [], problematic: {}, briefs: {} });
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
        settings.customTheme = settings.profiles[settings.activeProfile].customTheme;
        const payload = {
            format: 'stenodex-user-data',
            version: 5,
            progress: getAllPersistentProgress(),
            settings: settings
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'stenodex-user-data.txt';
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
                if (payload?.format !== 'stenodex-user-data' || ![1, 2, 3, 4, 5].includes(payload?.version)) {
                    throw new Error('Unsupported user data file.');
                }
                const importedSettings = payload.settings;
                const legacyProfileId = String(importedSettings?.activeProfile || settings.activeProfile);
                const importedProgress = payload.version >= 2
                    ? payload.progress
                    : { profiles: { [legacyProfileId]: payload.progress } };
                if (!importedProgress || !importedProgress.profiles || typeof importedProgress.profiles !== 'object' || !importedSettings || typeof importedSettings !== 'object' || !importedSettings.profiles || typeof importedSettings.profiles !== 'object') {
                    throw new Error('Invalid user data.');
                }
                pendingImportPayload = { settings: importedSettings, progress: importedProgress };
                const profileIds = Object.keys(importedSettings.profiles)
                    .filter(profileId => /^[1-5]$/.test(profileId) && importedProgress.profiles[profileId]);
                if (!profileIds.length) throw new Error('No profiles with practice data were found.');
                showImportProfilesModal(profileIds);
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
                    practiceRepeats: '0', practiceMaxWords: '0', practiceProblemWords: '0', practiceBriefWords: '0', practiceStartWord: '1', practiceEndWord: '0',
                    ignoreCaps: false, ignorePunct: false, blindMode: false, speechEnabled: false, speechVoice: '', practiceList: 'problematic',
                    quoteLanguage: 'lessons/Random Quotes/Random Quote (English).json', savedMaterials: []
                };
                Object.entries(practiceDefaults).forEach(([key, fallback]) => {
                    if (importedProfile[key] === undefined) importedProfile[key] = fallback;
                });
                if (!importedProfile.layout || typeof importedProfile.layout !== 'object') {
                    importedProfile.layout = JSON.parse(JSON.stringify(defaultLayout));
                } else if (!Array.isArray(importedProfile.layout.extL) || importedProfile.layout.extL.length < 2 || importedProfile.layout.extL.every(value => !String(value).trim())) {
                    importedProfile.layout.extL = ['^', '+'];
                }
                importedProfile.customTheme = normalizeCustomTheme(
                    imported.settings.profiles[profileId].customTheme,
                    imported.settings.customTheme || settings.customTheme
                );
            }
        });
        saveAllPersistentProgress(getAllPersistentProgress(), imported.progress, selectedProfiles);
        settings.customTheme = settings.profiles[settings.activeProfile].customTheme;
        localStorage.setItem('ploverSettings', JSON.stringify(settings));
        closeImportProfilesModal();
        loadPracticeSettingsForProfile();
        updateSettingsUI();
        applyThemeStyles();
        renderPersistentProblemWords();
        drawPersistentProgressGraph();
        openModal('User Data Imported', 'The selected profile data, layouts, and settings were imported successfully.', () => {});
    }

    function toggleSearchMenu(event) {
        event.stopPropagation();
        const menu = document.getElementById('searchModeMenu');
        const isOpen = menu.classList.toggle('visible');
        document.getElementById('searchModeBtn').setAttribute('aria-expanded', String(isOpen));
    }

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('searchModeMenu');
        if (menu && menu.classList.contains('visible') && !e.target.closest('.search-mode-wrapper')) {
            menu.classList.remove('visible');
            document.getElementById('searchModeBtn').setAttribute('aria-expanded', 'false');
        }
    });

    function setSearchMode(mode, focusInput = false) {
        document.getElementById('searchModeMenu').classList.remove('visible');
        document.getElementById('searchModeBtn').setAttribute('aria-expanded', 'false');
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
        if (focusInput) input.focus();
    }

    function updateSettingsUI() {
        const p = settings.profiles[settings.activeProfile];
        
        const themes = [
            'dark','blue','shrimp','coral-reef','tidepool','kelp-forest','deep-sea','sea-glass',
            'lagoon','bioluminescent','sandbar','neon-cyan','light','oled','dracula','tokyo-night','hacker','synthwave',
            'monokai','nord','gruvbox','catppuccin','solarized-dark','solarized-light',
            'cyberpunk','rose-pine','coffee','emerald','sunset','amethyst','cherry',
            'ocean','amber','charcoal','ruby','arctic','gold','mint','lavender',
            'tangerine','slate','matcha','velvet','midnight','custom'
        ];
        themes.forEach(t => {
            const btn = document.getElementById(`theme-${t}`);
            if(btn) btn.className = p.theme === t ? 'active' : '';
        });

        const customTheme = normalizeCustomTheme(p.customTheme);
        Object.keys(DEFAULT_CUSTOM_THEME).forEach(k => {
            const el = document.getElementById(`c_${k}`);
            if(el) el.value = customTheme[k];
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
        const speechButton = document.getElementById('btnSpeechEnabled');
        if (speechButton) {
            speechButton.style.borderColor = p.speechEnabled ? 'var(--accent)' : 'var(--border)';
            speechButton.style.color = p.speechEnabled ? 'var(--text-main)' : 'var(--text-muted)';
        }
    }

    function getSelectedSpeechVoice() {
        const voices = window.speechSynthesis?.getVoices() || [];
        return voices.find(voice => voice.name === settings.profiles[settings.activeProfile].speechVoice) || voices[0];
    }

    function speakPracticeText(text, rate = 1, force = false) {
        const profile = settings.profiles[settings.activeProfile];
        if (text === undefined || text === null || (!profile.speechEnabled && !force) || !window.speechSynthesis || !String(text).trim()) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(String(text));
        const voice = getSelectedSpeechVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = Math.max(0.1, Math.min(10, rate));
        window.speechSynthesis.speak(utterance);
    }

    function announceActivePracticeItem() {
        const activeIndex = practiceState.currentIndex;
        const activeText = practiceState.words[activeIndex];
        const blindMode = practiceState.blindMode;
        if (!activeText || (!blindMode && !settings.profiles[settings.activeProfile].speechEnabled)
            || activeIndex === practiceState.spokenPracticeIndex) return;
        practiceState.spokenPracticeIndex = activeIndex;
        speakPracticeText(activeText, 1, blindMode);
    }


    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const menuToggle = document.getElementById('menuToggle');
        sidebar.classList.toggle('open');
        const isOpen = sidebar.classList.contains('open');
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Close profile options' : 'Open profile options');
        sidebar.setAttribute('aria-hidden', String(!isOpen));
        sidebar.inert = !isOpen;
        
        if (isOpen) {
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
        updatePracticeBlindControls();
        updatePracticeEstimate();
        updatePracticeCapWarning();
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
            if (btnIC) {
                btnIC.classList.toggle('active', ic);
                btnIC.setAttribute('aria-pressed', String(ic));
            }
            if (btnIP) {
                btnIP.classList.toggle('active', ip);
                btnIP.setAttribute('aria-pressed', String(ip));
            }
            const btnBlind = document.getElementById('btnBlindMode');
            if (btnBlind) {
                btnBlind.classList.toggle('active', Boolean(profile.blindMode));
                btnBlind.setAttribute('aria-pressed', String(Boolean(profile.blindMode)));
            }
        } catch (e) { console.warn(e); }
    }

    function updatePracticeBlindControls() {
        const profile = settings.profiles[settings.activeProfile];
        const blindButton = document.getElementById('btnBlindMode');
        if (blindButton) {
            blindButton.classList.toggle('active', Boolean(profile.blindMode));
            blindButton.setAttribute('aria-pressed', String(Boolean(profile.blindMode)));
        }
        const wpm = document.getElementById('practiceBlindWpm');
        const type = document.getElementById('practiceBlindMode');
        if (wpm) wpm.disabled = !profile.blindMode;
        if (type) type.disabled = !profile.blindMode;
    }

    function isPracticePunctuation(value) {
        return /^\p{P}+$/u.test(String(value));
    }

    // Skip over punctuation tokens when Ignore Punctuation is enabled
    function skipHiddenPunctuationTokens() {
        try {
            const ignorePunct = practiceState.ignorePunct;
            if (!ignorePunct || !practiceState || !practiceState.words || practiceState.testMode === 'symbols') return;
            while (practiceState.currentIndex < practiceState.words.length && isPracticePunctuation(practiceState.words[practiceState.currentIndex])) {
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
        let out = String(s).normalize('NFC');
        const ignoreCaps = practiceState.ignoreCaps;
        const ignorePunct = practiceState.ignorePunct;
        if (ignorePunct && practiceState.testMode !== 'symbols') out = out.replace(/\p{P}/gu, '');
        if (ignoreCaps) out = out.toLowerCase();
        return out;
    }

    // Initialize practice toggles UI on load
    window.addEventListener('load', () => {
        updatePracticeTogglesUI();
        updatePracticeBlindControls();
    });

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
        const startupFallback = setTimeout(() => {
            console.warn('Dictionary database startup is taking longer than expected.');
            hideLoader();
        }, 5000);
        
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
            clearTimeout(startupFallback);
            db = e.target.result; 
            db.onversionchange = () => db.close();
            
            const tx = db.transaction('entries', 'readonly');
            if (!tx.objectStore('entries').indexNames.contains('stroke')) {
                indexedDB.deleteDatabase(DB_NAME);
                location.reload();
                return;
            }
            
            loadDictionaries(true); 
        };
        
        req.onerror = (e) => {
            clearTimeout(startupFallback);
            console.error("Database failed to open", e);
            hideLoader();
        };
        req.onblocked = () => {
            console.warn('Dictionary database startup is blocked by another tab.');
            hideLoader();
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
            const isBrief = Boolean(getPersistentProgress().briefs[word]);
            
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
                        <div class="stroke-action-row"><div class="raw-steno">${entry.stroke.replace(/</g, '&lt;')}</div><button class="add-brief-button" onclick="addBrief(${escapeInlineJson(word)}, ${escapeInlineJson(entry.stroke)}, this)">${isBrief ? 'Included in briefs list' : 'Add to briefs list'}</button></div>
                        ${graphHTML}
                    </div>
                `;
            }

            const speechButton = settings.profiles[settings.activeProfile].speechEnabled
                ? `<button class="speak-word-button" title="Say word aloud" onclick="speakPracticeText(${escapeInlineJson(word)})" aria-label="Say ${escapeHtml(word)}">Say It</button>`
                : '';
            card.innerHTML = `<div class="word-title">${word.replace(/</g, '&lt;')}${speechButton}</div>${strokesHTML}`;
            resultsEl.appendChild(card);
        }
    }

    // --- Practice Mode Logic ---
    let practiceState = {
        words: [],
        normalizedWords: [],
        problematicWordSet: new Set(),
        briefWordSet: new Set(),
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
        blindMode: false,
        blindModeType: 'wait',
        blindWpm: 60,
        spokenPracticeIndex: -1,
        blindTimer: 0,
        missed: new Set(),
        inefficient: new Set(),
        // endless mode removed; keep simple session flags
        isEndless: false,
        customDict: null,
        
        sessionStartTime: 0,
        sessionStartDate: null,
        lastInputTime: 0,
        lastInputValue: '',
        lastStrokeTime: 0,
        lastStrokeKind: '',
        strokeTypingWindow: 100,
        pendingSnapshotTimer: 0,
        pendingSnapshotInputType: '',
        pendingSnapshotIndex: -1,
        pendingEraseTimer: 0,
        statsHistory: [],
        testMode: 'lesson',
        testVariant: 'lesson',
        lessonId: '',
        personalBestWpm: 0,
        quoteRanges: [],
        awaitingNextQuote: false,
        dailyGoalReached: false,
        completedQuotes: 0,
        targetQuotes: 0,
        targetWordCount: 0,
        timeLimitSeconds: 0,
        timeRemaining: 0,
        timerInterval: 0,
        sessionEnding: false,
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
        replacementBurstTimer: 0,
        replacementIndex: -1,
        reportedPracticeIndices: new Set()
    };

    let statsInterval;
    const PROGRESS_STORAGE_KEY = 'steno_practice_progress_v1';
    const MAX_PRACTICE_LIST_WORDS = 5000;
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
        const normalizeDailyGoal = (value, fallback, max) => {
            if (value === undefined || value === null || value === '') return fallback;
            const numericValue = Number(value);
            return Number.isFinite(numericValue) ? Math.max(0, Math.min(max, numericValue)) : fallback;
        };
        progress.sessions = (Array.isArray(progress.sessions) ? progress.sessions : [])
            .filter(session => Number(session.words) > 0 || Number(session.durationSeconds) > 0).slice(-MAX_PROGRESS_SESSIONS);
        progress.quoteHistory = (Array.isArray(progress.quoteHistory) ? progress.quoteHistory : [])
            .filter(entry => entry && typeof entry.quote === 'string' && typeof entry.date === 'string')
            .slice(-500);
        progress.dailyGoalQuotes = normalizeDailyGoal(progress.dailyGoalQuotes, 5, 100);
        progress.dailyGoalWords = normalizeDailyGoal(progress.dailyGoalWords, 100, 50000);
        progress.dailyGoalJeffPhrases = normalizeDailyGoal(progress.dailyGoalJeffPhrases, 10, 50000);
        progress.dailyGoalNumbers = normalizeDailyGoal(progress.dailyGoalNumbers, 10, 50000);
        progress.dailyGoalSymbols = normalizeDailyGoal(progress.dailyGoalSymbols, 25, 50000);
        progress.dailyGoalProblematic = normalizeDailyGoal(progress.dailyGoalProblematic, 10, 50000);
        progress.dailyGoalBriefs = normalizeDailyGoal(progress.dailyGoalBriefs, 10, 50000);
        progress.dailyGoalAccuracy = normalizeDailyGoal(progress.dailyGoalAccuracy, 5, 50000);
        const problematicEntries = Object.entries(progress.problematic && typeof progress.problematic === 'object' ? progress.problematic : {})
            .slice(0, MAX_PRACTICE_LIST_WORDS);
        progress.problematic = Object.fromEntries(problematicEntries);
        const briefEntries = Object.entries(progress.briefs && typeof progress.briefs === 'object' ? progress.briefs : {})
            .slice(0, MAX_PRACTICE_LIST_WORDS);
        progress.briefs = Object.fromEntries(briefEntries);
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

    function getPracticeDateKey(value = new Date()) {
        const date = value instanceof Date ? value : new Date(value);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function getTodaysQuoteCount(progress = getPersistentProgress()) {
        const today = getPracticeDateKey();
        return progress.quoteHistory.filter(entry => getPracticeDateKey(entry.date) === today).length;
    }

    function getTodaysWordCount(progress = getPersistentProgress()) {
        const today = getPracticeDateKey();
        const savedWords = progress.sessions.reduce((total, session) =>
            getPracticeDateKey(session.date) === today ? total + (Number(session.words) || 0) : total, 0);
        if (!practiceState.sessionStartTime || practiceState.sessionEnding ||
            document.getElementById('practiceArena')?.style.display === 'none') return savedWords;
        return savedWords + practiceState.statsIndex;
    }

    function getTodaysModeCount(mode, progress = getPersistentProgress()) {
        const today = getPracticeDateKey();
        const isJeffPhrasing = mode === 'jeff-phrasing';
        const savedCount = progress.sessions.reduce((total, session) =>
            session.testMode === mode && getPracticeDateKey(session.date) === today
                ? total + (Number(isJeffPhrasing ? (session.phrases ?? session.words) : session.words) || 0)
                : total, 0);
        const active = practiceState.sessionStartDate
            && practiceState.testMode === mode
            && !practiceState.sessionEnding
            && document.getElementById('practiceArena')?.style.display !== 'none';
        const activeCount = isJeffPhrasing
            ? Math.min(practiceState.currentIndex, practiceState.words.length)
            : practiceState.statsIndex;
        return savedCount + (active ? activeCount : 0);
    }

    function getTodaysHighAccuracySessionCount(progress = getPersistentProgress()) {
        const today = getPracticeDateKey();
        return progress.sessions.filter(session =>
            getPracticeDateKey(session.date) === today
            && Number(session.words) > 0
            && Number(session.acc) > 95
        ).length;
    }

    const WPM_MILESTONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 225, 250];

    function renderWpmMilestones(bestWpm) {
        const container = document.getElementById('wpmMilestones');
        if (!container) return;
        container.setAttribute('aria-valuemin', '0');
        container.setAttribute('aria-valuemax', '250');
        container.setAttribute('aria-valuenow', String(Math.min(250, Math.round(bestWpm))));
        container.innerHTML = WPM_MILESTONES.map((milestone, index) => {
            const step = milestone - (WPM_MILESTONES[index - 1] || 0);
            const reached = bestWpm >= milestone;
            return `<div class="wpm-milestone-step" style="--milestone-step:${step}"><span class="wpm-milestone${reached ? ' is-reached' : ''}" aria-label="${milestone} words per minute${reached ? ', reached' : ''}">${milestone}</span></div>`;
        }).join('');
    }

    function updateWpmMilestoneProgress(bestWpm) {
        const container = document.getElementById('wpmMilestones');
        if (!container) return;
        container.setAttribute('aria-valuenow', String(Math.min(250, Math.round(bestWpm))));
        container.querySelectorAll('.wpm-milestone').forEach(milestone => {
            const value = Number(milestone.textContent);
            const reached = bestWpm >= value;
            milestone.classList.toggle('is-reached', reached);
            milestone.setAttribute('aria-label', `${value} words per minute${reached ? ', reached' : ''}`);
        });
    }

    function updateDailyGoalProgress(progress = getPersistentProgress()) {
        const quoteInput = document.getElementById('dailyGoalInput');
        const wordInput = document.getElementById('dailyGoalWordsInput');
        const quoteGoal = Math.max(0, Math.min(100, Number(quoteInput?.value ?? progress.dailyGoalQuotes) || 0));
        const wordGoal = Math.max(0, Math.min(50000, Number(wordInput?.value ?? progress.dailyGoalWords) || 0));
        const todayQuotes = getTodaysQuoteCount(progress);
        const todayWords = getTodaysWordCount(progress);
        const accuracyInput = document.getElementById('dailyGoalAccuracyInput');
        const accuracyGoal = Math.max(0, Math.min(50000, Number(accuracyInput?.value ?? progress.dailyGoalAccuracy) || 0));
        const todayHighAccuracySessions = getTodaysHighAccuracySessionCount(progress);
        const quotesComplete = todayQuotes >= quoteGoal;
        const wordsComplete = todayWords >= wordGoal;
        const accuracyComplete = todayHighAccuracySessions >= accuracyGoal;
        const quoteTotal = document.getElementById('dailyGoalTotal');
        const quoteComplete = document.getElementById('dailyGoalComplete');
        const wordsTotal = document.getElementById('dailyGoalWordsTotal');
        const wordsCompleteEl = document.getElementById('dailyGoalWordsComplete');
        const quoteSummary = document.getElementById('dailyGoalQuoteSummary');
        const quoteSkipped = document.getElementById('dailyGoalQuoteSkipped');
        const wordsSummary = document.getElementById('dailyGoalWordsSummary');
        const wordsSkipped = document.getElementById('dailyGoalWordsSkipped');
        const quoteBar = document.getElementById('dailyGoalBar');
        const wordsBar = document.getElementById('dailyGoalWordsBar');
        const quoteTrack = document.getElementById('dailyGoalQuoteTrack');
        const wordsTrack = document.getElementById('dailyGoalWordsTrack');
        const message = document.getElementById('dailyGoalMessage');
        const startButton = document.getElementById('startDailyGoalButton');
        const accuracyProgress = document.getElementById('dailyGoalAccuracyProgress');
        const accuracyBar = document.getElementById('dailyGoalAccuracyBar');
        const accuracyTrack = document.getElementById('dailyGoalAccuracyTrack');
        const modeGoals = [
            { key: 'Problematic', mode: 'problematic', goal: progress.dailyGoalProblematic, label: 'problematic word', list: 'problematic' },
            { key: 'Briefs', mode: 'briefs', goal: progress.dailyGoalBriefs, label: 'brief', list: 'briefs' },
            { key: 'Numbers', mode: 'numbers', goal: progress.dailyGoalNumbers, label: 'number group' },
            { key: 'Symbols', mode: 'symbols', goal: progress.dailyGoalSymbols, label: 'symbol' },
            { key: 'JeffPhrases', mode: 'jeff-phrasing', goal: progress.dailyGoalJeffPhrases, label: 'Jeff phrase' }
        ];
        let allModeGoalsComplete = true;
        const remainingModeGoals = [];
        modeGoals.forEach(({ key, mode, goal, label, list }) => {
            const goalValue = Math.max(0, Math.min(50000, Number(goal) || 0));
            const count = getTodaysModeCount(mode, progress);
            const listEmpty = list && Object.keys(progress[list] || {}).length === 0;
            const skipped = goalValue === 0;
            const percent = listEmpty || skipped ? 100 : Math.min(100, count / goalValue * 100);
            const complete = listEmpty || skipped || count >= goalValue;
            allModeGoalsComplete = allModeGoalsComplete && complete;
            if (!complete) remainingModeGoals.push(`${Math.max(0, goalValue - count).toLocaleString()} ${label}${goalValue - count === 1 ? '' : 's'}`);
            const progressText = document.getElementById(`dailyGoal${key}Progress`);
            const bar = document.getElementById(`dailyGoal${key}Bar`);
            const track = document.getElementById(`dailyGoal${key}Track`);
            if (progressText) progressText.textContent = skipped
                ? 'Skipped · complete'
                : listEmpty ? 'No items · complete' : `${count.toLocaleString()} / ${goalValue.toLocaleString()}`;
            if (bar) bar.style.width = `${percent}%`;
            if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
        });
        const accuracyPercent = accuracyGoal === 0 ? 100 : Math.min(100, todayHighAccuracySessions / accuracyGoal * 100);
        if (accuracyProgress) accuracyProgress.textContent = accuracyGoal === 0 ? 'Skipped · complete' : `${todayHighAccuracySessions} / ${accuracyGoal}`;
        if (accuracyBar) accuracyBar.style.width = `${accuracyPercent}%`;
        if (accuracyTrack) accuracyTrack.setAttribute('aria-valuenow', String(Math.round(accuracyPercent)));
        const quotePercent = quoteGoal === 0 ? 100 : Math.min(100, todayQuotes / quoteGoal * 100);
        const wordsPercent = wordGoal === 0 ? 100 : Math.min(100, todayWords / wordGoal * 100);
        if (quoteBar) quoteBar.style.width = `${quotePercent}%`;
        if (wordsBar) wordsBar.style.width = `${wordsPercent}%`;
        if (quoteTrack) quoteTrack.setAttribute('aria-valuenow', String(Math.round(quotePercent)));
        if (wordsTrack) wordsTrack.setAttribute('aria-valuenow', String(Math.round(wordsPercent)));
        if (quoteTotal) quoteTotal.textContent = quoteGoal;
        if (wordsTotal) wordsTotal.textContent = wordGoal.toLocaleString();
        if (quoteComplete) quoteComplete.textContent = todayQuotes;
        if (wordsCompleteEl) wordsCompleteEl.textContent = todayWords.toLocaleString();
        if (quoteSummary) quoteSummary.hidden = quoteGoal === 0;
        if (quoteSkipped) quoteSkipped.hidden = quoteGoal !== 0;
        if (wordsSummary) wordsSummary.hidden = wordGoal === 0;
        if (wordsSkipped) wordsSkipped.hidden = wordGoal !== 0;
        if (message) {
            if (quotesComplete && wordsComplete && allModeGoalsComplete && accuracyComplete) {
                message.textContent = 'All daily goals reached! Press Enter after a quote to keep practicing, or Esc to finish.';
            } else {
                const remainingQuotes = Math.max(0, quoteGoal - todayQuotes);
                const remainingWords = Math.max(0, wordGoal - todayWords);
                if (!accuracyComplete) remainingModeGoals.push(`${accuracyGoal - todayHighAccuracySessions} high-accuracy section${accuracyGoal - todayHighAccuracySessions === 1 ? '' : 's'}`);
                const modeGoalsMessage = remainingModeGoals.length ? ` · ${remainingModeGoals.join(', ')} left` : '';
                message.textContent = `${remainingQuotes} quote${remainingQuotes === 1 ? '' : 's'} and ${remainingWords.toLocaleString()} word${remainingWords === 1 ? '' : 's'} left${modeGoalsMessage}.`;
            }
        }
        if (startButton) {
            startButton.disabled = quotesComplete && wordsComplete && allModeGoalsComplete && accuracyComplete;
            startButton.textContent = startButton.disabled ? 'Goal complete' : 'Practice goal';
        }
        return { quoteGoal, wordGoal, todayQuotes, todayWords, quotesComplete, wordsComplete, allModeGoalsComplete, accuracyGoal, todayHighAccuracySessions, accuracyComplete };
    }

    function renderPracticeDashboard() {
        const progress = getPersistentProgress();
        const goalInput = document.getElementById('dailyGoalInput');
        if (goalInput && document.activeElement !== goalInput) goalInput.value = progress.dailyGoalQuotes;
        const wordGoalInput = document.getElementById('dailyGoalWordsInput');
        if (wordGoalInput && document.activeElement !== wordGoalInput) wordGoalInput.value = progress.dailyGoalWords;
        [
            ['dailyGoalJeffPhrasesInput', progress.dailyGoalJeffPhrases],
            ['dailyGoalNumbersInput', progress.dailyGoalNumbers],
            ['dailyGoalSymbolsInput', progress.dailyGoalSymbols],
            ['dailyGoalProblematicInput', progress.dailyGoalProblematic],
            ['dailyGoalBriefsInput', progress.dailyGoalBriefs],
            ['dailyGoalAccuracyInput', progress.dailyGoalAccuracy]
        ].forEach(([id, value]) => {
            const input = document.getElementById(id);
            if (input && document.activeElement !== input) input.value = value;
        });
        updateDailyGoalProgress(progress);

        const sessions = progress.sessions;
        const days = new Set(sessions.map(session => getPracticeDateKey(session.date))).size;
        const bestWpm = sessions.reduce((best, session) => Math.max(best, Number(session.wpm) || 0), 0);
        practiceState.personalBestWpm = bestWpm;
        const bestAccuracy = sessions.reduce((best, session) => Math.max(best, Number(session.acc) || 0), 0);
        const totalQuotes = progress.quoteHistory.length;
        document.getElementById('dashboardDays').textContent = days;
        document.getElementById('dashboardQuotes').textContent = totalQuotes;
        document.getElementById('dashboardBestWpm').textContent = bestWpm;
        document.getElementById('dashboardBestAccuracy').textContent = `${bestAccuracy.toFixed(2)}%`;
        const average = key => sessions.length
            ? sessions.reduce((total, session) => total + (Number(session[key]) || 0), 0) / sessions.length
            : 0;
        const longestStreak = sessions.length
            ? Math.max(...sessions.map(session => Number(session.longestStreak) || 0))
            : 0;
        document.getElementById('dashboardWords').textContent =
            sessions.reduce((total, session) => total + (Number(session.words) || 0), 0).toLocaleString();
        document.getElementById('dashboardAverageWpm').textContent = Math.round(average('wpm'));
        document.getElementById('dashboardAverageAccuracy').textContent =
            `${sessions.length ? average('acc').toFixed(2) : '0.00'}%`;
        document.getElementById('dashboardAverageStrokes').textContent = average('avgStr').toFixed(2);
        document.getElementById('dashboardLongestStreak').textContent = longestStreak.toLocaleString();
        renderWpmMilestones(bestWpm);

        const records = [
            ['quote', 'Quote'],
            ['time', 'Time'],
            ['words', 'Words'],
            ['quotes', 'Quote count'],
            ['daily', 'Daily goal'],
            ['numbers', 'Numbers'],
            ['symbols', 'Common symbols'],
            ['jeff-phrasing', 'Jeff Phrasing'],
            ['problematic', 'Problematic words'],
            ['briefs', 'My briefs'],
            ['lesson', 'Lessons']
        ];
        document.getElementById('modeRecords').innerHTML = records.map(([mode, label]) => {
            const modeSessions = sessions.filter(session => (session.testMode || 'lesson') === mode);
            const record = modeSessions.reduce((best, session) => (Number(session.wpm) || 0) > (Number(best?.wpm) || 0) ? session : best, null);
            const variant = record?.testVariant || '';
            let variantLabel = '';
            if (variant.startsWith('time-')) variantLabel = variant.slice(5);
            else if (variant.startsWith('words-')) variantLabel = `${variant.slice(6)} words`;
            else if (variant.startsWith('quotes-')) variantLabel = variant.slice(7).replace('-', ' · ');
            else if (variant.startsWith('quote-')) variantLabel = variant.slice(6);
            else if (variant.startsWith('jeff-phrasing-')) variantLabel = `${variant.slice(14)} phrases`;
            const suffix = variantLabel ? ` · ${escapeHtml(variantLabel)}` : '';
            return `<div class="mode-record"><span>${label}</span><strong>${record ? `${Number(record.wpm) || 0} WPM${suffix} · ${(Number(record.acc) || 0).toFixed(1)}%` : '—'}</strong></div>`;
        }).join('');

        const lessonRecords = new Map();
        sessions.forEach(session => {
            if (session.testMode !== 'lesson' || typeof session.lessonId !== 'string' || !session.lessonId.startsWith('lessons/')) return;
            const record = lessonRecords.get(session.lessonId) || {
                attempts: 0,
                words: 0,
                bestWpm: 0,
                bestAccuracy: 0,
                lastPractice: session.date
            };
            record.attempts++;
            record.words += Number(session.words) || 0;
            record.bestWpm = Math.max(record.bestWpm, Number(session.wpm) || 0);
            record.bestAccuracy = Math.max(record.bestAccuracy, Number(session.acc) || 0);
            if (new Date(session.date) > new Date(record.lastPractice)) record.lastPractice = session.date;
            lessonRecords.set(session.lessonId, record);
        });
        const sortedLessonRecords = [...lessonRecords.entries()].sort((a, b) =>
            new Date(b[1].lastPractice) - new Date(a[1].lastPractice));
        const lessonRecordCount = document.getElementById('lessonRecordCount');
        const lessonRecordList = document.getElementById('lessonRecordList');
        if (lessonRecordCount) lessonRecordCount.textContent = sortedLessonRecords.length;
        if (lessonRecordList) {
            lessonRecordList.innerHTML = sortedLessonRecords.length
                ? sortedLessonRecords.map(([lessonId, record]) => {
                    const title = getLessonTitle(lessonId);
                    return `<div class="mode-record"><span>${escapeHtml(title)}</span><strong>${record.attempts} session${record.attempts === 1 ? '' : 's'} · ${record.words} words · ${record.bestWpm} WPM · ${record.bestAccuracy.toFixed(1)}% best</strong></div>`;
                }).join('')
                : '<div class="quote-history-empty">Complete a built-in lesson to see its individual records here.</div>';
        }

        const history = progress.quoteHistory.slice(-30).reverse();
        document.getElementById('quoteHistoryCount').textContent = history.length;
        document.getElementById('quoteHistoryList').innerHTML = history.length
            ? history.map(entry => {
                const metrics = Number.isFinite(Number(entry.wpm))
                    ? `<span class="quote-history-metrics">${Number(entry.wpm)} WPM · ${(Number(entry.accuracy) || 0).toFixed(1)}% · ${(Number(entry.avgStrokes) || 0).toFixed(2)} strokes/word · ${Number(entry.words) || 0} words</span>`
                    : '<span class="quote-history-metrics">Stats unavailable for this older entry</span>';
                return `<article class="quote-history-item"><blockquote>${escapeHtml(entry.quote)}</blockquote><time>${new Date(entry.date).toLocaleString()}</time><span>${escapeHtml(entry.mode || 'quote')}</span>${metrics}</article>`;
            }).join('')
            : '<div class="quote-history-empty">Your completed quotes will appear here.</div>';

        const latestSession = sessions[sessions.length - 1];
        document.getElementById('dashboardLastPractice').textContent = latestSession
            ? `Last practice ${new Date(latestSession.date).toLocaleDateString()}`
            : 'Ready when you are';
    }

    function handleDailyGoalChange(event) {
        const input = event?.currentTarget || document.getElementById('dailyGoalInput');
        if (!input) return;
        const progress = getPersistentProgress();
        const goalFields = {
            dailyGoalInput: ['dailyGoalQuotes', 5, 100],
            dailyGoalWordsInput: ['dailyGoalWords', 100, 50000],
            dailyGoalJeffPhrasesInput: ['dailyGoalJeffPhrases', 10, 50000],
            dailyGoalNumbersInput: ['dailyGoalNumbers', 10, 50000],
            dailyGoalSymbolsInput: ['dailyGoalSymbols', 25, 50000],
            dailyGoalProblematicInput: ['dailyGoalProblematic', 10, 50000],
            dailyGoalBriefsInput: ['dailyGoalBriefs', 10, 50000],
            dailyGoalAccuracyInput: ['dailyGoalAccuracy', 5, 50000]
        };
        const [key, fallback, max] = goalFields[input.id] || [];
        if (!key) return;
        const value = input.value === '' ? fallback : Number(input.value);
        progress[key] = Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
        input.value = progress[key];
        savePersistentProgress(progress);
        renderPracticeDashboard();
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
        if (!progress.problematic[word] && Object.keys(progress.problematic).length >= MAX_PRACTICE_LIST_WORDS) return;
        const entry = progress.problematic[word] || { errors: 0, correct: 0 };
        entry.errors++;
        entry.correct = 0;
        progress.problematic[word] = entry;
        savePersistentProgress(progress);
    }

    async function getWordStrokeChoices(word) {
        if (!db) return [];
        return new Promise(resolve => {
            const request = db.transaction('entries', 'readonly').objectStore('entries').index('word_lower').getAll(IDBKeyRange.only(word.toLowerCase()));
            request.onsuccess = event => {
                const activeIds = new Set(dictionaries.map(dictionary => dictionary.id));
                resolve([...new Set(event.target.result.filter(entry => activeIds.has(entry.dictId)).map(entry => entry.stroke))]);
            };
            request.onerror = () => resolve([]);
        });
    }

    function removePracticeListWord(listName, word) {
        openModal('Remove Practice Word', `Remove "${word}" from your ${listName === 'briefs' ? 'briefs' : 'problematic words'}?`, () => {
            const progress = getPersistentProgress();
            delete progress[listName][word];
            savePersistentProgress(progress);
            renderPersistentProblemWords();
        });
    }

    function clearPracticeList(listName) {
        const displayName = listName === 'briefs' ? 'My Briefs' : 'Problematic Words';
        openModal('Clear Practice List', `Are you sure you want to clear the entire ${displayName} list? This cannot be undone.`, () => {
            const progress = getPersistentProgress();
            progress[listName] = {};
            savePersistentProgress(progress);
            renderPersistentProblemWords();
        });
    }

    function addBrief(word, stroke, button) {
        const progress = getPersistentProgress();
        const isAlreadyBrief = Boolean(progress.briefs[word]);
        if (isAlreadyBrief) delete progress.briefs[word];
        else {
            if (Object.keys(progress.briefs).length >= MAX_PRACTICE_LIST_WORDS) return;
            progress.briefs[word] = { stroke };
        }
        savePersistentProgress(progress);
        if (button) {
            button.textContent = isAlreadyBrief ? 'Add to briefs list' : 'Included in briefs list';
            button.disabled = false;
        }
        renderPersistentProblemWords();
    }

    function searchPracticeWord(word) {
        setSearchMode('word');
        const input = document.getElementById('searchInput');
        input.value = word;
        switchTab('search');
        triggerSearch();
        input.focus();
    }

    async function changePracticeStroke(listName, word, stroke) {
        if (!stroke) return;
        const progress = getPersistentProgress();
        if (listName === 'briefs') progress.briefs[word] = { stroke };
        else progress.problematic[word].stroke = stroke;
        savePersistentProgress(progress);
        renderPersistentProblemWords();
    }

    function getPracticeAccuracy() {
        const attemptedIndices = new Set([
            ...practiceState.correctPracticeIndices,
            ...practiceState.incorrectWordIndices
        ]);
        const attemptedWords = Array.from(attemptedIndices).reduce((total, index) => {
            return total + (practiceState.wordUnitCounts[index] ?? 1);
        }, 0);
        if (attemptedWords === 0) return 0;

        const correctWords = Array.from(practiceState.correctPracticeIndices)
            .filter(index => !practiceState.incorrectWordIndices.has(index))
            .reduce((total, index) => {
                return total + (practiceState.wordUnitCounts[index] ?? 1);
            }, 0);
        return (correctWords / attemptedWords) * 100;
    }

    function refreshPracticeAccuracy() {
        const accuracy = getPracticeAccuracy();
        
        const liveAccuracy = document.getElementById('liveAcc');
        if (liveAccuracy) liveAccuracy.innerText = accuracy.toFixed(2) + '%';
        
        return accuracy;
    }

    function recordPracticeMistake(index) {
        const word = practiceState.words[index];
        const limits = practiceState.maxStrokesMap[word] || { min: 1, max: 1 };
        const targetStrokes = practiceState.hintType === 'longest'
            ? (limits.max || limits.min || 1)
            : (limits.min || limits.max || 1);
        if ((practiceState.strokeCounts[index] || 0) <= targetStrokes) return;
        if (practiceState.correctPracticeIndices.has(index) || practiceState.mistakePracticeIndices.has(index)) return;
        practiceState.mistakePracticeIndices.add(index);
        practiceState.currentStreak = 0;
        playPracticeFeedback('miss');
        refreshPracticeAccuracy();
    }

    function recordCompletedPracticeWord(index, typedValue) {
        if (practiceState.reportedPracticeIndices.has(index)) return;
        practiceState.reportedPracticeIndices.add(index);

        const word = practiceState.words[index];
        const typed = typedValue || '';
        const wasAlreadyMissed = practiceState.mistakePracticeIndices.has(index);
        const limits = practiceState.maxStrokesMap[word] || { min: 1, max: 1 };
        const targetStrokes = practiceState.hintType === 'longest'
            ? (limits.max || limits.min || 1)
            : (limits.min || limits.max || 1);
        const missed = wasAlreadyMissed || (practiceState.strokeCounts[index] || 0) > targetStrokes;
        if (missed) {
            practiceState.eraseErrorWords.add(word);
            if (!wasAlreadyMissed) registerProblemPracticeWord(word);
            practiceState.currentStreak = 0;
        } else {
            registerCorrectPracticeWord(word);
            practiceState.currentStreak += practiceState.wordUnitCounts[index] || 1;
            practiceState.longestStreak = Math.max(practiceState.longestStreak, practiceState.currentStreak);
        }

        practiceState.wordScores[index] = !missed ? 1 : 0;
        if (missed) recordPracticeMistake(index);
        if (normalizeForComparison(typed) === normalizeForComparison(word)) {
            practiceState.correctPracticeIndices.add(index);
        }
        if (practiceState.wordScores[index]) playPracticeFeedback('correct');
        refreshPracticeAccuracy();
    }

    let persistentProblemRenderVersion = 0;

    async function renderPersistentProblemWords() {
        const renderVersion = ++persistentProblemRenderVersion;
        const progress = getPersistentProgress();
        const profile = settings.profiles[settings.activeProfile];
        const hintType = document.getElementById('strokeHintType')?.value || 'shortest';
        const lists = [
            { name: 'problematic', elementId: 'persistentProblematicWords', countId: 'problematicWordCount' },
            { name: 'briefs', elementId: 'persistentBriefWords', countId: 'briefWordCount' }
        ];

        await Promise.all(lists.map(async ({ name, elementId, countId }) => {
            const list = document.getElementById(elementId);
            const count = document.getElementById(countId);
            if (!list) return;
            const entries = progress[name] || {};
            const words = Object.keys(entries);
            if (count) count.textContent = words.length.toLocaleString();
            if (!words.length) {
                list.innerHTML = '<div class="quote-history-empty">None yet.</div>';
                return;
            }
            const cards = [];
            const limitsByWord = await Promise.all(words.map(async word => {
                const cachedLimits = practiceState.maxStrokesMap[word];
                const hasStroke = cachedLimits && (cachedLimits.shortest || cachedLimits.longest);
                const limits = hasStroke ? cachedLimits : await getStrokeLimitsAndOutlines(word);
                return [word, limits];
            }));
            if (renderVersion !== persistentProblemRenderVersion) return;
            for (const [word, limits] of limitsByWord) {
                practiceState.maxStrokesMap[word] = limits;
                const stroke = entries[word].stroke || (hintType === 'longest'
                    ? (limits.longest || limits.shortest || '')
                    : (limits.shortest || limits.longest || ''));
                const choices = await getWordStrokeChoices(word);
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
                const strokeOptions = choices.length ? `<label class="practice-stroke-picker"><select class="profile-select" aria-label="Choose outline" onchange="changePracticeStroke(${escapeInlineJson(name)}, ${escapeInlineJson(word)}, this.value)">${choices.map(choice => `<option value="${escapeHtml(choice)}" ${choice === stroke ? 'selected' : ''}>${escapeHtml(choice)}</option>`).join('')}</select></label>` : '';
                const counter = name === 'problematic' ? `Errors: ${entries[word].errors || 0} | Correct: ${entries[word].correct || 0}/5` : 'My Brief';
                cards.push(`<div class="dict-card practice-list-card"><div class="practice-list-top"><div class="dict-name">${escapeHtml(word)}</div><div class="practice-list-actions"><button class="practice-search-word" title="Look up this word in the dictionary" onclick="searchPracticeWord(${escapeInlineJson(word)})">Search</button>${strokeOptions}<button class="practice-remove" title="Remove from practice list" onclick="removePracticeListWord(${escapeInlineJson(name)}, ${escapeInlineJson(word)})">X</button></div></div><div style="width:100%;">${outline}<div class="practice-list-bottom"><div class="dict-priority">${counter}</div></div></div></div>`);
            }
            if (renderVersion === persistentProblemRenderVersion) list.innerHTML = cards.join('');
        }));
    }

    function switchTab(tab) {
        const isSearch = tab === 'search';
        document.getElementById('searchView').style.display = isSearch ? 'block' : 'none';
        document.getElementById('practiceView').style.display = isSearch ? 'none' : 'block';
        const searchTab = document.getElementById('searchTab');
        const practiceTab = document.getElementById('practiceTab');
        searchTab.classList.toggle('active', isSearch);
        practiceTab.classList.toggle('active', !isSearch);
        searchTab.setAttribute('aria-selected', String(isSearch));
        practiceTab.setAttribute('aria-selected', String(!isSearch));
        searchTab.tabIndex = isSearch ? 0 : -1;
        practiceTab.tabIndex = isSearch ? -1 : 0;
        if (!isSearch) {
            updatePracticeTestControls();
            renderPracticeDashboard();
            drawPersistentProgressGraph();
        }
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

    function isContinuousQuoteMode() {
        return practiceState.testMode === 'quote' || practiceState.testMode === 'daily';
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
        resetSavedMaterialSelection();
        clearSavedMaterialTitle();
        document.getElementById('practiceMaterial').value = getRandomPracticeQuote(quotes, source);
        document.getElementById('lessonSelect').value = 'custom';
        document.getElementById('practiceTestMode').value = 'lesson';
        updatePracticeTestControls();
        settings.profiles[settings.activeProfile].practiceLesson = 'custom';
        document.getElementById('newQuoteButton').classList.remove('hidden');
        savePracticeSettingsForProfile();
        updatePracticeEstimate();
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
            resetSavedMaterialSelection();
            if (select.value !== 'custom') select.value = 'custom';
            document.getElementById('newQuoteButton').classList.add('hidden');
            document.getElementById('practiceTestMode').value = 'lesson';
            updatePracticeTestControls();
            settings.profiles[settings.activeProfile].practiceLesson = 'custom';
            settings.profiles[settings.activeProfile].practiceMaterial = material.value;
            localStorage.setItem('ploverSettings', JSON.stringify(settings));
            updatePracticeEstimate();
        });

        const quoteLanguage = document.getElementById('quoteLanguage');
        quoteLanguage.addEventListener('change', () => {
            settings.profiles[settings.activeProfile].quoteLanguage = quoteLanguage.value;
            saveSettings();
            document.getElementById('newQuoteButton').classList.toggle('hidden', !quoteLanguage.value);
        });

        ['practiceTestMode', 'practiceQuoteLength', 'practiceTestDuration', 'practiceTestWords', 'practiceTestQuotes', 'practiceNumberGroups', 'practiceNumberDigits', 'practiceNumberFormat', 'practiceSymbolCount', 'jeffPhraseCount', 'jeffPhraseForm'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('change', () => {
                savePracticeSettingsForProfile();
                updatePracticeTestControls();
            });
        });
        ['dailyGoalInput', 'dailyGoalWordsInput', 'dailyGoalJeffPhrasesInput', 'dailyGoalNumbersInput', 'dailyGoalSymbolsInput', 'dailyGoalProblematicInput', 'dailyGoalBriefsInput', 'dailyGoalAccuracyInput'].forEach(id => {
            const input = document.getElementById(id);
            input.addEventListener('change', handleDailyGoalChange);
            input.addEventListener('input', () => updateDailyGoalProgress());
        });

        ['practiceMode', 'strokeHintType', 'strokeVisibility', 'practiceRepeats', 'practiceMaxWords', 'practiceProblemWords', 'practiceBriefWords', 'practiceStartWord', 'practiceEndWord'].forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            input.addEventListener('input', savePracticeSettingsForProfile);
            input.addEventListener('change', savePracticeSettingsForProfile);
            input.addEventListener('input', updatePracticeEstimate);
            input.addEventListener('change', updatePracticeEstimate);
        });
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
        renderPracticeDashboard();
        document.getElementById('savedMaterialSelect')?.addEventListener('change', event => {
            if (event.target.value !== '') loadSavedMaterial(event.target.value);
            renderSavedMaterials();
        });
        updatePracticeEstimate();

        select.addEventListener('change', async () => {
            resetSavedMaterialSelection();
            clearSavedMaterialTitle();
            document.getElementById('newQuoteButton').classList.add('hidden');
            document.getElementById('practiceTestMode').value = 'lesson';
            updatePracticeTestControls();
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
                    savePracticeSettingsForProfile();
                    updatePracticeEstimate();
                }
                select.disabled = false;
                return;
            }
            if (select.value === 'problematic') {
                material.value = await getPracticeListMaterial('problematic');
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
                select.disabled = false;
                return;
            }
            if (select.value === 'briefs') {
                material.value = await getPracticeListMaterial('briefs');
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
                select.disabled = false;
                return;
            }
            select.disabled = true;
            try {
                const response = await fetch(select.value, { cache: 'no-cache' });
                if (!response.ok) throw new Error('Lesson file unavailable.');
                material.value = await readLessonResponse(response);
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
            } catch (error) {
                alert('Unable to load that lesson.');
                select.value = 'custom';
            } finally {
                select.disabled = false;
            }
        });
    }

    window.addEventListener('load', loadLessons);

    async function getPracticeListMaterial(listName) {
        const entries = getPersistentProgress()[listName] || {};
        const lines = [];
        for (const word of Object.keys(entries)) {
            const entry = entries[word] || {};
            const stroke = entry.stroke || (await getStrokeLimitsAndOutlines(word)).shortest;
            lines.push(`${word}\t${stroke || ''}`);
        }
        return lines.join('\n');
    }

    function getCurrentPracticeQueue() {
        const material = document.getElementById('practiceMaterial')?.value || '';
        const mode = document.getElementById('practiceMode')?.value || 'random';
        let words = generatePracticeQueue(material, mode);
        let requestedLength = words.length;

        const repeats = Math.max(0, parseInt(document.getElementById('practiceRepeats')?.value || '0', 10) || 0);
        requestedLength *= repeats + 1;
        words = repeatPracticeWords(words, repeats);

        if (settings.profiles[settings.activeProfile].ignorePunct) {
            words = words.filter(word => !isPracticePunctuation(word));
        }

        const maxWords = Math.max(0, parseInt(document.getElementById('practiceMaxWords')?.value || '0', 10) || 0);
        if (maxWords > 0) {
            requestedLength = Math.min(requestedLength, maxWords);
            words = words.slice(0, maxWords);
        }
        words = capPracticeQueue(words);

        const problemWordCount = Math.max(0, parseInt(document.getElementById('practiceProblemWords')?.value || '0', 10) || 0);
        const problematicWords = Object.keys(getPersistentProgress().problematic);
        const injectedProblemWords = getRandomPracticeListWords(problematicWords, problemWordCount);
        requestedLength += injectedProblemWords.length;
        for (const word of injectedProblemWords) {
            if (words.length >= MAX_PRACTICE_WORDS) break;
            words.push(word);
        }

        const briefWordCount = Math.max(0, parseInt(document.getElementById('practiceBriefWords')?.value || '0', 10) || 0);
        const briefWords = Object.keys(getPersistentProgress().briefs || {});
        const injectedBriefWords = getRandomPracticeListWords(briefWords, briefWordCount);
        requestedLength += injectedBriefWords.length;
        for (const word of injectedBriefWords) {
            if (words.length >= MAX_PRACTICE_WORDS) break;
            words.push(word);
        }
        words = capPracticeQueue(words);

        const start = Math.max(1, parseInt(document.getElementById('practiceStartWord')?.value || '1', 10) || 1);
        const end = parseInt(document.getElementById('practiceEndWord')?.value || '0', 10) || 0;
        const rangeEnd = end > 0 ? end : words.length;
        words = words.slice(start - 1, rangeEnd);
        const requestedRangeEnd = end > 0 ? end : requestedLength;
        const cappedWords = capPracticeQueue(words);
        cappedWords.requestedLength = Math.max(0, Math.min(requestedLength, requestedRangeEnd) - start + 1);
        return cappedWords;
    }

    function updatePracticeCapWarning() {
        const warning = document.getElementById('practiceCapWarning');
        if (!warning) return;

        const queue = getCurrentPracticeQueue();
        const triggered = queue.requestedLength > MAX_PRACTICE_WORDS;

        warning.hidden = !triggered;
        warning.textContent = 'Exercise capped at 50,000 words. It cannot go above this limit.';
    }

    function updatePracticeEstimate() {
        const estimate = document.getElementById('practiceEstimate');
        if (!estimate) return;
        const material = document.getElementById('practiceMaterial')?.value || '';
        const mode = document.getElementById('practiceMode')?.value || 'random';
        let words = generatePracticeQueue(material, mode);
        const repeats = Math.max(0, parseInt(document.getElementById('practiceRepeats')?.value || '0', 10) || 0);
        words = repeatPracticeWords(words, repeats);
        if (settings.profiles[settings.activeProfile].ignorePunct) {
            words = words.filter(word => !isPracticePunctuation(word));
        }
        const maxWords = Math.max(0, parseInt(document.getElementById('practiceMaxWords')?.value || '0', 10) || 0);
        if (maxWords > 0) words = words.slice(0, maxWords);
        words = capPracticeQueue(words);
        const problemWordCount = Math.max(0, parseInt(document.getElementById('practiceProblemWords')?.value || '0', 10) || 0);
        const problematicWords = Object.keys(getPersistentProgress().problematic);
        for (const word of getRandomPracticeListWords(problematicWords, problemWordCount)) {
            if (words.length >= MAX_PRACTICE_WORDS) break;
            words.push(word);
        }
        const briefWordCount = Math.max(0, parseInt(document.getElementById('practiceBriefWords')?.value || '0', 10) || 0);
        const briefWords = Object.keys(getPersistentProgress().briefs || {});
        for (const word of getRandomPracticeListWords(briefWords, briefWordCount)) {
            if (words.length >= MAX_PRACTICE_WORDS) break;
            words.push(word);
        }
        words = capPracticeQueue(words);
        updatePracticeCapWarning();
        const start = Math.max(1, parseInt(document.getElementById('practiceStartWord')?.value || '1', 10) || 1);
        const end = parseInt(document.getElementById('practiceEndWord')?.value || '0', 10) || 0;
        const selectedWords = Math.max(0, Math.min(words.length, end > 0 ? end : words.length) - start + 1);
        const sessions = getPersistentProgress().sessions;
        const averageWpm = sessions.length ? sessions.reduce((total, session) => total + (Number(session.wpm) || 0), 0) / sessions.length : 0;
        if (!selectedWords || !averageWpm) {
            estimate.textContent = `Estimated time: ${selectedWords ? 'Set by completing a session' : '0:00'}`;
            return;
        }
        const seconds = Math.ceil(selectedWords / averageWpm * 60);
        estimate.textContent = `Estimated time: ${formatPracticeDuration(seconds)} at ${Math.round(averageWpm)} WPM (${selectedWords} words)`;
    }

    const MAX_PRACTICE_WORDS = 50000;

    function capPracticeQueue(words) {
        if (!Array.isArray(words)) return [];
        return words.slice(0, MAX_PRACTICE_WORDS);
    }

    function getRandomPracticeListWords(list, count) {
        if (!Array.isArray(list) || list.length === 0 || count <= 0) return [];
        return Array.from({ length: count }, () => list[Math.floor(Math.random() * list.length)]);
    }

    function repeatPracticeWords(words, repeats) {
        if (!Array.isArray(words) || repeats <= 0) return capPracticeQueue(words);

        const original = capPracticeQueue(words);
        const repeated = [];
        for (let repeat = 0; repeat < repeats; repeat++) {
            for (const word of original) {
                if (repeated.length >= MAX_PRACTICE_WORDS) return repeated;
                repeated.push(word);
            }
        }
        return repeated;
    }

    function formatPracticeDuration(totalSeconds) {
        const seconds = Math.max(0, Math.ceil(totalSeconds));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
        return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    function generatePracticeQueue(rawText, mode) {
        practiceState.customDict = null;
        const ignorePunct = settings.profiles[settings.activeProfile].ignorePunct;
        const cleanPracticeWord = word => ignorePunct
            ? String(word).normalize('NFC').replace(/\p{P}/gu, '')
            : String(word).normalize('NFC');
        
        const clippyEntries = parseClippyTape(rawText);
        if (clippyEntries.length) {
            practiceState.customDict = Object.fromEntries(clippyEntries.map(entry => [cleanPracticeWord(entry.word), entry.stroke]));
            const words = mode === 'random'
                ? shuffleArray(clippyEntries.map(entry => cleanPracticeWord(entry.word)))
                : clippyEntries.map(entry => cleanPracticeWord(entry.word));
            return capPracticeQueue(words);
        }

        // Check for Typey Type format (Word [tab or spaces] Stroke) line by line
        const lines = String(rawText).trim().split('\n');
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
            const tokens = String(rawText).match(/[\p{L}\p{M}\p{N}_'’-]+|[\p{P}\p{S}]/gu) || [];
            baseWords = tokens.map(cleanPracticeWord).filter(w => w.trim().length > 0);
        }
        
        if (baseWords.length === 0) return [];

        const uniqueWords = [...new Set(baseWords)];
        const shuffle = (array) => array.slice().sort(() => Math.random() - 0.5);

        let queue = [];
        switch (mode) {
            case 'ordered':
                queue.push(...baseWords);
                break;
            case 'random':
                queue.push(...shuffle(uniqueWords));
                break;
            case 'ordered-pyramid':
                for (let i = 0; i < baseWords.length; i++) {
                    for (let j = 0; j <= i; j++) {
                        if (queue.length >= MAX_PRACTICE_WORDS) return capPracticeQueue(queue);
                        queue.push(baseWords[j]);
                    }
                }
                break;
            case 'random-pyramid':
                const shuf = shuffle(uniqueWords);
                for (let i = 0; i < shuf.length; i++) {
                    for (let j = 0; j <= i; j++) {
                        if (queue.length >= MAX_PRACTICE_WORDS) return capPracticeQueue(queue);
                        queue.push(shuf[j]);
                    }
                }
                break;
            // 'endless' mode removed
        }
        return capPracticeQueue(queue);
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

    function countQuoteWords(text) {
        return (String(text).match(/[\p{L}\p{M}\p{N}_'’-]+/gu) || []).length;
    }

    function tokenizePracticeText(text) {
        return String(text).normalize('NFC').match(/[\p{L}\p{M}\p{N}_'’-]+|[\p{P}\p{S}]/gu) || [];
    }

    function pickQuotePool(pool, length) {
        const bounds = {
            short: quote => countQuoteWords(quote) <= 15,
            medium: quote => countQuoteWords(quote) > 15 && countQuoteWords(quote) <= 40,
            long: quote => countQuoteWords(quote) > 40 && countQuoteWords(quote) <= 100,
            marathon: quote => countQuoteWords(quote) > 100
        };
        let candidates = pool.filter(quote => bounds[length](quote));
        if (candidates.length) return shuffleArray(candidates);
        const sorted = pool.slice().sort((a, b) => countQuoteWords(a) - countQuoteWords(b));
        if (length === 'short') return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
        if (length === 'medium') return shuffleArray(sorted).slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
        if (length === 'long') return sorted.slice(-Math.max(1, Math.ceil(sorted.length / 3))).reverse();
        return [sorted.slice(-Math.min(10, sorted.length)).reverse().join(' ')];
    }

    async function buildQuoteTestQueue(testMode) {
        const source = document.getElementById('quoteLanguage').value;
        if (!source) throw new Error('Choose a quote language before starting this test.');
        const pool = await loadPracticeQuotes(source);
        if (!pool.length) throw new Error('No quotes are available for the selected language.');

        const length = document.getElementById('practiceQuoteLength').value;
        const candidates = pickQuotePool(pool, length);
        const quoteGoalInput = document.getElementById('dailyGoalInput').value;
        const wordGoalInput = document.getElementById('dailyGoalWordsInput').value;
        const quoteGoalValue = quoteGoalInput === '' ? 5 : Number(quoteGoalInput);
        const wordGoalValue = wordGoalInput === '' ? 100 : Number(wordGoalInput);
        const quoteGoal = Number.isFinite(quoteGoalValue) ? Math.max(0, Math.min(100, quoteGoalValue)) : 5;
        const wordGoal = Number.isFinite(wordGoalValue) ? Math.max(0, Math.min(50000, wordGoalValue)) : 100;
        const remainingDailyQuotes = Math.max(0, quoteGoal - getTodaysQuoteCount());
        const remainingDailyWords = Math.max(0, wordGoal - getTodaysWordCount());
        const quoteCount = testMode === 'quote' ? 1
            : testMode === 'daily' ? remainingDailyQuotes
                : testMode === 'quotes' ? Number(document.getElementById('practiceTestQuotes').value) || 5
                    : testMode === 'time'
                        ? Math.min(1000, Math.max(10, Math.ceil((Number(document.getElementById('practiceTestDuration').value) || 60) / 60 * 8) + 10))
                        : 0;
        if (testMode === 'daily' && remainingDailyQuotes === 0 && remainingDailyWords === 0) {
            throw new Error('Your daily quote and word goals are already complete.');
        }

        const targetWords = testMode === 'words'
            ? Number(document.getElementById('practiceTestWords').value) || 50
            : testMode === 'daily' ? remainingDailyWords : 0;
        const targetQuoteCount = testMode === 'daily' ? remainingDailyQuotes : quoteCount;
        const texts = [];
        if (testMode === 'daily') {
            let totalWords = 0;
            let queuedTokenCount = 0;
            let candidateIndex = 0;
            let candidatesTooLarge = 0;
            while ((texts.length < targetQuoteCount || totalWords < targetWords) && texts.length < MAX_PRACTICE_WORDS) {
                const text = candidates[candidateIndex % candidates.length];
                const quoteWords = countQuoteWords(text);
                let quoteTokens = tokenizePracticeText(text);
                if (settings.profiles[settings.activeProfile].ignorePunct) {
                    quoteTokens = quoteTokens.map(token => token.replace(/\p{P}/gu, '')).filter(Boolean);
                }
                candidateIndex++;
                if (!quoteWords || quoteTokens.length > MAX_PRACTICE_WORDS - queuedTokenCount) {
                    candidatesTooLarge++;
                    if (candidatesTooLarge >= candidates.length) break;
                    continue;
                }
                texts.push(text);
                totalWords += quoteWords;
                queuedTokenCount += quoteTokens.length;
                candidatesTooLarge = 0;
            }
            if (texts.length < targetQuoteCount || totalWords < targetWords) {
                throw new Error('These daily goals exceed the 50,000-item practice limit. Reduce the word goal or choose shorter quotes.');
            }
        } else if (targetWords > 0) {
            let totalWords = 0;
            let candidateIndex = 0;
            while (totalWords < targetWords && texts.length < 1000) {
                const text = candidates[candidateIndex % candidates.length];
                texts.push(text);
                totalWords += countQuoteWords(text);
                candidateIndex++;
            }
        } else {
            if (testMode === 'quote') {
                texts.push(getRandomPracticeQuote(candidates, source));
            } else {
                for (let index = 0; index < quoteCount; index++) {
                    texts.push(candidates[index % candidates.length]);
                }
            }
        }

        const words = [];
        const ranges = [];
        let totalWordUnits = 0;
        for (const text of texts) {
            const start = words.length;
            let tokens = tokenizePracticeText(text);
            if (settings.profiles[settings.activeProfile].ignorePunct) {
                tokens = tokens.map(token => token.replace(/\p{P}/gu, '')).filter(Boolean);
            }
            const remainingWords = testMode === 'words' ? targetWords - totalWordUnits : 0;
            let quoteWordUnits = 0;
            let selectedTokens = tokens;
            if (testMode === 'words') {
                selectedTokens = [];
                for (const token of tokens) {
                    const isWord = /[\p{L}\p{M}\p{N}]/u.test(token);
                    if (isWord && quoteWordUnits >= remainingWords) break;
                    selectedTokens.push(token);
                    if (isWord) quoteWordUnits++;
                }
            }
            words.push(...selectedTokens);
            if (words.length > start) {
                ranges.push({
                    start,
                    end: words.length,
                    text,
                    complete: testMode !== 'words' || countQuoteWords(text) <= remainingWords
                });
            }
            totalWordUnits += quoteWordUnits || (testMode !== 'words' ? countQuoteWords(text) : 0);
            if (testMode === 'words' && totalWordUnits >= targetWords) break;
        }
        return { words: capPracticeQueue(words), ranges, targetQuotes: targetQuoteCount, targetWords, source };
    }

    function numberChunkToWords(value) {
        const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        const words = [];
        const hundreds = Math.floor(value / 100);
        const remainder = value % 100;
        if (hundreds) words.push(ones[hundreds], 'hundred');
        if (remainder >= 20) {
            words.push(remainder % 10 ? `${tens[Math.floor(remainder / 10)]}-${ones[remainder % 10]}` : tens[Math.floor(remainder / 10)]);
        } else if (remainder >= 10) {
            words.push(teens[remainder - 10]);
        } else if (remainder || !words.length) {
            words.push(ones[remainder]);
        }
        return words.join(' ');
    }

    function numberToPracticeWords(digits) {
        const scales = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
            'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion'];
        const chunks = [];
        for (let end = digits.length, scale = 0; end > 0; end -= 3, scale++) {
            const start = Math.max(0, end - 3);
            const value = Number(digits.slice(start, end));
            if (value) chunks.unshift(`${numberChunkToWords(value)}${scales[scale] ? ` ${scales[scale]}` : ''}`);
        }
        return chunks.join(' ') || 'zero';
    }

    const jeffStarterStrokes = {
        that: 'STHA', if: 'STPA', when: 'SWH', what: 'SWHA', where: 'SWHR',
        who: 'SWHO', why: 'SWHAO', but: 'SPWH', for: 'STPR', and: 'SKP'
    };
    const jeffPronounStrokes = {
        i: 'EU', we: '*EU', he: 'E', she: '*E', you: 'U', they: '*U', it: '*'
    };
    const jeffPronounMeanings = {
        i: 'I', we: 'we', he: 'he', she: 'she', you: 'you', they: 'they', it: 'it'
    };
    const jeffFullStarters = [
        { value: 'I', stroke: 'SWR', meaning: 'I' },
        { value: 'you', stroke: 'KPWR', meaning: 'you' },
        { value: 'he', stroke: 'KWHR', meaning: 'he' },
        { value: 'she', stroke: 'SKWHR', meaning: 'she' },
        { value: 'it', stroke: 'KPWH', meaning: 'it' },
        { value: 'we', stroke: 'TWR', meaning: 'we' },
        { value: 'they', stroke: 'TWH', meaning: 'they' },
        { value: 'this', stroke: 'STKH', meaning: 'this' },
        { value: 'that', stroke: 'STWH', meaning: 'that' },
        { value: 'there', stroke: 'STHR', meaning: 'there' },
        { value: 'there-plural', stroke: 'STPHR', meaning: 'there (plural)' },
        { value: 'is', stroke: 'STKPWHR', meaning: '(is)' },
        { value: 'are', stroke: 'STWR', meaning: '(are)' }
    ];
    const jeffAuxiliaries = [
        { value: 'do', stroke: '', meaning: 'do' },
        { value: 'can', stroke: 'A', meaning: 'can' },
        { value: 'shall', stroke: 'O', meaning: 'shall' },
        { value: 'will', stroke: 'AO', meaning: 'will' }
    ];
    const jeffStructures = [
        { value: 'plain', stroke: '', meaning: 'he goes', form: 'present' },
        { value: 'negative', stroke: '*', meaning: "he doesn't go", form: 'negative' },
        { value: 'have', stroke: 'F', meaning: 'he has gone', form: 'have' },
        { value: 'negative-have', stroke: '*F', meaning: "he hasn't gone", form: 'negative-have' },
        { value: 'be', stroke: 'E', meaning: 'he is going', form: 'be' },
        { value: 'negative-be', stroke: '*E', meaning: "he isn't going", form: 'negative-be' },
        { value: 'still', stroke: 'EU', meaning: 'he still goes', form: 'still' },
        { value: 'negative-still', stroke: '*EU', meaning: "he still doesn't go", form: 'negative-still' },
        { value: 'been', stroke: 'EF', meaning: 'he has been going', form: 'been' },
        { value: 'negative-been', stroke: '*EF', meaning: "he hasn't been going", form: 'negative-been' },
        { value: 'never', stroke: 'EUF', meaning: 'he never goes', form: 'never' },
        { value: 'even', stroke: '*EUF', meaning: "he doesn't even go", form: 'even' },
        { value: 'always', stroke: 'U', meaning: 'always with an implicit subject; otherwise auxiliary inversion', form: 'always' },
        { value: 'negative-always', stroke: '*U', meaning: 'negative always with an implicit subject; otherwise negative inversion', form: 'negative-always' },
        { value: 'just', stroke: 'UF', meaning: 'he just goes', form: 'just' },
        { value: 'negative-just', stroke: '*UF', meaning: "he just doesn't go", form: 'negative-just' }
    ];
    const jeffStarterMeanings = {
        that: 'that', if: 'if', when: 'when', what: 'what', where: 'where',
        who: 'who', why: 'why', but: 'but', for: 'for', and: 'and'
    };
    const jeffVerbForms = {
        ask: { stroke: 'RB', pastEnding: 'D', past: 'asked', third: 'asks', participle: 'asked' },
        are: { stroke: 'B', pastEnding: 'D', past: 'were', third: 'are', participle: 'been' },
        become: { stroke: 'RPBG', pastEnding: 'D', past: 'became', third: 'becomes', participle: 'become' },
        believe: { stroke: 'BL', pastEnding: 'D', past: 'believed', third: 'believes', participle: 'believed' },
        call: { stroke: 'RBLG', pastEnding: 'D', past: 'called', third: 'calls', participle: 'called' },
        can: { stroke: 'BGS', pastEnding: 'Z', past: 'could', third: 'can', participle: 'can' },
        care: { stroke: 'RZ', pastEnding: 'D', past: 'cared', third: 'cares', participle: 'cared' },
        change: { stroke: 'PBGZ', pastEnding: 'D', past: 'changed', third: 'changes', participle: 'changed' },
        come: { stroke: 'BG', pastEnding: 'D', past: 'came', third: 'comes', participle: 'come' },
        consider: { stroke: 'RBGZ', pastEnding: 'D', past: 'considered', third: 'considers', participle: 'considered' },
        do: { stroke: 'RP', pastEnding: 'D', past: 'did', third: 'does', participle: 'done' },
        expect: { stroke: 'PGS', pastEnding: 'Z', past: 'expected', third: 'expects', participle: 'expected' },
        feel: { stroke: 'LT', pastEnding: 'D', past: 'felt', third: 'feels', participle: 'felt' },
        find: { stroke: 'PBLG', pastEnding: 'D', past: 'found', third: 'finds', participle: 'found' },
        forget: { stroke: 'RG', pastEnding: 'D', past: 'forgot', third: 'forgets', participle: 'forgotten' },
        get: { stroke: 'GS', pastEnding: 'Z', past: 'got', third: 'gets', participle: 'got' },
        give: { stroke: 'GZ', pastEnding: 'D', past: 'gave', third: 'gives', participle: 'given' },
        go: { stroke: 'G', pastEnding: 'D', past: 'went', third: 'goes', participle: 'gone' },
        have: { stroke: 'T', pastEnding: 'D', past: 'had', third: 'has', participle: 'had' },
        happen: { stroke: 'PZ', pastEnding: 'D', past: 'happened', third: 'happens', participle: 'happened' },
        hear: { stroke: 'PG', pastEnding: 'D', past: 'heard', third: 'hears', participle: 'heard' },
        hope: { stroke: 'RPS', pastEnding: 'Z', past: 'hoped', third: 'hopes', participle: 'hoped' },
        imagine: { stroke: 'PLG', pastEnding: 'D', past: 'imagined', third: 'imagines', participle: 'imagined' },
        keep: { stroke: 'PBGS', pastEnding: 'Z', past: 'kept', third: 'keeps', participle: 'kept' },
        know: { stroke: 'PB', pastEnding: 'D', past: 'knew', third: 'knows', participle: 'known' },
        learn: { stroke: 'RPBS', pastEnding: 'Z', past: 'learned', third: 'learns', participle: 'learned' },
        leave: { stroke: 'LGZ', pastEnding: 'D', past: 'left', third: 'leaves', participle: 'left' },
        let: { stroke: 'LS', pastEnding: 'Z', past: 'let', third: 'lets', participle: 'let' },
        like: { stroke: 'BLG', pastEnding: 'D', past: 'liked', third: 'likes', participle: 'liked' },
        live: { stroke: 'LZ', pastEnding: 'D', past: 'lived', third: 'lives', participle: 'lived' },
        look: { stroke: 'L', pastEnding: 'D', past: 'looked', third: 'looks', participle: 'looked' },
        love: { stroke: 'LG', pastEnding: 'D', past: 'loved', third: 'loves', participle: 'loved' },
        make: { stroke: 'RPBL', pastEnding: 'D', past: 'made', third: 'makes', participle: 'made' },
        may: { stroke: 'PL', pastEnding: 'D', past: 'might', third: 'may', participle: 'may' },
        mean: { stroke: 'PBL', pastEnding: 'D', past: 'meant', third: 'means', participle: 'meant' },
        move: { stroke: 'PLZ', pastEnding: 'D', past: 'moved', third: 'moves', participle: 'moved' },
        must: { stroke: 'PBLGS', pastEnding: '', past: 'must', third: 'must', participle: 'must' },
        need: { stroke: 'RPG', pastEnding: 'D', past: 'needed', third: 'needs', participle: 'needed' },
        put: { stroke: 'PS', pastEnding: 'Z', past: 'put', third: 'puts', participle: 'put' },
        read: { stroke: 'RS', pastEnding: 'Z', past: 'read', third: 'reads', participle: 'read' },
        realize: { stroke: 'RLS', pastEnding: 'Z', past: 'realized', third: 'realizes', participle: 'realized' },
        recall: { stroke: 'RL', pastEnding: 'D', past: 'recalled', third: 'recalls', participle: 'recalled' },
        remember: { stroke: 'RPL', pastEnding: 'D', past: 'remembered', third: 'remembers', participle: 'remembered' },
        remain: { stroke: 'RPLS', pastEnding: 'Z', past: 'remained', third: 'remains', participle: 'remained' },
        run: { stroke: 'R', pastEnding: 'D', past: 'ran', third: 'runs', participle: 'run' },
        say: { stroke: 'BS', pastEnding: 'Z', past: 'said', third: 'says', participle: 'said' },
        see: { stroke: 'S', pastEnding: 'Z', past: 'saw', third: 'sees', participle: 'seen' },
        seem: { stroke: 'PLS', pastEnding: 'Z', past: 'seemed', third: 'seems', participle: 'seemed' },
        set: { stroke: 'BLS', pastEnding: 'Z', past: 'set', third: 'sets', participle: 'set' },
        shall: { stroke: 'RBL', pastEnding: 'D', past: 'should', third: 'shall', participle: 'shall' },
        show: { stroke: 'RBZ', pastEnding: 'D', past: 'showed', third: 'shows', participle: 'shown' },
        take: { stroke: 'RBT', pastEnding: 'D', past: 'took', third: 'takes', participle: 'taken' },
        tell: { stroke: 'RLT', pastEnding: 'D', past: 'told', third: 'tells', participle: 'told' },
        think: { stroke: 'PBG', pastEnding: 'D', past: 'thought', third: 'thinks', participle: 'thought' },
        try: { stroke: 'RT', pastEnding: 'D', past: 'tried', third: 'tries', participle: 'tried' },
        understand: { stroke: 'RPB', pastEnding: 'D', past: 'understood', third: 'understands', participle: 'understood' },
        use: { stroke: 'Z', pastEnding: 'D', past: 'used', third: 'uses', participle: 'used' },
        want: { stroke: 'P', pastEnding: 'D', past: 'wanted', third: 'wants', participle: 'wanted' },
        will: { stroke: 'RBGS', pastEnding: 'Z', past: 'would', third: 'will', participle: 'will' },
        wish: { stroke: 'RBS', pastEnding: 'Z', past: 'wished', third: 'wishes', participle: 'wished' },
        work: { stroke: 'RBG', pastEnding: 'D', past: 'worked', third: 'works', participle: 'worked' }
    };
    const jeffSuffixOptions = [
        { value: 'T', stroke: '-T', meaning: 'to / a' },
        { value: 'S', stroke: '-S', meaning: 'that / like' }
    ];
    const jeffPastOptions = [
        { value: 'D', stroke: '-D', meaning: 'past ending D' },
        { value: 'Z', stroke: '-Z', meaning: 'past ending Z' }
    ];
    const jeffVerbSuffixes = {
        are: { T: 'a' }, become: { T: 'a' }, believe: { T: 'that' }, come: { T: 'to' },
        do: { T: 'it' }, expect: { T: 'that' }, feel: { S: 'like' }, find: { T: 'that' },
        forget: { T: 'to' }, get: { T: 'to' }, go: { T: 'to' }, have: { S: 'to' },
        hear: { T: 'that' }, hope: { T: 'to' }, imagine: { T: 'that' }, know: { T: 'that' },
        learn: { T: 'to' }, like: { T: 'to' }, love: { T: 'to' }, make: { T: 'a' },
        may: { T: 'be' }, mean: { T: 'to' }, must: { T: 'be' }, need: { T: 'to' },
        put: { T: 'it' }, realize: { T: 'that' }, remember: { T: 'that' }, say: { T: 'that' },
        seem: { T: 'to' }, think: { T: 'that' }, try: { S: 'to' }, understand: { T: 'the' },
        use: { T: 'to' }, want: { T: 'to' }, wish: { T: 'to' }, work: { T: 'on' }
    };
    const jeffPastSuffixModifiers = {
        'expect:T': 'DZ', 'feel:S': 'DZ', 'get:T': 'DZ', 'have:S': 'DZ',
        'hope:T': 'DZ', 'learn:T': 'DZ', 'put:T': 'DZ', 'realize:T': 'DZ',
        'say:T': 'DZ', 'seem:T': 'DZ', 'try:S': 'DZ', 'wish:T': 'DZ',
        'use:T': 'DZ'
    };
    const jeffThereValidEndings = new Set([
        '', 'D', 'B', 'BT', 'BD', 'BTD', 'BG', 'BGD', 'G', 'GD',
        'PZ', 'PDZ', 'T', 'TD', 'TS', 'TSDZ', 'LZ', 'LZD',
        'PL', 'PLT', 'PLD', 'PLTD', 'PBLGS', 'PBLGTS',
        'PBLGSZ', 'PBLGTSDZ', 'RPG', 'RPGD', 'RPGT', 'RPGTD',
        'RLG', 'RLGD', 'PLS', 'PLSZ', 'PLTS', 'PLTSDZ',
        'Z', 'DZ', 'TZ', 'TDZ'
    ]);
    const jeffNonPhraseStrokes = new Set([
        'STHR', 'STHRET', 'STHREUPLT', 'STPHREFPLT',
        'SKPUR', 'SKPUL', 'SKPEUT', 'SKP*'
    ]);
    const jeffInvariantVerbEndings = new Set(['can', 'may', 'must', 'shall', 'will']);

    function normalizeJeffEnding(stroke, modifiers = '') {
        const order = 'RPBLGTSDZ';
        const keys = new Set(`${stroke}${modifiers}`);
        return Array.from(order).filter(key => keys.has(key)).join('');
    }

    function getJeffVerbEndingStroke(name, verb, suffix, isPast) {
        const suffixKey = suffix || '';
        const pastModifiers = isPast
            ? jeffPastSuffixModifiers[`${name}:${suffixKey}`] || verb.pastEnding
            : '';
        return normalizeJeffEnding(verb.stroke, `${suffixKey}${pastModifiers || ''}`);
    }

    function getJeffNegativeModal(auxiliary, isPast) {
        if (auxiliary === 'can') return isPast ? "couldn't" : "can't";
        if (auxiliary === 'will') return isPast ? "wouldn't" : "won't";
        if (auxiliary === 'shall') return isPast ? "shouldn't" : 'shall not';
        return '';
    }

    function getJeffAuxiliaryText(auxiliary, isPast, isThirdPerson, isNegative) {
        if (auxiliary === 'do') {
            if (isNegative) return isPast ? "didn't" : isThirdPerson ? "doesn't" : "don't";
            return isPast ? 'did' : isThirdPerson ? 'does' : 'do';
        }
        if (isNegative) return getJeffNegativeModal(auxiliary, isPast);
        if (isPast && auxiliary === 'can') return 'could';
        if (isPast && auxiliary === 'shall') return 'should';
        if (isPast && auxiliary === 'will') return 'would';
        return auxiliary;
    }

    function joinJeffStroke(prefix, suffix) {
        if (!prefix) return suffix;
        if (!suffix) return prefix;
        return /[AO*EU-]/.test(`${prefix}${suffix}`) ? `${prefix}${suffix}` : `${prefix}-${suffix}`;
    }

    function composeJeffStroke(parts) {
        return parts.reduce((stroke, part) => joinJeffStroke(stroke, part || ''), '');
    }

    function formatJeffStructureStroke(value, stroke) {
        if (value === 'have') return '-F';
        return stroke;
    }

    function parsePracticeChoices(value) {
        return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
    }

    function renderJeffPhraseOptions() {
        const structureInput = document.getElementById('jeffStructures');
        if (structureInput) {
            const migratedStructures = parsePracticeChoices(structureInput.value)
                .map(value => value === 'question' ? 'always' : value === 'negative-question' ? 'negative-always' : value)
                .filter(value => jeffStructures.some(structure => structure.value === value));
            structureInput.value = migratedStructures.join(', ');
        }
        const simpleStarters = Object.entries(jeffStarterStrokes).map(([value, stroke]) => ({
            value, stroke, meaning: jeffStarterMeanings[value] || value
        }));
        const simplePronouns = Object.entries(jeffPronounStrokes).map(([value, stroke]) => ({
            value, stroke, meaning: jeffPronounMeanings[value] || value
        }));
        const verbs = Object.entries(jeffVerbForms).map(([value, details]) => ({
            value, stroke: `-${details.stroke}`, meaning: value === 'are' ? 'be' : value
        }));
        const structures = jeffStructures.map(({ value, stroke, meaning }) => ({
            value, stroke: formatJeffStructureStroke(value, stroke), meaning
        }));
        const categories = [
            ['jeffStarterOptions', simpleStarters, 'jeffStarters'],
            ['jeffPronounOptions', simplePronouns, 'jeffPronouns'],
            ['jeffVerbOptions', verbs, 'jeffVerbs'],
            ['jeffFullVerbOptions', verbs, 'jeffFullVerbs'],
            ['jeffFullStarterOptions', jeffFullStarters, 'jeffFullStarters'],
            ['jeffAuxiliaryOptions', jeffAuxiliaries, 'jeffAuxiliaries'],
            ['jeffStructureOptions', structures, 'jeffStructures'],
            ['jeffSimpleSuffixOptions', jeffSuffixOptions, 'jeffSimpleSuffixes'],
            ['jeffFullSuffixOptions', jeffSuffixOptions, 'jeffFullSuffixes'],
            ['jeffSimplePastOptions', jeffPastOptions, 'jeffSimplePast'],
            ['jeffFullPastOptions', jeffPastOptions, 'jeffFullPast']
        ];

        for (const [containerId, options, inputId] of categories) {
            const container = document.getElementById(containerId);
            const input = document.getElementById(inputId);
            if (!container || !input) continue;
            const selected = parsePracticeChoices(input.value);
            container.replaceChildren();
            for (const option of options) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'jeff-phrase-option';
                button.dataset.value = option.value;
                button.setAttribute('aria-pressed', String(selected.includes(option.value)));
                button.setAttribute('aria-label', option.stroke ? `${option.stroke}, ${option.meaning}` : option.meaning);
                button.title = option.stroke ? `${option.stroke} · ${option.meaning}` : option.meaning;
                const stroke = document.createElement('span');
                stroke.className = 'jeff-phrase-option-stroke';
                stroke.textContent = option.stroke;
                const meaning = document.createElement('span');
                meaning.className = 'jeff-phrase-option-meaning';
                meaning.textContent = option.meaning;
                button.append(stroke, meaning);
                button.addEventListener('click', () => {
                    const values = parsePracticeChoices(input.value);
                    const index = values.indexOf(option.value);
                    if (index >= 0) values.splice(index, 1);
                    else values.push(option.value);
                    input.value = values.join(', ');
                    renderJeffPhraseOptions();
                    savePracticeSettingsForProfile();
                    updatePracticeEstimate();
                });
                container.appendChild(button);
            }
        }

        const haveContainer = document.getElementById('jeffSimpleHaveOptions');
        const haveSetting = document.getElementById('jeffIncludeHave');
        if (haveContainer && haveSetting) {
            haveContainer.replaceChildren();
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'jeff-phrase-option';
            button.setAttribute('aria-pressed', String(haveSetting.checked));
            button.setAttribute('aria-label', '-F, have');
            button.title = '-F · have';
            button.innerHTML = '<span class="jeff-phrase-option-stroke">-F</span><span class="jeff-phrase-option-meaning">have</span>';
            button.addEventListener('click', () => {
                haveSetting.checked = !haveSetting.checked;
                renderJeffPhraseOptions();
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
            });
            haveContainer.appendChild(button);
        }

        document.querySelectorAll('[data-jeff-all], [data-jeff-none]').forEach(button => {
            if (button.dataset.jeffBound) return;
            button.dataset.jeffBound = 'true';
            button.addEventListener('click', () => {
                const container = document.getElementById(button.dataset.jeffAll || button.dataset.jeffNone);
                if (!container) return;
                const inputId = {
                    jeffStarterOptions: 'jeffStarters',
                    jeffPronounOptions: 'jeffPronouns',
                    jeffVerbOptions: 'jeffVerbs',
                    jeffFullVerbOptions: 'jeffFullVerbs',
                    jeffFullStarterOptions: 'jeffFullStarters',
                    jeffAuxiliaryOptions: 'jeffAuxiliaries',
                    jeffStructureOptions: 'jeffStructures',
                    jeffSimpleSuffixOptions: 'jeffSimpleSuffixes',
                    jeffFullSuffixOptions: 'jeffFullSuffixes',
                    jeffSimplePastOptions: 'jeffSimplePast',
                    jeffFullPastOptions: 'jeffFullPast'
                }[container.id];
                if (!inputId) return;
                const input = document.getElementById(inputId);
                input.value = button.dataset.jeffAll
                    ? Array.from(container.querySelectorAll('.jeff-phrase-option'), option => option.dataset.value).join(', ')
                    : '';
                renderJeffPhraseOptions();
                savePracticeSettingsForProfile();
                updatePracticeEstimate();
            });
        });
    }

    function getThirdPersonVerb(verb) {
        if (verb === 'have') return 'has';
        if (verb === 'do') return 'does';
        if (verb === 'go') return 'goes';
        if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`;
        if (/(s|x|z|ch|sh|o)$/i.test(verb)) return `${verb}es`;
        return `${verb}s`;
    }

    function getRegularPastVerb(verb) {
        if (verb.endsWith('e')) return `${verb}d`;
        if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ied`;
        return `${verb}ed`;
    }

    function getPresentParticiple(verb) {
        if (jeffInvariantVerbEndings.has(verb)) return verb;
        if (verb === 'see') return 'seeing';
        if (['get', 'let', 'put', 'run', 'set', 'forget'].includes(verb)) {
            return `${verb}${verb.endsWith('t') ? 't' : verb.endsWith('n') ? 'n' : 'g'}ing`;
        }
        return verb.endsWith('e') ? `${verb.slice(0, -1)}ing` : `${verb}ing`;
    }

    async function buildJeffPhrasingMaterial() {
        const selected = id => parsePracticeChoices(document.getElementById(id)?.value || '');
        const randomItem = items => items[Math.floor(Math.random() * items.length)];
        const starters = parsePracticeChoices(document.getElementById('jeffStarters').value.toLowerCase())
            .filter(starter => jeffStarterStrokes[starter]);
        const pronouns = parsePracticeChoices(document.getElementById('jeffPronouns').value)
            .map(pronoun => pronoun.toLowerCase())
            .filter(pronoun => jeffPronounStrokes[pronoun]);
        const fullStarters = jeffFullStarters.filter(starter => selected('jeffFullStarters').includes(starter.value));
        const requestedVerbs = selected('jeffVerbs').filter(verb => jeffVerbForms[verb]);
        const requestedFullVerbs = selected('jeffFullVerbs').filter(verb => jeffVerbForms[verb]);
        const selectedPhraseForm = document.getElementById('jeffPhraseForm').value;
        const phraseForm = selectedPhraseForm === 'full' ? 'full' : 'simple';
        const verbs = phraseForm === 'full' ? requestedFullVerbs : requestedVerbs;
        const auxiliaries = jeffAuxiliaries.filter(aux => selected('jeffAuxiliaries').includes(aux.value));
        const structures = jeffStructures.filter(structure => selected('jeffStructures').includes(structure.value));
        if (phraseForm === 'simple' && (!starters.length || !pronouns.length || !verbs.length)) {
            throw new Error('Select at least one simple starter, pronoun, and verb.');
        }
        if (phraseForm === 'full' && (!fullStarters.length || !auxiliaries.length || !structures.length || !verbs.length)) {
            throw new Error('Select at least one full-form starter, auxiliary, structure, and verb.');
        }

        const phraseCount = Math.max(1, Math.min(100, Number(document.getElementById('jeffPhraseCount').value) || 25));
        const suffixIds = phraseForm === 'full' ? 'jeffFullSuffixes' : 'jeffSimpleSuffixes';
        const pastIds = phraseForm === 'full' ? 'jeffFullPast' : 'jeffSimplePast';
        const suffixes = selected(suffixIds).filter(suffix => ['T', 'S'].includes(suffix));
        const pastEndings = selected(pastIds).filter(ending => ['D', 'Z'].includes(ending));
        const haveEnabled = phraseForm === 'simple' && document.getElementById('jeffIncludeHave').checked;
        const practiceLines = [];
        for (let index = 0; index < phraseCount; index++) {
            let selectedVerbName = randomItem(verbs);
            let verb = jeffVerbForms[selectedVerbName];
            let isPast = ['D', 'Z'].includes(verb.pastEnding)
                && pastEndings.includes(verb.pastEnding)
                && Math.random() < 0.3;
            let availableSuffixes = suffixes.filter(suffix => jeffVerbSuffixes[selectedVerbName]?.[suffix]);
            let suffix = availableSuffixes.length > 0 && Math.random() < 0.25
                ? randomItem(availableSuffixes)
                : '';
            let ending = getJeffVerbEndingStroke(selectedVerbName, verb, suffix, isPast);
            let suffixText = jeffVerbSuffixes[selectedVerbName]?.[suffix] || '';
            let phrase;
            let outline;

            if (phraseForm === 'simple') {
                let starter = randomItem(starters);
                let pronoun = randomItem(pronouns);
                let useHave = haveEnabled && Boolean(verb.participle) && Math.random() < 0.25;
                let prefix = `${jeffStarterStrokes[starter]}${jeffPronounStrokes[pronoun]}${useHave ? 'F' : ''}`;
                outline = composeJeffStroke([prefix, ending]);
                if (jeffNonPhraseStrokes.has(outline)) {
                    const alternatives = starters.flatMap(candidateStarter =>
                        pronouns.flatMap(candidatePronoun =>
                            [false, ...(haveEnabled && Boolean(verb.participle) ? [true] : [])]
                                .map(candidateHave => ({
                                    starter: candidateStarter,
                                    pronoun: candidatePronoun,
                                    useHave: candidateHave,
                                    prefix: `${jeffStarterStrokes[candidateStarter]}${jeffPronounStrokes[candidatePronoun]}${candidateHave ? 'F' : ''}`
                                }))
                        )
                    ).filter(candidate => !jeffNonPhraseStrokes.has(composeJeffStroke([candidate.prefix, ending])));
                    if (!alternatives.length) {
                        throw new Error('The selected simple Jeff options only produce strokes reserved by the reference for other phrases.');
                    }
                    const alternative = randomItem(alternatives);
                    starter = alternative.starter;
                    pronoun = alternative.pronoun;
                    useHave = alternative.useHave;
                    prefix = alternative.prefix;
                    outline = composeJeffStroke([prefix, ending]);
                }
                const subjectForPronoun = pronoun === 'i' ? 'I' : pronoun;
                const useTo = selectedVerbName === 'use' && suffix === 'T';
                const isThirdPerson = ['he', 'she', 'it'].includes(pronoun);
                const simpleVerbText = useHave
                    ? jeffInvariantVerbEndings.has(selectedVerbName) && isPast ? verb.past : verb.participle
                    : useTo ? 'used'
                    : selectedVerbName === 'are'
                        ? isPast ? (['you', 'we', 'they'].includes(pronoun) ? 'were' : 'was')
                            : pronoun === 'i' ? 'am' : isThirdPerson ? 'is' : 'are'
                        : isPast ? (verb.past || getRegularPastVerb(selectedVerbName))
                            : isThirdPerson ? (verb.third || getThirdPersonVerb(selectedVerbName)) : selectedVerbName;
                const auxiliary = useHave ? (isPast ? 'had' : (isThirdPerson ? 'has' : 'have')) : '';
                phrase = [starter, subjectForPronoun, auxiliary, simpleVerbText, suffixText].filter(Boolean).join(' ');
            } else {
                const starter = randomItem(fullStarters);
                const auxiliary = randomItem(auxiliaries);
                const structure = randomItem(structures);
                if (['there', 'there-plural'].includes(starter.value)) {
                    const validEndings = verbs.flatMap(verbName => {
                        const candidateVerb = jeffVerbForms[verbName];
                        const candidateSuffixes = ['', ...suffixes.filter(value => jeffVerbSuffixes[verbName]?.[value])];
                        const candidatePastOptions = [
                            false,
                            ...(['D', 'Z'].includes(candidateVerb.pastEnding) && pastEndings.includes(candidateVerb.pastEnding)
                                ? [true]
                                : [])
                        ];
                        return candidateSuffixes.flatMap(candidateSuffix =>
                            candidatePastOptions.map(candidateIsPast => ({
                                verbName,
                                suffix: candidateSuffix,
                                isPast: candidateIsPast,
                                ending: getJeffVerbEndingStroke(verbName, candidateVerb, candidateSuffix, candidateIsPast)
                            }))
                        ).filter(candidate => jeffThereValidEndings.has(candidate.ending)
                            && !jeffNonPhraseStrokes.has(composeJeffStroke([
                                starter.stroke, auxiliary.stroke, structure.stroke, candidate.ending
                            ])));
                    });
                    if (!validEndings.length) {
                        throw new Error('No selected verb, suffix, and past-ending combination is valid with the there starter in Jeff’s reference.');
                    }
                    const validEnding = randomItem(validEndings);
                    selectedVerbName = validEnding.verbName;
                    verb = jeffVerbForms[selectedVerbName];
                    isPast = validEnding.isPast;
                    suffix = validEnding.suffix;
                    ending = validEnding.ending;
                    suffixText = jeffVerbSuffixes[selectedVerbName]?.[suffix] || '';
                }
                const subject = ['(is)', '(are)'].includes(starter.meaning)
                    ? ''
                    : starter.meaning === 'there (plural)' ? 'there' : starter.meaning;
                const name = Object.keys(jeffVerbForms).find(key => jeffVerbForms[key] === verb);
                const isFirstPerson = starter.value === 'I';
                const isThirdPerson = starter.value === 'is'
                    || (starter.value !== 'there-plural' && ['he', 'she', 'it', 'this', 'that', 'there'].includes(subject.toLowerCase()));
                const hasExplicitSubject = Boolean(subject);
                const isCopula = name === 'are';
                const isInvariantVerb = jeffInvariantVerbEndings.has(name);
                const useTo = name === 'use' && suffix === 'T';
                const base = isCopula ? 'be'
                    : useTo ? 'used'
                        : isInvariantVerb && isPast ? verb.past
                            : name;
                const present = isCopula ? (isFirstPerson ? 'am' : isThirdPerson ? 'is' : 'are')
                    : useTo ? 'used'
                    : isThirdPerson ? (verb.third || getThirdPersonVerb(name)) : name;
                const past = isCopula ? (isFirstPerson || isThirdPerson ? 'was' : 'were')
                    : useTo ? 'used'
                    : verb.past || getRegularPastVerb(name);
                const participle = isCopula ? 'been'
                    : useTo ? 'used'
                        : isInvariantVerb && isPast ? verb.past
                            : verb.participle || name;
                const presentParticiple = isCopula ? 'being'
                    : useTo ? 'used'
                        : isInvariantVerb && isPast ? verb.past
                            : getPresentParticiple(name);
                const modal = auxiliary.value === 'do' ? '' : auxiliary.value;
                const pastModal = auxiliary.value === 'can' ? 'could'
                    : auxiliary.value === 'shall' ? 'should'
                        : auxiliary.value === 'will' ? 'would' : modal;
                const negativeModal = getJeffNegativeModal(modal, isPast);
                const subjectPrefix = subject ? `${subject} ` : '';
                const auxiliaryPerson = hasExplicitSubject && isThirdPerson;
                const auxiliaryText = getJeffAuxiliaryText(auxiliary.value, isPast, auxiliaryPerson, false);
                const negativeAuxiliaryText = getJeffAuxiliaryText(auxiliary.value, isPast, auxiliaryPerson, true);
                let structureText;
                switch (structure.form) {
                    case 'negative':
                        structureText = `${subjectPrefix}${modal ? negativeModal : `${isPast ? "didn't" : isThirdPerson ? "doesn't" : "don't"}`} ${base}`;
                        break;
                    case 'have':
                        structureText = `${subjectPrefix}${modal ? `${isPast ? pastModal : modal} have` : isPast ? 'had' : isThirdPerson ? 'has' : 'have'} ${participle}`;
                        break;
                    case 'negative-have':
                        structureText = `${subjectPrefix}${modal ? `${negativeModal} have` : isPast ? "hadn't" : isThirdPerson ? "hasn't" : "haven't"} ${participle}`;
                        break;
                    case 'just':
                    case 'still':
                    case 'never': {
                        const adverb = structure.form;
                        structureText = modal
                            ? `${subjectPrefix}${isPast ? pastModal : modal} ${adverb} ${base}`
                            : `${subjectPrefix}${adverb} ${isPast ? past : present}`;
                        break;
                    }
                    case 'negative-just':
                    case 'negative-still': {
                        const adverb = structure.form === 'negative-just' ? 'just' : 'still';
                        structureText = modal
                            ? `${subjectPrefix}${adverb} ${negativeModal} ${base}`
                            : `${subjectPrefix}${adverb} ${isPast ? "didn't" : isThirdPerson ? "doesn't" : "don't"} ${base}`;
                        break;
                    }
                    case 'always':
                        structureText = hasExplicitSubject
                            ? `${auxiliaryText} ${subject} ${base}`
                            : auxiliary.value === 'do' ? `to ${base}` : `${auxiliaryText} always ${base}`;
                        break;
                    case 'negative-always':
                        structureText = hasExplicitSubject
                            ? `${negativeAuxiliaryText} ${subject} ${base}`
                            : auxiliary.value === 'do' ? `not to ${base}` : `${negativeAuxiliaryText} always ${base}`;
                        break;
                    case 'be':
                        structureText = `${subjectPrefix}${modal ? `${isPast ? pastModal : modal} be` : isPast ? (isFirstPerson || isThirdPerson ? 'was' : 'were') : isFirstPerson ? 'am' : isThirdPerson ? 'is' : 'are'} ${presentParticiple}`;
                        break;
                    case 'negative-be':
                        structureText = `${subjectPrefix}${modal ? `${negativeModal} be` : isPast ? (isFirstPerson || isThirdPerson ? "wasn't" : "weren't") : isFirstPerson ? 'am not' : isThirdPerson ? "isn't" : "aren't"} ${presentParticiple}`;
                        break;
                    case 'been':
                        structureText = `${subjectPrefix}${modal ? `${isPast ? pastModal : modal} have been` : isPast ? 'had been' : isThirdPerson ? 'has been' : 'have been'} ${presentParticiple}`;
                        break;
                    case 'negative-been':
                        structureText = `${subjectPrefix}${modal ? `${negativeModal} have been` : isPast ? "hadn't been" : isThirdPerson ? "hasn't been" : "haven't been"} ${presentParticiple}`;
                        break;
                    case 'even':
                        structureText = modal
                            ? `${subjectPrefix}${negativeModal} even ${base}`
                            : `${subjectPrefix}${isPast ? "didn't" : isThirdPerson ? "doesn't" : "don't"} even ${base}`;
                        break;
                    default:
                        structureText = modal
                            ? `${subjectPrefix}${isPast ? pastModal : modal} ${base}`
                            : `${subjectPrefix}${isPast ? past : present}`;
                }
                phrase = [structureText, suffixText].filter(Boolean).join(' ');
                outline = composeJeffStroke([starter.stroke, auxiliary.stroke, structure.stroke, ending]);
            }
            if (jeffNonPhraseStrokes.has(outline)) {
                throw new Error('The selected Jeff phrase options produced a stroke reserved by the reference for another phrase.');
            }
            practiceLines.push(`${phrase}\t${outline}`);
        }
        return practiceLines.join('\n');
    }

    function buildGeneratedPracticeQueue(testMode) {
        if (testMode === 'numbers') {
            const groupCount = Math.max(1, Math.min(250, Number(document.getElementById('practiceNumberGroups').value) || 50));
            const digitCount = Math.max(1, Math.min(36, Number(document.getElementById('practiceNumberDigits').value) || 6));
            const format = document.getElementById('practiceNumberFormat').value;
            const groups = Array.from({ length: groupCount }, () => {
                let digits = '';
                for (let index = 0; index < digitCount; index++) {
                    digits += String(index === 0 && digitCount > 1
                        ? 1 + Math.floor(Math.random() * 9)
                        : Math.floor(Math.random() * 10));
                }
                const useWords = format === 'words' || (format === 'mixed' && Math.random() < 0.5);
                return useWords ? numberToPracticeWords(digits) : digits;
            });
            return groups;
        }

        const symbolCount = Math.max(1, Math.min(250, Number(document.getElementById('practiceSymbolCount').value) || 50));
        const symbols = Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
        const selected = [];
        while (selected.length < symbolCount) {
            selected.push(...shuffleArray(symbols).slice(0, Math.min(symbolCount - selected.length, symbols.length)));
        }
        return selected;
    }

    function updatePracticeTestControls() {
        const mode = document.getElementById('practiceTestMode')?.value || 'quote';
        const dashboard = document.querySelector('.typing-dashboard');
        if (dashboard) {
            dashboard.dataset.mode = mode;
            const phraseForm = document.getElementById('jeffPhraseForm')?.value;
            dashboard.dataset.jeffForm = phraseForm === 'full' ? 'full' : 'simple';
        }
        document.querySelectorAll('.jeff-phrasing-setting').forEach(setting => {
            setting.hidden = mode !== 'jeff-phrasing';
        });
        document.querySelectorAll('.test-number-setting').forEach(setting => {
            setting.hidden = mode !== 'numbers';
        });
        document.querySelectorAll('.test-symbol-setting').forEach(setting => {
            setting.hidden = mode !== 'symbols';
        });
        document.querySelectorAll('.test-language-setting').forEach(setting => {
            setting.hidden = ['numbers', 'symbols', 'jeff-phrasing', 'problematic', 'briefs'].includes(mode);
        });
        const lessonSetting = document.querySelector('.test-lesson-setting');
        if (lessonSetting) lessonSetting.hidden = mode !== 'lesson';
        const startButton = document.getElementById('startPracticeButton');
        if (startButton) startButton.textContent = mode === 'daily'
            ? 'Start daily practice'
            : mode === 'numbers' ? 'Start number practice'
                : mode === 'symbols' ? 'Start symbol practice'
                    : mode === 'jeff-phrasing' ? 'Start Jeff Phrasing'
                        : mode === 'problematic' ? 'Practice problematic words'
                            : mode === 'briefs' ? 'Practice my briefs' : 'Start test';
        renderJeffPhraseOptions();
        updatePracticeEstimate();
    }

    function getPracticeTestVariant(mode) {
        if (mode === 'time') return `time-${document.getElementById('practiceTestDuration').value}s`;
        if (mode === 'words') return `words-${document.getElementById('practiceTestWords').value}`;
        if (mode === 'quotes') return `quotes-${document.getElementById('practiceTestQuotes').value}-${document.getElementById('practiceQuoteLength').value}`;
        if (mode === 'quote') return `quote-${document.getElementById('practiceQuoteLength').value}`;
        if (mode === 'numbers') return `numbers-${document.getElementById('practiceNumberGroups').value}-${document.getElementById('practiceNumberDigits').value}-${document.getElementById('practiceNumberFormat').value}`;
        if (mode === 'symbols') return `symbols-${document.getElementById('practiceSymbolCount').value}`;
        if (mode === 'jeff-phrasing') return `jeff-phrasing-${document.getElementById('jeffPhraseCount').value}-${document.getElementById('jeffPhraseForm').value}`;
        return mode;
    }

    function startDailyQuotePractice() {
        document.getElementById('practiceTestMode').value = 'daily';
        updatePracticeTestControls();
        startPractice();
    }

    function restartPractice() {
        startPractice();
    }

    async function startPractice() {
        const testMode = document.getElementById('practiceTestMode')?.value || 'lesson';
        let quoteTest = null;
        let text = document.getElementById('practiceMaterial').value;
        let mode = document.getElementById('practiceMode').value;
        if (testMode === 'jeff-phrasing') {
            try {
                text = await buildJeffPhrasingMaterial();
            } catch (error) {
                openModal('Unable to start Jeff Phrasing', error.message, () => {});
                return;
            }
            mode = 'ordered';
        } else if (testMode === 'numbers' || testMode === 'symbols') {
            const words = buildGeneratedPracticeQueue(testMode);
            quoteTest = { words, ranges: [], targetQuotes: 0, targetWords: words.length };
            mode = 'ordered';
        } else if (testMode === 'problematic' || testMode === 'briefs') {
            text = await getPracticeListMaterial(testMode);
            mode = 'ordered';
        } else if (testMode !== 'lesson') {
            try {
                quoteTest = await buildQuoteTestQueue(testMode);
            } catch (error) {
                openModal('Unable to start practice', error.message, () => {});
                return;
            }
            mode = 'ordered';
            text = quoteTest.words.join(' ');
        }
        const vis = document.getElementById('strokeVisibility').value;
        const hintType = document.getElementById('strokeHintType').value;

        savePracticeSettingsForProfile();

        practiceState.isEndless = false;
        practiceState.blindMode = Boolean(settings.profiles[settings.activeProfile].blindMode);
        practiceState.blindModeType = 'wait';
        practiceState.blindWpm = 60;
        practiceState.spokenPracticeIndex = -1;
        if (practiceState.blindTimer) clearInterval(practiceState.blindTimer);
        practiceState.blindTimer = 0;
        practiceState.words = quoteTest ? quoteTest.words : generatePracticeQueue(text, mode);
        if (quoteTest) practiceState.customDict = null;
        const persistentProgress = getPersistentProgress();
        practiceState.problematicWordSet = new Set(Object.keys(persistentProgress.problematic || {}).map(word => word.toLowerCase()));
        practiceState.briefWordSet = new Set(Object.keys(persistentProgress.briefs || {}).map(word => word.toLowerCase()));

        // Repeats: allow duplicating the entire text N times (default 0)
        const repeats = testMode === 'lesson'
            ? parseInt(document.getElementById('practiceRepeats') ? document.getElementById('practiceRepeats').value : '0', 10) || 0
            : 0;
        practiceState.words = repeatPracticeWords(practiceState.words, repeats);

        // If ignore punctuation is enabled, remove punctuation tokens entirely from the practice queue
        if (testMode === 'lesson' && settings.profiles[settings.activeProfile].ignorePunct) {
            practiceState.words = practiceState.words.filter(w => !isPracticePunctuation(w));
        }
        // Max words cap: 0 means no cap
        const maxWords = parseInt(document.getElementById('practiceMaxWords') ? document.getElementById('practiceMaxWords').value : '0', 10) || 0;
        const problemWordCount = parseInt(document.getElementById('practiceProblemWords') ? document.getElementById('practiceProblemWords').value : '0', 10) || 0;
        const briefWordCount = parseInt(document.getElementById('practiceBriefWords') ? document.getElementById('practiceBriefWords').value : '0', 10) || 0;
        if (testMode === 'lesson' && maxWords > 0) {
            practiceState.words = practiceState.words.slice(0, maxWords);
        }
        practiceState.words = capPracticeQueue(practiceState.words);

        // Inject problem words after capping the material so the requested count is added.
        const problematicWords = Object.keys(getPersistentProgress().problematic);
        if (testMode === 'lesson' && problemWordCount > 0 && problematicWords.length) {
            const injectedWords = getRandomPracticeListWords(problematicWords, problemWordCount);
            injectedWords.forEach(word => {
                if (practiceState.words.length >= MAX_PRACTICE_WORDS) return;
                const position = Math.floor(Math.random() * (practiceState.words.length + 1));
                practiceState.words.splice(position, 0, word);
            });
        }
        const briefWords = Object.keys(getPersistentProgress().briefs || {});
        if (testMode === 'lesson' && briefWordCount > 0 && briefWords.length) {
            const injectedBriefWords = getRandomPracticeListWords(briefWords, briefWordCount);
            injectedBriefWords.forEach(word => {
                if (practiceState.words.length >= MAX_PRACTICE_WORDS) return;
                const position = Math.floor(Math.random() * (practiceState.words.length + 1));
                practiceState.words.splice(position, 0, word);
            });
            const briefEntries = getPersistentProgress().briefs;
            practiceState.customDict = Object.assign(practiceState.customDict || {}, Object.fromEntries(
                injectedBriefWords
                    .filter(word => briefEntries[word]?.stroke)
                    .map(word => [word, briefEntries[word].stroke])
            ));
        }
        practiceState.words = capPracticeQueue(practiceState.words);
        const startWord = testMode === 'lesson' ? Math.max(1, parseInt(document.getElementById('practiceStartWord')?.value || '1', 10) || 1) : 1;
        const endWord = Math.max(0, parseInt(document.getElementById('practiceEndWord')?.value || '0', 10) || 0);
        if (testMode === 'lesson') practiceState.words = practiceState.words.slice(startWord - 1, endWord > 0 ? endWord : undefined);
        practiceState.words = capPracticeQueue(practiceState.words);
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
            if (testMode === 'symbols') return 1;
            if (testMode !== 'lesson' && isPracticePunctuation(word)) return 0;
            const units = String(word).match(/[\p{L}\p{M}\p{N}_'’-]+/gu);
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
        practiceState.sessionStartTime = 0;
        practiceState.sessionStartDate = new Date();
        practiceState.lastInputValue = '';
        practiceState.lastStrokeTime = 0;
        practiceState.lastStrokeKind = '';
        if (practiceState.pendingSnapshotTimer) clearTimeout(practiceState.pendingSnapshotTimer);
        practiceState.pendingSnapshotTimer = 0;
        practiceState.pendingSnapshotInputType = '';
        practiceState.pendingSnapshotIndex = -1;
        if (practiceState.pendingEraseTimer) clearTimeout(practiceState.pendingEraseTimer);
        practiceState.pendingEraseTimer = 0;
        practiceState.statsHistory = [];
        practiceState.graphSelectedIndex = -1;
        practiceState.graphHoverIndex = -1;
        practiceState.testMode = testMode;
        practiceState.testVariant = getPracticeTestVariant(testMode);
        practiceState.personalBestWpm = getPersistentProgress().sessions.reduce(
            (best, session) => Math.max(best, Number(session.wpm) || 0), 0);
        const selectedLesson = document.getElementById('lessonSelect')?.value || '';
        practiceState.lessonId = testMode === 'lesson' && selectedLesson.startsWith('lessons/')
            ? selectedLesson
            : '';
        practiceState.quoteRanges = quoteTest?.ranges || [];
        practiceState.awaitingNextQuote = false;
        practiceState.dailyGoalReached = false;
        practiceState.completedQuotes = 0;
        practiceState.targetQuotes = quoteTest?.targetQuotes || 0;
        practiceState.targetWordCount = quoteTest?.targetWords || 0;
        practiceState.timeLimitSeconds = testMode === 'time' ? Number(document.getElementById('practiceTestDuration').value) || 60 : 0;
        practiceState.timeRemaining = practiceState.timeLimitSeconds;
        practiceState.sessionEnding = false;
        practiceState.timerInterval = 0;
        practiceState.completedIndices = new Set();
        practiceState.lastCompletedIndex = -1;
        practiceState.lastLiveStatsPaint = 0;
        practiceState.lastVisualIndex = -1;
        practiceState.renderedStart = 0;
        practiceState.renderedEnd = -1;
        practiceState.logicalInput = '';
        if (practiceState.replacementBurstTimer) clearTimeout(practiceState.replacementBurstTimer);
        practiceState.replacementBurstTimer = 0;
        practiceState.replacementIndex = -1;
        practiceState.reportedPracticeIndices = new Set();
        const graphLabel = document.getElementById('graphPointLabel');
        if (graphLabel) graphLabel.style.display = 'none';
        
        clearInterval(statsInterval);
        clearInterval(practiceState.timerInterval);
        practiceState.timerInterval = 0;
        statsInterval = setInterval(recordHistoryStat, 1000);
        
        document.getElementById('liveWpm').innerText = "0";
        document.getElementById('liveAcc').innerText = "0.00%";
        document.getElementById('liveAvgStr').innerText = "0";
        
        document.getElementById('practiceSetup').style.display = 'none';
        document.getElementById('practiceResults').style.display = 'none';
        document.getElementById('practiceArena').style.display = 'flex';
        calculateLiveStats();

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
        document.getElementById('liveTestStatus').textContent = getLiveTestStatus();
        renderPracticeDashboard();
        
        renderMonkeyText();
        updatePracticeBlindControls();
        
        const input = document.getElementById('practiceInput');
        input.value = "";
        input.focus();

        document.getElementById('monkeyContainer').onclick = () => input.focus();
    }

    function getLiveTestStatus() {
        if (practiceState.awaitingNextQuote && practiceState.testMode === 'daily' && practiceState.dailyGoalReached) {
            return 'Daily goal reached! Press Enter to continue, or Esc to finish.';
        }
        if (practiceState.awaitingNextQuote && isContinuousQuoteMode()) {
            return 'Quote complete. Press Enter for the next quote, or End test to finish.';
        }
        if (practiceState.testMode === 'time') {
            const seconds = Math.max(0, practiceState.timeRemaining);
            return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · timed steno`;
        }
        if (practiceState.testMode === 'quote') return `Quote ${practiceState.completedQuotes + 1}`;
        if (practiceState.testMode === 'daily') {
            const goal = updateDailyGoalProgress();
            return `Quotes ${goal.todayQuotes} / ${goal.quoteGoal} · Words ${goal.todayWords.toLocaleString()} / ${goal.wordGoal.toLocaleString()}`;
        }
        if (practiceState.testMode === 'quotes') {
            return `Quotes ${Math.min(practiceState.completedQuotes, practiceState.targetQuotes)} / ${practiceState.targetQuotes}`;
        }
        if (practiceState.testMode === 'words') {
            return `Words ${Math.min(practiceState.statsIndex, practiceState.targetWordCount)} / ${practiceState.targetWordCount}`;
        }
        if (practiceState.testMode === 'jeff-phrasing') {
            return `Phrases ${Math.min(practiceState.currentIndex, practiceState.words.length)} / ${practiceState.words.length}`;
        }
        if (practiceState.testMode === 'numbers' || practiceState.testMode === 'symbols') {
            const label = practiceState.testMode === 'numbers' ? 'Number items' : 'Symbols';
            return `${label} ${Math.min(practiceState.statsIndex, practiceState.targetWordCount)} / ${practiceState.targetWordCount}`;
        }
        if (practiceState.testMode === 'problematic' || practiceState.testMode === 'briefs') {
            const label = practiceState.testMode === 'problematic' ? 'Problematic words' : 'Briefs';
            return `${label} ${Math.min(practiceState.statsIndex, practiceState.words.length)} / ${practiceState.words.length}`;
        }
        return '';
    }

    function completeReachedPracticeQuotes() {
        if (!practiceState.quoteRanges.length) return;
        const progress = getPersistentProgress();
        let changed = false;
        let completedQuote = false;
        for (const range of practiceState.quoteRanges) {
            if (range.completed || practiceState.currentIndex < range.end) continue;
            range.completed = true;
            if (!range.complete) continue;
            completedQuote = true;
            const quoteStats = getCompletedQuoteStats(range);
            practiceState.completedQuotes++;
            progress.quoteHistory.push({
                date: new Date().toISOString(),
                quote: range.text,
                mode: practiceState.testMode,
                ...quoteStats
            });
            changed = true;
        }
        if (changed) {
            savePersistentProgress(progress);
            renderPracticeDashboard();
        }
        const status = document.getElementById('liveTestStatus');
        if (completedQuote && isContinuousQuoteMode()) practiceState.awaitingNextQuote = true;
        if (practiceState.testMode === 'daily') {
            calculateLiveStats();
            const goal = updateDailyGoalProgress(progress);
            if (goal.quotesComplete && goal.wordsComplete) practiceState.dailyGoalReached = true;
        } else if (practiceState.testMode === 'quote' && completedQuote) {
            endPractice();
        }
        if (status) status.textContent = getLiveTestStatus();
    }

    async function appendPracticeQuote() {
        const source = document.getElementById('quoteLanguage')?.value || '';
        if (!source) throw new Error('Choose a quote language before continuing quote practice.');
        const quotes = await loadPracticeQuotes(source);
        const candidates = pickQuotePool(quotes, document.getElementById('practiceQuoteLength')?.value || 'medium');
        const text = getRandomPracticeQuote(candidates, source);
        if (!text) throw new Error('No quotes are available for the selected language.');
        let tokens = tokenizePracticeText(text);
        if (practiceState.ignorePunct) {
            tokens = tokens.map(token => token.replace(/\p{P}/gu, '')).filter(Boolean);
        }
        if (!tokens.length) throw new Error('The selected quote has no practiceable words.');
        if (practiceState.words.length + tokens.length > MAX_PRACTICE_WORDS) {
            throw new Error('This session reached the 50,000-word practice limit. End the session and start another to continue.');
        }

        const start = practiceState.words.length;
        practiceState.words.push(...tokens);
        practiceState.quoteRanges.push({ start, end: start + tokens.length, text, complete: true, completed: false });
        for (const token of tokens) {
            practiceState.normalizedWords.push(normalizeForComparison(token));
            practiceState.typedWords.push('');
            practiceState.strokeCounts.push(0);
            practiceState.wordUnitCounts.push(isPracticePunctuation(token) ? 0 : 1);
            practiceState.maxStrokesMap[token] = await getStrokeLimitsAndOutlines(token);
        }
        return start;
    }

    async function advancePracticeQuote() {
        if (!isContinuousQuoteMode() || practiceState.sessionEnding) return;
        let nextRange = practiceState.quoteRanges.find(range => range.start >= practiceState.currentIndex && !range.completed);
        try {
            if (!nextRange) {
                const start = await appendPracticeQuote();
                nextRange = practiceState.quoteRanges.find(range => range.start === start);
            }
        } catch (error) {
            openModal('Unable to load next quote', error.message, () => {});
            return;
        }
        if (!nextRange) return;

        practiceState.awaitingNextQuote = false;
        practiceState.currentIndex = nextRange.start;
        practiceState.typedEndIndex = nextRange.start - 1;
        practiceState.lastCompletedIndex = nextRange.start - 1;
        practiceState.logicalInput = '';
        practiceState.lastInputValue = '';
        practiceState.lastStrokeKind = '';
        practiceState.lastStrokeTime = 0;
        practiceState.mismatchIndex = -1;
        practiceState.extraTypedWords = [];
        practiceState.renderedStart = 0;
        practiceState.renderedEnd = -1;
        practiceState.lastScrolledIndex = -1;
        practiceState.lastScrolledLineTop = -1;
        practiceState.lockedScrollTop = 0;
        document.getElementById('practiceInput').value = '';
        document.getElementById('monkeyContainer').scrollTop = 0;
        renderMonkeyText();
        document.getElementById('practiceInput').focus();
        const status = document.getElementById('liveTestStatus');
        if (status) status.textContent = getLiveTestStatus();
    }

    function startActiveQuoteTiming() {
        const range = practiceState.quoteRanges.find(({ start, end }) =>
            practiceState.currentIndex >= start && practiceState.currentIndex < end);
        if (range && !range.startedAt) range.startedAt = Date.now();
    }

    function getCompletedQuoteStats(range) {
        const indices = Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset);
        const attempted = indices.filter(index =>
            practiceState.correctPracticeIndices.has(index) || practiceState.incorrectWordIndices.has(index));
        const correct = attempted.filter(index =>
            practiceState.correctPracticeIndices.has(index) && !practiceState.incorrectWordIndices.has(index));
        const attemptedWords = attempted.reduce((total, index) =>
            total + (practiceState.wordUnitCounts[index] ?? 1), 0);
        const correctWords = correct.reduce((total, index) =>
            total + (practiceState.wordUnitCounts[index] ?? 1), 0);
        const words = indices.reduce((total, index) =>
            total + (practiceState.wordUnitCounts[index] ?? 1), 0);
        const strokes = indices.reduce((total, index) => total + (practiceState.strokeCounts[index] || 0), 0);
        const correctCharacters = correct.reduce((total, index) =>
            total + Array.from(String(practiceState.typedWords[index] || '')).length, 0);
        const elapsedSeconds = Math.max(1, (Date.now() - (range.startedAt || Date.now())) / 1000);

        return {
            wpm: Math.round(correctCharacters / 5 / (elapsedSeconds / 60)),
            accuracy: attemptedWords ? (correctWords / attemptedWords) * 100 : 0,
            avgStrokes: words ? strokes / words : 0,
            words: countQuoteWords(range.text)
        };
    }

    function startPracticeCountdown() {
        if (practiceState.testMode !== 'time' || practiceState.timerInterval) return;
        practiceState.timerInterval = setInterval(() => {
            practiceState.timeRemaining = Math.max(0, practiceState.timeRemaining - 1);
            const status = document.getElementById('liveTestStatus');
            if (status) status.textContent = getLiveTestStatus();
            calculateLiveStats();
            if (practiceState.timeRemaining === 0) endPractice();
        }, 1000);
    }

    function renderMonkeyText() {
        const container = document.getElementById('monkeyText');
        container.innerHTML = "";
        const ignoreCaps = practiceState.ignoreCaps;
        const ignorePunct = practiceState.ignorePunct;
        const blindMode = practiceState.blindMode;
        const activeIndex = practiceState.currentIndex;
        announceActivePracticeItem();
        const windowSize = 100;
        const startIndex = Math.max(0, activeIndex - 15);
        const endIndex = Math.min(practiceState.words.length - 1, activeIndex + windowSize - 1);
        practiceState.renderedStart = startIndex;
        practiceState.renderedEnd = endIndex;
        document.getElementById('monkeyContainer').scrollTop = 0;
        practiceState.lockedScrollTop = 0;

        for (let index = startIndex; index <= endIndex; index++) {
            if (index > 0 && practiceState.quoteRanges.some(range => range.start === index)) {
                const quoteBreak = document.createElement('div');
                quoteBreak.className = 'quote-break';
                quoteBreak.setAttribute('aria-hidden', 'true');
                container.appendChild(quoteBreak);
            }
            const word = practiceState.words[index];
            const isPunct = isPracticePunctuation(word);
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
            if (practiceState.testMode === 'jeff-phrasing') wordDiv.classList.add('jeff-phrase-word');
            const wordKey = String(word).toLowerCase();
            if (practiceState.problematicWordSet.has(wordKey)) {
                wordDiv.classList.add('problematic-word');
            } else if (practiceState.briefWordSet.has(wordKey)) {
                wordDiv.classList.add('brief-word');
            }
            wordDiv.id = `word-${index}`;

            if (index >= startIndex && index <= endIndex) {
                for(let i=0; i<word.length; i++) {
                    const span = document.createElement('span');
                    span.className = 'letter';
                    span.innerText = ignoreCaps ? word[i].toLowerCase() : word[i];
                    if (blindMode && index >= activeIndex && i >= (practiceState.typedWords[index] || '').length) {
                        span.classList.add('blind-hidden');
                    }
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
        announceActivePracticeItem();
        const needsWindow = practiceState.currentIndex < practiceState.renderedStart
            || (practiceState.renderedEnd < practiceState.words.length - 1
                && practiceState.currentIndex >= practiceState.renderedEnd - 20);
        if (needsWindow) renderMonkeyText();

        // Remove any stray cursors first to avoid multiple blinking cursors
        const oldCursor = document.querySelector('#monkeyText .monkey-cursor');
        if (oldCursor) oldCursor.remove();
        renderTypedExtras();

        const startIdx = practiceState.renderedStart;
        const endIdx = Math.min(practiceState.words.length - 1, Math.max(practiceState.currentIndex, practiceState.typedEndIndex));
        const ignoreCaps = practiceState.ignoreCaps;
        const ignorePunct = practiceState.ignorePunct;

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

            const isPunct = isPracticePunctuation(targetWord);

            for (let j = 0; j < targetWord.length; j++) {
                const span = letters[j];
                if (!span) continue;

                const typedLength = typed.length;
                span.classList.toggle('blind-hidden', practiceState.blindMode && i >= practiceState.currentIndex && j >= typedLength);

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

            if (practiceState.blindMode && i >= practiceState.currentIndex) {
                Array.from(wordDiv.children)
                    .filter(element => !element.classList.contains('monkey-cursor'))
                    .forEach((span, index) => span.classList.toggle('blind-hidden', index >= typed.length));
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
        scrollToActiveWord();
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
        const strokeIndex = practiceState.pendingSnapshotTimer
            ? practiceState.pendingSnapshotIndex
            : practiceState.currentIndex;
        if (practiceState.pendingSnapshotTimer) {
            clearTimeout(practiceState.pendingSnapshotTimer);
        }
        practiceState.pendingSnapshotIndex = strokeIndex;
        practiceState.pendingSnapshotTimer = setTimeout(() => {
            const snapshotIndex = practiceState.pendingSnapshotIndex;
            const inputType = practiceState.pendingSnapshotInputType;
            practiceState.pendingSnapshotTimer = 0;
            practiceState.pendingSnapshotIndex = -1;
            if (inputType === 'deleteContentBackward') {
                handleTyping({ inputType, data: null }, true);
            } else {
                countPracticeStroke(snapshotIndex);
                schedulePracticeVisualUpdate();
            }
            practiceState.pendingSnapshotInputType = '';
        }, 100);
    }

    function countPracticeStroke(index = practiceState.currentIndex) {
        const strokeTarget = practiceState.words[index];
        if (!strokeTarget) return;
        const strokeLimits = practiceState.maxStrokesMap[strokeTarget] || {min: 1, max: 1};
        practiceState.strokeCounts[index] =
            (practiceState.strokeCounts[index] || 0) + 1;

        const strokeTargetLimit = practiceState.hintType === 'longest'
            ? (strokeLimits.max || strokeLimits.min || 1)
            : (strokeLimits.min || strokeLimits.max || 1);
        if ((practiceState.strokeCounts[index] || 0) > strokeTargetLimit) {
            if (!practiceState.mistakePracticeIndices.has(index)) {
                practiceState.mistakePracticeIndices.add(index);
                practiceState.currentStreak = 0;
                playPracticeFeedback('miss');
                refreshPracticeAccuracy();
            }
        }
    }

    function handleTyping(event, forceSnapshot = false) {
        if (practiceState.awaitingNextQuote) {
            const input = document.getElementById('practiceInput');
            if (input) input.value = '';
            return;
        }
        const now = performance.now();

        const input = document.getElementById('practiceInput');
        const rawInputVal = input.value;
        let inputVal = rawInputVal.normalize('NFC');
        if (inputVal !== rawInputVal) {
            const caret = input.selectionStart;
            input.value = inputVal;
            const normalizedCaret = rawInputVal.slice(0, caret).normalize('NFC').length;
            input.setSelectionRange(normalizedCaret, normalizedCaret);
        }
        let previousInput = practiceState.lastInputValue;
        const inputType = event.inputType || '';
        const isInsertion = !inputType || inputType.startsWith('insert');
        const isDeletion = inputType.startsWith('delete');
        const insertedSpace = isInsertion && /\s$/.test(inputVal);
        const deletedSpace = isDeletion && /\s$/.test(previousInput);
        const strokeKind = isDeletion ? 'delete' : 'insert';
        const isStrokeChange = inputVal !== previousInput && (isInsertion || isDeletion) && !insertedSpace && !deletedSpace;
        const isDeleteChange = isDeletion && inputVal !== previousInput;

        if (!practiceState.sessionStartTime && isInsertion && inputVal.trim()) {
            practiceState.sessionStartTime = now;
            startPracticeCountdown();
        }
        if (isInsertion && inputVal.trim()) startActiveQuoteTiming();

        if (isInsertion && inputVal.trim() && !forceSnapshot && !insertedSpace) {
            practiceState.logicalInput = inputVal;
            practiceState.lastInputValue = inputVal;
            const activeWord = practiceState.words[practiceState.currentIndex];
            const activeTypedText = String(activeWord || '').includes(' ')
                ? inputVal
                : (inputVal.match(/\S*$/) || [''])[0];
            if (activeWord) {
                practiceState.typedWords[practiceState.currentIndex] = activeTypedText;
                practiceState.typedEndIndex = practiceState.currentIndex;
                const normalizedTarget = practiceState.normalizedWords[practiceState.currentIndex]
                    || normalizeForComparison(activeWord);
                const normalizedTyped = normalizeForComparison(activeTypedText);
                practiceState.mismatchIndex = normalizedTarget.startsWith(normalizedTyped)
                    ? -1
                    : practiceState.currentIndex;
                if (practiceState.mismatchIndex >= 0) {
                    practiceState.incorrectWordIndices.add(practiceState.currentIndex);
                }
            }
            practiceState.pendingSnapshotInputType = 'insertText';
            schedulePracticeSnapshotCheck();
            schedulePracticeVisualUpdate();
            return;
        }

        if (inputVal !== previousInput) {
        }

        if (isDeletion) {
            practiceState.logicalInput = inputVal;
            if (practiceState.currentIndex < practiceState.words.length) {
                practiceState.typedWords[practiceState.currentIndex] = inputVal;
                practiceState.mismatchIndex = -1;
                practiceState.extraTypedWords = [];
            }
            practiceState.lastInputValue = inputVal;
            if (!forceSnapshot) {
                practiceState.pendingSnapshotInputType = 'deleteContentBackward';
                schedulePracticeSnapshotCheck();
            }
            schedulePracticeVisualUpdate();
            return;
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

        practiceState.lastInputValue = inputVal;

        // Split into non-empty segments so spaces inside Typey Type phrases
        // can be consumed as part of one practice target.
        const typedArray = inputVal.match(/\S+/g) || [];
        const isMultiWordInsertion = isInsertion && typedArray.length > 1;
        // Map typed segments to token-wise typedWords (support glued punctuation like "another.")
        const words = practiceState.words || [];
        if (insertedSpace && inputVal.trim()) {
            practiceState.pendingSnapshotInputType = 'insertText';
            schedulePracticeSnapshotCheck();
        }

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
            const segmentTokens = tokenizePracticeText(completedSegment);
            const tokenizedMatchesTargets = segmentTokens.length > 1 &&
                segmentTokens.length <= words.length - practiceState.currentIndex &&
                segmentTokens.every((token, offset) => {
                    const targetIndex = practiceState.currentIndex + offset;
                    const target = words[targetIndex];
                    return target !== undefined &&
                        normalizeForComparison(token) === (practiceState.normalizedWords[targetIndex] || normalizeForComparison(target));
                });
            if (normalizeForComparison(completedSegment) === normalizedTarget || tokenizedMatchesTargets) {
                const completedTokens = tokenizedMatchesTargets ? segmentTokens : [completedSegment];
                completedTokens.forEach((token, offset) => {
                    const targetIndex = practiceState.currentIndex + offset;
                    practiceState.typedWords[targetIndex] = token;
                    if (!practiceState.completedIndices.has(targetIndex)) {
                        practiceState.completedIndices.add(targetIndex);
                        registerCorrectPracticeWord(words[targetIndex]);
                    }
                    recordCompletedPracticeWord(targetIndex, token);
                });
                practiceState.logicalInput = completedSegment;
                practiceState.lastCompletedIndex = practiceState.currentIndex + completedTokens.length - 1;
                practiceState.currentIndex += completedTokens.length;
                if (practiceState.ignorePunct) {
                    while (practiceState.currentIndex < words.length && isPracticePunctuation(words[practiceState.currentIndex])) {
                        practiceState.currentIndex++;
                    }
                }
                practiceState.mismatchIndex = -1;
                completeReachedPracticeQuotes();
                input.value = '';
                practiceState.lastInputValue = '';
                practiceState.lastStrokeKind = '';
                practiceState.lastStrokeTime = 0;
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
                recordPracticeMistake(practiceState.currentIndex);
            }
            schedulePracticeVisualUpdate();
            if (practiceState.currentIndex >= words.length && !isContinuousQuoteMode()) endPractice();
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

            const segmentTokens = tokenizePracticeText(seg);
            const tokenizedMatchesTargets = segmentTokens.length > 1 &&
                segmentTokens.length <= words.length - wIdx &&
                segmentTokens.every((token, offset) => {
                    const targetIndex = wIdx + offset;
                    const tokenTarget = words[targetIndex];
                    return tokenTarget !== undefined &&
                        normalizeForComparison(token) === (practiceState.normalizedWords[targetIndex] || normalizeForComparison(tokenTarget));
                });
            if (tokenizedMatchesTargets) {
                segmentTokens.forEach((token, offset) => {
                    const targetIndex = wIdx + offset;
                    const tokenTarget = words[targetIndex];
                    typedPerToken[targetIndex] = token;
                    if (!practiceState.completedIndices.has(targetIndex)) {
                        practiceState.completedIndices.add(targetIndex);
                        registerCorrectPracticeWord(tokenTarget);
                    }
                    recordCompletedPracticeWord(targetIndex, token);
                    if (isMultiWordInsertion && (tIdx > 0 || offset > 0)) practiceState.strokeCounts[targetIndex] = 0;
                });
                practiceState.lastCompletedIndex = wIdx + segmentTokens.length - 1;
                tIdx++;
                wIdx += segmentTokens.length;
                continue;
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
            while (wIdx < words.length && isPracticePunctuation(words[wIdx])) wIdx++;
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
        completeReachedPracticeQuotes();

        if (firstMismatch < 0 && (completedItem || wIdx > mappingStartIndex)) {
            input.value = '';
            practiceState.lastInputValue = '';
            practiceState.lastStrokeKind = '';
            practiceState.lastStrokeTime = 0;
            practiceState.extraTypedWords = [];
        }

        // no endless mode: do not append copies

        schedulePracticeVisualUpdate();
        
        if (practiceState.currentIndex >= practiceState.words.length && !isContinuousQuoteMode()) {
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
            const minutes = practiceState.sessionStartTime ? (now - practiceState.sessionStartTime) / 60000 : 0;
        
            const completedItems = Math.min(practiceState.currentIndex, practiceState.words.length);
            const wordUnitCount = index => practiceState.wordUnitCounts[index] ?? 1;
            practiceState.statsCorrectWords = Array.from(practiceState.correctPracticeIndices)
                .reduce((total, index) => total + wordUnitCount(index), 0);
        practiceState.statsCorrectChars = 0;
        practiceState.statsTotalStrokes = 0;
            let completedWordUnits = 0;
            for (let i = 0; i < completedItems; i++) {
                const wordUnits = wordUnitCount(i);
                completedWordUnits += wordUnits;
                if (practiceState.correctPracticeIndices.has(i)) {
                    practiceState.statsCorrectChars += practiceState.words[i].length + 1;
                }
                if (wordUnits > 0) {
                    practiceState.statsTotalStrokes += practiceState.strokeCounts[i] || 0;
                }
            }
            practiceState.statsIndex = completedWordUnits;

        const wpm = minutes > 0 ? Math.round((practiceState.statsCorrectChars / 5) / minutes) : 0;
        updateWpmMilestoneProgress(Math.max(practiceState.personalBestWpm, wpm));
        updateDailyGoalProgress();
        const totalPracticeWords = practiceState.wordUnitCounts.length
            ? practiceState.wordUnitCounts.reduce((total, count) => total + count, 0)
            : practiceState.words.length;
        const acc = getPracticeAccuracy();
        
        const avgStr = practiceState.statsIndex > 0 ? (practiceState.statsTotalStrokes / practiceState.statsIndex).toFixed(2) : 0;
        const liveWpm = document.getElementById('liveWpm');
        const liveAcc = document.getElementById('liveAcc');
        const liveAvgStr = document.getElementById('liveAvgStr');
        const liveStreak = document.getElementById('liveStreak');
        const liveLongestStreak = document.getElementById('liveLongestStreak');

        if (liveWpm) liveWpm.innerText = wpm;
        if (liveAcc) liveAcc.innerText = acc.toFixed(2) + '%';
        if (liveAvgStr) liveAvgStr.innerText = avgStr;
        if (liveStreak) liveStreak.innerText = practiceState.currentStreak;
        if (liveLongestStreak) liveLongestStreak.innerText = practiceState.longestStreak;
        
        const completed = Math.min(practiceState.statsIndex, totalPracticeWords);
        const progressText = document.getElementById('liveProgressText');
        const progressBar = document.getElementById('liveProgressBar');
        let progressLabel = `${completed} / ${totalPracticeWords}`;
        let progressPercent = totalPracticeWords ? completed / totalPracticeWords * 100 : 0;
        if (practiceState.testMode === 'time') {
            progressLabel = `${practiceState.completedQuotes} quotes`;
            progressPercent = practiceState.timeLimitSeconds
                ? (practiceState.timeLimitSeconds - practiceState.timeRemaining) / practiceState.timeLimitSeconds * 100
                : 0;
        } else if (practiceState.testMode === 'daily') {
            const goal = updateDailyGoalProgress();
            progressLabel = `Quotes ${goal.todayQuotes} / ${goal.quoteGoal} · Words ${goal.todayWords.toLocaleString()} / ${goal.wordGoal.toLocaleString()}`;
            progressPercent = Math.min(
                goal.todayQuotes / goal.quoteGoal * 100,
                goal.todayWords / goal.wordGoal * 100
            );
        } else if (practiceState.testMode === 'quote') {
            progressLabel = `${practiceState.completedQuotes} quotes completed · quote ${practiceState.completedQuotes + 1}`;
            const activeRange = practiceState.quoteRanges.find(range =>
                practiceState.currentIndex >= range.start && practiceState.currentIndex < range.end);
            progressPercent = activeRange
                ? (practiceState.currentIndex - activeRange.start) / Math.max(1, activeRange.end - activeRange.start) * 100
                : 100;
        } else if (practiceState.testMode === 'quotes') {
            progressLabel = `${practiceState.completedQuotes} / ${practiceState.targetQuotes} quotes`;
            progressPercent = practiceState.targetQuotes
                ? practiceState.completedQuotes / practiceState.targetQuotes * 100
                : 0;
        } else if (practiceState.testMode === 'words') {
            progressLabel = `${Math.min(completed, practiceState.targetWordCount)} / ${practiceState.targetWordCount} words`;
            progressPercent = practiceState.targetWordCount
                ? Math.min(100, completed / practiceState.targetWordCount * 100)
                : 0;
        } else if (practiceState.testMode === 'jeff-phrasing') {
            const completedPhrases = Math.min(practiceState.currentIndex, practiceState.words.length);
            progressLabel = `${completedPhrases} / ${practiceState.words.length} phrases`;
            progressPercent = practiceState.words.length ? completedPhrases / practiceState.words.length * 100 : 0;
        } else if (practiceState.testMode === 'numbers' || practiceState.testMode === 'symbols') {
            const itemLabel = practiceState.testMode === 'numbers' ? 'items' : 'symbols';
            progressLabel = `${Math.min(completed, practiceState.targetWordCount)} / ${practiceState.targetWordCount} ${itemLabel}`;
            progressPercent = practiceState.targetWordCount
                ? Math.min(100, completed / practiceState.targetWordCount * 100)
                : 0;
        }
        if (progressText) progressText.innerText = progressLabel;
        if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, progressPercent))}%`;
        if (practiceState.testMode === 'daily') {
            updateDailyGoalProgress();
        }
        const status = document.getElementById('liveTestStatus');
        if (status) status.textContent = getLiveTestStatus();
        return { wpm, acc, avgStr, streak: practiceState.currentStreak, longestStreak: practiceState.longestStreak };
    }

    function recordHistoryStat() {
        if (!practiceState.sessionStartTime) return;
        const stats = calculateLiveStats();
        stats.word = practiceState.words[Math.max(0, practiceState.currentIndex - 1)] || practiceState.words[practiceState.currentIndex] || '';
        stats.typedWords = practiceState.statsIndex;
        practiceState.statsHistory.push(stats);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }
    function escapeInlineJson(value) {
        return JSON.stringify(String(value)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function formatSessionTooltip(session, typedWords = session.words) {
        return `${escapeHtml(new Date(session.date).toLocaleString())}<br>${escapeHtml(session.mode)} | ${typedWords} words typed<br>WPM: ${Number(session.wpm) || 0} | Accuracy: ${(Number(session.acc) || 0).toFixed(2)}%<br>Avg strokes/word: ${(Number(session.avgStr) || 0).toFixed(2)} | Longest streak: ${Number(session.longestStreak) || 0}`;
    }

    function formatLiveTooltip(point) {
        return `${escapeHtml(new Date(practiceState.sessionStartDate || Date.now()).toLocaleString())}<br>${escapeHtml(practiceState.mode)} | ${point.typedWords || 0} words typed<br>WPM: ${point.wpm || 0} | Accuracy: ${(Number(point.acc) || 0).toFixed(2)}%<br>Avg strokes/word: ${(Number(point.avgStr) || 0).toFixed(2)} | Longest streak: ${practiceState.longestStreak}`;
    }

    function endPractice() {
        if (practiceState.sessionEnding) return;
        practiceState.sessionEnding = true;
        if (practiceState.pendingSnapshotTimer) {
            clearTimeout(practiceState.pendingSnapshotTimer);
            if (practiceState.pendingSnapshotInputType !== 'deleteContentBackward') {
                countPracticeStroke(practiceState.pendingSnapshotIndex);
            }
            practiceState.pendingSnapshotTimer = 0;
            practiceState.pendingSnapshotIndex = -1;
            practiceState.pendingSnapshotInputType = '';
        }
        clearInterval(statsInterval);
        clearInterval(practiceState.timerInterval);
        practiceState.timerInterval = 0;
        if (practiceState.blindTimer) {
            clearInterval(practiceState.blindTimer);
            practiceState.blindTimer = 0;
        }
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
                recordPracticeMistake(practiceState.currentIndex);
            }
        }
        document.getElementById('practiceArena').style.display = 'none';
        document.getElementById('practiceResults').style.display = 'block';

        const finalStats = calculateLiveStats();

        const progress = getPersistentProgress();
        const completedWords = Math.max(0, practiceState.statsIndex);
        const sessionDuration = practiceState.sessionStartTime
            ? Math.round((performance.now() - practiceState.sessionStartTime) / 1000)
            : 0;
        if (completedWords > 0 || sessionDuration > 0) {
            progress.sessions.push({
                date: new Date().toISOString(),
                mode: practiceState.mode,
                testMode: practiceState.testMode,
                testVariant: practiceState.testVariant,
                lessonId: practiceState.lessonId,
                words: completedWords,
                phrases: practiceState.testMode === 'jeff-phrasing'
                    ? Math.min(practiceState.currentIndex, practiceState.words.length)
                    : undefined,
                wpm: finalStats.wpm,
                acc: Number(finalStats.acc.toFixed(2)),
                avgStr: Number(finalStats.avgStr) || 0,
                longestStreak: practiceState.longestStreak,
                quotes: practiceState.completedQuotes,
                durationSeconds: sessionDuration
            });
        }
        if (progress.sessions.length > MAX_PROGRESS_SESSIONS) progress.sessions = progress.sessions.slice(-MAX_PROGRESS_SESSIONS);
        savePersistentProgress(progress);
        renderPracticeDashboard();
        renderPersistentProblemWords();
        drawPersistentProgressGraph();

        document.getElementById('resWpm').innerText = finalStats.wpm;
        document.getElementById('resAcc').innerText = finalStats.acc.toFixed(2) + "%";
        document.getElementById('resStr').innerText = finalStats.avgStr;
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

    const practiceGraphPadding = { top: 20, right: 20, bottom: 24, left: 88 };

    function drawMetricLanes(canvas, records, selectedIndex, hoverIndex, getValues, emptyMessage) {
        const responsiveWidth = Math.round(canvas.clientWidth || canvas.width);
        const responsiveHeight = Math.round(responsiveWidth / 2);
        if (canvas.width !== responsiveWidth || canvas.height !== responsiveHeight) {
            canvas.width = responsiveWidth;
            canvas.height = responsiveHeight;
        }
        const ctx = canvas.getContext('2d');
        const root = getComputedStyle(document.body);
        const border = root.getPropertyValue('--border').trim() || '#555555';
        const colors = ['--stat-wpm', '--stat-acc', '--stat-str', '--stat-streak'].map(name => root.getPropertyValue(name).trim());
        const metrics = [
            { name: 'WPM', suffix: '', step: 20, fallback: 100 },
            { name: 'Accuracy', suffix: '%', step: 10, fixedMax: 100 },
            { name: 'Avg Strokes', suffix: '', step: 0.5, fallback: 2 },
            { name: 'Streak', suffix: '', step: 1, fallback: 10 },
        ];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!records.length) {
            ctx.fillStyle = root.getPropertyValue('--text-muted').trim();
            ctx.font = '14px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(emptyMessage, 20, 36);
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
            ctx.textAlign = 'left';
            ctx.fillText(metric.name, 8, top + laneHeight / 2, practiceGraphPadding.left - 18);
            ctx.textAlign = 'right';
            ctx.fillText(`${maxValue}${metric.suffix}`, practiceGraphPadding.left - 8, top + 5);
            ctx.fillText(`0${metric.suffix}`, practiceGraphPadding.left - 8, bottom - 5);

            if (points.length) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, bottom);
                points.forEach(point => ctx.lineTo(point.x, point.y));
                ctx.lineTo(points[points.length - 1].x, bottom);
                ctx.closePath();
                ctx.globalAlpha = 0.09;
                ctx.fillStyle = colors[metricIndex];
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            points.forEach((point, index) => {
                ctx.beginPath();
                ctx.fillStyle = colors[metricIndex];
                ctx.arc(point.x, point.y, index === selectedIndex || index === hoverIndex ? 4 : 2, 0, Math.PI * 2);
                ctx.fill();
            });
            drawSmoothGraphLine(ctx, points, colors[metricIndex], 2);
        });
    }

    function drawResultsGraph() {
        const canvas = document.getElementById('resultGraph');
        const history = practiceState.statsHistory || [];
        drawMetricLanes(canvas, history, practiceState.graphSelectedIndex, practiceState.graphHoverIndex, metricIndex => history.map(point => {
            if (metricIndex === 0) return Number(point.wpm) || 0;
            if (metricIndex === 1) return Number(point.acc) || 0;
            if (metricIndex === 2) return Number(point.avgStr) || 0;
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
            label.innerHTML = formatLiveTooltip(point);
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
        drawMetricLanes(canvas, sessions, -1, -1, metricIndex => sessions.map(session => {
            if (metricIndex === 0) return Number(session.wpm) || 0;
            if (metricIndex === 1) return Number(session.acc) || 0;
            if (metricIndex === 2) return Number(session.avgStr) || 0;
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
            label.innerHTML = formatSessionTooltip(session);
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
        window.addEventListener('resize', () => {
            drawPersistentProgressGraph();
            if (document.getElementById('practiceResults').style.display !== 'none') drawResultsGraph();
        });
        document.querySelector('.activity-details')?.addEventListener('toggle', event => {
            if (event.target.open) drawPersistentProgressGraph();
        });
        hideLoader();
        initDB();
    };

    document.addEventListener('keydown', event => {
        const sidebar = document.getElementById('sidebar');
        const searchModeMenu = document.getElementById('searchModeMenu');
        const searchModeButton = document.getElementById('searchModeBtn');
        const isEditable = event.target instanceof HTMLElement
            && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));

        if (event.key === 'Escape' && sidebar.classList.contains('open')) {
            event.preventDefault();
            event.stopPropagation();
            toggleSidebar();
            document.getElementById('menuToggle').focus();
            return;
        }
        if (event.key === 'Escape' && searchModeMenu.classList.contains('visible')) {
            event.preventDefault();
            event.stopPropagation();
            searchModeMenu.classList.remove('visible');
            searchModeButton.setAttribute('aria-expanded', 'false');
            searchModeButton.focus();
            return;
        }
        if (event.target === searchModeButton && event.key === 'ArrowDown') {
            event.preventDefault();
            if (!searchModeMenu.classList.contains('visible')) toggleSearchMenu(event);
            searchModeMenu.querySelector('button')?.focus();
            return;
        }
        if (searchModeMenu.classList.contains('visible')
            && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            && event.target instanceof HTMLElement
            && event.target.classList.contains('search-mode-option')) {
            event.preventDefault();
            const options = Array.from(searchModeMenu.querySelectorAll('.search-mode-option'));
            const currentIndex = options.indexOf(event.target);
            const step = event.key === 'ArrowDown' ? 1 : -1;
            options[(currentIndex + step + options.length) % options.length]?.focus();
            return;
        }
        if (event.target instanceof HTMLElement && event.target.matches('[role="tab"]')
            && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = Array.from(document.querySelectorAll('#viewTabs [role="tab"]'));
            const currentIndex = tabs.indexOf(event.target);
            const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[nextIndex].focus();
            switchTab(tabs[nextIndex].id === 'searchTab' ? 'search' : 'practice');
            return;
        }
        if (event.key === '/' && !isEditable && !event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat
            && document.getElementById('practiceArena').style.display === 'none'
            && !sidebar.classList.contains('open')) {
            event.preventDefault();
            switchTab('search');
            document.getElementById('searchInput').focus();
        }
    });

    let practiceRestartShortcutReady = false;
    window.addEventListener('keydown', event => {
        const practiceArena = document.getElementById('practiceArena');
        const practiceResults = document.getElementById('practiceResults');
        if (practiceArena.style.display === 'none') {
            const practiceView = document.getElementById('practiceView');
            const practiceSetup = document.getElementById('practiceSetup');
            if (practiceResults.style.display !== 'none' && event.key === 'Escape') {
                event.preventDefault();
                practiceRestartShortcutReady = false;
                resetPracticeUI();
                return;
            }
            if (practiceResults.style.display !== 'none'
                && event.key === 'Enter'
                && !event.altKey
                && !event.ctrlKey
                && !event.metaKey) {
                event.preventDefault();
                practiceRestartShortcutReady = false;
                if (practiceState.testMode === 'quote' || practiceState.testMode === 'daily') {
                    document.getElementById('practiceTestMode').value = 'quote';
                    updatePracticeTestControls();
                }
                startPractice();
                return;
            }
            if (practiceResults.style.display === 'none'
                && practiceView.style.display !== 'none'
                && practiceSetup.style.display !== 'none'
                && event.key === 'Enter'
                && !event.altKey
                && !event.ctrlKey
                && !event.metaKey
                && !event.repeat) {
                event.preventDefault();
                practiceRestartShortcutReady = false;
                startPractice();
            }
            return;
        }
        if (event.key === 'Enter' && practiceRestartShortcutReady) {
            event.preventDefault();
            practiceRestartShortcutReady = false;
            restartPractice();
        } else if (event.key === 'Enter' && practiceState.awaitingNextQuote && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            practiceRestartShortcutReady = false;
            advancePracticeQuote();
        } else if (event.key === 'Escape') {
            practiceRestartShortcutReady = false;
            endPractice();
        } else if (event.key === 'Tab') {
            event.preventDefault();
            practiceRestartShortcutReady = true;
            document.getElementById('practiceInput').focus();
        } else if (event.key !== 'Shift') {
            practiceRestartShortcutReady = false;
        }
    });