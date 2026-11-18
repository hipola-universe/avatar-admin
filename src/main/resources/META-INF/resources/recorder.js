// The "Interact" button: record your voice, the admin transcribes it and sends it to every avatar
// as the voice from the sky (their new instructions). What happened is shown on screen.
document.addEventListener('DOMContentLoaded', () => {
    const recordButton = document.getElementById('recordButton');
    if (!recordButton) return;
    let mediaRecorder;
    let audioChunks = [];

    const toast = document.createElement('div');
    toast.className = 'voice-toast';
    document.body.appendChild(toast);
    let toastTimer;
    const notify = (text, kind = 'info', ms = 7000) => {
        toast.textContent = text;
        toast.className = 'voice-toast show ' + kind;
        clearTimeout(toastTimer);
        if (ms) toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
    };

    const startRecording = async () => {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            notify('Microphone unavailable: ' + error.message, 'error');
            return;
        }
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            // Browsers record webm/opus (Chrome, Firefox) or mp4 (Safari): name the file after what it really is.
            const type = mediaRecorder.mimeType || 'audio/webm';
            const extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
            sendAudioToServer(new Blob(audioChunks, { type }), 'recording.' + extension);
        };
        mediaRecorder.start();
        recordButton.classList.add('blink');
        recordButton.textContent = 'Stop';
        notify('Listening… click Stop when you are done.', 'info', 0);
    };

    const stopRecording = () => {
        mediaRecorder.stop();
        recordButton.classList.remove('blink');
        recordButton.textContent = 'Interact';
    };

    recordButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording(); else startRecording();
    });

    const sendAudioToServer = async (audioBlob, fileName) => {
        const formData = new FormData();
        formData.append('audio', audioBlob, fileName);
        notify('Transcribing…', 'info', 0);
        try {
            const response = await fetch('/initChat/audio', { method: 'POST', body: formData });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
            notify(`The sky said to ${data.listeners.length} avatar${data.listeners.length > 1 ? 's' : ''}: « ${data.text} »`, 'ok', 12000);
        } catch (error) {
            notify('Voice not sent. ' + error.message, 'error', 15000);
        }
    };
});
