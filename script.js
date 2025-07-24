let currentInput = '';
let inputEnabled = true;
let visitor_id;
let fpHash;

async function init() {
    visitor_id = localStorage.getItem('visitor_id');
    if (!visitor_id) {
        visitor_id = crypto.randomUUID();
        localStorage.setItem('visitor_id', visitor_id);
    }

    const fp = await FingerprintJS.load();
    const result = await fp.get();
    fpHash = result.visitorId;

    const geoResponse = await fetch('https://ip-api.com/json');
    const geo = await geoResponse.json();

    await fetch('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            visitor_id,
            fpHash,
            geo,
            userAgent: navigator.userAgent
        })
    });
}

function updateScreen() {
    const screen = document.getElementById('screen');
    const lines = screen.innerHTML.split('\n');
    const lastLine = lines[lines.length - 1];
    
    if (lastLine.startsWith('> ')) {
        lines[lines.length - 1] = `> ${currentInput}<span class="cursor">_</span>`;
    }
    
    screen.innerHTML = lines.join('\n');
}

async function handleEnter() {
    if (!inputEnabled || !currentInput.trim()) return;
    
    inputEnabled = false;
    const screen = document.getElementById('screen');
    
    const lines = screen.innerHTML.split('\n');
    lines[lines.length - 1] = `> ${currentInput}`;
    screen.innerHTML = lines.join('\n');
    
    const response = await fetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            visitor_id,
            prompt: currentInput
        })
    });
    
    const data = await response.json();
    
    screen.innerHTML += '\n';
    await typeWriter(data.answer);
    
    screen.innerHTML += '\n> <span class="cursor">_</span>';
    currentInput = '';
    inputEnabled = true;
    
    window.scrollTo(0, document.body.scrollHeight);
}

async function typeWriter(text) {
    const screen = document.getElementById('screen');
    for (let i = 0; i < text.length; i++) {
        screen.innerHTML = screen.innerHTML.slice(0, -28) + text[i] + '<span class="cursor">_</span>';
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    screen.innerHTML = screen.innerHTML.slice(0, -28);
}

document.addEventListener('keydown', async (e) => {
    if (!inputEnabled) return;
    
    if (e.key === 'Enter') {
        await handleEnter();
    } else if (e.key === 'Backspace') {
        currentInput = currentInput.slice(0, -1);
        updateScreen();
    } else if (e.key.length === 1) {
        currentInput += e.key;
        updateScreen();
    }
});

init();
