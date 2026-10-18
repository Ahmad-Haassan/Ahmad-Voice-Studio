// Ahmad Voice Studio - Interactive Frontend Logic Pro

let currentRefAudioPath = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordInterval = null;
let recordSeconds = 0;
let audioContext = null;
let analyser = null;
let animFrameId = null;

let isGenerating = false;
let genTimerInterval = null;
let genSeconds = 0;
let isSeedLocked = false;

// DOM Elements
const engineStatusBadge = document.getElementById("engineStatusBadge");
const engineStatusText = document.getElementById("engineStatusText");
const openFolderBtn = document.getElementById("openFolderBtn");
const historyToggleBtn = document.getElementById("historyToggleBtn");
const historyCountBadge = document.getElementById("historyCountBadge");

const tabMic = document.getElementById("tabMic");
const tabUpload = document.getElementById("tabUpload");
const paneMic = document.getElementById("paneMic");
const paneUpload = document.getElementById("paneUpload");

const liveVisualizerCanvas = document.getElementById("liveVisualizerCanvas");
const visualizerCtx = liveVisualizerCanvas.getContext("2d");
const recordBtn = document.getElementById("recordBtn");
const recordTimer = document.getElementById("recordTimer");
const recordHintText = document.getElementById("recordHintText");

const audioDropzone = document.getElementById("audioDropzone");
const browseFileBtn = document.getElementById("browseFileBtn");

const activeAudioBar = document.getElementById("activeAudioBar");
const loadedAudioName = document.getElementById("loadedAudioName");
const playRefAudioBtn = document.getElementById("playRefAudioBtn");
const clearRefAudioBtn = document.getElementById("clearRefAudioBtn");

const refTextInput = document.getElementById("refTextInput");
const genTextInput = document.getElementById("genTextInput");

const micDenoiseCheck = document.getElementById("micDenoiseCheck");
const boostVolumeCheck = document.getElementById("boostVolumeCheck");

const cfgSlider = document.getElementById("cfgSlider");
const cfgVal = document.getElementById("cfgVal");
const speedSlider = document.getElementById("speedSlider");
const speedVal = document.getElementById("speedVal");
const stepsSlider = document.getElementById("stepsSlider");
const stepsVal = document.getElementById("stepsVal");
const removeSilenceCheck = document.getElementById("removeSilenceCheck");
const seedInput = document.getElementById("seedInput");
const randomSeedBtn = document.getElementById("randomSeedBtn");
const lockSeedBtn = document.getElementById("lockSeedBtn");

const generateBtn = document.getElementById("generateBtn");
const progressBarContainer = document.getElementById("progressBarContainer");
const progressStatusLabel = document.getElementById("progressStatusLabel");
const genTimerText = document.getElementById("genTimerText");
const cancelGenBtn = document.getElementById("cancelGenBtn");

const resultPlayerCard = document.getElementById("resultPlayerCard");
const playerPlayBtn = document.getElementById("playerPlayBtn");
const playIcon = document.getElementById("playIcon");
const pauseIcon = document.getElementById("pauseIcon");
const trackTitle = document.getElementById("trackTitle");
const trackTime = document.getElementById("trackTime");
const playbackWaveformCanvas = document.getElementById("playbackWaveformCanvas");
const playbackCtx = playbackWaveformCanvas.getContext("2d");
const downloadAudioBtn = document.getElementById("downloadAudioBtn");

const historyOverlay = document.getElementById("historyOverlay");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const historyList = document.getElementById("historyList");

const nativeAudioPlayer = document.getElementById("nativeAudioPlayer");
const refAudioPlayer = document.getElementById("refAudioPlayer");
const historyAudioPlayer = document.getElementById("historyAudioPlayer");

// Global hook for Python status updates
window.onEngineStatusUpdate = function(msg) {
    if (engineStatusText) {
        engineStatusText.textContent = msg;
    }
    if (progressStatusLabel) {
        progressStatusLabel.textContent = msg;
    }
};

// Check PyWebView Bridge Ready
function checkPyWebView() {
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.ping().then(info => {
            engineStatusText.textContent = `Ready (${info.device})`;
            engineStatusBadge.style.color = "#10b981";
            loadHistory();
        }).catch(err => {
            console.log("Ping error:", err);
        });
    } else {
        setTimeout(checkPyWebView, 300);
    }
}
window.addEventListener("pywebviewready", checkPyWebView);
setTimeout(checkPyWebView, 600);

// Tab switching
tabMic.addEventListener("click", () => {
    tabMic.classList.add("active");
    tabUpload.classList.remove("active");
    paneMic.classList.add("active");
    paneUpload.classList.remove("active");
});

tabUpload.addEventListener("click", () => {
    tabUpload.classList.add("active");
    tabMic.classList.remove("active");
    paneUpload.classList.add("active");
    paneMic.classList.remove("active");
});

// Quality preset pills
document.querySelectorAll(".preset-pill").forEach(pill => {
    pill.addEventListener("click", () => {
        document.querySelectorAll(".preset-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        const steps = pill.getAttribute("data-steps");
        stepsSlider.value = steps;
        stepsVal.textContent = steps;
    });
});

stepsSlider.addEventListener("input", (e) => {
    const val = e.target.value;
    stepsVal.textContent = val;
    document.querySelectorAll(".preset-pill").forEach(pill => {
        if (pill.getAttribute("data-steps") === val) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });
});

// Voice Clarity Slider update
cfgSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    let tag = "Sharp";
    if (val < 1.8) tag = "Soft";
    else if (val >= 2.6) tag = "Crisp";
    cfgVal.textContent = `${val} (${tag})`;
});

// Speech Speed Slider update
speedSlider.addEventListener("input", (e) => {
    speedVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
});

// Quick prompt chips
document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        genTextInput.value = chip.getAttribute("data-text");
        genTextInput.focus();
    });
});

// Clarity Quick-read sentence chips
document.querySelectorAll(".chip-sample").forEach(chip => {
    chip.addEventListener("click", () => {
        const text = chip.getAttribute("data-sample");
        refTextInput.value = text;
        refTextInput.focus();
    });
});

// Seed controller
randomSeedBtn.addEventListener("click", () => {
    const rand = Math.floor(Math.random() * 9999999);
    seedInput.value = rand;
});

lockSeedBtn.addEventListener("click", () => {
    isSeedLocked = !isSeedLocked;
    if (isSeedLocked) {
        lockSeedBtn.textContent = "🔒";
        lockSeedBtn.style.color = "#10b981";
        lockSeedBtn.title = "Seed Locked";
    } else {
        lockSeedBtn.textContent = "🔓";
        lockSeedBtn.style.color = "";
        lockSeedBtn.title = "Seed Unlocked";
    }
});

// Idle visualizer animation for recording canvas
function drawIdleVisualizer() {
    visualizerCtx.clearRect(0, 0, liveVisualizerCanvas.width, liveVisualizerCanvas.height);
    const bars = 36;
    const barWidth = liveVisualizerCanvas.width / bars - 2;
    const time = Date.now() * 0.003;

    for (let i = 0; i < bars; i++) {
        const height = 4 + Math.sin(time + i * 0.28) * 5;
        const x = i * (barWidth + 2);
        const y = (liveVisualizerCanvas.height - height) / 2;

        const grad = visualizerCtx.createLinearGradient(0, y, 0, y + height);
        grad.addColorStop(0, "rgba(6, 182, 212, 0.45)");
        grad.addColorStop(1, "rgba(139, 92, 246, 0.35)");

        visualizerCtx.fillStyle = grad;
        visualizerCtx.fillRect(x, y, barWidth, height);
    }
}
let idleInterval = setInterval(drawIdleVisualizer, 50);

// Live Microphone Recording Logic
recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        stopRecording();
    } else {
        startRecording();
    }
});

async function startRecording() {
    try {
        clearInterval(idleInterval);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            if (audioContext) audioContext.close();
            cancelAnimationFrame(animFrameId);
            idleInterval = setInterval(drawIdleVisualizer, 50);

            const blob = new Blob(recordedChunks, { type: "audio/webm" });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64Data = reader.result;
                if (window.pywebview && window.pywebview.api) {
                    recordHintText.textContent = "Processing & standardizing reference audio...";
                    window.pywebview.api.save_recorded_audio(base64Data).then(res => {
                        if (res.success) {
                            setActiveAudio(res.file_path, "Microphone Voice (24kHz Studio)");
                            if (res.audio_preview) {
                                refAudioPlayer.src = res.audio_preview;
                            }
                            recordHintText.textContent = "Voice loaded! Tip: Enter what you spoke in transcript.";
                        } else {
                            recordHintText.textContent = "Error saving: " + res.error;
                        }
                    });
                }
            };
        };

        mediaRecorder.start();
        recordBtn.classList.add("recording");
        recordHintText.textContent = "Recording... Speak clearly (click again to finish)";

        recordSeconds = 0;
        recordTimer.textContent = "00:00";
        recordInterval = setInterval(() => {
            recordSeconds++;
            const mins = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
            const secs = String(recordSeconds % 60).padStart(2, "0");
            recordTimer.textContent = `${mins}:${secs}`;

            if (recordSeconds >= 12) {
                stopRecording();
            }
        }, 1000);

        visualizeLiveMic();
    } catch (err) {
        alert("Microphone Access Error: " + err.message);
        idleInterval = setInterval(drawIdleVisualizer, 50);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        recordBtn.classList.remove("recording");
        clearInterval(recordInterval);
    }
}

function visualizeLiveMic() {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function render() {
        animFrameId = requestAnimationFrame(render);
        analyser.getByteFrequencyData(dataArray);

        visualizerCtx.clearRect(0, 0, liveVisualizerCanvas.width, liveVisualizerCanvas.height);
        const bars = dataArray.length;
        const barWidth = liveVisualizerCanvas.width / bars - 2;

        for (let i = 0; i < bars; i++) {
            const barHeight = Math.max(4, (dataArray[i] / 255) * liveVisualizerCanvas.height);
            const x = i * (barWidth + 2);
            const y = (liveVisualizerCanvas.height - barHeight) / 2;

            const grad = visualizerCtx.createLinearGradient(0, y, 0, y + barHeight);
            grad.addColorStop(0, "#06b6d4");
            grad.addColorStop(0.5, "#3b82f6");
            grad.addColorStop(1, "#8b5cf6");

            visualizerCtx.fillStyle = grad;
            visualizerCtx.fillRect(x, y, barWidth, barHeight);
        }
    }
    render();
}

// File Picker
browseFileBtn.addEventListener("click", () => {
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.select_audio_file().then(res => {
            if (res.success) {
                setActiveAudio(res.file_path, res.filename);
                if (res.audio_preview) {
                    refAudioPlayer.src = res.audio_preview;
                }
            }
        });
    }
});
audioDropzone.addEventListener("click", () => browseFileBtn.click());

function setActiveAudio(filePath, displayName) {
    currentRefAudioPath = filePath;
    loadedAudioName.textContent = displayName;
    activeAudioBar.style.display = "flex";
}

clearRefAudioBtn.addEventListener("click", () => {
    currentRefAudioPath = null;
    activeAudioBar.style.display = "none";
    refAudioPlayer.pause();
    refAudioPlayer.src = "";
});

playRefAudioBtn.addEventListener("click", () => {
    if (!refAudioPlayer.src) return;
    if (refAudioPlayer.paused) {
        refAudioPlayer.play();
        playRefAudioBtn.textContent = "⏸ Pause";
    } else {
        refAudioPlayer.pause();
        playRefAudioBtn.textContent = "▶ Play";
    }
});
refAudioPlayer.onended = () => {
    playRefAudioBtn.textContent = "▶ Play";
};

// Open Output Folder
openFolderBtn.addEventListener("click", () => {
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.open_outputs_folder();
    }
});

// Master Voice Generation Action
generateBtn.addEventListener("click", async () => {
    if (!currentRefAudioPath) {
        alert("Please record or select a reference voice first (Step 1).");
        return;
    }
    const genText = genTextInput.value.trim();
    if (!genText) {
        alert("Please enter the text you want the voice to say (Step 2).");
        genTextInput.focus();
        return;
    }

    isGenerating = true;
    generateBtn.disabled = true;
    cancelGenBtn.disabled = false;
    cancelGenBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <span>Cancel Generation</span>
    `;
    progressBarContainer.style.display = "flex";
    progressStatusLabel.textContent = "Initializing voice synthesis on CPU...";
    resultPlayerCard.style.display = "none";

    // Start timer
    genSeconds = 0;
    genTimerText.textContent = "00:00";
    clearInterval(genTimerInterval);
    genTimerInterval = setInterval(() => {
        genSeconds++;
        const mins = String(Math.floor(genSeconds / 60)).padStart(2, "0");
        const secs = String(genSeconds % 60).padStart(2, "0");
        genTimerText.textContent = `${mins}:${secs}`;
    }, 1000);

    const refText = refTextInput.value.trim();
    const speed = parseFloat(speedSlider.value);
    const steps = parseInt(stepsSlider.value);
    const cfgStrength = parseFloat(cfgSlider.value);
    const removeSilence = removeSilenceCheck.checked;
    const boostVolume = boostVolumeCheck.checked;
    const denoiseMic = micDenoiseCheck.checked;
    
    let seedVal = parseInt(seedInput.value);
    if (isNaN(seedVal)) seedVal = -1;

    try {
        const res = await window.pywebview.api.generate_speech(
            currentRefAudioPath,
            refText,
            genText,
            speed,
            steps,
            cfgStrength,
            0.15, // cross-fade
            removeSilence,
            boostVolume,
            denoiseMic,
            seedVal
        );

        if (res.success) {
            progressStatusLabel.textContent = `Completed! (${res.duration}s audio generated)`;
            
            // Set up player
            nativeAudioPlayer.src = res.audio_base64;
            trackTitle.textContent = res.filename;
            downloadAudioBtn.href = res.audio_base64;
            downloadAudioBtn.download = res.filename;

            // Update seed input if seed was random and not locked
            if (!isSeedLocked && res.seed) {
                seedInput.value = res.seed;
            }

            resultPlayerCard.style.display = "flex";
            nativeAudioPlayer.play();
            setPlayerPlaying(true);
            renderStaticWaveform();

            // Refresh history
            loadHistory();
        } else if (res.cancelled) {
            progressStatusLabel.textContent = "Generation cancelled by user.";
        } else {
            alert("Synthesis Notice: " + res.error);
            progressStatusLabel.textContent = "Error: " + res.error;
        }
    } catch (err) {
        progressStatusLabel.textContent = "Notice: " + err;
    } finally {
        isGenerating = false;
        generateBtn.disabled = false;
        clearInterval(genTimerInterval);
        setTimeout(() => {
            if (!isGenerating) {
                progressBarContainer.style.display = "none";
            }
        }, 4000);
    }
});

// Cancel Generation Action
cancelGenBtn.addEventListener("click", async () => {
    if (!isGenerating) return;
    cancelGenBtn.disabled = true;
    cancelGenBtn.textContent = "Cancelling...";
    progressStatusLabel.textContent = "Interrupting neural flow-matching...";

    if (window.pywebview && window.pywebview.api) {
        try {
            await window.pywebview.api.cancel_generation();
        } catch (e) {
            console.log("Cancel error:", e);
        }
    }
});

// Result Audio Player Controller
playerPlayBtn.addEventListener("click", () => {
    if (nativeAudioPlayer.paused) {
        nativeAudioPlayer.play();
        setPlayerPlaying(true);
    } else {
        nativeAudioPlayer.pause();
        setPlayerPlaying(false);
    }
});

nativeAudioPlayer.onended = () => {
    setPlayerPlaying(false);
};

nativeAudioPlayer.ontimeupdate = () => {
    const cur = formatTime(nativeAudioPlayer.currentTime);
    const dur = formatTime(nativeAudioPlayer.duration || 0);
    trackTime.textContent = `${cur} / ${dur}`;
    renderProgressWaveform();
};

function setPlayerPlaying(isPlaying) {
    if (isPlaying) {
        playIcon.style.display = "none";
        pauseIcon.style.display = "block";
    } else {
        playIcon.style.display = "block";
        pauseIcon.style.display = "none";
    }
}

function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

// Waveform visualizer for playback
let waveBars = [];
function renderStaticWaveform() {
    waveBars = [];
    const count = 75;
    for (let i = 0; i < count; i++) {
        waveBars.push(0.2 + Math.random() * 0.8);
    }
    renderProgressWaveform();
}

function renderProgressWaveform() {
    const width = playbackWaveformCanvas.width;
    const height = playbackWaveformCanvas.height;
    playbackCtx.clearRect(0, 0, width, height);

    if (waveBars.length === 0) return;

    const progress = (nativeAudioPlayer.currentTime / (nativeAudioPlayer.duration || 1));
    const barWidth = width / waveBars.length - 2;

    for (let i = 0; i < waveBars.length; i++) {
        const barH = waveBars[i] * (height - 8);
        const x = i * (barWidth + 2);
        const y = (height - barH) / 2;

        const isPast = (i / waveBars.length) <= progress;
        playbackCtx.fillStyle = isPast ? "#06b6d4" : "rgba(255, 255, 255, 0.25)";
        playbackCtx.fillRect(x, y, barWidth, barH);
    }
}

// Scrubber click on waveform
playbackWaveformCanvas.addEventListener("click", (e) => {
    const rect = playbackWaveformCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    if (nativeAudioPlayer.duration) {
        nativeAudioPlayer.currentTime = percent * nativeAudioPlayer.duration;
    }
});

// History Drawer Controller
historyToggleBtn.addEventListener("click", () => {
    historyOverlay.classList.add("open");
    loadHistory();
});

closeHistoryBtn.addEventListener("click", () => {
    historyOverlay.classList.remove("open");
});

historyOverlay.addEventListener("click", (e) => {
    if (e.target === historyOverlay) {
        historyOverlay.classList.remove("open");
    }
});

async function loadHistory() {
    if (!window.pywebview || !window.pywebview.api) return;
    try {
        const items = await window.pywebview.api.get_history();
        historyCountBadge.textContent = items.length;

        if (items.length === 0) {
            historyList.innerHTML = `<div class="history-empty">No creations yet. Generate your first voice clone!</div>`;
            return;
        }

        historyList.innerHTML = items.map(item => `
            <div class="history-card" data-filename="${item.filename}">
                <div class="history-card-header">
                    <span class="history-filename" title="${item.filename}">${item.filename}</span>
                    <span class="history-meta">${item.size_kb} KB</span>
                </div>
                <div class="history-meta">${item.time}</div>
                <div class="history-actions">
                    <button class="mini-btn play-history-btn" data-audio="${item.audio_base64}">▶ Play</button>
                    <a class="mini-btn" href="${item.audio_base64}" download="${item.filename}">💾 Download</a>
                    <button class="mini-btn danger delete-history-btn" data-filename="${item.filename}">🗑️ Delete</button>
                </div>
            </div>
        `).join("");

        // Wire history buttons
        document.querySelectorAll(".play-history-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const b64 = btn.getAttribute("data-audio");
                if (historyAudioPlayer.src === b64 && !historyAudioPlayer.paused) {
                    historyAudioPlayer.pause();
                    btn.textContent = "▶ Play";
                } else {
                    document.querySelectorAll(".play-history-btn").forEach(b => b.textContent = "▶ Play");
                    historyAudioPlayer.src = b64;
                    historyAudioPlayer.play();
                    btn.textContent = "⏸ Pause";
                }
            });
        });

        historyAudioPlayer.onended = () => {
            document.querySelectorAll(".play-history-btn").forEach(b => b.textContent = "▶ Play");
        };

        document.querySelectorAll(".delete-history-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const fname = btn.getAttribute("data-filename");
                if (confirm(`Delete "${fname}"?`)) {
                    await window.pywebview.api.delete_history_item(fname);
                    loadHistory();
                }
            });
        });
    } catch (e) {
        console.log("History load error:", e);
    }
}
