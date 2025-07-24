const express = require('express');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static('.'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

async function initDB() {
    try {
        await pool.query(`
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
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                visitor_id UUID REFERENCES visitors,
                ts TIMESTAMPTZ DEFAULT now(),
                prompt TEXT,
                answer TEXT
            )
        `);
        
        console.log('Database initialized');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

initDB();

app.post('/session', async (req, res) => {
    const { visitor_id, fpHash, geo, userAgent } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO visitors (visitor_id, fp_hash, ip, city, country, lat, lon, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (visitor_id) 
            DO UPDATE SET 
                last_seen = now(),
                fp_hash = EXCLUDED.fp_hash,
                ip = EXCLUDED.ip,
                city = EXCLUDED.city,
                country = EXCLUDED.country,
                lat = EXCLUDED.lat,
                lon = EXCLUDED.lon,
                user_agent = EXCLUDED.user_agent
        `, [visitor_id, fpHash, geo.query, geo.city, geo.country, geo.lat, geo.lon, userAgent]);
        
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Session creation failed' });
    }
});

app.post('/query', async (req, res) => {
    const { visitor_id, prompt } = req.body;
    
    try {
        const visitorResult = await pool.query(
            'SELECT * FROM visitors WHERE visitor_id = $1',
            [visitor_id]
        );
        const visitor = visitorResult.rows[0];
        
        const historyResult = await pool.query(
            'SELECT prompt, answer FROM conversations WHERE visitor_id = $1 ORDER BY ts DESC LIMIT 5',
            [visitor_id]
        );
        
        const systemPrompt = `You are an OSINT lab concierge helping researchers and investigators. You have access to visitor context:
Location: ${visitor.city}, ${visitor.country}
Coordinates: ${visitor.lat}, ${visitor.lon}
First seen: ${visitor.first_seen}
Previous conversations: ${historyResult.rows.length}

Provide helpful, accurate information about OSINT tools, techniques, and methodologies. Be concise and terminal-appropriate.`;

        const message = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });
        
        const answer = message.content[0].text;
        
        await pool.query(
            'INSERT INTO conversations (visitor_id, prompt, answer) VALUES ($1, $2, $3)',
            [visitor_id, prompt, answer]
        );
        
        res.json({ answer });
    } catch (error) {
        console.error(error);
        res.status(500).json({ answer: 'Error processing request.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`OSINT Lab Terminal running on port ${PORT}`);
});
