const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Simple health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'OSINT Terminal is running!' });
});

// Only initialize DB if we have DATABASE_URL
let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    // Initialize database tables
    pool.query(`
        CREATE TABLE IF NOT EXISTS visitors (
            visitor_id UUID PRIMARY KEY,
            fp_hash TEXT,
            ip TEXT,
            city TEXT,
            country TEXT,
            lat NUMERIC,
            lon NUMERIC,
            user_agent TEXT,
            first_seen TIMESTAMPTZ DEFAULT now(),
            last_seen TIMESTAMPTZ DEFAULT now()
        )
    `).catch(err => console.log('Table might already exist:', err.message));
    
    pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
            id SERIAL PRIMARY KEY,
            visitor_id UUID REFERENCES visitors,
            ts TIMESTAMPTZ DEFAULT now(),
            prompt TEXT,
            answer TEXT
        )
    `).catch(err => console.log('Table might already exist:', err.message));
}

app.post('/session', async (req, res) => {
    const { visitor_id, fpHash, geo, userAgent } = req.body;
    
    if (!pool) {
        return res.json({ success: true, message: 'No database configured' });
    }
    
    try {
        await pool.query(`
            INSERT INTO visitors (visitor_id, fp_hash, ip, city, country, lat, lon, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (visitor_id) 
            DO UPDATE SET 
                last_seen = now(),
                fp_hash = EXCLUDED.fp_hash
        `, [visitor_id, fpHash, geo.query || 'unknown', geo.city || 'unknown', 
            geo.country || 'unknown', geo.lat || 0, geo.lon || 0, userAgent || 'unknown']);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Session error:', error);
        res.json({ success: true }); // Don't break the frontend
    }
});

app.post('/query', async (req, res) => {
    const { visitor_id, prompt } = req.body;
    
    // If no OpenAI key, return a helpful message
    if (!process.env.OPENAI_API_KEY) {
        return res.json({ 
            answer: "SYSTEM: OpenAI API key not configured. Add OPENAI_API_KEY to Railway environment variables." 
        });
    }
    
    try {
        // Lazy load OpenAI only when needed
        const OpenAI = require('openai');
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        let systemPrompt = "You are an OSINT lab concierge helping researchers and investigators. ";
        
        // Add visitor context if database is available
        if (pool) {
            try {
                const visitorResult = await pool.query(
                    'SELECT * FROM visitors WHERE visitor_id = $1',
                    [visitor_id]
                );
                const visitor = visitorResult.rows[0];
                if (visitor) {
                    systemPrompt += `Visitor from ${visitor.city}, ${visitor.country}. `;
                }
            } catch (err) {
                console.log('Could not fetch visitor info:', err.message);
            }
        }
        
        systemPrompt += "Provide helpful, accurate information about OSINT tools, techniques, and methodologies. Be concise and terminal-appropriate.";

        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            max_tokens: 500
        });
        
        const answer = completion.choices[0].message.content;
        
        // Store conversation if database is available
        if (pool) {
            try {
                await pool.query(
                    'INSERT INTO conversations (visitor_id, prompt, answer) VALUES ($1, $2, $3)',
                    [visitor_id, prompt, answer]
                );
            } catch (err) {
                console.log('Could not store conversation:', err.message);
            }
        }
        
        res.json({ answer });
    } catch (error) {
        console.error('Query error:', error);
        res.json({ 
            answer: `ERROR: ${error.message}. Check your OpenAI API key.` 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`OSINT Lab Terminal running on port ${PORT}`);
    console.log('Environment check:');
    console.log('- PORT:', PORT);
    console.log('- DATABASE_URL:', process.env.DATABASE_URL ? 'configured' : 'not configured');
    console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'configured' : 'not configured');
});
