'use strict';

(function expose(root) {
    if (typeof document === 'undefined') return;

    document.addEventListener('DOMContentLoaded', () => {
        const analysis = root.KanaricPitchAnalysis;
        const MicrophoneEngine = root.KanaricKaraokeMicrophone
            && root.KanaricKaraokeMicrophone.BrowserMicrophoneEngine;
        const lab = document.getElementById('pitch-lab');
        if (!lab || !analysis) return;

        const ui = {
            start: document.getElementById('pitch-mic-start'),
            stop: document.getElementById('pitch-mic-stop'),
            save: document.getElementById('pitch-mic-save'),
            micStatus: document.getElementById('pitch-mic-status'),
            latency: document.getElementById('pitch-mic-latency'),
            range: document.getElementById('pitch-range-summary'),
            file: document.getElementById('pitch-reference-file'),
            referenceStatus: document.getElementById('pitch-reference-status'),
            reference: document.getElementById('pitch-reference-summary'),
            alignment: document.getElementById('pitch-alignment'),
            canvas: document.getElementById('pitch-canvas'),
            recommendation: document.getElementById('pitch-recommendation'),
            applied: document.getElementById('pitch-applied'),
            candidates: document.getElementById('pitch-candidates'),
            applyKey: document.getElementById('pitch-apply-key'),
        };
        const state = {
            engine: null,
            unsubscribe: null,
            analysisContext: null,
            analyser: null,
            sampleBuffer: null,
            sampleTimer: null,
            measuredFrames: [],
            measuredRange: null,
            savedRange: loadSavedRange(),
            referenceFrames: [],
            displayedReferenceFrames: [],
            referenceSummary: null,
            alignmentMs: 0,
            recommendation: null,
            appliedKey: null,
        };

        function audioContextConstructor() {
            return root.AudioContext || root.webkitAudioContext;
        }

        function setStatus(element, message, kind = '') {
            if (!element) return;
            element.textContent = message;
            element.classList.toggle('is-error', kind === 'error');
            element.classList.toggle('is-warning', kind === 'warning');
        }

        function formatMidi(value) {
            return value === null || value === undefined ? '—' : Number(value).toFixed(1);
        }

        function formatRange(range, empty = '尚無音域資料') {
            if (!range || range.lowestMidi === null) return empty;
            const warning = range.octaveWarning ? '；有八度不確定訊號，請重測' : '';
            return `最低 MIDI ${formatMidi(range.lowestMidi)}、最高 MIDI ${formatMidi(range.highestMidi)}；`
                + `舒適範圍 ${formatMidi(range.comfortableLowMidi)}–${formatMidi(range.comfortableHighMidi)}`
                + `；有效比例 ${(range.voicedRatio * 100).toFixed(1)}%${warning}`;
        }

        function loadSavedRange() {
            try {
                const parsed = JSON.parse(root.localStorage.getItem('kanaric.pitch.range') || 'null');
                return parsed && parsed.lowestMidi !== null ? parsed : null;
            } catch (error) {
                return null;
            }
        }

        function saveRange() {
            const range = state.measuredRange;
            if (!range || range.lowestMidi === null) return;
            root.localStorage.setItem('kanaric.pitch.range', JSON.stringify(range));
            state.savedRange = { ...range };
            setStatus(ui.micStatus, '音域摘要已儲存到此瀏覽器。原始麥克風資料沒有儲存。');
            renderRecommendation();
        }

        function getRange() {
            return state.measuredRange && state.measuredRange.lowestMidi !== null
                ? state.measuredRange : state.savedRange;
        }

        function updateLatency(snapshot) {
            if (!snapshot) return;
            const format = snapshot.format;
            const sampleRate = format && format.sampleRate ? `${format.sampleRate} Hz` : '取樣率未知';
            const latency = snapshot.latency || {};
            const latencyText = latency.reportedMs === null || latency.reportedMs === undefined
                ? '延遲未知' : `執行環境回報 ${latency.reportedMs.toFixed(1)} ms（未做實體 loopback）`;
            setStatus(ui.latency, `輸入：${sampleRate}；${latencyText}`,
                latency.status === 'warning' ? 'warning' : '');
        }

        function updateMicStatus(event) {
            const snapshot = event && event.state ? event : state.engine && state.engine.snapshot();
            if (!snapshot) return;
            updateLatency(snapshot);
            if (snapshot.state === 'disconnected') {
                setStatus(ui.micStatus, '麥克風已移除；可重新插入後按「開始測量」。', 'warning');
            } else if (snapshot.state === 'requesting') {
                setStatus(ui.micStatus, '正在請求麥克風權限…');
            } else if (snapshot.state === 'denied') {
                setStatus(ui.micStatus, '瀏覽器拒絕麥克風權限，請在網站設定中允許後重試。', 'error');
            } else if (snapshot.state === 'unsupported') {
                setStatus(ui.micStatus, '此瀏覽器不支援麥克風分析。', 'error');
            } else if (snapshot.state === 'stopped') {
                setStatus(ui.micStatus, '麥克風測量已停止。');
            } else if (snapshot.error) {
                setStatus(ui.micStatus, snapshot.error.message || '麥克風無法使用。', 'error');
            }
        }

        function closeAnalysisContext() {
            if (!state.analysisContext || typeof state.analysisContext.close !== 'function') return;
            const closing = state.analysisContext.close();
            if (closing && typeof closing.catch === 'function') closing.catch(() => {});
            state.analysisContext = null;
            state.analyser = null;
        }

        function stopMic() {
            if (state.sampleTimer) clearInterval(state.sampleTimer);
            state.sampleTimer = null;
            if (state.engine) state.engine.stop();
            if (state.unsubscribe) state.unsubscribe();
            state.unsubscribe = null;
            state.engine = null;
            closeAnalysisContext();
            ui.start.disabled = false;
            ui.stop.disabled = true;
            ui.save.disabled = !state.measuredRange || state.measuredRange.lowestMidi === null;
            renderAll();
        }

        function sampleMic() {
            if (!state.analyser || !state.sampleBuffer || !state.engine) return;
            state.analyser.getFloatTimeDomainData(state.sampleBuffer);
            const snapshot = state.engine.snapshot();
            const latency = snapshot.latency && snapshot.latency.measuredMs;
            const captureTimeMs = performance.now();
            const timeMs = captureTimeMs - (Number.isFinite(latency) ? latency : 0);
            state.measuredFrames.push(analysis.detectPitchFrame(
                state.sampleBuffer, state.analysisContext.sampleRate, timeMs,
            ));
            if (state.measuredFrames.length > 2400) state.measuredFrames.shift();
            state.measuredRange = analysis.summarizeRange(state.measuredFrames);
            ui.save.disabled = state.measuredRange.lowestMidi === null;
            ui.range.textContent = formatRange(state.measuredRange);
            renderCanvas();
            renderRecommendation();
        }

        async function startMic() {
            if (!MicrophoneEngine) {
                setStatus(ui.micStatus, '麥克風分析邊界未載入。', 'error');
                return;
            }
            const AudioContext = audioContextConstructor();
            if (!AudioContext || !root.navigator.mediaDevices) {
                setStatus(ui.micStatus, '此瀏覽器不支援 Web Audio 麥克風分析。', 'error');
                return;
            }
            stopMic();
            state.engine = new MicrophoneEngine({
                AudioContext,
                mediaDevices: root.navigator.mediaDevices,
            });
            state.unsubscribe = state.engine.on(updateMicStatus);
            const snapshot = await state.engine.start({ bufferSize: 128 });
            updateMicStatus(snapshot);
            if (snapshot.state !== 'running') {
                state.engine = null;
                if (state.unsubscribe) state.unsubscribe();
                state.unsubscribe = null;
                return;
            }
            const streams = state.engine.getStreams();
            const dryStream = streams && streams.dryAnalysis;
            if (!dryStream) {
                setStatus(ui.micStatus, '無法取得本機乾聲分析串流。', 'error');
                stopMic();
                return;
            }
            state.analysisContext = new AudioContext();
            if (typeof state.analysisContext.resume === 'function') await state.analysisContext.resume();
            const source = state.analysisContext.createMediaStreamSource(dryStream);
            state.analyser = state.analysisContext.createAnalyser();
            state.analyser.fftSize = 2048;
            state.analyser.smoothingTimeConstant = 0;
            state.sampleBuffer = new Float32Array(state.analyser.fftSize);
            source.connect(state.analyser);
            state.measuredFrames = [];
            state.measuredRange = null;
            ui.start.disabled = true;
            ui.stop.disabled = false;
            setStatus(ui.micStatus, '測量中：請唱幾個舒服的低音與高音。');
            state.sampleTimer = setInterval(sampleMic, 80);
            sampleMic();
        }

        function decodeAudioData(context, buffer) {
            return new Promise((resolve, reject) => {
                let result;
                try {
                    result = context.decodeAudioData(buffer, resolve, reject);
                } catch (error) {
                    reject(error);
                    return;
                }
                if (result && typeof result.then === 'function') result.then(resolve, reject);
            });
        }

        async function importReference(file) {
            if (!file) return;
            const AudioContext = audioContextConstructor();
            if (!AudioContext) {
                setStatus(ui.referenceStatus, '此瀏覽器不支援本機音檔分析。', 'error');
                return;
            }
            setStatus(ui.referenceStatus, `正在本機分析「${file.name}」…`);
            state.referenceFrames = [];
            state.displayedReferenceFrames = [];
            state.referenceSummary = null;
            state.appliedKey = null;
            ui.applyKey.disabled = true;
            try {
                const context = new AudioContext();
                const buffer = await decodeAudioData(context, await file.arrayBuffer());
                const samples = buffer.getChannelData(0);
                const frames = [];
                const frameSize = 2048;
                const hop = 4096;
                const maxFrames = 3600;
                for (let offset = 0; offset + frameSize <= samples.length && frames.length < maxFrames; offset += hop) {
                    frames.push(analysis.detectPitchFrame(
                        samples.subarray(offset, offset + frameSize),
                        buffer.sampleRate,
                        offset / buffer.sampleRate * 1000,
                    ));
                    if (frames.length % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
                }
                const summary = analysis.summarizeRange(frames);
                state.referenceFrames = frames;
                state.displayedReferenceFrames = frames;
                state.referenceSummary = summary;
                const truncated = samples.length / buffer.sampleRate * 1000 > frames.at(-1)?.timeMs + 1000;
                const warning = summary.octaveWarning || summary.voicedRatio < 0.2;
                setStatus(ui.referenceStatus,
                    `${file.name}：${formatRange(summary, '沒有足夠清楚的人聲')}`
                    + (truncated ? '；為保持瀏覽器反應，只分析前約 5 分鐘' : '')
                    + (warning ? '；可能有伴奏或八度干擾' : ''), warning ? 'warning' : '');
                ui.reference.textContent = formatRange(summary, '沒有足夠清楚的人聲訊號');
                renderAll();
            } catch (error) {
                setStatus(ui.referenceStatus, `本機音檔無法分析：${error.message || '格式不支援'}`, 'error');
                ui.reference.textContent = '沒有可用參考曲線';
                renderAll();
            }
        }

        function renderCanvas() {
            const canvas = ui.canvas;
            if (!canvas || typeof canvas.getContext !== 'function') return;
            const rect = canvas.getBoundingClientRect();
            const width = Math.max(320, Math.round(rect.width || 800));
            const height = Math.max(220, Math.round(rect.height || 300));
            const ratio = root.devicePixelRatio || 1;
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            const context = canvas.getContext('2d');
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, width, height);
            context.fillStyle = '#10131a';
            context.fillRect(0, 0, width, height);
            const reference = state.displayedReferenceFrames;
            const measured = state.measuredFrames;
            const all = measured.concat(reference);
            if (!all.length) {
                context.fillStyle = '#99a1b3';
                context.font = '14px sans-serif';
                context.fillText('開始測量或匯入本機參考音檔後，曲線會顯示在這裡。', 20, height / 2);
                return;
            }
            const values = all.map((item) => item.midi).filter((value) => Number.isFinite(value));
            const low = Math.min(36, Math.floor(Math.min(...values) - 2));
            const high = Math.max(84, Math.ceil(Math.max(...values) + 2));
            const duration = Math.max(1000, ...all.map((item) => item.timeMs + state.alignmentMs));
            context.strokeStyle = 'rgba(255,255,255,.1)';
            context.fillStyle = '#99a1b3';
            context.font = '12px sans-serif';
            for (let midi = Math.ceil(low / 12) * 12; midi <= high; midi += 12) {
                const y = height - (midi - low) / (high - low) * height;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
                context.fillText(`MIDI ${midi}`, 8, Math.max(14, y - 4));
            }
            drawFrames(context, measured, width, height, low, high, duration, '#72b7ff', 0);
            drawFrames(context, reference, width, height, low, high, duration, '#ffca73', state.alignmentMs);
        }

        function drawFrames(context, frames, width, height, low, high, duration, color, timeOffset) {
            let drawing = false;
            context.strokeStyle = color;
            context.lineWidth = 2;
            context.beginPath();
            frames.forEach((item) => {
                if (!item || item.voiced !== true || !Number.isFinite(item.midi)) {
                    drawing = false;
                    return;
                }
                const x = Math.max(0, Math.min(width, (item.timeMs + timeOffset) / duration * width));
                const y = height - (item.midi - low) / (high - low) * height;
                if (!drawing) context.moveTo(x, y);
                else context.lineTo(x, y);
                drawing = true;
            });
            context.stroke();
        }

        function renderRecommendation() {
            const range = getRange();
            if (!state.referenceFrames.length || !range || range.lowestMidi === null) {
                state.recommendation = null;
                ui.recommendation.textContent = '需要音域與參考音檔後才會產生建議。';
                ui.candidates.replaceChildren();
                ui.applyKey.disabled = true;
                return;
            }
            state.recommendation = analysis.recommendKey(state.referenceFrames, range);
            const result = state.recommendation;
            if (result.recommendedSemitones === null) {
                ui.recommendation.textContent = `${result.reason}：參考人聲或你的音域資料不足，請重新測量或換較乾淨的本機音檔。`;
                ui.candidates.replaceChildren();
                ui.applyKey.disabled = true;
                return;
            }
            const key = result.recommendedSemitones;
            ui.recommendation.textContent = `建議 ${key > 0 ? '+' : ''}${key} Key；信心 ${(result.confidence * 100).toFixed(0)}%。${result.reason}。`;
            ui.candidates.replaceChildren();
            result.candidates.forEach((candidate) => {
                const row = document.createElement('tr');
                if (candidate.semitones === key) row.className = 'is-recommended';
                const values = [
                    `${candidate.semitones > 0 ? '+' : ''}${candidate.semitones}${candidate.semitones === 0 ? '（原 Key）' : ''}`,
                    `${candidate.outsideCount}（${(candidate.outsideRatio * 100).toFixed(0)}%）`,
                    `${candidate.absoluteOutsideCount}（${(candidate.absoluteOutsideRatio * 100).toFixed(0)}%）`,
                    candidate.score.toFixed(2),
                ];
                values.forEach((value) => {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    row.appendChild(cell);
                });
                ui.candidates.appendChild(row);
            });
            ui.applyKey.disabled = false;
        }

        function applyRecommendedKey() {
            if (!state.recommendation || state.recommendation.recommendedSemitones === null) return;
            state.appliedKey = state.recommendation.recommendedSemitones;
            state.displayedReferenceFrames = analysis.shiftPitchFrames(
                state.referenceFrames, state.appliedKey,
            );
            ui.applied.textContent = `已將參考曲線平移 ${state.appliedKey > 0 ? '+' : ''}${state.appliedKey} Key。`
                + '這只改變比較圖的音高參數，沒有改變播放器位置、歌詞時間或 #WORDS#。';
            renderCanvas();
        }

        function renderAll() {
            ui.range.textContent = formatRange(state.measuredRange || state.savedRange);
            ui.reference.textContent = formatRange(state.referenceSummary, '尚無參考曲線');
            renderCanvas();
            renderRecommendation();
        }

        ui.start.addEventListener('click', () => { startMic().catch((error) => {
            setStatus(ui.micStatus, error.message || '麥克風啟動失敗。', 'error');
            stopMic();
        }); });
        ui.stop.addEventListener('click', stopMic);
        ui.save.addEventListener('click', saveRange);
        ui.file.addEventListener('change', () => importReference(ui.file.files && ui.file.files[0]));
        ui.alignment.addEventListener('input', () => {
            state.alignmentMs = Number(ui.alignment.value) || 0;
            renderCanvas();
        });
        ui.applyKey.addEventListener('click', applyRecommendedKey);
        root.addEventListener('resize', renderCanvas);
        root.addEventListener('pagehide', stopMic, { once: true });
        renderAll();
    });
}(typeof globalThis !== 'undefined' ? globalThis : this));
