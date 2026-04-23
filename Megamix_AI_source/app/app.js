(function () {
    'use strict';

    const state = window.MegaMix && window.MegaMix.state;
    if (!state) return;
    window.MegaMix.JOSH_VERB_DISABLED = true;

    const views = {
        app: document.getElementById('view-app'),
        mastering: document.getElementById('view-mastering'),
        pricing: document.getElementById('view-pricing'),
        manageSubscription: document.getElementById('view-manage-subscription')
    };
    let pendingDownload = null;
    let pendingSingleFile = null;
    let hasShownUploadFxModalThisSession = false;
    const emailModalApp = document.getElementById('emailModalApp');
    const emailInputApp = document.getElementById('emailInputApp');
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const fileListEl = document.getElementById('file-list');
    const presetSelect = document.getElementById('preset-select');
    const guidanceForJosh = document.getElementById('guidance-for-josh');
    const btnMixIt = document.getElementById('btn-mix-it');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    const mixerStripsEl = document.getElementById('mixer-strips');
    const presetNameInput = document.getElementById('preset-name-input');
    const btnSavePreset = document.getElementById('btn-save-preset');
    const loadPresetSelect = document.getElementById('load-preset-select');
    const btnLoadPreset = document.getElementById('btn-load-preset');
    const audioBefore = document.getElementById('audio-before');
    const audioAfter = document.getElementById('audio-after');
    const playBtn = document.getElementById('play-btn');
    const playbackProgress = document.getElementById('playback-progress');
    const playbackTime = document.getElementById('playback-time');
    const playbackDuration = document.getElementById('playback-duration');
    const playbackInstruction = document.getElementById('playback-instruction');
    const playbackBuilding = document.getElementById('playback-building');
    const mixLoadingBlock = document.getElementById('mix-loading-block');
    const mixItLoading = document.getElementById('mix-it-loading');
    const mixItLoadingText = document.getElementById('mix-it-loading-text');
    const mixItProgressFill = document.getElementById('mix-it-progress-fill');
    const masteringLoadingBlock = document.getElementById('mastering-loading-block');
    const btnExport = document.getElementById('btn-export');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const toggleFileListBtn = document.getElementById('toggle-file-list');
    const uploadAndFilesBody = document.getElementById('upload-and-files-body');
    const masteringStatusEl = document.getElementById('mastering-status');

    let masteringGraphInited = false;
    let masterCompressor = null;
    let masterGain = null;
    let masterDryGain = null;
    let masterWetGain = null;

    function showToast(html, anchorEl) {
        var toast = document.createElement('div');
        toast.className = 'toast toast-anchored';
        toast.setAttribute('role', 'alert');
        toast.innerHTML = html;
        document.body.appendChild(toast);
        if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
            var rect = anchorEl.getBoundingClientRect();
            var toastRect = toast.getBoundingClientRect();
            var spaceAbove = rect.top;
            var spaceBelow = (window.innerHeight || document.documentElement.clientHeight) - rect.bottom;
            var pad = 8;
            if (spaceAbove >= toastRect.height + pad || spaceBelow < spaceAbove) {
                toast.style.top = (rect.bottom + pad) + 'px';
                toast.style.left = Math.max(pad, Math.min(rect.left, (window.innerWidth || document.documentElement.clientWidth) - toastRect.width - pad)) + 'px';
            } else {
                toast.style.top = (rect.top - toastRect.height - pad) + 'px';
                toast.style.left = Math.max(pad, Math.min(rect.left, (window.innerWidth || document.documentElement.clientWidth) - toastRect.width - pad)) + 'px';
            }
        } else {
            toast.style.bottom = '24px';
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
        }
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 5500);
    }

    function showView(name) {
        Object.keys(views).forEach(k => {
            if (!views[k]) return;
            const isTarget = k === name;
            views[k].classList.toggle('hidden', !isTarget);
            views[k].classList.toggle('view-visible', isTarget);
        });
        var joshAvatar = document.getElementById('josh-avatar');
        if (joshAvatar) joshAvatar.classList.toggle('hidden', name !== 'app' && name !== 'mastering');
        const active = views[name];
        if (active) {
            void active.offsetHeight; // force reflow so fade-in animation runs
            setTimeout(() => active.classList.remove('view-visible'), 350);
        }
        if (name === 'mastering') {
            var ab = document.getElementById('audio-before');
            var aa = document.getElementById('audio-after');
            var pb = document.getElementById('play-btn');
            if (ab) ab.pause();
            if (aa) aa.pause();
            if (window.MegaMix && typeof window.MegaMix.stopLivePlayback === 'function') window.MegaMix.stopLivePlayback();
            if (pb) {
                pb.classList.remove('playing');
                pb.textContent = '\u25B6';
            }
            initMasteringPageWhenShown();
            setTimeout(function () {
                var viewMastering = document.getElementById('view-mastering');
                if (viewMastering) viewMastering.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        }
        if (name === 'app') {
            var amb = document.getElementById('audio-mastering-before');
            var am = document.getElementById('audio-mastering');
            var pm = document.getElementById('play-mastering');
            if (amb) amb.pause();
            if (am) am.pause();
            if (pm) {
                pm.classList.remove('playing');
                pm.textContent = '\u25B6';
            }
        }
    }
    document.querySelectorAll('[data-view]').forEach(el => {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            const v = this.getAttribute('data-view');
            if (v) showView(v);
        });
    });

    function updatePlaybackInstruction() {
        if (!playbackInstruction) return;
        if (!state.mixReady) {
            playbackInstruction.textContent = 'Upload your tracks, then click Mix it to create your mix. After that, use Before/After to compare.';
            if (playBtn) playBtn.disabled = true;
        } else {
            playbackInstruction.textContent = 'Before = flat mix; After = your mix. Refine with Josh below.';
            if (playBtn) playBtn.disabled = false;
        }
        const btnExport = document.getElementById('btn-export');
        const btnMastering = document.getElementById('btn-ai-mastering');
        if (btnExport) btnExport.disabled = !state.mixReady;
        if (btnMastering) btnMastering.disabled = !state.mixReady;
    }
    function updateMasteringUI() {
        /* Mastering preview/download now on dedicated Mastering page */
    }

    async function buildMixAndSetUrls() {
        window.MegaMix.revokeMixUrls();
        if (state.uploadedFiles.length === 0) {
            audioBefore.removeAttribute('src');
            audioAfter.removeAttribute('src');
            if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
            playbackInstruction.classList.remove('hidden');
            playBtn.disabled = true;
        return;
        }
        playbackInstruction.classList.add('hidden');
        if (mixLoadingBlock) mixLoadingBlock.classList.remove('hidden');
        playBtn.disabled = true;
        try {
            await window.MegaMix.decodeStemsToBuffers();
            if (state.stemBuffers.length === 0) return;
            const beforeMix = window.MegaMix.buildMixedBuffer(true);
            const afterMix = await window.MegaMix.buildAfterMixWithFX();
            if (beforeMix) {
                state.mixedBeforeUrl = URL.createObjectURL(window.MegaMix.encodeWav(beforeMix.left, beforeMix.right, beforeMix.sampleRate));
                audioBefore.src = state.mixedBeforeUrl;
            }
            if (afterMix) {
                state.mixedAfterUrl = URL.createObjectURL(window.MegaMix.encodeWav(afterMix.left, afterMix.right, afterMix.sampleRate));
                audioAfter.src = state.mixedAfterUrl;
            }
            if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
            playbackInstruction.classList.remove('hidden');
            playBtn.disabled = false;
        } catch (e) {
            console.error(e);
            if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
            playbackInstruction.classList.remove('hidden');
            playbackInstruction.textContent = 'Mix build failed. Try fewer or shorter files.';
            playBtn.disabled = true;
        }
    }

    function addFiles(files) {
        const accepted = Array.from(files).filter(f => {
            const n = f.name.toLowerCase();
            return n.endsWith('.wav') || n.endsWith('.mp3') || (f.type && f.type.startsWith('audio/'));
        });
        if (accepted.length === 0) return;
        // Analytics: upload start
        try {
            if (window.trackEvent && accepted.length > 0) {
                let totalBytes = 0;
                accepted.forEach(function (f) { if (f && typeof f.size === 'number') totalBytes += f.size; });
                const totalMb = totalBytes / (1024 * 1024);
                let sizeBucket = '<200MB';
                if (totalMb >= 500) sizeBucket = '>500MB';
                else if (totalMb >= 200) sizeBucket = '200-500MB';
                window.trackEvent('mix_upload_start', {
                    file_count: accepted.length,
                    total_size_mb: Math.round(totalMb),
                    size_bucket: sizeBucket
                });
            }
        } catch (e) {
            // ignore analytics errors
        }
        if (accepted.length === 1) {
            pendingSingleFile = accepted[0];
            var modalEl = document.getElementById('one-file-not-supported-modal');
            if (modalEl) {
                modalEl.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            }
            return;
        }
        const existingLen = state.uploadedFiles.length;
        for (const f of accepted) {
            if (state.uploadedFiles.length >= window.MegaMix.MAX_FILES) break;
            state.uploadedFiles.push({ file: f, name: f.name, url: URL.createObjectURL(f) });
        }
        state.tracks = state.uploadedFiles.map((e, i) => {
            if (i < existingLen && state.tracks[i]) return state.tracks[i];
            return window.MegaMix.defaultTrack(e.name);
        });
        renderFileList();
        renderMixerStrips();
        updatePlaybackInstruction();
        // Analytics: upload complete (files accepted into state)
        try {
            if (window.trackEvent && state.uploadedFiles.length > 0) {
                window.trackEvent('mix_upload_complete', {
                    file_count: state.uploadedFiles.length
                });
            }
        } catch (e) {
            // ignore analytics errors
        }
        if (state.uploadedFiles.length > existingLen) {
            if (state.uploadedFiles.length >= 2 && !hasShownUploadFxModalThisSession) {
                hasShownUploadFxModalThisSession = true;
                const uploadFxModal = document.getElementById('upload-fx-info-modal');
                if (uploadFxModal) {
                    uploadFxModal.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                }
            }
            const panel = document.getElementById('panel-simple');
            const step2 = panel ? panel.previousElementSibling : null;
            if (step2) step2.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function removeFile(index) {
        const entry = state.uploadedFiles[index];
        if (entry && entry.url) URL.revokeObjectURL(entry.url);
        state.uploadedFiles.splice(index, 1);
        state.tracks.splice(index, 1);
        renderFileList();
        renderMixerStrips();
        if (state.uploadedFiles.length === 0) {
            state.mixReady = false;
            state.hasInitialMix = false;
            state.stemBuffers = [];
            state.trackAnalyses = [];
            window.MegaMix.stopLivePlayback();
            window.MegaMix.revokeMixUrls();
            window.MegaMix.revokeMasteredUrl();
            if (audioBefore) audioBefore.removeAttribute('src');
            if (audioAfter) audioAfter.removeAttribute('src');
            updatePlaybackInstruction();
            updateMasteringUI();
        }
    }

    function renderFileList() {
        fileListEl.innerHTML = '';
        state.uploadedFiles.forEach((entry, i) => {
            const li = document.createElement('li');
            li.textContent = entry.name;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'remove-file';
            btn.textContent = '×';
            btn.setAttribute('aria-label', 'Remove');
            btn.addEventListener('click', () => removeFile(i));
            li.appendChild(btn);
            fileListEl.appendChild(li);
        });
    }

    var _lastRenderStrips = 0;
    var _renderStripsTimer = null;
    var RENDER_STRIPS_THROTTLE_MS = 200;
    function doRenderMixerStrips() {
        var t0 = performance.now();
        mixerStripsEl.innerHTML = '';
        state.tracks.forEach((track, i) => {
            const strip = document.createElement('div');
            strip.className = 'mixer-strip';
            strip.dataset.trackIndex = String(i);
            const nameWrap = document.createElement('div');
            nameWrap.className = 'mixer-strip-name-wrap';
            const nameEl = document.createElement('span');
            nameEl.className = 'mixer-strip-name';
            nameEl.title = track.name;
            nameEl.textContent = track.name.length > 18 ? track.name.slice(0, 15) + '…' : track.name;
            nameWrap.appendChild(nameEl);
            const analysis = state.trackAnalyses && state.trackAnalyses[i];
            if (analysis) {
                const blockSec = 0.2;
                const loudestSec = (analysis.loudestBlockIndex != null ? analysis.loudestBlockIndex * blockSec : 0);
                const softestSec = (analysis.softestBlockIndex != null ? analysis.softestBlockIndex * blockSec : 0);
                const fmt = (s) => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; };
                const peakDb = analysis.peakDb != null ? Math.round(analysis.peakDb) + ' dB' : '';
                const tip = [peakDb && 'Peak ' + peakDb, analysis.loudestBlockIndex != null ? 'Loudest @ ' + fmt(loudestSec) : '', analysis.softestBlockIndex != null ? 'Softest @ ' + fmt(softestSec) : ''].filter(Boolean).join(' · ');
                const analysisEl = document.createElement('span');
                analysisEl.className = 'mixer-strip-analysis';
                analysisEl.textContent = peakDb ? 'Peak ' + peakDb : 'Dynamics';
                analysisEl.title = tip || 'Track dynamics';
                nameWrap.appendChild(analysisEl);
            }
            const faderWrap = document.createElement('div');
            faderWrap.className = 'mixer-strip-fader';
            const fader = document.createElement('input');
            fader.type = 'range';
            fader.min = 0;
            fader.max = 2;
            fader.step = 0.01;
            fader.value = Math.min(2, Math.max(0, track.gain));
            fader.title = 'Level';
            fader.addEventListener('mousedown', () => pushUndo());
            fader.addEventListener('input', () => {
                track.gain = parseFloat(fader.value);
                if (track.automation && track.automation.level && track.automation.level.length >= 2) {
                    track.automation.level[0].value = track.gain;
                    track.automation.level[track.automation.level.length - 1].value = track.gain;
                }
                window.MegaMix.syncTrackToLiveGraph(i);
                window.MegaMix.syncAllTracksToLiveGraph();
            });
            fader.addEventListener('change', () => {
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'fader',
                            track_index: i,
                            track_name: track.name || '',
                            gain: track.gain
                        });
                    }
                } catch (e) {
                    // ignore analytics errors
                }
            });
            faderWrap.appendChild(fader);
            const panWrap = document.createElement('div');
            panWrap.className = 'mixer-strip-pan';
            const panLabel = document.createElement('span');
            panLabel.className = 'mixer-pan-label';
            panLabel.textContent = 'Pan';
            panLabel.setAttribute('aria-hidden', 'true');
            const pan = document.createElement('input');
            pan.type = 'range';
            pan.min = -1;
            pan.max = 1;
            pan.step = 0.01;
            pan.value = track.pan;
            pan.title = 'Pan';
            pan.setAttribute('aria-label', 'Pan');
            pan.addEventListener('mousedown', () => pushUndo());
            pan.addEventListener('input', () => {
                track.pan = parseFloat(pan.value);
                if (track.automation && track.automation.pan && track.automation.pan.length >= 2) {
                    track.automation.pan[0].value = track.pan;
                    track.automation.pan[track.automation.pan.length - 1].value = track.pan;
                }
                window.MegaMix.syncTrackToLiveGraph(i);
                window.MegaMix.syncAllTracksToLiveGraph();
            });
            pan.addEventListener('change', () => {
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'pan',
                            track_index: i,
                            track_name: track.name || '',
                            pan: track.pan
                        });
                    }
                } catch (e) {
                    // ignore analytics errors
                }
            });
            panWrap.appendChild(panLabel);
            panWrap.appendChild(pan);
            const fxRow = document.createElement('div');
            fxRow.className = 'mixer-fx-row';
            function makeFxSlot(fxType, label, isOn, toggleOn, params, getAdjust, setAdjust, getMix, setMix, adjustRange, adjustStep) {
                const slot = document.createElement('div');
                slot.className = 'mixer-fx-slot';
                const powerBtn = document.createElement('button');
                powerBtn.type = 'button';
                powerBtn.className = 'mixer-fx-power';
                powerBtn.setAttribute('aria-pressed', isOn);
                powerBtn.title = label + ' on/off';
                powerBtn.textContent = isOn ? '\u25CF' : '\u25CB';
                powerBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pushUndo();
                    toggleOn();
                    powerBtn.setAttribute('aria-pressed', track[fxType === 'eq' ? 'eqOn' : 'compOn']);
                    powerBtn.textContent = track[fxType === 'eq' ? 'eqOn' : 'compOn'] ? '\u25CF' : '\u25CB';
                    window.MegaMix.syncTrackToLiveGraph(i);
                    window.MegaMix.syncAllTracksToLiveGraph();
                    try {
                        if (window.trackEvent) {
                            window.trackEvent('mix_parameter_change', {
                                control: fxType === 'eq' ? 'eq_power' : 'comp_power',
                                track_index: i,
                                track_name: track.name || '',
                                enabled: !!track[fxType === 'eq' ? 'eqOn' : 'compOn']
                            });
                        }
                    } catch (err) {
                        // ignore analytics errors
                    }
                });
                const nameBtn = document.createElement('button');
                nameBtn.type = 'button';
                nameBtn.className = 'mixer-fx-name';
                nameBtn.textContent = label;
                nameBtn.title = 'Open ' + label + ' settings';
                const popover = document.createElement('div');
                popover.className = 'mixer-fx-popover mixer-fx-mini-panel hidden';
                popover.setAttribute('aria-hidden', 'true');
                const miniBg = document.createElement('div');
                miniBg.className = 'mixer-fx-mini-bg mixer-fx-mini-bg-' + fxType;
                const knobRow = document.createElement('div');
                knobRow.className = 'mixer-fx-mini-knobs';
                const adjustLabel = document.createElement('label');
                adjustLabel.textContent = 'Adjust';
                const adjustInput = document.createElement('input');
                adjustInput.type = 'range';
                adjustInput.min = adjustRange[0];
                adjustInput.max = adjustRange[1];
                adjustInput.step = adjustStep;
                adjustInput.value = getAdjust();
                adjustInput.title = 'Adjust';
                const mixLabel = document.createElement('label');
                mixLabel.textContent = 'Mix';
                const mixInput = document.createElement('input');
                mixInput.type = 'range';
                mixInput.min = 0;
                mixInput.max = 100;
                mixInput.step = 1;
                mixInput.value = Math.round((getMix() * 100));
                mixInput.title = 'Mix';
                const updateFromKnobs = () => {
                    setAdjust(parseFloat(adjustInput.value));
                    setMix(parseFloat(mixInput.value) / 100);
                    window.MegaMix.syncTrackToLiveGraph(i);
                    window.MegaMix.syncAllTracksToLiveGraph();
                };
                adjustInput.addEventListener('input', updateFromKnobs);
                mixInput.addEventListener('input', updateFromKnobs);
                knobRow.appendChild(adjustLabel);
                knobRow.appendChild(adjustInput);
                knobRow.appendChild(mixLabel);
                knobRow.appendChild(mixInput);
                popover.appendChild(miniBg);
                popover.appendChild(knobRow);
                nameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const open = !popover.classList.contains('hidden');
                    document.querySelectorAll('.mixer-fx-mini-panel').forEach(p => { p.classList.add('hidden'); p.setAttribute('aria-hidden', 'true'); });
                    if (!open) {
                        popover.classList.remove('hidden');
                        popover.setAttribute('aria-hidden', 'false');
                        adjustInput.value = getAdjust();
                        mixInput.value = Math.round(getMix() * 100);
                    }
                });
                slot.appendChild(powerBtn);
                slot.appendChild(nameBtn);
                slot.appendChild(popover);
                return slot;
            }
            const eqSlot = makeFxSlot('eq', 'JoshEQ', track.eqOn, () => { track.eqOn = !track.eqOn; },
                track.eqParams,
                () => (track.eqParams && track.eqParams.high != null) ? track.eqParams.high : 0,
                (v) => { track.eqParams = track.eqParams || { low: 0, mid: 0, high: 0 }; track.eqParams.high = v; },
                () => (track.eqMix != null) ? track.eqMix : 1,
                (v) => { track.eqMix = v; },
                [-6, 6], 0.5);
            const compSlot = makeFxSlot('comp', 'JoshSquash', track.compOn, () => { track.compOn = !track.compOn; },
                track.compParams,
                () => (track.compParams && track.compParams.ratio != null) ? track.compParams.ratio : 2,
                (v) => { track.compParams = track.compParams || {}; track.compParams.ratio = v; },
                () => (track.compMix != null) ? track.compMix : 1,
                (v) => { track.compMix = v; },
                [1, 8], 0.5);
            fxRow.appendChild(eqSlot);
            fxRow.appendChild(compSlot);
            const verbSlot = document.createElement('div');
            verbSlot.className = 'mixer-fx-slot' + (window.MegaMix.JOSH_VERB_DISABLED ? ' disabled' : '');
            const verbPowerBtn = document.createElement('button');
            verbPowerBtn.type = 'button';
            verbPowerBtn.className = 'mixer-fx-power';
            verbPowerBtn.setAttribute('aria-pressed', (window.MegaMix.JOSH_VERB_DISABLED || !track.reverbOn) ? 'false' : 'true');
            verbPowerBtn.title = window.MegaMix.JOSH_VERB_DISABLED ? 'Coming soon' : 'JoshVerb on/off';
            verbPowerBtn.textContent = (window.MegaMix.JOSH_VERB_DISABLED || !track.reverbOn) ? '\u25CB' : '\u25CF';
            verbPowerBtn.disabled = !!window.MegaMix.JOSH_VERB_DISABLED;
            verbPowerBtn.addEventListener('click', function (e) {
                if (window.MegaMix.JOSH_VERB_DISABLED) return;
                e.stopPropagation();
                pushUndo();
                track.reverbOn = !track.reverbOn;
                verbPowerBtn.setAttribute('aria-pressed', track.reverbOn);
                verbPowerBtn.textContent = track.reverbOn ? '\u25CF' : '\u25CB';
                window.MegaMix.syncTrackToLiveGraph(i);
                window.MegaMix.syncAllTracksToLiveGraph();
                if (window.MegaMix.scheduleBuildAfter) window.MegaMix.scheduleBuildAfter();
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'reverb_power',
                            track_index: i,
                            track_name: track.name || '',
                            enabled: !!track.reverbOn
                        });
                    }
                } catch (err) {
                    // ignore analytics errors
                }
            });
            const verbNameBtn = document.createElement('button');
            verbNameBtn.type = 'button';
            verbNameBtn.className = 'mixer-fx-name';
            verbNameBtn.textContent = 'JoshVerb';
            verbNameBtn.title = window.MegaMix.JOSH_VERB_DISABLED ? 'Coming soon' : 'Open JoshVerb settings';
            verbNameBtn.disabled = !!window.MegaMix.JOSH_VERB_DISABLED;
            const verbPopover = document.createElement('div');
            verbPopover.className = 'mixer-fx-popover mixer-fx-mini-panel hidden';
            verbPopover.setAttribute('aria-hidden', 'true');
            const verbMiniBg = document.createElement('div');
            verbMiniBg.className = 'mixer-fx-mini-bg mixer-fx-mini-bg-eq';
            const verbKnobRow = document.createElement('div');
            verbKnobRow.className = 'mixer-fx-mini-knobs';
            const verbMixLabel = document.createElement('label');
            verbMixLabel.textContent = 'Mix';
            const verbMixInput = document.createElement('input');
            verbMixInput.type = 'range';
            verbMixInput.min = 0;
            verbMixInput.max = 100;
            verbMixInput.step = 1;
            verbMixInput.value = Math.round(((track.reverbParams && track.reverbParams.mix != null) ? track.reverbParams.mix : 0.25) * 100);
            verbMixInput.title = 'Wet amount';
            const verbDecayLabel = document.createElement('label');
            verbDecayLabel.textContent = 'Decay (s)';
            const verbDecayInput = document.createElement('input');
            verbDecayInput.type = 'range';
            verbDecayInput.min = 15;
            verbDecayInput.max = 120;
            verbDecayInput.step = 5;
            verbDecayInput.value = Math.round(((track.reverbParams && track.reverbParams.decaySeconds != null) ? track.reverbParams.decaySeconds : 0.4) * 100);
            verbDecayInput.title = 'Decay time';
            function updateVerbFromPopover() {
                track.reverbParams = track.reverbParams || { mix: 0.25, decaySeconds: 0.4 };
                track.reverbParams.mix = Math.max(0, Math.min(1, parseInt(verbMixInput.value, 10) / 100));
                track.reverbParams.decaySeconds = Math.max(0.15, Math.min(1.5, parseInt(verbDecayInput.value, 10) / 100));
                window.MegaMix.syncTrackToLiveGraph(i);
                window.MegaMix.syncAllTracksToLiveGraph();
                if (window.MegaMix.scheduleBuildAfter) window.MegaMix.scheduleBuildAfter();
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'reverb_params',
                            track_index: i,
                            track_name: track.name || ''
                        });
                    }
                } catch (err) {
                    // ignore analytics errors
                }
            }
            verbMixInput.addEventListener('input', updateVerbFromPopover);
            verbDecayInput.addEventListener('input', updateVerbFromPopover);
            verbKnobRow.appendChild(verbMixLabel);
            verbKnobRow.appendChild(verbMixInput);
            verbKnobRow.appendChild(verbDecayLabel);
            verbKnobRow.appendChild(verbDecayInput);
            verbPopover.appendChild(verbMiniBg);
            verbPopover.appendChild(verbKnobRow);
            verbNameBtn.addEventListener('click', function (e) {
                if (window.MegaMix.JOSH_VERB_DISABLED) return;
                e.stopPropagation();
                var open = !verbPopover.classList.contains('hidden');
                document.querySelectorAll('.mixer-fx-mini-panel').forEach(function (p) { p.classList.add('hidden'); p.setAttribute('aria-hidden', 'true'); });
                if (!open) {
                    verbPopover.classList.remove('hidden');
                    verbPopover.setAttribute('aria-hidden', 'false');
                    verbMixInput.value = Math.round(((track.reverbParams && track.reverbParams.mix != null) ? track.reverbParams.mix : 0.25) * 100);
                    verbDecayInput.value = Math.round(((track.reverbParams && track.reverbParams.decaySeconds != null) ? track.reverbParams.decaySeconds : 0.4) * 100);
                }
            });
            verbSlot.appendChild(verbPowerBtn);
            verbSlot.appendChild(verbNameBtn);
            verbSlot.appendChild(verbPopover);
            fxRow.appendChild(verbSlot);
            if (!track.automation) {
                track.automation = { level: [{ t: 0, value: track.gain }, { t: 1, value: track.gain }], pan: [{ t: 0, value: track.pan }, { t: 1, value: track.pan }] };
            }
            const autoBtn = document.createElement('button');
            autoBtn.type = 'button';
            autoBtn.className = 'mixer-fx-btn disabled';
            autoBtn.textContent = 'Auto';
            autoBtn.title = 'Level and pan automation (coming soon)';
            autoBtn.disabled = true;
            const autoPanel = document.createElement('div');
            autoPanel.className = 'mixer-automation-panel hidden';
            autoPanel.setAttribute('aria-hidden', 'true');
            function renderAutomationCurve(curveKey, label, valueMin, valueMax, valueStep) {
                const curve = track.automation[curveKey] || [];
                autoPanel.innerHTML = '';
                const levelHead = document.createElement('div');
                levelHead.className = 'automation-curve-header';
                levelHead.textContent = 'Level (0–100% = time, value 0–2)';
                autoPanel.appendChild(levelHead);
                const levelList = document.createElement('div');
                levelList.className = 'automation-keyframes';
                (track.automation.level || []).sort((a, b) => a.t - b.t).forEach((pt, idx) => {
                    const row = document.createElement('div');
                    row.className = 'automation-keyframe-row';
                    const tInput = document.createElement('input');
                    tInput.type = 'number';
                    tInput.min = 0;
                    tInput.max = 100;
                    tInput.step = 1;
                    tInput.value = Math.round(pt.t * 100);
                    tInput.title = 'Time %';
                    const vInput = document.createElement('input');
                    vInput.type = 'number';
                    vInput.min = 0;
                    vInput.max = 2;
                    vInput.step = 0.05;
                    vInput.value = pt.value;
                    vInput.title = 'Level';
                    const rm = document.createElement('button');
                    rm.type = 'button';
                    rm.className = 'mixer-fx-btn';
                    rm.textContent = '×';
                    rm.title = 'Remove';
                    const point = track.automation.level.slice().sort((a, b) => a.t - b.t)[idx];
                    const update = () => {
                        const t = Math.max(0, Math.min(1, parseFloat(tInput.value) / 100));
                        const v = Math.max(0, Math.min(2, parseFloat(vInput.value)));
                        point.t = t;
                        point.value = v;
                        track.automation.level.sort((a, b) => a.t - b.t);
                        window.MegaMix.syncAllTracksToLiveGraph();
                    };
                    tInput.addEventListener('input', update);
                    vInput.addEventListener('input', update);
                    rm.addEventListener('click', () => {
                        if (track.automation.level.length <= 2) return;
                        pushUndo();
                        const realIdx = track.automation.level.indexOf(point);
                        if (realIdx >= 0) track.automation.level.splice(realIdx, 1);
                        renderMixerStrips();
                        window.MegaMix.syncAllTracksToLiveGraph();
                    });
                    row.appendChild(tInput);
                    row.appendChild(vInput);
                    row.appendChild(rm);
                    levelList.appendChild(row);
                });
                autoPanel.appendChild(levelList);
                if (track.automation.level.length < 8) {
                    const addLevel = document.createElement('button');
                    addLevel.type = 'button';
                    addLevel.className = 'btn btn-small';
                    addLevel.textContent = '+ Level point';
                    addLevel.addEventListener('click', () => {
                        pushUndo();
                        track.automation.level.push({ t: 0.5, value: 1 });
                        track.automation.level.sort((a, b) => a.t - b.t);
                        renderMixerStrips();
                        window.MegaMix.syncAllTracksToLiveGraph();
                    });
                    autoPanel.appendChild(addLevel);
                }
                const panHead = document.createElement('div');
                panHead.className = 'automation-curve-header';
                panHead.textContent = 'Pan (0–100% = time, value -1 to 1)';
                autoPanel.appendChild(panHead);
                const panList = document.createElement('div');
                panList.className = 'automation-keyframes';
                (track.automation.pan || []).sort((a, b) => a.t - b.t).forEach((pt, idx) => {
                    const row = document.createElement('div');
                    row.className = 'automation-keyframe-row';
                    const tInput = document.createElement('input');
                    tInput.type = 'number';
                    tInput.min = 0;
                    tInput.max = 100;
                    tInput.step = 1;
                    tInput.value = Math.round(pt.t * 100);
                    const vInput = document.createElement('input');
                    vInput.type = 'number';
                    vInput.min = -1;
                    vInput.max = 1;
                    vInput.step = 0.05;
                    vInput.value = pt.value;
                    const rm = document.createElement('button');
                    rm.type = 'button';
                    rm.className = 'mixer-fx-btn';
                    rm.textContent = '×';
                    const point = track.automation.pan.slice().sort((a, b) => a.t - b.t)[idx];
                    const update = () => {
                        const t = Math.max(0, Math.min(1, parseFloat(tInput.value) / 100));
                        const v = Math.max(-1, Math.min(1, parseFloat(vInput.value)));
                        point.t = t;
                        point.value = v;
                        track.automation.pan.sort((a, b) => a.t - b.t);
                        window.MegaMix.syncAllTracksToLiveGraph();
                    };
                    tInput.addEventListener('input', update);
                    vInput.addEventListener('input', update);
                    rm.addEventListener('click', () => {
                        if (track.automation.pan.length <= 2) return;
                        pushUndo();
                        const realIdx = track.automation.pan.indexOf(point);
                        if (realIdx >= 0) track.automation.pan.splice(realIdx, 1);
                        renderMixerStrips();
                        window.MegaMix.syncAllTracksToLiveGraph();
                    });
                    row.appendChild(tInput);
                    row.appendChild(vInput);
                    row.appendChild(rm);
                    panList.appendChild(row);
                });
                autoPanel.appendChild(panList);
                if (track.automation.pan.length < 8) {
                    const addPan = document.createElement('button');
                    addPan.type = 'button';
                    addPan.className = 'btn btn-small';
                    addPan.textContent = '+ Pan point';
                    addPan.addEventListener('click', () => {
                        pushUndo();
                        track.automation.pan.push({ t: 0.5, value: 0 });
                        track.automation.pan.sort((a, b) => a.t - b.t);
                        renderMixerStrips();
                        window.MegaMix.syncAllTracksToLiveGraph();
                    });
                    autoPanel.appendChild(addPan);
                }
            }
            autoBtn.addEventListener('click', () => {
                const open = !autoPanel.classList.contains('hidden');
                if (open) {
                    autoPanel.classList.add('hidden');
                    autoPanel.setAttribute('aria-hidden', 'true');
                } else {
                    renderAutomationCurve('level', 'Level', 0, 2, 0.05);
                    autoPanel.classList.remove('hidden');
                    autoPanel.setAttribute('aria-hidden', 'false');
                }
            });
            fxRow.appendChild(autoBtn);
            var soloMuteRow = document.createElement('div');
            soloMuteRow.className = 'mixer-solo-mute-row';
            var soloBtn = document.createElement('button');
            soloBtn.type = 'button';
            soloBtn.className = 'mixer-solo-mute-btn';
            soloBtn.setAttribute('aria-pressed', !!track.solo);
            soloBtn.title = 'Solo';
            soloBtn.textContent = 'S';
            var muteBtn = document.createElement('button');
            muteBtn.type = 'button';
            muteBtn.className = 'mixer-solo-mute-btn';
            muteBtn.setAttribute('aria-pressed', !!track.mute);
            muteBtn.title = 'Mute';
            muteBtn.textContent = 'M';
            soloBtn.addEventListener('click', function () {
                pushUndo();
                track.solo = !track.solo;
                soloBtn.setAttribute('aria-pressed', !!track.solo);
                window.MegaMix.syncAllTracksToLiveGraph();
                if (window.MegaMix.scheduleBuildAfter) window.MegaMix.scheduleBuildAfter();
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'solo',
                            track_index: i,
                            track_name: track.name || '',
                            enabled: !!track.solo
                        });
                    }
                } catch (err) {
                    // ignore analytics errors
                }
            });
            muteBtn.addEventListener('click', function () {
                pushUndo();
                track.mute = !track.mute;
                muteBtn.setAttribute('aria-pressed', !!track.mute);
                window.MegaMix.syncAllTracksToLiveGraph();
                if (window.MegaMix.scheduleBuildAfter) window.MegaMix.scheduleBuildAfter();
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_parameter_change', {
                            control: 'mute',
                            track_index: i,
                            track_name: track.name || '',
                            enabled: !!track.mute
                        });
                    }
                } catch (err) {
                    // ignore analytics errors
                }
            });
            soloMuteRow.appendChild(soloBtn);
            soloMuteRow.appendChild(muteBtn);
            strip.appendChild(nameWrap);
            strip.appendChild(faderWrap);
            strip.appendChild(panWrap);
            strip.appendChild(fxRow);
            strip.appendChild(soloMuteRow);
            strip.appendChild(autoPanel);
            mixerStripsEl.appendChild(strip);
        });
        console.log('[MegaMix perf] doRenderMixerStrips: ' + (performance.now() - t0).toFixed(2) + ' ms (tracks=' + state.tracks.length + ')');
    }
    function renderMixerStrips() {
        var now = Date.now();
        if (_renderStripsTimer) clearTimeout(_renderStripsTimer);
        if (now - _lastRenderStrips >= RENDER_STRIPS_THROTTLE_MS || _lastRenderStrips === 0) {
            _lastRenderStrips = now;
            console.log('[MegaMix perf] renderMixerStrips: run immediately (throttle ok)');
            doRenderMixerStrips();
        } else {
            var delay = RENDER_STRIPS_THROTTLE_MS - (now - _lastRenderStrips);
            console.log('[MegaMix perf] renderMixerStrips: throttled, defer ' + delay + ' ms');
            _renderStripsTimer = setTimeout(function () {
                _renderStripsTimer = null;
                _lastRenderStrips = Date.now();
                doRenderMixerStrips();
            }, delay);
        }
    }

    function initPlaybackCard() {
        window.MegaMix.onAfterMixBuilt = function () {
            if (audioAfter && state.mixedAfterUrl) audioAfter.src = state.mixedAfterUrl;
        };
        const tabs = document.querySelectorAll('.before-after-tab');
        const playbackPositionLabel = document.getElementById('playback-position-label');
        function getActiveMode() {
            const active = document.querySelector('.before-after-tab.active');
            return active ? active.getAttribute('data-mode') : 'before';
        }
        function setMutedFromTab() {
            const mode = getActiveMode();
            audioBefore.muted = (mode !== 'before');
            if (audioAfter) audioAfter.muted = (mode !== 'after');
        }
        function formatTime(s) {
            if (!isFinite(s) || s < 0) return '0:00';
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return m + ':' + (sec < 10 ? '0' : '') + sec;
        }
        const duration = () => window.MegaMix.liveGraph() ? window.MegaMix.getTransportDuration() : (audioBefore.duration && isFinite(audioBefore.duration) ? audioBefore.duration : 0);
        var PROGRESS_UI_THROTTLE_MS = 120;
        var lastProgressUIUpdate = 0;
        function updateProgress() {
            const mode = getActiveMode();
            const d = duration();
            let t = 0;
            if (mode === 'after' && window.MegaMix.liveGraph() && window.MegaMix.livePlaybackSources().length > 0) {
                const lg = window.MegaMix.liveGraph();
                t = window.MegaMix.transportOffset() + (lg.ctx.currentTime - window.MegaMix.playbackStartTime());
                if (t >= d) {
                    window.MegaMix.stopLivePlayback();
                    playBtn.classList.remove('playing');
                    playBtn.textContent = '\u25B6';
                    window.MegaMix.setTransportOffset(0);
                    t = d;
                }
            } else if (mode === 'before') {
                t = audioBefore.currentTime || 0;
            } else if (mode === 'after' && audioAfter && isFinite(audioAfter.duration)) {
                t = audioAfter.currentTime || 0;
            } else {
                t = window.MegaMix.transportOffset();
            }
            var now = Date.now();
            if (now - lastProgressUIUpdate >= PROGRESS_UI_THROTTLE_MS) {
                lastProgressUIUpdate = now;
                if (d > 0) {
                    playbackProgress.value = (t / d) * 100;
                    playbackDuration.textContent = formatTime(d);
                }
                playbackTime.textContent = formatTime(t);
                if (playbackPositionLabel) playbackPositionLabel.textContent = 'Playback at ' + formatTime(t);
            }
        }
        function stopBoth() {
            audioBefore.pause();
            if (audioAfter) audioAfter.pause();
            window.MegaMix.stopLivePlayback();
            playBtn.classList.remove('playing');
            playBtn.textContent = '\u25B6';
            updateProgress();
        }
        function getCurrentPlaybackTime() {
            const d = duration();
            if (d <= 0) return 0;
            if (!audioBefore.paused) return audioBefore.currentTime || 0;
            if (audioAfter && !audioAfter.paused && isFinite(audioAfter.duration)) return audioAfter.currentTime || 0;
            if (window.MegaMix.livePlaybackSources().length > 0 && window.MegaMix.liveGraph()) {
                const lg = window.MegaMix.liveGraph();
                return window.MegaMix.transportOffset() + (lg.ctx.currentTime - window.MegaMix.playbackStartTime());
            }
            return (playbackProgress.value / 100) * d;
        }
        function startPlaybackAt(mode, pos) {
            const d = duration();
            if (d <= 0) return;
            if (mode === 'before') {
                audioBefore.currentTime = Math.min(pos, (audioBefore.duration || d) - 0.01);
                audioBefore.play();
                playBtn.classList.add('playing');
                playBtn.textContent = '\u23F8';
            } else if (mode === 'after' && window.MegaMix.liveGraph()) {
                window.MegaMix.startLivePlayback(pos);
                playBtn.classList.add('playing');
                playBtn.textContent = '\u23F8';
                window.MegaMix.setLivePlaybackRaf(requestAnimationFrame(tickLiveProgress));
            } else if (mode === 'after' && audioAfter && state.mixedAfterUrl) {
                audioAfter.muted = false;
                audioAfter.currentTime = Math.min(pos, (audioAfter.duration || d) - 0.01);
                audioAfter.play();
                playBtn.classList.add('playing');
                playBtn.textContent = '\u23F8';
            }
        }
        function tickLiveProgress() {
            if (window.MegaMix.livePlaybackSources().length === 0) return;
            updateProgress();
            window.MegaMix.setLivePlaybackRaf(requestAnimationFrame(tickLiveProgress));
        }
        tabs.forEach(tab => {
            tab.addEventListener('click', function () {
                tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
                this.classList.add('active');
                this.setAttribute('aria-selected', 'true');
                const playing = !audioBefore.paused || (audioAfter && !audioAfter.paused) || window.MegaMix.livePlaybackSources().length > 0;
                if (playing) {
                    const pos = getCurrentPlaybackTime();
                    audioBefore.pause();
                    if (audioAfter) audioAfter.pause();
                    window.MegaMix.stopLivePlayback();
                    setMutedFromTab();
                    startPlaybackAt(getActiveMode(), pos);
                } else {
                    setMutedFromTab();
                }
            });
        });
        var beforeAfterInfoBtn = document.getElementById('before-after-info-btn');
        if (beforeAfterInfoBtn) {
            beforeAfterInfoBtn.addEventListener('click', function () {
                showToast('<p><strong>A/B testing:</strong> Switch between Before (flat mix) and After (your mix with preset and fader/FX changes) to compare. Use the transport to play, pause, and seek.</p><p><strong>Refine with Josh:</strong> Use the quick prompt buttons or type in the chat (e.g. &quot;bring up the vocals&quot;, &quot;more punch&quot;). Josh applies changes to the After mix; listen and iterate.</p>', beforeAfterInfoBtn);
            });
        }
        var mixerInfoBtn = document.getElementById('mixer-info-btn');
        if (mixerInfoBtn) {
            mixerInfoBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                showToast('<p>Use the mixer to <strong>manually adjust</strong> each track: drag the faders for level, pan left/right, and turn on EQ, compression, or reverb per track. Changes are reflected in the After playback and when you refine with Josh.</p>', mixerInfoBtn);
            });
        }
        playBtn.addEventListener('click', function () {
            const mode = getActiveMode();
            const playing = (mode === 'before' && !audioBefore.paused) || (mode === 'after' && (window.MegaMix.livePlaybackSources().length > 0 || (audioAfter && !audioAfter.paused)));
            if (playing) {
                stopBoth();
            } else {
                const d = duration();
                if (d <= 0) return;
                if (mode === 'before') {
                    const pos = audioBefore.currentTime || 0;
                    audioBefore.currentTime = pos;
                    audioBefore.play();
                    playBtn.classList.add('playing');
                    playBtn.textContent = '\u23F8';
                } else if (mode === 'after' && window.MegaMix.liveGraph()) {
                    const pos = (playbackProgress.value / 100) * d;
                    window.MegaMix.startLivePlayback(pos);
                    playBtn.classList.add('playing');
                    playBtn.textContent = '\u23F8';
                    window.MegaMix.setLivePlaybackRaf(requestAnimationFrame(tickLiveProgress));
                } else if (mode === 'after' && audioAfter && state.mixedAfterUrl) {
                    audioAfter.muted = false;
                    const pos = (playbackProgress.value / 100) * (audioAfter.duration || d);
                    audioAfter.currentTime = pos;
                    audioAfter.play();
                    playBtn.classList.add('playing');
                    playBtn.textContent = '\u23F8';
                }
            }
        });
        playbackProgress.addEventListener('input', function () {
            const d = duration();
            if (d <= 0) return;
            const t = (playbackProgress.value / 100) * d;
            const mode = getActiveMode();
            if (mode === 'before') {
                audioBefore.currentTime = t;
                playbackTime.textContent = formatTime(t);
            } else if (mode === 'after' && audioAfter && state.mixedAfterUrl) {
                window.MegaMix.setTransportOffset(t);
                audioAfter.currentTime = t;
                playbackTime.textContent = formatTime(t);
                if (window.MegaMix.livePlaybackSources().length > 0) {
                    window.MegaMix.startLivePlayback(t);
                }
            } else {
                window.MegaMix.setTransportOffset(t);
                playbackTime.textContent = formatTime(t);
                if (window.MegaMix.livePlaybackSources().length > 0) {
                    window.MegaMix.startLivePlayback(t);
                }
            }
            if (playbackPositionLabel) playbackPositionLabel.textContent = 'Playback at ' + formatTime(t);
        });
        audioBefore.addEventListener('loadedmetadata', function () {
            if (audioBefore.duration && isFinite(audioBefore.duration))
                playbackDuration.textContent = formatTime(audioBefore.duration);
        });
        audioBefore.addEventListener('timeupdate', function () {
            if (getActiveMode() === 'before') updateProgress();
        });
        audioBefore.addEventListener('ended', stopBoth);
        if (audioAfter) {
            audioAfter.addEventListener('ended', stopBoth);
            audioAfter.addEventListener('timeupdate', function () {
                if (getActiveMode() === 'after') updateProgress();
            });
        }
        setMutedFromTab();
    }

    function updateFileListVisibility() {
        if (uploadAndFilesBody) {
            uploadAndFilesBody.classList.toggle('collapsed', !state.fileListVisible);
            if (toggleFileListBtn) toggleFileListBtn.textContent = state.fileListVisible ? 'Hide file list' : 'Show file list';
        }
    }
    if (toggleFileListBtn && uploadAndFilesBody) {
        toggleFileListBtn.addEventListener('click', () => {
            state.fileListVisible = !state.fileListVisible;
            updateFileListVisibility();
        });
    }

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) addFiles(fileInput.files);
        fileInput.value = '';
    });
    var uploadFxInfoBtn = document.getElementById('upload-fx-info-btn');
    if (uploadFxInfoBtn) {
        uploadFxInfoBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        uploadFxInfoBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showToast('<p>Per-track we offer <strong>EQ</strong> and <strong>compression</strong> only—not a full effects suite. For best results, use stems that already have FX from your DAW, then use MegaMix for balance, tone, and mastering.</p><p><strong>Single file?</strong> Drop one mix and choose <strong>Split stems with AI</strong> in the popup. We split into 4 stems (vocals, drums, bass, other); then mix and master as usual.</p>', uploadFxInfoBtn);
        });
    }

    const mixerCollapsible = document.getElementById('mixer-collapsible');
    const mixerCollapsibleToggle = document.getElementById('mixer-collapsible-toggle');
    if (mixerCollapsible && mixerCollapsibleToggle) {
        mixerCollapsibleToggle.addEventListener('click', function () {
            const collapsed = mixerCollapsible.classList.toggle('collapsed');
            mixerCollapsibleToggle.setAttribute('aria-expanded', !collapsed);
        });
    }

    function setMixItLoading(show) {
        if (mixItLoading) mixItLoading.classList.toggle('hidden', !show);
        btnMixIt.disabled = show;
        if (!show && mixItProgressFill) mixItProgressFill.style.width = '0%';
        if (!show && mixItLoadingText) mixItLoadingText.textContent = 'Mixing…';
    }
    function setMixItProgress(pct, statusText) {
        if (mixItProgressFill) mixItProgressFill.style.width = pct + '%';
        if (mixItLoadingText && statusText) mixItLoadingText.textContent = statusText;
    }

    async function runMixIt(opts) {
        opts = opts || {};
        // Analytics: first or subsequent Mix It runs
        try {
            if (window.trackEvent) {
                window.trackEvent('mix_ai_suggestion', {
                    is_initial_mix: !state.hasInitialMix,
                    has_guidance: !!(guidanceForJosh && guidanceForJosh.value && guidanceForJosh.value.trim()),
                    preset_genre: presetSelect && presetSelect.value
                });
            }
        } catch (e) {
            // ignore analytics errors
        }
        if (state.uploadedFiles.length === 0) {
            addChatMessage('bot', 'Upload stems first, then click Mix it.');
            return;
        }
        if (state.mixReady && state.hasInitialMix) {
            window.MegaMix.syncAllTracksToLiveGraph();
            addChatMessage('bot', 'Mix updated from your current settings. Use the live transport to hear changes.');
            return;
        }
        console.log('[MegaMix perf] runMixIt: start (files=' + state.uploadedFiles.length + ')');
        var tRunMixIt = performance.now();
        state.joshChangeHistory = [];
        setMixItLoading(true);
        setMixItProgress(0, 'Decoding stems…');
        playbackInstruction.classList.add('hidden');
        if (mixLoadingBlock) mixLoadingBlock.classList.remove('hidden');
        playbackBuilding.classList.remove('hidden');
        playBtn.disabled = true;
        try {
            await window.MegaMix.decodeStemsToBuffers();
            setMixItProgress(20, 'Applying balance…');
            if (state.stemBuffers.length === 0) {
                setMixItLoading(false);
                if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
                playbackInstruction.classList.remove('hidden');
                playbackInstruction.textContent = 'Could not decode audio. Try different files.';
                return;
            }
            const genreId = presetSelect.value;
            if (window.MegaMix.GENRE_BALANCE[genreId]) {
                pushUndo();
                window.MegaMix.applyMusicalBalance(state.tracks, genreId);
                renderMixerStrips();
            }
            if (guidanceForJosh && guidanceForJosh.value.trim()) {
                const guidance = guidanceForJosh.value.trim();
                const changes = window.MegaMix.interpretChatMessage(guidance, state.tracks, state.trackAnalyses);
                if (changes && changes.length > 0) {
                    pushUndo();
                    window.MegaMix.applyJoshResponse(state.tracks, changes);
                    var stepLines = window.MegaMix.formatJoshChangesForDisplay(changes, state.tracks);
                    state.joshChangeHistory.push(stepLines);
                    state.lastJoshChangesSummary = stepLines;
                    updateJoshTransparencyPanel();
                    renderMixerStrips();
                }
            }
            setMixItProgress(40, 'Building before mix…');
            window.MegaMix.revokeMixUrls();
            window.MegaMix.revokeMasteredUrl();
            const beforeMix = window.MegaMix.buildMixedBuffer(true);
            setMixItProgress(60, 'Building after mix…');
            const afterMix = await window.MegaMix.buildAfterMixWithFX();
            setMixItProgress(100, 'Finishing…');
            if (beforeMix) {
                state.mixedBeforeUrl = URL.createObjectURL(window.MegaMix.encodeWav(beforeMix.left, beforeMix.right, beforeMix.sampleRate));
                audioBefore.src = state.mixedBeforeUrl;
            }
            if (afterMix) {
                state.mixedAfterUrl = URL.createObjectURL(window.MegaMix.encodeWav(afterMix.left, afterMix.right, afterMix.sampleRate));
                audioAfter.src = state.mixedAfterUrl;
            }
            state.mixReady = true;
            state.hasInitialMix = true;
            state.fileListVisible = false;
            updateFileListVisibility();
            updateMasteringUI();
            var mixLoadingRow = document.getElementById('mix-it-loading-row');
            var mixProgressTrack = mixItLoading && mixItLoading.querySelector('.mix-it-progress-track');
            var mixDoneCheck = document.getElementById('mix-done-check');
            if (mixLoadingRow) mixLoadingRow.classList.add('hidden');
            if (mixProgressTrack) mixProgressTrack.classList.add('hidden');
            if (mixDoneCheck) {
                mixDoneCheck.classList.remove('hidden');
                mixDoneCheck.setAttribute('aria-hidden', 'false');
            }
            btnMixIt.disabled = false;
            setTimeout(function () {
                if (mixDoneCheck) mixDoneCheck.classList.add('mix-done-fade');
                setTimeout(function () {
                    setMixItLoading(false);
                    if (mixDoneCheck) {
                        mixDoneCheck.classList.add('hidden');
                        mixDoneCheck.classList.remove('mix-done-fade');
                        mixDoneCheck.setAttribute('aria-hidden', 'true');
                    }
                    if (mixLoadingRow) mixLoadingRow.classList.remove('hidden');
                    if (mixProgressTrack) mixProgressTrack.classList.remove('hidden');
                    var refineHeading = document.getElementById('refine-with-josh-heading');
                    if (refineHeading) refineHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 500);
            }, 2000);
            if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
            updatePlaybackInstruction();
            const afterTab = document.querySelector('.before-after-tab[data-mode="after"]');
            if (afterTab && !afterTab.classList.contains('active')) {
                document.querySelectorAll('.before-after-tab').forEach(tab => { tab.classList.remove('active'); tab.setAttribute('aria-selected', 'false'); });
                afterTab.classList.add('active');
                afterTab.setAttribute('aria-selected', 'true');
                audioBefore.muted = true;
                audioAfter.muted = false;
            }
            addChatMessage('bot', 'Mix ready. Listen in Before/After or refine with Josh.');
            console.log('[MegaMix perf] runMixIt: createLiveGraph');
            window.MegaMix.createLiveGraph();
            console.log('[MegaMix perf] runMixIt: total ' + (performance.now() - tRunMixIt).toFixed(2) + ' ms');
            const d = window.MegaMix.getTransportDuration();
            if (playbackDuration && d > 0) {
                const m = Math.floor(d / 60);
                const s = Math.floor(d % 60);
                playbackDuration.textContent = m + ':' + (s < 10 ? '0' : '') + s;
            }
            if (opts.thenShowMastering) showView('mastering');
        } catch (e) {
            console.error(e);
            setMixItLoading(false);
            if (mixLoadingBlock) mixLoadingBlock.classList.add('hidden');
            playbackInstruction.classList.remove('hidden');
            playbackInstruction.textContent = 'Mix build failed. Try fewer or shorter files.';
            playBtn.disabled = true;
        }
    }
    btnMixIt.addEventListener('click', runMixIt);

    (function initStep2PresetPrompts() {
        const grid = document.getElementById('preset-prompts-grid');
        const promptsByGenre = window.MegaMix.GENRE_PROMPTS || {};
        function updatePresetPromptButtons() {
            const genre = presetSelect && presetSelect.value ? presetSelect.value : 'custom';
            const prompts = promptsByGenre[genre] || promptsByGenre.custom || [];
            if (!grid) return;
            grid.querySelectorAll('.preset-prompt-btn').forEach((btn, idx) => {
                const text = prompts[idx] || '';
                btn.textContent = text;
                btn.setAttribute('data-prompt', text);
            });
        }
        if (presetSelect) presetSelect.addEventListener('change', updatePresetPromptButtons);
        if (grid) {
            grid.querySelectorAll('.preset-prompt-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    const prompt = this.getAttribute('data-prompt') || '';
                    if (guidanceForJosh) guidanceForJosh.value = prompt;
                });
            });
        }
        updatePresetPromptButtons();
    })();

    function appendBotMessageAnimated(containerEl, label, text) {
        const div = document.createElement('div');
        div.className = 'msg bot';
        containerEl.appendChild(div);
        const fullText = label + text;
        const words = text.split(/(\s+)/);
        const msPerWord = 40;
        const maxMs = 2000;
        const stepMs = Math.min(msPerWord, Math.floor(maxMs / Math.max(1, words.length)));
        let index = 0;
        div.textContent = label;
        function scrollToBottom() { containerEl.scrollTop = containerEl.scrollHeight; }
        function addNext() {
            if (index >= words.length) { scrollToBottom(); return; }
            div.textContent = label + words.slice(0, index + 1).join('');
            index += 1;
            scrollToBottom();
            if (index < words.length) setTimeout(addNext, stepMs);
        }
        if (words.length <= 1) { div.textContent = fullText; scrollToBottom(); }
        else setTimeout(addNext, stepMs);
    }
    function addChatMessage(who, text) {
        if (who === 'user') {
            const div = document.createElement('div');
            div.className = 'msg user';
            div.textContent = 'You: ' + text;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            appendBotMessageAnimated(chatMessages, 'Josh: ', text);
        }
    }
    chatSend.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    function updateJoshTransparencyPanel() {
        const wrap = document.getElementById('josh-transparency-wrap');
        const body = document.getElementById('josh-transparency-body');
        const list = document.getElementById('josh-transparency-list');
        const toggle = document.getElementById('josh-transparency-toggle');
        if (!wrap || !list) return;
        const history = state.joshChangeHistory || [];
        const flatLength = history.reduce(function (n, step) { return n + (step && step.length ? step.length : 0); }, 0);
        if (flatLength === 0) {
            wrap.classList.add('hidden');
            return;
        }
        wrap.classList.remove('hidden');
        list.innerHTML = '';
        history.forEach(function (step, stepIndex) {
            if (!step || !step.length) return;
            var stepLabel = document.createElement('li');
            stepLabel.className = 'josh-transparency-step-label';
            stepLabel.textContent = 'Step ' + (stepIndex + 1) + ':';
            list.appendChild(stepLabel);
            step.forEach(function (s) {
                var li = document.createElement('li');
                li.textContent = s;
                list.appendChild(li);
            });
        });
        if (toggle) toggle.setAttribute('aria-expanded', body && !body.classList.contains('collapsed') ? 'true' : 'false');
    }
    var joshTransparencyToggle = document.getElementById('josh-transparency-toggle');
    var joshTransparencyBody = document.getElementById('josh-transparency-body');
    if (joshTransparencyToggle && joshTransparencyBody) {
        joshTransparencyToggle.addEventListener('click', function () {
            joshTransparencyBody.classList.toggle('collapsed');
            joshTransparencyToggle.setAttribute('aria-expanded', joshTransparencyBody.classList.contains('collapsed') ? 'false' : 'true');
        });
    }
    function updateStep3QuickPrompts() {
        const container = document.getElementById('quick-prompts');
        const genre = (presetSelect && presetSelect.value) ? presetSelect.value : 'rock';
        const prompts = window.MegaMix.GENRE_QUICK_PROMPTS && window.MegaMix.GENRE_QUICK_PROMPTS[genre];
        if (!container) return;
        container.innerHTML = '';
        const list = Array.isArray(prompts) ? prompts : (window.MegaMix.GENRE_QUICK_PROMPTS && window.MegaMix.GENRE_QUICK_PROMPTS.custom) || [];
        list.forEach(function (item) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-ghost btn-small quick-prompt';
            btn.setAttribute('data-prompt', item.prompt || item);
            btn.textContent = item.label || item;
            container.appendChild(btn);
        });
    }
    const quickPromptsEl = document.getElementById('quick-prompts');
    if (quickPromptsEl) {
        quickPromptsEl.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest('.quick-prompt');
            if (!btn) return;
            const prompt = btn.getAttribute('data-prompt');
            if (prompt) {
                chatInput.value = prompt;
                sendChat();
            }
        });
    }
    updateStep3QuickPrompts();
    if (presetSelect) presetSelect.addEventListener('change', updateStep3QuickPrompts);

    function initJoshAvatarDrag(wrapEl) {
        if (!wrapEl) return;
        var startX = 0, startY = 0, startLeft = 0, startTop = 0;
        var wrapWidth = 0, wrapHeight = 0;
        function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }
        function applyPosition(el, leftPx, topPx) {
            el.style.transition = 'none';
            el.style.position = 'fixed';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.left = leftPx + 'px';
            el.style.top = topPx + 'px';
            el.style.transform = 'none';
            el.style.animation = 'none';
        }
        function finishDrag() {
            wrapEl.style.animation = '';
            wrapEl.style.transition = '';
        }
        wrapEl.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            if (e.target && (e.target.closest && e.target.closest('#josh-thought-wrap'))) return;
            e.preventDefault();
            var r = wrapEl.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = r.left;
            startTop = r.top;
            wrapWidth = r.width;
            wrapHeight = r.height;
            applyPosition(wrapEl, startLeft, startTop);
            function onMove(e2) {
                var dx = e2.clientX - startX;
                var dy = e2.clientY - startY;
                var newLeft = clamp(startLeft + dx, 0, window.innerWidth - wrapWidth);
                var newTop = clamp(startTop + dy, 0, Math.max(0, window.innerHeight - wrapHeight));
                wrapEl.style.left = newLeft + 'px';
                wrapEl.style.top = newTop + 'px';
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                finishDrag();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        wrapEl.addEventListener('touchstart', function (e) {
            if (e.touches.length === 0) return;
            if (e.target && (e.target.closest && e.target.closest('#josh-thought-wrap'))) return;
            e.preventDefault();
            var r = wrapEl.getBoundingClientRect();
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startLeft = r.left;
            startTop = r.top;
            wrapWidth = r.width;
            wrapHeight = r.height;
            applyPosition(wrapEl, startLeft, startTop);
            function onMove(e2) {
                if (e2.touches.length === 0) return;
                e2.preventDefault();
                var newLeft = clamp(startLeft + (e2.touches[0].clientX - startX), 0, window.innerWidth - wrapWidth);
                var newTop = clamp(startTop + (e2.touches[0].clientY - startY), 0, Math.max(0, window.innerHeight - wrapHeight));
                wrapEl.style.left = newLeft + 'px';
                wrapEl.style.top = newTop + 'px';
            }
            function onEnd() {
                document.removeEventListener('touchmove', onMove, { passive: false });
                document.removeEventListener('touchend', onEnd);
                document.removeEventListener('touchcancel', onEnd);
                finishDrag();
            }
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
            document.addEventListener('touchcancel', onEnd);
        }, { passive: false });
    }
    (function () {
        var joshWrap = document.getElementById('josh-avatar');
        if (joshWrap && joshWrap.parentNode !== document.body) document.body.appendChild(joshWrap);
        initJoshAvatarDrag(joshWrap);
        var thoughtEl = document.getElementById('josh-avatar-thought');
        var thoughtSimple = document.getElementById('josh-thought-simple');
        var thoughtInputRow = document.getElementById('josh-thought-input-row');
        var thoughtInput = document.getElementById('josh-thought-input');
        var thoughtSend = document.getElementById('josh-thought-send');
        var thoughtChat = document.getElementById('josh-thought-chat');
        var thoughtClose = document.getElementById('josh-thought-close');
        var joshAvatarHelp = document.getElementById('josh-avatar-help');
        var thoughtMessages = document.getElementById('josh-thought-messages');
        var thoughtChatInput = document.getElementById('josh-thought-chat-input');
        var thoughtChatSend = document.getElementById('josh-thought-chat-send');
        var thoughtWrap = document.getElementById('josh-thought-wrap');

        var joshBubbleMessages = [
            "Click on 'Mixer'/'Mastering controls' to manually control your mix!",
            "Click on the preset prompts to hear real-time changes to your mix!"
        ];
        var joshBubbleChatHistory = [];
        var joshShowMessageAt = 0;
        var joshPhase = 'blank';
        var JOSH_BLANK_MS = 12000;
        var JOSH_MESSAGE_MS = 6000;

        function pickRandomMessage() {
            return joshBubbleMessages[Math.floor(Math.random() * joshBubbleMessages.length)];
        }
        function runJoshBubbleTimer() {
            var now = Date.now();
            if (joshPhase === 'blank') {
                if (now - joshShowMessageAt >= JOSH_BLANK_MS) {
                    joshPhase = 'message';
                    joshShowMessageAt = now;
                    if (thoughtEl) thoughtEl.textContent = pickRandomMessage();
                    if (thoughtWrap) thoughtWrap.classList.remove('josh-bubble-empty');
                } else {
                    if (thoughtEl) thoughtEl.textContent = '';
                    if (thoughtWrap) thoughtWrap.classList.add('josh-bubble-empty');
                }
            } else {
                if (now - joshShowMessageAt >= JOSH_MESSAGE_MS) {
                    joshPhase = 'blank';
                    joshShowMessageAt = now;
                    if (thoughtEl) thoughtEl.textContent = '';
                    if (thoughtWrap) thoughtWrap.classList.add('josh-bubble-empty');
                } else if (thoughtWrap) {
                    thoughtWrap.classList.remove('josh-bubble-empty');
                }
            }
        }
        if (thoughtEl) {
            thoughtEl.textContent = '';
            setInterval(runJoshBubbleTimer, 500);
        }
        if (thoughtWrap) thoughtWrap.classList.add('josh-bubble-empty');

        function showJoshSimple() {
            if (thoughtSimple) thoughtSimple.classList.remove('hidden');
            if (thoughtInputRow) thoughtInputRow.classList.add('hidden');
            if (thoughtChat) thoughtChat.classList.add('hidden');
            if (thoughtInput) thoughtInput.value = '';
            runJoshBubbleTimer();
        }
        function nudgeAvatarIfNeeded() {
            if (!joshWrap || !thoughtWrap) return;
            var padTop = 32;
            var padSides = 20;
            var vw = window.innerWidth;
            var vh = window.innerHeight;
            function runNudge() {
                var wr = joshWrap.getBoundingClientRect();
                var target = thoughtWrap;
                if (thoughtChat && !thoughtChat.classList.contains('hidden')) target = thoughtChat;
                else if (thoughtInputRow && !thoughtInputRow.classList.contains('hidden')) target = thoughtInputRow;
                var tr = target.getBoundingClientRect();
                var currentLeft = wr.left;
                var currentBottom = vh - wr.bottom;
                var deltaLeft = 0;
                var deltaBottom = 0;
                if (tr.top < padTop) deltaBottom = padTop - tr.top;
                if (tr.left < padSides) deltaLeft = padSides - tr.left;
                if (tr.right > vw - padSides) deltaLeft = -(tr.right - (vw - padSides));
                var newLeft = currentLeft + deltaLeft;
                var newBottom = currentBottom - deltaBottom;
                newLeft = Math.max(padSides, Math.min(vw - wr.width - padSides, newLeft));
                var maxBottom = vh - wr.height - padTop;
                var minBottom = padSides;
                newBottom = Math.max(minBottom, Math.min(maxBottom, newBottom));
                joshWrap.style.left = newLeft + 'px';
                joshWrap.style.bottom = newBottom + 'px';
            }
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    runNudge();
                    setTimeout(runNudge, 100);
                    setTimeout(runNudge, 280);
                });
            });
        }
        function showJoshInputRow() {
            if (thoughtSimple) thoughtSimple.classList.add('hidden');
            if (thoughtInputRow) thoughtInputRow.classList.remove('hidden');
            if (thoughtChat) thoughtChat.classList.add('hidden');
            if (thoughtInput) {
                thoughtInput.value = '';
                thoughtInput.focus();
            }
            nudgeAvatarIfNeeded();
        }
        function showJoshChat() {
            if (thoughtSimple) thoughtSimple.classList.add('hidden');
            if (thoughtInputRow) thoughtInputRow.classList.add('hidden');
            if (thoughtChat) thoughtChat.classList.remove('hidden');
            renderJoshBubbleMessages();
            if (thoughtChatInput) {
                thoughtChatInput.value = '';
                thoughtChatInput.focus();
            }
            nudgeAvatarIfNeeded();
        }
        function renderJoshBubbleMessages() {
            if (!thoughtMessages) return;
            thoughtMessages.innerHTML = '';
            joshBubbleChatHistory.forEach(function (m) {
                var div = document.createElement('div');
                div.className = 'josh-msg ' + m.role;
                div.textContent = (m.role === 'user' ? 'You: ' : 'Josh: ') + m.text;
                thoughtMessages.appendChild(div);
            });
            thoughtMessages.scrollTop = thoughtMessages.scrollHeight;
        }
        var joshSending = false;
        function sendJoshBubbleMessage(text, fromChatInput) {
            text = (text || '').trim();
            if (!text) return;
            if (joshSending) return;
            joshSending = true;
            joshBubbleChatHistory.push({ role: 'user', text: text });
            if (!fromChatInput && thoughtInput) thoughtInput.value = '';
            if (fromChatInput) {
                renderJoshBubbleMessages();
                if (thoughtChatInput) thoughtChatInput.value = '';
            }
            var typingEl = null;
            if (thoughtMessages) {
                typingEl = document.createElement('div');
                typingEl.className = 'josh-msg bot';
                typingEl.textContent = 'Josh: ...';
                thoughtMessages.appendChild(typingEl);
                thoughtMessages.scrollTop = thoughtMessages.scrollHeight;
            }
            fetch((window.location.origin || '') + '/api/josh/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: 'chat', userMessage: text, changesSummary: '', source: 'bubble' })
            }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (data) {
                joshSending = false;
                if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                var reply = (data.reply || 'Something went wrong. Try again.').trim();
                joshBubbleChatHistory.push({ role: 'bot', text: reply });
                if (fromChatInput) {
                    renderJoshBubbleMessages();
                } else {
                    showJoshChat();
                }
            }).catch(function () {
                joshSending = false;
                if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                joshBubbleChatHistory.push({ role: 'bot', text: "Couldn't reach Josh. Try again in a sec." });
                if (fromChatInput) renderJoshBubbleMessages(); else showJoshChat();
            });
        }

        if (thoughtSimple && thoughtEl) {
            thoughtSimple.addEventListener('click', function (e) {
                e.stopPropagation();
                showJoshInputRow();
            });
            thoughtEl.addEventListener('click', function (e) {
                e.stopPropagation();
                showJoshInputRow();
            });
            thoughtEl.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showJoshInputRow();
                }
            });
        }
        if (thoughtSend && thoughtInput) {
            thoughtSend.addEventListener('click', function () {
                sendJoshBubbleMessage(thoughtInput.value, false);
            });
            thoughtInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var val = thoughtInput.value;
                    if ((val || '').trim()) sendJoshBubbleMessage(val, false);
                }
            });
        }
        if (thoughtClose) {
            thoughtClose.addEventListener('click', function () {
                showJoshSimple();
            });
        }
        if (joshAvatarHelp) {
            joshAvatarHelp.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            joshAvatarHelp.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                showJoshInputRow();
                if (thoughtInput) thoughtInput.focus();
            });
        }
        if (joshWrap) {
            document.addEventListener('mousedown', function (e) {
                if (!thoughtInputRow || thoughtInputRow.classList.contains('hidden')) return;
                if (thoughtChat && !thoughtChat.classList.contains('hidden')) return;
                if (joshWrap.contains(e.target)) return;
                showJoshSimple();
            });
            window.addEventListener('resize', function () {
                if (thoughtInputRow && !thoughtInputRow.classList.contains('hidden')) nudgeAvatarIfNeeded();
                else if (thoughtChat && !thoughtChat.classList.contains('hidden')) nudgeAvatarIfNeeded();
            });
        }
        if (thoughtChatSend && thoughtChatInput) {
            thoughtChatSend.addEventListener('click', function () {
                sendJoshBubbleMessage(thoughtChatInput.value, true);
            });
            thoughtChatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendJoshBubbleMessage(thoughtChatInput.value, true);
                }
            });
        }
    })();

    async function sendChat() {
        const text = chatInput.value.trim();
        if (!text) return;
        addChatMessage('user', text);
        chatInput.value = '';
        if (!state.mixReady) {
            (async function () {
                var fallback = "Create your mix first: click Mix it, then I can help you refine it.";
                try {
                    var res = await fetch((window.location.origin || '') + '/api/josh/reply', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ context: 'mixing', userMessage: text, changesSummary: 'User has not run Mix it yet.' })
                    });
                    var data = await res.json().catch(function () { return {}; });
                    if (res.ok && data.reply) {
                        addChatMessage('bot', data.reply);
                        return;
                    }
                } catch (e) { console.warn('Josh reply', e); }
                addChatMessage('bot', fallback);
            })();
            return;
        }
        let changes = null;
        try {
            const res = await fetch((window.location.origin || '') + '/api/josh/interpret', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, tracks: state.tracks })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.changes && Array.isArray(data.changes)) {
                changes = data.changes;
                console.log('[MegaMix] Josh LLM: ' + changes.length + ' changes');
            }
        } catch (e) {
            console.warn('[MegaMix] Josh LLM fallback:', e.message || e);
        }
        if (!changes || changes.length === 0) {
            changes = window.MegaMix.interpretChatMessage(text, state.tracks, state.trackAnalyses);
        }
        if (changes && changes.length > 0) {
            var tJosh = performance.now();
            console.log('[MegaMix perf] Josh chat: applying ' + changes.length + ' changes');
            pushUndo();
            window.MegaMix.applyJoshResponse(state.tracks, changes);
            var stepLines = window.MegaMix.formatJoshChangesForDisplay(changes, state.tracks);
            state.joshChangeHistory.push(stepLines);
            state.lastJoshChangesSummary = stepLines;
            updateJoshTransparencyPanel();
            console.log('[MegaMix perf] Josh chat: applyJoshResponse ' + (performance.now() - tJosh).toFixed(2) + ' ms');
            renderMixerStrips();
            window.MegaMix.syncAllTracksToLiveGraph();
            (async function () {
                var fallback = "Done. Hit play on the After tab and see how it hits.";
                try {
                    var res = await fetch((window.location.origin || '') + '/api/josh/reply', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            context: 'mixing',
                            userMessage: text,
                            changesSummary: (state.lastJoshChangesSummary || []).join('; ')
                        })
                    });
                    var data = await res.json().catch(function () { return {}; });
                    if (res.ok && data.reply) {
                        addChatMessage('bot', data.reply);
                        return;
                    }
                } catch (e) { console.warn('Josh reply', e); }
                addChatMessage('bot', fallback);
            })();
        } else {
            (async function () {
                var fallback = "I didn't catch which tracks to change. Try \"make the kick and snare more prominent\" or \"bring up the vocals\".";
                try {
                    var res = await fetch((window.location.origin || '') + '/api/josh/reply', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ context: 'mixing', userMessage: text, changesSummary: '' })
                    });
                    var data = await res.json().catch(function () { return {}; });
                    if (res.ok && data.reply) {
                        addChatMessage('bot', data.reply);
                        return;
                    }
                } catch (e) { console.warn('Josh reply', e); }
                addChatMessage('bot', fallback);
            })();
        }
    }

    function getStoredPresets() {
        try {
            const raw = localStorage.getItem(window.MegaMix.PRESET_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }
    function setStoredPresets(list) {
        localStorage.setItem(window.MegaMix.PRESET_STORAGE_KEY, JSON.stringify(list));
        refreshLoadPresetSelect();
    }
    function refreshLoadPresetSelect() {
        if (!loadPresetSelect) return;
        const list = getStoredPresets();
        const current = loadPresetSelect.value;
        loadPresetSelect.innerHTML = '<option value="">Load preset…</option>';
        list.forEach((p, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = p.name;
            loadPresetSelect.appendChild(opt);
        });
        if (current !== undefined) loadPresetSelect.value = current;
    }
    if (loadPresetSelect) refreshLoadPresetSelect();
    if (btnSavePreset) btnSavePreset.addEventListener('click', () => {
        const name = (presetNameInput && presetNameInput.value ? presetNameInput.value.trim() : '') || 'Preset ' + (getStoredPresets().length + 1);
        const list = getStoredPresets();
        list.push({ name, state: { tracks: JSON.parse(JSON.stringify(state.tracks)) } });
        setStoredPresets(list);
        if (presetNameInput) presetNameInput.value = '';
    });
    if (btnLoadPreset) btnLoadPreset.addEventListener('click', () => {
        if (!loadPresetSelect || loadPresetSelect.value === '') return;
        const list = getStoredPresets();
        const p = list[parseInt(loadPresetSelect.value, 10)];
        if (p && p.state.tracks && Array.isArray(p.state.tracks)) {
            pushUndo();
            state.tracks = JSON.parse(JSON.stringify(p.state.tracks));
            while (state.tracks.length > state.uploadedFiles.length) state.tracks.pop();
            while (state.tracks.length < state.uploadedFiles.length) state.tracks.push(window.MegaMix.defaultTrack(state.uploadedFiles[state.tracks.length].name));
            state.joshChangeHistory = [];
            renderMixerStrips();
            window.MegaMix.syncAllTracksToLiveGraph();
            updateJoshTransparencyPanel();
        }
    });

    const MAX_UNDO_STACK = 50;
    let lastPushUndoTime = 0;
    const PUSH_UNDO_COOLDOWN_MS = 500;
    function pushUndo() {
        if (Date.now() - lastPushUndoTime < PUSH_UNDO_COOLDOWN_MS) return;
        lastPushUndoTime = Date.now();
        if (state.undoStack.length >= MAX_UNDO_STACK) state.undoStack.shift();
        state.undoStack.push({
            tracks: JSON.stringify(window.MegaMix.snapshotMixerState()),
            joshLen: (state.joshChangeHistory && state.joshChangeHistory.length) || 0
        });
        state.redoStack = [];
        updateUndoRedoButtons();
    }
    function updateUndoRedoButtons() {
        if (btnUndo) btnUndo.disabled = state.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = state.redoStack.length === 0;
    }
    function restoreTracks(entry) {
        try {
            var tracksSnapshot = null;
            var joshLen = undefined;
            if (entry && typeof entry === 'object' && typeof entry.tracks === 'string') {
                tracksSnapshot = entry.tracks;
                joshLen = entry.joshLen;
            } else if (typeof entry === 'string') {
                tracksSnapshot = entry;
            } else if (entry && typeof entry === 'object' && entry.tracks != null) {
                tracksSnapshot = entry.tracks;
                joshLen = entry.joshLen;
            }
            if (tracksSnapshot == null) return;
            window.MegaMix.restoreMixerState(tracksSnapshot);
            if (typeof joshLen === 'number' && state.joshChangeHistory) state.joshChangeHistory = state.joshChangeHistory.slice(0, joshLen);
            renderMixerStrips();
            window.MegaMix.syncAllTracksToLiveGraph();
            updateJoshTransparencyPanel();
        } catch (_) {}
    }
    btnUndo.addEventListener('click', () => {
        if (state.undoStack.length === 0) return;
        if (state.redoStack.length >= MAX_UNDO_STACK) state.redoStack.shift();
        state.redoStack.push({
            tracks: JSON.stringify(window.MegaMix.snapshotMixerState()),
            joshChangeHistory: (state.joshChangeHistory && state.joshChangeHistory.slice(0)) || []
        });
        var popped = state.undoStack.pop();
        restoreTracks(popped);
        updateUndoRedoButtons();
        addChatMessage('bot', 'Undo applied.');
    });
    btnRedo.addEventListener('click', () => {
        if (state.redoStack.length === 0) return;
        if (state.undoStack.length >= MAX_UNDO_STACK) state.undoStack.shift();
        state.undoStack.push({
            tracks: JSON.stringify(window.MegaMix.snapshotMixerState()),
            joshLen: (state.joshChangeHistory && state.joshChangeHistory.length) || 0
        });
        var popped = state.redoStack.pop();
        if (popped && typeof popped === 'object' && Array.isArray(popped.joshChangeHistory)) {
            window.MegaMix.restoreMixerState(popped.tracks);
            state.joshChangeHistory = popped.joshChangeHistory.slice(0);
            renderMixerStrips();
            window.MegaMix.syncAllTracksToLiveGraph();
            updateJoshTransparencyPanel();
        } else {
            restoreTracks(popped);
        }
        updateUndoRedoButtons();
        addChatMessage('bot', 'Redo applied.');
    });
    updateUndoRedoButtons();

    function openEmailModal(type) {
        pendingDownload = { type };
        if (emailModalApp) emailModalApp.classList.remove('hidden');
        if (emailInputApp) emailInputApp.value = '';
        document.body.style.overflow = 'hidden';
    }
    function closeEmailModal() {
        if (emailModalApp) emailModalApp.classList.add('hidden');
        pendingDownload = null;
        document.body.style.overflow = '';
    }

    var loginOrTrialModalApp = document.getElementById('loginOrTrialModalApp');
    function openLoginOrTrialModal() {
        if (loginOrTrialModalApp) {
            loginOrTrialModalApp.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    }
    function closeLoginOrTrialModal() {
        if (loginOrTrialModalApp) {
            loginOrTrialModalApp.classList.add('hidden');
            document.body.style.overflow = '';
        }
        pendingDownload = null;
    }
    function performMixDownload() {
        if (!state.mixReady || state.stemBuffers.length === 0) return;
        showToast('<p>Preparing your mix download…</p>', null);
        try {
            window.MegaMix.buildAfterMixWithFX().then(function (afterMix) {
                if (afterMix) {
                    const blob = window.MegaMix.encodeWav(afterMix.left, afterMix.right, afterMix.sampleRate);
                    const filename = 'MegaMix_Download_Nomaster.wav';
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.click();
                    var readyToast = document.createElement('div');
                    readyToast.className = 'toast toast-anchored';
                    readyToast.setAttribute('role', 'alert');
                    readyToast.style.bottom = '24px';
                    readyToast.style.left = '50%';
                    readyToast.style.transform = 'translateX(-50%)';
                    readyToast.innerHTML = '<p>If the download didn\'t start, <a href="' + url + '" download="' + filename + '" style="color:#a78bfa;text-decoration:underline;font-weight:600;">click here to download your mix</a>.</p>';
                    document.body.appendChild(readyToast);
                    setTimeout(function () { if (readyToast.parentNode) readyToast.parentNode.removeChild(readyToast); }, 15000);
                    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
                }
            }).catch(function (e) { console.error('Export', e); showToast('<p>Download failed. Please try again.</p>', null); });
        } catch (e) { console.error('Export', e); showToast('<p>Download failed. Please try again.</p>', null); }
    }
    function performMasteredDownload() {
        if (!state.masteredUrl) return;
        const a = document.createElement('a');
        a.href = state.masteredUrl;
        a.download = 'MegaMix_Download_Master.wav';
        a.click();
        try {
            if (window.trackEvent) {
                window.trackEvent('mix_download_master', {
                    source: 'web_app'
                });
            }
        } catch (e) {
            // ignore analytics errors
        }
    }
    function performSlowedReverbDownload() {
        if (!state.slowedReverbUrl) return;
        const a = document.createElement('a');
        a.href = state.slowedReverbUrl;
        a.download = 'MegaMix_Slowed_Reverb.wav';
        a.click();
    }
    function performPendingDownload() {
        if (!pendingDownload) return;
        const t = pendingDownload.type;
        pendingDownload = null;
        if (t === 'mix') performMixDownload();
        else if (t === 'mastered') performMasteredDownload();
        else if (t === 'slowed-reverb') performSlowedReverbDownload();
    }
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
    }
    async function handleEmailSignup(signedUp) {
        const info = pendingDownload;
        if (signedUp && emailInputApp) {
            const email = emailInputApp.value.trim();
            if (!email || !isValidEmail(email)) {
                alert('Please enter a valid email address.');
                return;
            }
            const format = info && info.type === 'mastered' ? 'web-mastered' : (info && info.type === 'slowed-reverb' ? 'web-slowed-reverb' : 'web-mix');
            try {
                const base = window.location.origin || '';
                const res = await fetch(base + '/mailchimp-signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, format, platform: 'web' })
                });
                const data = await res.json().catch(function () { return {}; });
                if (!data.success) console.warn('Mailchimp signup', data.error || data);
            } catch (e) { console.warn('Mailchimp signup', e); }
        }
        closeEmailModal();
        if (info) {
            if (info.type === 'mix') performMixDownload();
            else if (info.type === 'mastered') performMasteredDownload();
            else if (info.type === 'slowed-reverb') performSlowedReverbDownload();
        }
    }

    function isPreviewMode() {
        return window.MegaMixAuth && window.MegaMixAuth.isPreviewMode && window.MegaMixAuth.isPreviewMode();
    }
    function isSubscribedUser() {
        return document.body && document.body.classList.contains('logged-in');
    }

    btnExport.addEventListener('click', function () {
        if (!state.mixReady || state.stemBuffers.length === 0) return;
        if (isPreviewMode()) {
            pendingDownload = { type: 'mix' };
            openLoginOrTrialModal();
            return;
        }
        if (isSubscribedUser()) {
            performMixDownload();
            return;
        }
        openEmailModal('mix');
    });

    const btnAiMastering = document.getElementById('btn-ai-mastering');

    var masteringProgressFill = document.getElementById('mastering-progress-fill');
    function showMasteringStatus(text, progressPct) {
        if (masteringStatusEl) masteringStatusEl.textContent = text || '';
        if (masteringLoadingBlock) masteringLoadingBlock.classList.toggle('hidden', !text);
        if (masteringProgressFill) masteringProgressFill.style.width = (progressPct != null ? progressPct : 0) + '%';
    }
    if (btnAiMastering) {
        btnAiMastering.addEventListener('click', async () => {
            if (!state.mixReady || state.stemBuffers.length === 0) {
                addChatMessage('bot', 'Upload stems and click Mix it first, then run AI Mastering.');
                return;
            }
            try {
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_master_render_start', {
                            source: 'ai_master_button'
                        });
                    }
                } catch (e) {
                    // ignore analytics errors
                }
                var tMastering = performance.now();
                console.log('[MegaMix perf] AI Mastering: start (step 1 buildAfterMixWithFX, step 2 runMasteringChain)');
                window.MegaMix.revokeMasteredUrl();
                btnAiMastering.disabled = true;
                showMasteringStatus('Rendering mix… (step 1 of 2)', 10);
                const afterMix = await window.MegaMix.buildAfterMixWithFX();
                if (!afterMix) {
                    showMasteringStatus('', 0);
                    btnAiMastering.disabled = false;
                    addChatMessage('bot', 'Could not render the mix. Try again.');
                    return;
                }
                if (state.unmasteredMixUrl) URL.revokeObjectURL(state.unmasteredMixUrl);
                state.unmasteredMixUrl = URL.createObjectURL(window.MegaMix.encodeWav(afterMix.left, afterMix.right, afterMix.sampleRate));
                showMasteringStatus('Applying AI mastering… (step 2 of 2)', 50);
                state.masteringOptions = state.masteringOptions || { punch: 0, loudness: 1, compression: 1 };
                const mastered = await window.MegaMix.runMasteringChain(afterMix, state.masteringOptions);
                showMasteringStatus('', 0);
                btnAiMastering.disabled = false;
                console.log('[MegaMix perf] AI Mastering: total ' + (performance.now() - tMastering).toFixed(2) + ' ms');
                if (mastered) {
                    if (state.slowedReverbUrl) { URL.revokeObjectURL(state.slowedReverbUrl); state.slowedReverbUrl = null; }
                    state.masteredUrl = URL.createObjectURL(window.MegaMix.encodeWav(mastered.left, mastered.right, mastered.sampleRate));
                    addChatMessage('bot', 'Mastering complete. Taking you to the Mastering page.');
                    showView('mastering');
                    try {
                        if (window.trackEvent) {
                            window.trackEvent('mix_master_render_complete', {
                                success: true
                            });
                        }
                    } catch (e) {
                        // ignore analytics errors
                    }
                } else {
                    addChatMessage('bot', 'Mastering did not produce output. Try again.');
                }
            } catch (e) {
                console.error('AI Mastering', e);
                showMasteringStatus('', 0);
                btnAiMastering.disabled = false;
                addChatMessage('bot', 'Mastering failed. Please try again.');
                try {
                    if (window.trackEvent) {
                        window.trackEvent('mix_master_render_complete', {
                            success: false
                        });
                    }
                } catch (err) {
                    // ignore analytics errors
                }
            }
        });
    }
    let masteringPageInited = false;
    function initMasteringPageWhenShown() {
        const audioMasteringBefore = document.getElementById('audio-mastering-before');
        const audioMastering = document.getElementById('audio-mastering');
        const playMastering = document.getElementById('play-mastering');
        const progressMastering = document.getElementById('progress-mastering');
        const timeMastering = document.getElementById('time-mastering');
        const durationMastering = document.getElementById('duration-mastering');
        const chatMessagesMastering = document.getElementById('chat-messages-mastering');
        const chatInputMastering = document.getElementById('chat-input-mastering');
        const chatSendMastering = document.getElementById('chat-send-mastering');
        const btnDownloadMasteredFinal = document.getElementById('btn-download-mastered-final');
        const masteringTabs = document.querySelectorAll('.mastering-tab');
        if (!audioMastering || !playMastering || !progressMastering) return;

        function formatTime(s) {
            if (!isFinite(s) || s < 0) return '0:00';
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return m + ':' + (sec < 10 ? '0' : '') + sec;
        }
        function getActiveMasteringMode() {
            const active = document.querySelector('.mastering-tab.active');
            return active ? active.getAttribute('data-mode') : 'after';
        }
        function setMasteringMutedFromTab() {
            const mode = getActiveMasteringMode();
            if (audioMasteringBefore) audioMasteringBefore.muted = (mode !== 'before');
            audioMastering.muted = (mode !== 'after');
        }
        function masteringDuration() {
            const mode = getActiveMasteringMode();
            const el = mode === 'before' && audioMasteringBefore ? audioMasteringBefore : audioMastering;
            return (el && el.duration && isFinite(el.duration)) ? el.duration : 0;
        }
        var MASTERING_PROGRESS_THROTTLE_MS = 120;
        var lastMasteringProgressUIUpdate = 0;
        function updateMasteringProgress() {
            const mode = getActiveMasteringMode();
            const el = mode === 'before' && audioMasteringBefore ? audioMasteringBefore : audioMastering;
            const d = masteringDuration();
            const t = (el && el.currentTime != null) ? el.currentTime : 0;
            var now = Date.now();
            if (now - lastMasteringProgressUIUpdate >= MASTERING_PROGRESS_THROTTLE_MS) {
                lastMasteringProgressUIUpdate = now;
                if (d > 0) {
                    progressMastering.value = (t / d) * 100;
                    if (durationMastering) durationMastering.textContent = formatTime(d);
                }
                if (timeMastering) timeMastering.textContent = formatTime(t);
                drawMasteringWaveform();
            }
        }

        let waveformBins = null;
        const canvasWaveform = document.getElementById('waveform-mastering');
        function drawMasteringWaveform() {
            if (!canvasWaveform || !waveformBins || waveformBins.length === 0) return;
            const mode = getActiveMasteringMode();
            const el = mode === 'before' && audioMasteringBefore ? audioMasteringBefore : audioMastering;
            const d = (el && el.duration && isFinite(el.duration)) ? el.duration : 0;
            const t = (el && el.currentTime != null) ? el.currentTime : 0;
            const w = canvasWaveform.width;
            const h = canvasWaveform.height;
            const ctx = canvasWaveform.getContext('2d');
            if (!ctx) return;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, w, h);
            const n = waveformBins.length;
            const barW = Math.max(1, w / n);
            const midY = h / 2;
            ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
            for (let i = 0; i < n; i++) {
                const v = waveformBins[i];
                const barH = Math.max(1, (v * midY));
                ctx.fillRect(i * barW, midY - barH / 2, barW, barH);
            }
            const playheadX = d && isFinite(d) && d > 0 ? (t / d) * w : 0;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(playheadX - 1, 0, 2, h);
        }
        function fillWaveformFromUrl(url) {
            if (!canvasWaveform || !window.MegaMix || !window.MegaMix.getAudioContext) return;
            const ctx = window.MegaMix.getAudioContext();
            fetch(url).then(r => r.arrayBuffer()).then(ab => ctx.decodeAudioData(ab)).then(buffer => {
                const ch0 = buffer.getChannelData(0);
                const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
                const len = buffer.length;
                const numBins = Math.min(800, Math.max(200, Math.floor(len / 1024)));
                const binSize = Math.floor(len / numBins);
                const bins = new Float32Array(numBins);
                for (let i = 0; i < numBins; i++) {
                    let peak = 0;
                    const start = i * binSize;
                    const end = Math.min(start + binSize, len);
                    for (let j = start; j < end; j++) {
                        const s = (Math.abs(ch0[j]) + Math.abs(ch1[j])) / 2;
                        if (s > peak) peak = s;
                    }
                    bins[i] = peak;
                }
                let max = 0;
                for (let i = 0; i < numBins; i++) if (bins[i] > max) max = bins[i];
                if (max > 0) for (let i = 0; i < numBins; i++) bins[i] /= max;
                waveformBins = bins;
                if (canvasWaveform.parentElement) {
                    const r = window.devicePixelRatio || 1;
                    const cw = Math.floor((canvasWaveform.parentElement.offsetWidth || 600) * r);
                    const ch = Math.floor(70 * r);
                    canvasWaveform.width = cw;
                    canvasWaveform.height = ch;
                }
                drawMasteringWaveform();
            }).catch(() => {});
        }
        const masteringBaseValues = { threshold: -18, ratio: 2.5, attack: 0.01, release: 0.2, output: 1 };
        function ensureMasteringGraph() {
            if (masteringGraphInited || !window.MegaMix || !window.MegaMix.getAudioContext) return;
            const ctx = window.MegaMix.getAudioContext();
            if (audioMasteringBefore) {
                const sourceBefore = ctx.createMediaElementSource(audioMasteringBefore);
                sourceBefore.connect(ctx.destination);
            }
            const source = ctx.createMediaElementSource(audioMastering);
            const dryGain = ctx.createGain();
            const compressor = ctx.createDynamicsCompressor();
            const wetGainNode = ctx.createGain();
            const wetGain = ctx.createGain();
            const sumNode = ctx.createGain();
            compressor.threshold.value = masteringBaseValues.threshold;
            compressor.knee.value = 6;
            compressor.ratio.value = masteringBaseValues.ratio;
            compressor.attack.value = masteringBaseValues.attack;
            compressor.release.value = masteringBaseValues.release;
            wetGainNode.gain.value = masteringBaseValues.output;
            source.connect(dryGain);
            source.connect(compressor);
            compressor.connect(wetGainNode);
            wetGainNode.connect(wetGain);
            dryGain.connect(sumNode);
            wetGain.connect(sumNode);
            sumNode.connect(ctx.destination);
            const mixEl = document.getElementById('mastering-mix');
            const mixPct = mixEl ? Math.max(0, Math.min(100, Number(mixEl.value) || 100)) : 100;
            dryGain.gain.value = 1 - mixPct / 100;
            wetGain.gain.value = mixPct / 100;
            masterCompressor = compressor;
            masterGain = wetGainNode;
            masterDryGain = dryGain;
            masterWetGain = wetGain;
            masteringGraphInited = true;
        }
        if (state.masteredUrl) {
            ensureMasteringGraph();
            audioMastering.src = state.masteredUrl;
            if (state.unmasteredMixUrl && audioMasteringBefore) audioMasteringBefore.src = state.unmasteredMixUrl;
            audioMastering.onloadedmetadata = function () {
                if (audioMastering.duration && isFinite(audioMastering.duration) && durationMastering)
                    durationMastering.textContent = formatTime(audioMastering.duration);
            };
            if (audioMasteringBefore) audioMasteringBefore.onloadedmetadata = function () {
                if (getActiveMasteringMode() === 'before' && durationMastering && audioMasteringBefore.duration && isFinite(audioMasteringBefore.duration))
                    durationMastering.textContent = formatTime(audioMasteringBefore.duration);
            };
            masteringTabs.forEach(function (t) {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            var afterTab = document.querySelector('.mastering-tab[data-mode="after"]');
            if (afterTab) {
                afterTab.classList.add('active');
                afterTab.setAttribute('aria-selected', 'true');
            }
            setMasteringMutedFromTab();
            fillWaveformFromUrl(state.masteredUrl);
        } else if (chatMessagesMastering) {
            const msg = document.createElement('div');
            msg.className = 'msg bot';
            msg.textContent = 'Josh: Run AI Mastering from the mixing page first.';
            chatMessagesMastering.appendChild(msg);
        }

        function stopBothMastering() {
            if (audioMasteringBefore) audioMasteringBefore.pause();
            audioMastering.pause();
            playMastering.classList.remove('playing');
            playMastering.textContent = '\u25B6';
            updateMasteringProgress();
        }
        function getCurrentMasteringTime() {
            const mode = getActiveMasteringMode();
            if (mode === 'before' && audioMasteringBefore && !audioMasteringBefore.paused)
                return audioMasteringBefore.currentTime || 0;
            if (!audioMastering.paused) return audioMastering.currentTime || 0;
            const d = masteringDuration();
            return d > 0 ? (progressMastering.value / 100) * d : 0;
        }
        function startMasteringPlaybackAt(mode, pos) {
            const d = masteringDuration();
            if (d <= 0) return;
            if (mode === 'before' && audioMasteringBefore && state.unmasteredMixUrl) {
                audioMasteringBefore.currentTime = Math.min(pos, (audioMasteringBefore.duration || d) - 0.01);
                audioMasteringBefore.muted = false;
                audioMasteringBefore.play();
            } else if (mode === 'after' && state.masteredUrl) {
                audioMastering.currentTime = Math.min(pos, (audioMastering.duration || d) - 0.01);
                audioMastering.muted = false;
                audioMastering.play();
            }
            playMastering.classList.add('playing');
            playMastering.textContent = '\u23F8';
        }
        if (!masteringPageInited) {
            masteringPageInited = true;
            var btnReturnToMixing = document.getElementById('btn-return-to-mixing');
            if (btnReturnToMixing) btnReturnToMixing.addEventListener('click', function () { showView('app'); });
            masteringTabs.forEach(function (tab) {
                tab.addEventListener('click', function () {
                    masteringTabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
                    this.classList.add('active');
                    this.setAttribute('aria-selected', 'true');
                    const playing = (audioMasteringBefore && !audioMasteringBefore.paused) || !audioMastering.paused;
                    if (playing) {
                        const pos = getCurrentMasteringTime();
                        if (audioMasteringBefore) audioMasteringBefore.pause();
                        audioMastering.pause();
                        setMasteringMutedFromTab();
                        startMasteringPlaybackAt(getActiveMasteringMode(), pos);
                    } else {
                        setMasteringMutedFromTab();
                    }
                });
            });
            playMastering.addEventListener('click', function () {
                const mode = getActiveMasteringMode();
                const playing = (audioMasteringBefore && !audioMasteringBefore.paused) || !audioMastering.paused;
                if (playing) {
                    stopBothMastering();
                } else {
                    var srPlay = document.getElementById('play-slowed-reverb');
                    var srBefore = document.getElementById('audio-slowed-before');
                    var srAfter = document.getElementById('audio-slowed-after');
                    if (srBefore) srBefore.pause();
                    if (srAfter) srAfter.pause();
                    if (srPlay) { srPlay.classList.remove('playing'); srPlay.textContent = '\u25B6'; }
                    const d = masteringDuration();
                    if (d <= 0) return;
                    const pos = getCurrentMasteringTime();
                    setMasteringMutedFromTab();
                    startMasteringPlaybackAt(mode, pos);
                }
            });
            audioMastering.addEventListener('timeupdate', function () { if (getActiveMasteringMode() === 'after') updateMasteringProgress(); });
            if (audioMasteringBefore) audioMasteringBefore.addEventListener('timeupdate', function () { if (getActiveMasteringMode() === 'before') updateMasteringProgress(); });
            audioMastering.addEventListener('ended', stopBothMastering);
            if (audioMasteringBefore) audioMasteringBefore.addEventListener('ended', stopBothMastering);
            progressMastering.addEventListener('input', function () {
                const d = masteringDuration();
                if (d && isFinite(d) && d > 0) {
                    const t = (progressMastering.value / 100) * d;
                    const mode = getActiveMasteringMode();
                    if (mode === 'before' && audioMasteringBefore) audioMasteringBefore.currentTime = t;
                    else audioMastering.currentTime = t;
                    if (timeMastering) timeMastering.textContent = formatTime(t);
                    drawMasteringWaveform();
                }
            });
            if (audioMastering) audioMastering.addEventListener('seeked', drawMasteringWaveform);
            if (audioMasteringBefore) audioMasteringBefore.addEventListener('seeked', drawMasteringWaveform);
            const masteringControlsCollapsible = document.getElementById('mastering-controls-collapsible');
            const masteringControlsToggle = document.getElementById('mastering-controls-toggle');
            if (masteringControlsCollapsible && masteringControlsToggle) {
                masteringControlsToggle.addEventListener('click', function () {
                    const collapsed = masteringControlsCollapsible.classList.toggle('collapsed');
                    masteringControlsToggle.setAttribute('aria-expanded', !collapsed);
                });
            }
            function getAdjustDelta() {
                const adjEl = document.getElementById('mastering-adjust');
                const pct = adjEl ? Math.max(0, Math.min(100, Number(adjEl.value) || 50)) : 50;
                return (pct - 50) / 50;
            }
            function applyMasteringFromSlidersAndAdjust() {
                const delta = getAdjustDelta();
                const threshRange = 3;
                const ratioRange = 2.5;
                const attackRange = 0.2;
                const releaseRange = 0.5;
                const thresholdEffective = masteringBaseValues.threshold - delta * threshRange;
                const ratioEffective = Math.max(1, Math.min(20, masteringBaseValues.ratio + delta * ratioRange));
                const attackEffective = Math.max(0.001, Math.min(0.5, masteringBaseValues.attack + delta * attackRange));
                const releaseEffective = Math.max(0.01, Math.min(2, masteringBaseValues.release - delta * releaseRange));
                if (masterCompressor) {
                    masterCompressor.threshold.value = thresholdEffective;
                    masterCompressor.ratio.value = ratioEffective;
                    masterCompressor.attack.value = attackEffective;
                    masterCompressor.release.value = releaseEffective;
                }
                if (masterGain) masterGain.gain.value = Math.max(0.01, masteringBaseValues.output);
                const thresholdValEl = document.getElementById('mastering-threshold-value');
                const ratioValEl = document.getElementById('mastering-ratio-value');
                const attackValEl = document.getElementById('mastering-attack-value');
                const releaseValEl = document.getElementById('mastering-release-value');
                const outputValEl = document.getElementById('mastering-output-value');
                if (thresholdValEl) thresholdValEl.textContent = typeof thresholdEffective === 'number' && thresholdEffective % 1 !== 0 ? thresholdEffective.toFixed(2) : String(thresholdEffective);
                if (ratioValEl) ratioValEl.textContent = typeof ratioEffective === 'number' && ratioEffective % 1 !== 0 ? ratioEffective.toFixed(2) : String(ratioEffective);
                if (attackValEl) attackValEl.textContent = typeof attackEffective === 'number' ? attackEffective.toFixed(3) : String(attackEffective);
                if (releaseValEl) releaseValEl.textContent = typeof releaseEffective === 'number' && releaseEffective % 1 !== 0 ? releaseEffective.toFixed(2) : String(releaseEffective);
                if (outputValEl) outputValEl.textContent = typeof masteringBaseValues.output === 'number' && masteringBaseValues.output % 1 !== 0 ? masteringBaseValues.output.toFixed(2) : String(masteringBaseValues.output);
            }
            function updateMasteringParam(sliderId, valueId, mapFn, baseKey) {
                const slider = document.getElementById(sliderId);
                if (!slider) return;
                function update() {
                    const val = mapFn(Number(slider.value));
                    if (baseKey) masteringBaseValues[baseKey] = val;
                    applyMasteringFromSlidersAndAdjust();
                }
                slider.addEventListener('input', update);
                update();
            }
            updateMasteringParam('mastering-threshold', 'mastering-threshold-value', function (v) { return -30 + (v / 100) * 30; }, 'threshold');
            updateMasteringParam('mastering-ratio', 'mastering-ratio-value', function (v) { return 1 + (v / 100) * 19; }, 'ratio');
            updateMasteringParam('mastering-attack', 'mastering-attack-value', function (v) { return 0.001 + (v / 100) * 0.499; }, 'attack');
            updateMasteringParam('mastering-release', 'mastering-release-value', function (v) { return 0.01 + (v / 100) * 1.99; }, 'release');
            updateMasteringParam('mastering-output', 'mastering-output-value', function (v) { return 0.5 + (v / 100) * 1.5; }, 'output');
            const adjustInput = document.getElementById('mastering-adjust');
            const knobAdjustEl = document.getElementById('knob-adjust');
            function setAdjustKnobUI(value) {
                const v = Math.max(0, Math.min(100, Number(value) || 50));
                if (adjustInput) adjustInput.value = v;
                if (knobAdjustEl) {
                    const needle = knobAdjustEl.querySelector('.rotary-knob-needle');
                    if (needle) needle.style.transform = 'rotate(' + ((v / 100) * 270 - 135) + 'deg)';
                    knobAdjustEl.setAttribute('aria-valuenow', v);
                }
                const label = document.getElementById('adjust-knob-label');
                if (label) label.textContent = v === 50 ? '12:00' : (v < 50 ? '-' + (50 - v) + '%' : '+' + (v - 50) + '%');
            }
            if (adjustInput) {
                adjustInput.addEventListener('input', function () {
                    setAdjustKnobUI(this.value);
                    applyMasteringFromSlidersAndAdjust();
                });
            }
            function initRotaryKnob(knobEl, initialValue, minVal, maxVal, onChange) {
                var value = Math.max(minVal, Math.min(maxVal, initialValue));
                var startY = 0;
                var startVal = 0;
                knobEl.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    startY = e.clientY;
                    startVal = value;
                    function onMove(e2) {
                        value = Math.max(minVal, Math.min(maxVal, startVal - (e2.clientY - startY) * 0.5));
                        onChange(value);
                    }
                    function onUp() {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    }
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
                knobEl.addEventListener('keydown', function (e) {
                    var step = e.shiftKey ? 10 : 5;
                    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        value = Math.min(maxVal, value + step);
                        onChange(value);
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        value = Math.max(minVal, value - step);
                        onChange(value);
                    }
                });
            }
            if (knobAdjustEl && adjustInput) {
                initRotaryKnob(knobAdjustEl, 50, 0, 100, function (v) {
                    setAdjustKnobUI(v);
                    adjustInput.dispatchEvent(new Event('input', { bubbles: true }));
                });
                setAdjustKnobUI(adjustInput.value);
            }
            window.MegaMix.applyMasteringOptionsToControls = function (opts) {
                if (!opts || !masteringGraphInited) return;
                var punch = Math.max(0, Math.min(2, Number(opts.punch) || 0));
                var loudness = Math.max(0, Math.min(2, Number(opts.loudness) || 0));
                var compression = Math.max(0, Math.min(2, Number(opts.compression) !== undefined ? opts.compression : 1));
                var thr = compression === 0 ? -12 : compression === 2 ? -24 : -18;
                var ratio = compression === 0 ? 1.5 : compression === 2 ? 4 : 2.5;
                var attack = punch === 0 ? 0.01 : punch === 1 ? 0.005 : 0.003;
                var release = punch === 0 ? 0.2 : punch === 1 ? 0.15 : 0.1;
                var output = loudness === 0 ? 0.85 : loudness === 2 ? 1.2 : 1;
                masteringBaseValues.threshold = thr;
                masteringBaseValues.ratio = ratio;
                masteringBaseValues.attack = attack;
                masteringBaseValues.release = release;
                masteringBaseValues.output = output;
                var thrSlider = document.getElementById('mastering-threshold');
                var ratioSlider = document.getElementById('mastering-ratio');
                var attackSlider = document.getElementById('mastering-attack');
                var releaseSlider = document.getElementById('mastering-release');
                var outputSlider = document.getElementById('mastering-output');
                if (thrSlider) thrSlider.value = Math.round((thr + 30) / 30 * 100);
                if (ratioSlider) ratioSlider.value = Math.round((ratio - 1) / 19 * 100);
                if (attackSlider) attackSlider.value = Math.round((attack - 0.001) / 0.499 * 100);
                if (releaseSlider) releaseSlider.value = Math.round((release - 0.01) / 1.99 * 100);
                if (outputSlider) outputSlider.value = Math.round((output - 0.5) / 1.5 * 100);
                setAdjustKnobUI(50);
                applyMasteringFromSlidersAndAdjust();
            };
            const mixKnob = document.getElementById('mastering-mix');
            const mixValueEl = document.getElementById('mastering-mix-value');
            const knobMixEl = document.getElementById('knob-mix');
            if (mixKnob && masterDryGain !== undefined && masterWetGain !== undefined) {
                function applyMixKnob() {
                    const pct = Math.max(0, Math.min(100, Number(mixKnob.value) || 100));
                    if (masterDryGain) masterDryGain.gain.value = 1 - pct / 100;
                    if (masterWetGain) masterWetGain.gain.value = pct / 100;
                    if (mixValueEl) mixValueEl.textContent = pct + '%';
                }
                mixKnob.addEventListener('input', applyMixKnob);
                if (mixValueEl) mixValueEl.textContent = (Number(mixKnob.value) || 100) + '%';
                if (knobMixEl) {
                    function setMixKnobUI(value) {
                        var v = Math.max(0, Math.min(100, Number(value) || 100));
                        mixKnob.value = v;
                        var needle = knobMixEl.querySelector('.rotary-knob-needle');
                        if (needle) needle.style.transform = 'rotate(' + ((v / 100) * 270 - 135) + 'deg)';
                        knobMixEl.setAttribute('aria-valuenow', v);
                        applyMixKnob();
                    }
                    initRotaryKnob(knobMixEl, 100, 0, 100, setMixKnobUI);
                    setMixKnobUI(mixKnob.value);
                }
            }
            function addMasteringChatMessage(who, text) {
                if (!chatMessagesMastering) return;
                if (who === 'user') {
                    const div = document.createElement('div');
                    div.className = 'msg user';
                    div.textContent = 'You: ' + text;
                    chatMessagesMastering.appendChild(div);
                    chatMessagesMastering.scrollTop = chatMessagesMastering.scrollHeight;
                } else {
                    appendBotMessageAnimated(chatMessagesMastering, 'Josh: ', text);
                }
            }
            function interpretMasteringMessage(text) {
                const t = text.toLowerCase();
                const delta = {};
                if (/\b(more|add|increase|boost)\s*(punch|punchy|transient)\b|\bpunch(ier)?\b/.test(t)) { delta.punch = 1; }
                else if (/\b(less|reduce|decrease)\s*punch\b|\b(softer|smoother)\s*transient\b/.test(t)) { delta.punch = -1; }
                else if (/\b(louder|more\s*loudness|boost\s*level|increase\s*volume)\b/.test(t)) { delta.loudness = 1; }
                else if (/\b(quieter|less\s*loud|lower\s*level|reduce\s*volume)\b/.test(t)) { delta.loudness = -1; }
                else if (/\b(more|increase|heavier)\s*compression\b|\b(compress|squash)\s*more\b/.test(t)) { delta.compression = 1; }
                else if (/\b(less|reduce|lighter)\s*compression\b|\bless\s*squash\b/.test(t)) { delta.compression = -1; }
                else if (/\bbright(er)?\b|\bmore\s*treble\b/.test(t)) { delta.punch = 1; }
                else if (/\bwarm(er)?\b|\bmore\s*bass\b/.test(t)) { delta.compression = -0.5; }
                return delta;
            }
            function applyMasteringDelta(delta) {
                state.masteringOptions = state.masteringOptions || { punch: 0, loudness: 1, compression: 1 };
                if (delta.punch !== undefined) state.masteringOptions.punch = Math.max(0, Math.min(2, (state.masteringOptions.punch || 0) + delta.punch));
                if (delta.loudness !== undefined) state.masteringOptions.loudness = Math.max(0, Math.min(2, (state.masteringOptions.loudness || 0) + delta.loudness));
                if (delta.compression !== undefined) state.masteringOptions.compression = Math.max(0, Math.min(2, (state.masteringOptions.compression !== undefined ? state.masteringOptions.compression : 1) + delta.compression));
            }
            function masteringReplyForDelta(delta) {
                if (delta.punch === 1) return "Done. More punch in the master—have a listen.";
                if (delta.punch === -1) return "Done. Softened the punch a bit.";
                if (delta.loudness === 1) return "Done. Louder. Crank it.";
                if (delta.loudness === -1) return "Done. Brought the level down a touch.";
                if (delta.compression === 1) return "Done. More compression on there.";
                if (delta.compression === -1 || delta.compression === -0.5) return "Done. Lightened the compression.";
                return "Done. Applied. Have a listen.";
            }
            function describeMasteringDelta(delta) {
                var parts = [];
                if (delta.punch === 1) parts.push('added more punch');
                if (delta.punch === -1) parts.push('softened punch');
                if (delta.loudness === 1) parts.push('made it louder');
                if (delta.loudness === -1) parts.push('reduced level');
                if (delta.compression === 1) parts.push('added compression');
                if (delta.compression === -1 || delta.compression === -0.5) parts.push('lightened compression');
                return parts.length ? parts.join('; ') : 'adjusted mastering';
            }
            if (chatSendMastering && chatInputMastering) {
                chatSendMastering.addEventListener('click', async function () {
                    const text = (chatInputMastering.value || '').trim();
                    if (!text) return;
                    addMasteringChatMessage('user', text);
                    chatInputMastering.value = '';
                    const delta = interpretMasteringMessage(text);
                    const understood = Object.keys(delta).length > 0;
                    if (!understood) {
                        try {
                            var res = await fetch((window.location.origin || '') + '/api/josh/reply', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ context: 'mastering', userMessage: text, changesSummary: '' })
                            });
                            var data = await res.json().catch(function () { return {}; });
                            if (res.ok && data.reply) {
                                addMasteringChatMessage('bot', data.reply);
                                return;
                            }
                        } catch (e) { console.warn('Josh reply', e); }
                        addMasteringChatMessage('bot', "I can adjust things like punch, loudness, and tone. Try \"more punch\" or \"make it louder\".");
                        return;
                    }
                    if (!state.mixReady || state.stemBuffers.length === 0) {
                        addMasteringChatMessage('bot', 'Upload stems and run Mix it first, then AI Mastering, before refining here.');
                        return;
                    }
                    applyMasteringDelta(delta);
                    if (typeof window.MegaMix.applyMasteringOptionsToControls === 'function') {
                        window.MegaMix.applyMasteringOptionsToControls(state.masteringOptions);
                    }
                    try {
                        var res = await fetch((window.location.origin || '') + '/api/josh/reply', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                context: 'mastering',
                                userMessage: text,
                                changesSummary: describeMasteringDelta(delta)
                            })
                        });
                        var data = await res.json().catch(function () { return {}; });
                        if (res.ok && data.reply) {
                            addMasteringChatMessage('bot', data.reply);
                            return;
                        }
                    } catch (e) { console.warn('Josh reply', e); }
                    addMasteringChatMessage('bot', masteringReplyForDelta(delta));
                });
                chatInputMastering.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') chatSendMastering.click();
                });
                if (chatMessagesMastering && chatMessagesMastering.children.length === 0) {
                    addMasteringChatMessage('bot', "Hi! I'm Josh. Here you can refine your master—tell me things like 'make it louder', 'more punch', or 'warmer' and I'll adjust the settings. Have a listen and refine until it's right.");
                }
            }
            document.querySelectorAll('.quick-prompt-mastering').forEach(btn => {
                btn.addEventListener('click', function () {
                    const prompt = btn.getAttribute('data-prompt');
                    if (prompt && chatInputMastering) {
                        chatInputMastering.value = prompt;
                        if (chatSendMastering) chatSendMastering.click();
                    }
                });
            });
            if (btnDownloadMasteredFinal) {
                btnDownloadMasteredFinal.addEventListener('click', async function () {
                    if (isPreviewMode()) {
                        pendingDownload = { type: 'mastered' };
                        openLoginOrTrialModal();
                        return;
                    }
                    if (!state.mixReady || state.stemBuffers.length === 0) return;
                    var btn = btnDownloadMasteredFinal;
                    var origText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = 'Preparing…';
                    try {
                        var afterMix = await window.MegaMix.buildAfterMixWithFX();
                        if (!afterMix) { btn.textContent = origText; btn.disabled = false; return; }
                        state.masteringOptions = state.masteringOptions || { punch: 0, loudness: 1, compression: 1 };
                        var mastered = await window.MegaMix.runMasteringChain(afterMix, state.masteringOptions);
                        if (!mastered) { btn.textContent = origText; btn.disabled = false; return; }
                        if (state.masteredUrl) URL.revokeObjectURL(state.masteredUrl);
                        if (state.slowedReverbUrl) { URL.revokeObjectURL(state.slowedReverbUrl); state.slowedReverbUrl = null; }
                        state.masteredUrl = URL.createObjectURL(window.MegaMix.encodeWav(mastered.left, mastered.right, mastered.sampleRate));
                        if (audioMastering) audioMastering.src = state.masteredUrl;
                        if (typeof fillWaveformFromUrl === 'function') fillWaveformFromUrl(state.masteredUrl);
                    } finally {
                        btn.textContent = origText;
                        btn.disabled = false;
                    }
                    if (document.body && document.body.classList.contains('logged-in')) {
                        performMasteredDownload();
                    } else {
                        openEmailModal('mastered');
                    }
                });
            }
        }
        var slowedReverbMarchBadge = document.getElementById('slowed-reverb-march-badge');
        if (slowedReverbMarchBadge && new Date() >= new Date('2026-04-01')) {
            slowedReverbMarchBadge.style.display = 'none';
        }
        var btnGenerateSlowedReverb = document.getElementById('btn-generate-slowed-reverb');
        var audioSlowedBefore = document.getElementById('audio-slowed-before');
        var audioSlowedAfter = document.getElementById('audio-slowed-after');
        var playSlowedReverb = document.getElementById('play-slowed-reverb');
        var progressSlowedReverb = document.getElementById('progress-slowed-reverb');
        var timeSlowedReverb = document.getElementById('time-slowed-reverb');
        var durationSlowedReverb = document.getElementById('duration-slowed-reverb');
        var btnDownloadSlowedReverb = document.getElementById('btn-download-slowed-reverb');
        var canvasWaveformSlowed = document.getElementById('waveform-slowed-reverb');
        var waveformBinsSlowedBefore = null;
        var waveformBinsSlowedAfter = null;
        function fillSlowedWaveformFromUrl(url, whichTab) {
            if (!canvasWaveformSlowed || !window.MegaMix || !window.MegaMix.getAudioContext) return;
            var ctx = window.MegaMix.getAudioContext();
            fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return ctx.decodeAudioData(ab); }).then(function (buffer) {
                var ch0 = buffer.getChannelData(0);
                var ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
                var len = buffer.length;
                var numBins = Math.min(800, Math.max(200, Math.floor(len / 1024)));
                var binSize = Math.floor(len / numBins);
                var bins = new Float32Array(numBins);
                for (var i = 0; i < numBins; i++) {
                    var peak = 0;
                    var start = i * binSize;
                    var end = Math.min(start + binSize, len);
                    for (var j = start; j < end; j++) {
                        var s = (Math.abs(ch0[j]) + Math.abs(ch1[j])) / 2;
                        if (s > peak) peak = s;
                    }
                    bins[i] = peak;
                }
                var max = 0;
                for (var i = 0; i < numBins; i++) if (bins[i] > max) max = bins[i];
                if (max > 0) for (var i = 0; i < numBins; i++) bins[i] /= max;
                if (whichTab === 'before') waveformBinsSlowedBefore = bins; else waveformBinsSlowedAfter = bins;
                drawSlowedWaveform();
            }).catch(function () {});
        }
        function getActiveSlowedMode() {
            var active = document.querySelector('.slowed-reverb-tab.active');
            return active ? active.getAttribute('data-mode') : 'after';
        }
        function setSlowedMutedFromTab() {
            var mode = getActiveSlowedMode();
            if (audioSlowedBefore) audioSlowedBefore.muted = (mode !== 'before');
            if (audioSlowedAfter) audioSlowedAfter.muted = (mode !== 'after');
        }
        function slowedDuration() {
            var mode = getActiveSlowedMode();
            var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
            return (el && el.duration && isFinite(el.duration)) ? el.duration : 0;
        }
        function drawSlowedWaveform() {
            var mode = getActiveSlowedMode();
            var bins = mode === 'before' ? waveformBinsSlowedBefore : waveformBinsSlowedAfter;
            if (!canvasWaveformSlowed || !bins || bins.length === 0) return;
            var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
            var d = (el && el.duration && isFinite(el.duration)) ? el.duration : 0;
            var t = (el && el.currentTime != null) ? el.currentTime : 0;
            var w = canvasWaveformSlowed.width;
            var h = canvasWaveformSlowed.height;
            var ctx = canvasWaveformSlowed.getContext('2d');
            if (!ctx) return;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(0, 0, w, h);
            var n = bins.length;
            var barW = Math.max(1, w / n);
            var midY = h / 2;
            ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
            for (var i = 0; i < n; i++) {
                var v = bins[i];
                var barH = Math.max(1, (v * midY));
                ctx.fillRect(i * barW, midY - barH / 2, barW, barH);
            }
            var playheadX = d && isFinite(d) && d > 0 ? (t / d) * w : 0;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fillRect(playheadX - 1, 0, 2, h);
        }
        function updateSlowedProgress() {
            var mode = getActiveSlowedMode();
            var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
            var d = slowedDuration();
            var t = (el && el.currentTime != null) ? el.currentTime : 0;
            if (d > 0) {
                if (progressSlowedReverb) progressSlowedReverb.value = (t / d) * 100;
                if (durationSlowedReverb) durationSlowedReverb.textContent = formatTime(d);
            }
            if (timeSlowedReverb) timeSlowedReverb.textContent = formatTime(t);
            drawSlowedWaveform();
        }
        if (btnGenerateSlowedReverb) {
            btnGenerateSlowedReverb.addEventListener('click', function () {
                if (!state.masteredUrl) {
                    showToast('Master your track first, then generate the slowed + reverb version.', null);
                    return;
                }
                var btn = btnGenerateSlowedReverb;
                var origText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Generating…';
                var masteredUrl = state.masteredUrl;
                setTimeout(function () {
                    window.MegaMix.buildSlowedReverbFromMasterUrl(masteredUrl).then(function () {
                        btn.textContent = origText;
                        btn.disabled = false;
                        if (audioSlowedAfter) audioSlowedAfter.src = state.slowedReverbUrl;
                        if (btnDownloadSlowedReverb) { btnDownloadSlowedReverb.disabled = false; }
                        fillSlowedWaveformFromUrl(state.slowedReverbUrl, 'after');
                        if (audioSlowedAfter && durationSlowedReverb && audioSlowedAfter.duration && isFinite(audioSlowedAfter.duration)) {
                            durationSlowedReverb.textContent = formatTime(audioSlowedAfter.duration);
                        }
                    }).catch(function (e) {
                        console.error('Slowed + reverb', e);
                        btn.textContent = origText;
                        btn.disabled = false;
                        showToast('Failed to generate slowed + reverb. Try again.', null);
                    });
                }, 0);
            });
        }
        if (state.masteredUrl && audioSlowedBefore) {
            audioSlowedBefore.src = state.masteredUrl;
            fillSlowedWaveformFromUrl(state.masteredUrl, 'before');
        }
        if (state.slowedReverbUrl && audioSlowedAfter) {
            audioSlowedAfter.src = state.slowedReverbUrl;
            if (btnDownloadSlowedReverb) btnDownloadSlowedReverb.disabled = false;
            fillSlowedWaveformFromUrl(state.slowedReverbUrl, 'after');
        }
        var slowedTabs = document.querySelectorAll('.slowed-reverb-tab');
        slowedTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                slowedTabs.forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
                this.classList.add('active');
                this.setAttribute('aria-selected', 'true');
                var playing = (audioSlowedBefore && !audioSlowedBefore.paused) || (audioSlowedAfter && !audioSlowedAfter.paused);
                if (playing) {
                    var pos = progressSlowedReverb && slowedDuration() > 0 ? (progressSlowedReverb.value / 100) * slowedDuration() : 0;
                    if (audioSlowedBefore) audioSlowedBefore.pause();
                    if (audioSlowedAfter) audioSlowedAfter.pause();
                    setSlowedMutedFromTab();
                    var mode = getActiveSlowedMode();
                    var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
                    if (el && el.duration) {
                        el.currentTime = Math.min(pos, el.duration - 0.01);
                        el.play();
                    }
                    if (playSlowedReverb) { playSlowedReverb.classList.add('playing'); playSlowedReverb.textContent = '\u23F8'; }
                } else setSlowedMutedFromTab();
            });
        });
        if (playSlowedReverb) {
            playSlowedReverb.addEventListener('click', function () {
                var playing = (audioSlowedBefore && !audioSlowedBefore.paused) || (audioSlowedAfter && !audioSlowedAfter.paused);
                if (playing) {
                    if (audioSlowedBefore) audioSlowedBefore.pause();
                    if (audioSlowedAfter) audioSlowedAfter.pause();
                    playSlowedReverb.classList.remove('playing');
                    playSlowedReverb.textContent = '\u25B6';
                } else {
                    stopBothMastering();
                    var d = slowedDuration();
                    if (d <= 0) return;
                    var pos = progressSlowedReverb && progressSlowedReverb.value != null ? (progressSlowedReverb.value / 100) * d : 0;
                    setSlowedMutedFromTab();
                    var mode = getActiveSlowedMode();
                    var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
                    if (el) {
                        el.currentTime = Math.min(pos, (el.duration || d) - 0.01);
                        el.play();
                    }
                    playSlowedReverb.classList.add('playing');
                    playSlowedReverb.textContent = '\u23F8';
                }
            });
        }
        if (audioSlowedAfter) {
            audioSlowedAfter.addEventListener('timeupdate', function () { if (getActiveSlowedMode() === 'after') updateSlowedProgress(); });
            audioSlowedAfter.addEventListener('ended', function () { if (playSlowedReverb) { playSlowedReverb.classList.remove('playing'); playSlowedReverb.textContent = '\u25B6'; } });
        }
        if (audioSlowedBefore) {
            audioSlowedBefore.addEventListener('timeupdate', function () { if (getActiveSlowedMode() === 'before') updateSlowedProgress(); });
            audioSlowedBefore.addEventListener('ended', function () { if (playSlowedReverb) { playSlowedReverb.classList.remove('playing'); playSlowedReverb.textContent = '\u25B6'; } });
        }
        if (progressSlowedReverb) {
            progressSlowedReverb.addEventListener('input', function () {
                var d = slowedDuration();
                if (d && isFinite(d) && d > 0) {
                    var t = (progressSlowedReverb.value / 100) * d;
                    var mode = getActiveSlowedMode();
                    var el = (mode === 'before' && audioSlowedBefore) ? audioSlowedBefore : audioSlowedAfter;
                    if (el) el.currentTime = t;
                    if (timeSlowedReverb) timeSlowedReverb.textContent = formatTime(t);
                    drawSlowedWaveform();
                }
            });
        }
        if (btnDownloadSlowedReverb) {
            btnDownloadSlowedReverb.addEventListener('click', function () {
                if (isPreviewMode()) {
                    pendingDownload = { type: 'slowed-reverb' };
                    openLoginOrTrialModal();
                    return;
                }
                if (!state.slowedReverbUrl) return;
                performSlowedReverbDownload();
            });
        }
        var chatMessagesSlowedReverb = document.getElementById('chat-messages-slowed-reverb');
        var chatInputSlowedReverb = document.getElementById('chat-input-slowed-reverb');
        var chatSendSlowedReverb = document.getElementById('chat-send-slowed-reverb');
        function addSlowedReverbChatMessage(role, text) {
            if (!chatMessagesSlowedReverb) return;
            var div = document.createElement('div');
            div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
            div.textContent = (role === 'bot' ? 'Josh: ' : '') + text;
            chatMessagesSlowedReverb.appendChild(div);
            chatMessagesSlowedReverb.scrollTop = chatMessagesSlowedReverb.scrollHeight;
        }
        function applySlowedReverbTweak(promptText) {
            if (!state.masteredUrl) {
                showToast('Master your track first, then generate the slowed + reverb version.', null);
                return;
            }
            if (!state.slowedReverbUrl) {
                showToast('Generate Slowed + Reverb first, then you can tweak it with Josh.', null);
                return;
            }
            var rate = state.slowedPlaybackRate != null ? state.slowedPlaybackRate : 0.8;
            var mix = state.slowedReverbMix != null ? state.slowedReverbMix : 0.4;
            var decay = state.slowedReverbDecaySeconds != null ? state.slowedReverbDecaySeconds : 0.45;
            var shimmer = state.slowedShimmerDb != null ? state.slowedShimmerDb : 0;
            var lower = (promptText || '').toLowerCase().trim();
            if (/\bspeed\s*up|faster\b/.test(lower)) {
                rate = Math.min(0.95, rate + 0.05);
            } else if (/\bslow\s*down|slower\b/.test(lower)) {
                rate = Math.max(0.65, rate - 0.05);
            } else if (/\bmore\s*(reverb|verb)|add\s*more\s*verb|more\s*reverb\b/.test(lower)) {
                mix = Math.min(0.85, mix + 0.15);
            } else if (/\bless\s*(reverb|verb)|reduce\s*verb|reduce\s*reverb\b/.test(lower)) {
                mix = Math.max(0.1, mix - 0.15);
            } else if (/\bshimmer\b/.test(lower)) {
                shimmer = 4;
            } else {
                addSlowedReverbChatMessage('bot', 'Try "Speed up slightly", "Slow down slightly", "Add more Verb", "Reduce Verb", or "Add shimmer".');
                return;
            }
            var opts = { playbackRate: rate, reverbMix: mix, reverbDecaySeconds: decay, shimmerDb: shimmer };
            var botReply = rate !== (state.slowedPlaybackRate || 0.8) ? (rate > (state.slowedPlaybackRate || 0.8) ? 'Sped up slightly.' : 'Slowed down slightly.') :
                mix !== (state.slowedReverbMix != null ? state.slowedReverbMix : 0.4) ? (mix > (state.slowedReverbMix != null ? state.slowedReverbMix : 0.4) ? 'Added more reverb.' : 'Reduced reverb.') :
                shimmer > 0 ? 'Shimmer added—high end lifted.' : 'Done.';
            var wasPlayingAfter = getActiveSlowedMode() === 'after' && audioSlowedAfter && !audioSlowedAfter.paused;
            var seekTo = (audioSlowedAfter && isFinite(audioSlowedAfter.currentTime)) ? audioSlowedAfter.currentTime : 0;
            addSlowedReverbChatMessage('bot', 'Applying…');
            var masteredUrlForTweak = state.masteredUrl;
            setTimeout(function () {
            window.MegaMix.buildSlowedReverbFromMasterUrl(masteredUrlForTweak, opts).then(function () {
                if (chatMessagesSlowedReverb && chatMessagesSlowedReverb.lastChild && chatMessagesSlowedReverb.lastChild.textContent === 'Josh: Applying…') {
                    chatMessagesSlowedReverb.lastChild.textContent = 'Josh: ' + botReply;
                }
                if (audioSlowedAfter) {
                    audioSlowedAfter.src = state.slowedReverbUrl;
                    if (wasPlayingAfter || seekTo > 0) {
                        var onReady = function () {
                            audioSlowedAfter.removeEventListener('loadedmetadata', onReady);
                            audioSlowedAfter.removeEventListener('canplay', onReady);
                            var d = (audioSlowedAfter.duration && isFinite(audioSlowedAfter.duration)) ? audioSlowedAfter.duration : 0;
                            var t = d > 0 ? Math.min(seekTo, d - 0.01) : 0;
                            audioSlowedAfter.currentTime = t;
                            if (wasPlayingAfter) {
                                audioSlowedAfter.play();
                                if (playSlowedReverb) { playSlowedReverb.classList.add('playing'); playSlowedReverb.textContent = '\u23F8'; }
                            }
                            updateSlowedProgress();
                        };
                        audioSlowedAfter.addEventListener('loadedmetadata', onReady);
                        audioSlowedAfter.addEventListener('canplay', onReady);
                        if (audioSlowedAfter.readyState >= 2) onReady();
                    }
                }
                fillSlowedWaveformFromUrl(state.slowedReverbUrl, 'after');
                if (durationSlowedReverb && audioSlowedAfter && audioSlowedAfter.duration && isFinite(audioSlowedAfter.duration)) {
                    durationSlowedReverb.textContent = formatTime(audioSlowedAfter.duration);
                }
            }).catch(function (e) {
                console.error('Slowed reverb tweak', e);
                if (chatMessagesSlowedReverb && chatMessagesSlowedReverb.lastChild && chatMessagesSlowedReverb.lastChild.textContent === 'Josh: Applying…') {
                    chatMessagesSlowedReverb.lastChild.textContent = 'Josh: Something went wrong. Try again.';
                }
            });
            }, 0);
        }
        var quickPromptsSlowedReverb = document.querySelectorAll('#quick-prompts-slowed-reverb .quick-prompt-slowed-reverb');
        quickPromptsSlowedReverb.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var prompt = btn.getAttribute('data-prompt');
                if (prompt) {
                    addSlowedReverbChatMessage('user', prompt);
                    applySlowedReverbTweak(prompt);
                }
            });
        });
        if (chatSendSlowedReverb && chatInputSlowedReverb) {
            function sendSlowedReverbChat() {
                var text = (chatInputSlowedReverb.value || '').trim();
                if (!text) return;
                chatInputSlowedReverb.value = '';
                addSlowedReverbChatMessage('user', text);
                applySlowedReverbTweak(text);
            }
            chatSendSlowedReverb.addEventListener('click', sendSlowedReverbChat);
            chatInputSlowedReverb.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); sendSlowedReverbChat(); }
            });
        }
        updateMasteringProgress();
    }

    const btnSignin = document.getElementById('btn-signin');
    if (btnSignin) btnSignin.addEventListener('click', () => { /* Sign in opens login modal via auth overlay */ });

    const emailModalAppClose = document.getElementById('emailModalAppClose');
    const emailModalAppYes = document.getElementById('emailModalAppYes');
    const emailModalAppNo = document.getElementById('emailModalAppNo');
    if (emailModalAppClose) emailModalAppClose.addEventListener('click', function () { closeEmailModal(); pendingDownload = null; });
    if (emailModalAppYes) emailModalAppYes.addEventListener('click', function () { handleEmailSignup(true); });
    if (emailModalAppNo) emailModalAppNo.addEventListener('click', function () { handleEmailSignup(false); });
    if (emailModalApp) {
        emailModalApp.addEventListener('click', function (e) {
            var content = emailModalApp.querySelector('.email-modal-app-content');
            if (content && !content.contains(e.target)) {
                closeEmailModal();
                pendingDownload = null;
            }
        });
    }

    var loginOrTrialModalAppClose = document.getElementById('loginOrTrialModalAppClose');
    var loginOrTrialModalAppLogin = document.getElementById('loginOrTrialModalAppLogin');
    var loginOrTrialModalAppTrial = document.getElementById('loginOrTrialModalAppTrial');
    if (loginOrTrialModalAppClose) loginOrTrialModalAppClose.addEventListener('click', closeLoginOrTrialModal);
    if (loginOrTrialModalAppLogin) {
        loginOrTrialModalAppLogin.addEventListener('click', function () {
            if (loginOrTrialModalApp) {
                loginOrTrialModalApp.classList.add('hidden');
                document.body.style.overflow = '';
            }
            if (window.MegaMixAuth && window.MegaMixAuth.showLoginRequired) window.MegaMixAuth.showLoginRequired();
        });
    }
    if (loginOrTrialModalAppTrial) {
        loginOrTrialModalAppTrial.addEventListener('click', function () {
            closeLoginOrTrialModal();
            if (window.MegaMixAuth && window.MegaMixAuth.doFreeTrial) window.MegaMixAuth.doFreeTrial();
        });
    }
    if (loginOrTrialModalApp) {
        loginOrTrialModalApp.addEventListener('click', function (e) {
            var content = loginOrTrialModalApp.querySelector('.login-or-trial-content');
            if (content && !content.contains(e.target)) {
                closeLoginOrTrialModal();
            }
        });
    }

    var preCheckoutModalApp = document.getElementById('preCheckoutEmailModalApp');
    var preCheckoutCloseApp = document.getElementById('preCheckoutEmailModalAppClose');
    var preCheckoutInputApp = document.getElementById('preCheckoutEmailInputApp');
    var preCheckoutSubmitApp = document.getElementById('preCheckoutEmailModalAppSubmit');
    var preCheckoutSkipApp = document.getElementById('preCheckoutEmailModalAppSkip');
    var preCheckoutCallback = null;
    function closePreCheckoutModalApp() {
        if (preCheckoutModalApp) preCheckoutModalApp.classList.add('hidden');
        document.body.style.overflow = '';
        preCheckoutCallback = null;
    }
    function showPreCheckoutEmailModal(callback) {
        preCheckoutCallback = callback || null;
        if (preCheckoutModalApp) {
            preCheckoutModalApp.classList.remove('hidden');
            if (preCheckoutInputApp) preCheckoutInputApp.value = '';
            document.body.style.overflow = 'hidden';
        }
    }
    function runPreCheckoutCallback() {
        var cb = preCheckoutCallback;
        closePreCheckoutModalApp();
        if (typeof cb === 'function') cb();
    }
    if (preCheckoutSubmitApp) preCheckoutSubmitApp.addEventListener('click', function () {
        var email = preCheckoutInputApp ? preCheckoutInputApp.value.trim() : '';
        if (email && isValidEmail(email)) {
            var base = window.location.origin || '';
            fetch(base + '/mailchimp-signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, signupSource: 'prospective-free-trial-app' })
            }).then(function () {}).catch(function () {});
        }
        runPreCheckoutCallback();
    });
    if (preCheckoutSkipApp) preCheckoutSkipApp.addEventListener('click', runPreCheckoutCallback);
    if (preCheckoutCloseApp) preCheckoutCloseApp.addEventListener('click', runPreCheckoutCallback);
    if (preCheckoutModalApp) preCheckoutModalApp.addEventListener('click', function (e) {
        if (e.target === preCheckoutModalApp) runPreCheckoutCallback();
    });
    if (window.MegaMixAuth) window.MegaMixAuth.showPreCheckoutEmailModal = showPreCheckoutEmailModal;

    window.addEventListener('megamix:show-precheckout-email', function (e) {
        var proceed = e.detail && e.detail.proceed;
        if (typeof proceed === 'function') showPreCheckoutEmailModal(proceed);
    });

    var manageSubInput = document.getElementById('manage-subscription-input');
    var manageSubVerify = document.getElementById('manage-subscription-verify');
    var manageSubError = document.getElementById('manage-subscription-error');
    var manageSubActions = document.getElementById('manage-subscription-actions');
    var manageSubCancel = document.getElementById('manage-subscription-cancel');
    var manageSubVerifiedLicenseKey = null;
    if (manageSubVerify) {
        manageSubVerify.addEventListener('click', function () {
            var v = manageSubInput ? manageSubInput.value.trim() : '';
            if (!v) {
                if (manageSubError) { manageSubError.textContent = 'Please enter your license key.'; manageSubError.classList.remove('hidden'); }
                return;
            }
            if (manageSubError) manageSubError.classList.add('hidden');
            var base = window.location.origin || '';
            fetch(base + '/api/subscription/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licenseKey: v }) })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.ok && manageSubActions) {
                        manageSubVerifiedLicenseKey = v;
                        manageSubActions.classList.remove('hidden');
                    } else if (manageSubError) {
                        manageSubError.textContent = data.error || 'Verification failed.';
                        manageSubError.classList.remove('hidden');
                    }
                })
                .catch(function () {
                    if (manageSubError) { manageSubError.textContent = 'Something went wrong. Try again.'; manageSubError.classList.remove('hidden'); }
                });
        });
    }
    if (manageSubCancel) {
        manageSubCancel.addEventListener('click', function () {
            if (!manageSubVerifiedLicenseKey) return;
            var base = window.location.origin || '';
            fetch(base + '/api/subscription/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licenseKey: manageSubVerifiedLicenseKey }) })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.url) window.location.href = data.url;
                    else alert(data.error || 'Could not open billing portal.');
                })
                .catch(function () { alert('Something went wrong. Try again.'); });
        });
    }

    var oneFileNotSupportedModal = document.getElementById('one-file-not-supported-modal');
    var oneFileModalContent = document.getElementById('one-file-modal-content');
    var oneFileMasterLoading = document.getElementById('one-file-master-loading');
    var oneFileMasterLoadingText = document.getElementById('one-file-master-loading-text');
    var oneFileSeparateProgressWrap = document.getElementById('one-file-separate-progress-wrap');
    var oneFileSeparateProgressFill = document.getElementById('one-file-separate-progress-fill');
    var oneFileSeparateTimer = document.getElementById('one-file-separate-timer');
    var oneFileMasterLoadingSpinnerWrap = document.getElementById('one-file-master-loading-spinner-wrap');
    var oneFileSeparateProgressIntervalId = null;
    var STEM_SEPARATE_DEFAULT_EST_SEC = 120;
    var STEM_SEPARATE_TARGET_SAMPLE_RATE = 44100;

    /**
     * Preprocess audio for stem separation: optionally resample to 44.1 kHz to reduce upload size
     * and Replicate processing time. Full track is always sent (no trim). On any failure, returns the original file.
     * @param {File} file - User-selected audio file
     * @returns {{ file: File, trimmed: boolean }}
     */
    async function preprocessAudioForStemSeparation(file) {
        var original = file;
        try {
            if (!window.MegaMix || !window.MegaMix.getAudioContext || !window.MegaMix.encodeWav) return { file: original, trimmed: false };
            var ab = await file.arrayBuffer();
            var ctx = window.MegaMix.getAudioContext();
            var buffer = await ctx.decodeAudioData(ab.slice(0));
            var sampleRate = buffer.sampleRate;
            if (sampleRate <= STEM_SEPARATE_TARGET_SAMPLE_RATE) return { file: original, trimmed: false };
            var numSamples = buffer.length;
            var ch0 = buffer.getChannelData(0);
            var ch1 = buffer.numberOfChannels >= 2 ? buffer.getChannelData(1) : ch0;
            var fullBuf = ctx.createBuffer(2, numSamples, sampleRate);
            fullBuf.getChannelData(0).set(ch0);
            fullBuf.getChannelData(1).set(ch1);
            var lengthAt44 = Math.ceil((numSamples / sampleRate) * STEM_SEPARATE_TARGET_SAMPLE_RATE);
            var offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, lengthAt44, STEM_SEPARATE_TARGET_SAMPLE_RATE);
            var source = offlineCtx.createBufferSource();
            source.buffer = fullBuf;
            source.connect(offlineCtx.destination);
            source.start(0);
            var rendered = await offlineCtx.startRendering();
            var left = rendered.getChannelData(0);
            var right = rendered.getChannelData(1);
            var blob = window.MegaMix.encodeWav(left, right, STEM_SEPARATE_TARGET_SAMPLE_RATE);
            var outFile = new File([blob], 'prepared_for_sep.wav', { type: 'audio/wav' });
            return { file: outFile, trimmed: false };
        } catch (e) {
            console.warn('Stem separation preprocess failed, using original file', e);
            return { file: original, trimmed: false };
        }
    }

    function stopStemSeparateProgress() {
        if (oneFileSeparateProgressIntervalId) {
            clearInterval(oneFileSeparateProgressIntervalId);
            oneFileSeparateProgressIntervalId = null;
        }
        if (oneFileSeparateProgressWrap) oneFileSeparateProgressWrap.classList.add('hidden');
        if (oneFileMasterLoadingSpinnerWrap) oneFileMasterLoadingSpinnerWrap.classList.remove('hidden');
    }

    function closeOneFileNotSupportedModal() {
        pendingSingleFile = null;
        stopStemSeparateProgress();
        if (oneFileModalContent) oneFileModalContent.classList.remove('hidden');
        if (oneFileMasterLoading) oneFileMasterLoading.classList.add('hidden');
        if (oneFileNotSupportedModal) {
            oneFileNotSupportedModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    function showOneFileModalLoading(show, statusText, options) {
        options = options || {};
        if (oneFileModalContent) oneFileModalContent.classList.toggle('hidden', !!show);
        if (oneFileMasterLoading) oneFileMasterLoading.classList.toggle('hidden', !show);
        if (oneFileMasterLoadingText && statusText !== undefined) oneFileMasterLoadingText.textContent = statusText;
        if (show && options.stemSeparation) {
            if (oneFileSeparateProgressWrap) oneFileSeparateProgressWrap.classList.remove('hidden');
            if (oneFileMasterLoadingSpinnerWrap) oneFileMasterLoadingSpinnerWrap.classList.add('hidden');
        } else if (show) {
            if (oneFileSeparateProgressWrap) oneFileSeparateProgressWrap.classList.add('hidden');
            if (oneFileMasterLoadingSpinnerWrap) oneFileMasterLoadingSpinnerWrap.classList.remove('hidden');
        } else {
            stopStemSeparateProgress();
        }
    }
    var oneFileNotSupportedModalClose = document.getElementById('one-file-not-supported-modal-close');
    var oneFileNotSupportedModalOk = document.getElementById('one-file-not-supported-modal-ok');
    var oneFileMasterSingleBtn = document.getElementById('one-file-master-single-btn');
    if (oneFileNotSupportedModalClose) oneFileNotSupportedModalClose.addEventListener('click', closeOneFileNotSupportedModal);
    if (oneFileNotSupportedModalOk) oneFileNotSupportedModalOk.addEventListener('click', closeOneFileNotSupportedModal);
    if (oneFileMasterSingleBtn) {
        oneFileMasterSingleBtn.addEventListener('click', async function () {
            if (!pendingSingleFile) return;
            var f = pendingSingleFile;
            pendingSingleFile = null;
            showOneFileModalLoading(true, 'Building your mix…');
            state.uploadedFiles.push({ file: f, name: f.name, url: URL.createObjectURL(f) });
            state.tracks = state.uploadedFiles.map(function (e, i) { return window.MegaMix.defaultTrack(e.name); });
            renderFileList();
            renderMixerStrips();
            updatePlaybackInstruction();
            try {
                await runMixIt();
                showOneFileModalLoading(true, 'Applying AI mastering…');
                var afterMix = await window.MegaMix.buildAfterMixWithFX();
                if (!afterMix) {
                    showOneFileModalLoading(false);
                    closeOneFileNotSupportedModal();
                    showToast('Could not render the mix. Please try again.');
                    return;
                }
                if (state.unmasteredMixUrl) URL.revokeObjectURL(state.unmasteredMixUrl);
                state.unmasteredMixUrl = URL.createObjectURL(window.MegaMix.encodeWav(afterMix.left, afterMix.right, afterMix.sampleRate));
                state.masteringOptions = state.masteringOptions || { punch: 0, loudness: 1, compression: 1 };
                var mastered = await window.MegaMix.runMasteringChain(afterMix, state.masteringOptions);
                closeOneFileNotSupportedModal();
                if (mastered) {
                    if (state.masteredUrl) URL.revokeObjectURL(state.masteredUrl);
                    if (state.slowedReverbUrl) { URL.revokeObjectURL(state.slowedReverbUrl); state.slowedReverbUrl = null; }
                    state.masteredUrl = URL.createObjectURL(window.MegaMix.encodeWav(mastered.left, mastered.right, mastered.sampleRate));
                    showView('mastering');
                } else {
                    showToast('Mastering did not produce output. Try again.');
                }
            } catch (e) {
                console.error('Single-file master flow', e);
                showOneFileModalLoading(false);
                closeOneFileNotSupportedModal();
                showToast('Something went wrong. Please try again.');
            }
        });
    }
    async function runStemSeparation() {
        if (!pendingSingleFile) return;
        var token = (window.MegaMixAuth && window.MegaMixAuth.getToken) ? window.MegaMixAuth.getToken() : null;
        var inPreviewMode = window.MegaMixAuth && window.MegaMixAuth.isPreviewMode && window.MegaMixAuth.isPreviewMode();
        if (!token || inPreviewMode) {
            if (window.MegaMixAuth && window.MegaMixAuth.showLoginRequired) {
                window.MegaMixAuth.showLoginRequired('This is a premium feature! Sign up for a free trial to separate your stems.');
            } else {
                showToast('Sign in to use AI stem separation.');
            }
            return;
        }
        var estSec = STEM_SEPARATE_DEFAULT_EST_SEC;
        try {
            var estRes = await fetch((window.location.origin || '') + '/api/separate-estimate');
            if (estRes && estRes.ok) {
                var estData = await estRes.json();
                if (typeof estData.estimatedSeconds === 'number' && estData.estimatedSeconds > 0) estSec = estData.estimatedSeconds;
            }
        } catch (_) {}
        var preprocessed = await preprocessAudioForStemSeparation(pendingSingleFile);
        showOneFileModalLoading(true, 'Separating stems…', { stemSeparation: true });
        if (oneFileSeparateProgressFill) oneFileSeparateProgressFill.style.width = '0%';
        var progressStartTime = Date.now();
        oneFileSeparateProgressIntervalId = setInterval(function () {
            var elapsed = (Date.now() - progressStartTime) / 1000;
            var pct = Math.min(95, (elapsed / estSec) * 95);
            if (oneFileSeparateProgressFill) oneFileSeparateProgressFill.style.width = pct + '%';
            var m = Math.floor(elapsed / 60);
            var s = Math.floor(elapsed % 60);
            var elapsedStr = m + ':' + (s < 10 ? '0' : '') + s;
            var remaining = Math.max(0, estSec - elapsed);
            var remStr = remaining > 0 ? '~' + Math.ceil(remaining) + ' s' : 'Almost done…';
            if (oneFileSeparateTimer) oneFileSeparateTimer.textContent = 'Elapsed: ' + elapsedStr + ' · Est. remaining: ' + remStr;
        }, 500);

        var formData = new FormData();
        formData.append('audio', preprocessed.file);
            try {
                var base = window.location.origin || '';
                var res = await fetch(base + '/api/separate', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + token },
                    body: formData
                });
                if (oneFileSeparateProgressIntervalId) {
                    clearInterval(oneFileSeparateProgressIntervalId);
                    oneFileSeparateProgressIntervalId = null;
                }
                if (!res.ok) {
                    showOneFileModalLoading(false);
                    closeOneFileNotSupportedModal();
                    showToast('Stem separation failed. Try again or upload stems from your DAW.');
                    return;
                }
                if (oneFileSeparateProgressFill) oneFileSeparateProgressFill.style.width = '100%';
                if (oneFileSeparateTimer) oneFileSeparateTimer.textContent = 'Complete!';
                var data = await res.json();
                var stems = data.stems || [];
                if (stems.length === 0) {
                    showOneFileModalLoading(false);
                    closeOneFileNotSupportedModal();
                    showToast('Stem separation produced no output. Try again.');
                    return;
                }
                for (var s = 0; s < stems.length; s++) {
                    var stem = stems[s];
                    var binary = atob(stem.data);
                    var bytes = new Uint8Array(binary.length);
                    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    var blob = new Blob([bytes], { type: 'audio/wav' });
                    var fileName = (stem.name || 'Stem' + (s + 1)) + '.wav';
                    var file = new File([blob], fileName, { type: 'audio/wav' });
                    var url = URL.createObjectURL(blob);
                    state.uploadedFiles.push({ file: file, name: fileName, url: url });
                }
                state.tracks = state.uploadedFiles.map(function (e, i) { return window.MegaMix.defaultTrack(e.name); });
                renderFileList();
                renderMixerStrips();
                updatePlaybackInstruction();
                setTimeout(function () {
                    closeOneFileNotSupportedModal();
                    var panel = document.getElementById('panel-simple');
                    var step2 = panel ? panel.previousElementSibling : null;
                    if (step2) step2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 400);
            } catch (e) {
                console.error('Split stems', e);
                if (oneFileSeparateProgressIntervalId) {
                    clearInterval(oneFileSeparateProgressIntervalId);
                    oneFileSeparateProgressIntervalId = null;
                }
                showOneFileModalLoading(false);
                closeOneFileNotSupportedModal();
                showToast('Something went wrong. Please try again.');
            }
    }
    var oneFileSplitStemsBtn = document.getElementById('one-file-split-stems-btn');
    if (oneFileSplitStemsBtn) oneFileSplitStemsBtn.addEventListener('click', function () { runStemSeparation(); });

    if (oneFileNotSupportedModal) {
        oneFileNotSupportedModal.addEventListener('click', function (e) {
            var content = oneFileNotSupportedModal.querySelector('.email-modal-app-content');
            if (content && !content.contains(e.target)) closeOneFileNotSupportedModal();
        });
    }

    var uploadFxInfoModal = document.getElementById('upload-fx-info-modal');
    var uploadFxInfoModalClose = document.getElementById('upload-fx-info-modal-close');
    var uploadFxInfoModalOk = document.getElementById('upload-fx-info-modal-ok');
    function closeUploadFxInfoModal() {
        if (uploadFxInfoModal) {
            uploadFxInfoModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }
    if (uploadFxInfoModalClose) uploadFxInfoModalClose.addEventListener('click', closeUploadFxInfoModal);
    if (uploadFxInfoModalOk) uploadFxInfoModalOk.addEventListener('click', closeUploadFxInfoModal);
    if (uploadFxInfoModal) {
        uploadFxInfoModal.addEventListener('click', function (e) {
            var content = uploadFxInfoModal.querySelector('.email-modal-app-content');
            if (content && !content.contains(e.target)) closeUploadFxInfoModal();
        });
    }

    const contactModalApp = document.getElementById('contactModalApp');
    const contactFormApp = document.getElementById('contactFormApp');
    function openContactModalApp() {
        if (contactModalApp) {
            contactModalApp.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    }
    function closeContactModalApp() {
        if (contactModalApp) {
            contactModalApp.classList.add('hidden');
            document.body.style.overflow = '';
            if (contactFormApp) contactFormApp.reset();
        }
    }
    const footerContact = document.getElementById('footer-contact');
    if (footerContact) footerContact.addEventListener('click', function (e) { e.preventDefault(); openContactModalApp(); });
    const contactModalAppClose = document.getElementById('contactModalAppClose');
    const contactModalAppCancel = document.getElementById('contactModalAppCancel');
    if (contactModalAppClose) contactModalAppClose.addEventListener('click', closeContactModalApp);
    if (contactModalAppCancel) contactModalAppCancel.addEventListener('click', closeContactModalApp);
    if (contactModalApp) {
        contactModalApp.addEventListener('click', function (e) {
            if (e.target === contactModalApp) closeContactModalApp();
        });
    }
    if (contactFormApp) {
        contactFormApp.addEventListener('submit', async function (e) {
            e.preventDefault();
            const name = document.getElementById('contactNameApp') && document.getElementById('contactNameApp').value.trim();
            const email = document.getElementById('contactEmailApp') && document.getElementById('contactEmailApp').value.trim();
            const subject = document.getElementById('contactSubjectApp') && document.getElementById('contactSubjectApp').value;
            const message = document.getElementById('contactMessageApp') && document.getElementById('contactMessageApp').value.trim();
            if (!name || !email || !subject || !message) {
                alert('Please fill in all fields.');
                return;
            }
            try {
                const response = await fetch('/contact-support', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, subject, message })
                });
                const result = await response.json();
                if (result.success) {
                    alert('Thank you for contacting us! We\'ll get back to you within 24 hours.');
                    closeContactModalApp();
                } else {
                    alert('Sorry, there was an error sending your message. Please try again or email us directly at support@megamixai.com');
                }
            } catch (err) {
                console.error('Contact form error:', err);
                alert('Sorry, there was an error sending your message. Please try again or email us directly at support@megamixai.com');
            }
        });
    }

    const newsletterSignupModalApp = document.getElementById('newsletterSignupModalApp');
    const newsletterEmailInputApp = document.getElementById('newsletterEmailInputApp');
    var newsletterSignupSourceApp = null;
    function openNewsletterSignupModal(signupSource) {
        newsletterSignupSourceApp = signupSource || null;
        if (newsletterSignupModalApp) {
            newsletterSignupModalApp.classList.remove('hidden');
            if (newsletterEmailInputApp) newsletterEmailInputApp.value = '';
            document.body.style.overflow = 'hidden';
        }
    }
    function closeNewsletterSignupModal() {
        if (newsletterSignupSourceApp === 'prospective-60s-app') {
            try { sessionStorage.setItem('megamix_60s_popup_app_shown', '1'); } catch (e) {}
        }
        newsletterSignupSourceApp = null;
        if (newsletterSignupModalApp) {
            newsletterSignupModalApp.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }
    const footerNewsletter = document.getElementById('footer-newsletter');
    if (footerNewsletter) footerNewsletter.addEventListener('click', function (e) {
        e.preventDefault();
        openNewsletterSignupModal();
    });
    const newsletterSignupModalAppClose = document.getElementById('newsletterSignupModalAppClose');
    const newsletterSignupModalAppCancel = document.getElementById('newsletterSignupModalAppCancel');
    const newsletterSignupModalAppSubmit = document.getElementById('newsletterSignupModalAppSubmit');
    if (newsletterSignupModalAppClose) newsletterSignupModalAppClose.addEventListener('click', closeNewsletterSignupModal);
    if (newsletterSignupModalAppCancel) newsletterSignupModalAppCancel.addEventListener('click', closeNewsletterSignupModal);
    if (newsletterSignupModalApp) {
        newsletterSignupModalApp.addEventListener('click', function (e) {
            if (e.target === newsletterSignupModalApp) closeNewsletterSignupModal();
        });
    }
    if (newsletterSignupModalAppSubmit) newsletterSignupModalAppSubmit.addEventListener('click', async function () {
        const email = newsletterEmailInputApp ? newsletterEmailInputApp.value.trim() : '';
        if (!email || !isValidEmail(email)) {
            alert('Please enter a valid email address.');
            return;
        }
        try {
            const base = window.location.origin || '';
            var body = newsletterSignupSourceApp
                ? { email: email, signupSource: newsletterSignupSourceApp }
                : { email: email, format: 'web-newsletter', platform: 'web' };
            const res = await fetch(base + '/mailchimp-signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(function () { return {}; });
            if (data.success) {
                alert('Thanks for signing up!');
            } else {
                console.warn('Newsletter signup', data.error || data);
                alert(data.error || 'Signup may have failed. Please try again.');
            }
        } catch (e) {
            console.warn('Newsletter signup', e);
            alert('Something went wrong. Please try again.');
        }
        closeNewsletterSignupModal();
    });

    var linger60sKeyApp = 'megamix_60s_popup_app_shown';
    var linger60sMs = 60000;
    if (!document.body.classList.contains('logged-in')) {
        var alreadyShownApp = false;
        try { alreadyShownApp = sessionStorage.getItem(linger60sKeyApp) === '1'; } catch (e) {}
        if (!alreadyShownApp) {
            setTimeout(function () {
                try { if (sessionStorage.getItem(linger60sKeyApp) === '1') return; } catch (e) {}
                if (document.body.classList.contains('logged-in')) return;
                openNewsletterSignupModal('prospective-60s-app');
            }, linger60sMs);
        }
    }

    window.addEventListener('megamix:logged-in', function () {
        performPendingDownload();
    });

    initPlaybackCard();
    updatePlaybackInstruction();
    if (chatMessages && typeof IntersectionObserver !== 'undefined') {
        const chatArea = chatMessages.closest('.chat-wrap') || chatMessages;
        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry || !entry.isIntersecting) return;
            if (chatMessages.children.length === 0) {
                addChatMessage('bot', "Hi! I'm Josh, your AI mixing assistant. Just tell me what you want to achieve (like 'add punch' or 'smooth vocals') and I'll adjust the settings for you. I use your stems and your feedback to get the balance you want.");
            }
            observer.disconnect();
        }, { root: null, rootMargin: '0px', threshold: 0.1 });
        observer.observe(chatArea);
    } else if (chatMessages && chatMessages.children.length === 0) {
        addChatMessage('bot', "Hi! I'm Josh, your AI mixing assistant. Just tell me what you want to achieve (like 'add punch' or 'smooth vocals') and I'll adjust the settings for you. I use your stems and your feedback to get the balance you want.");
    }
})();
