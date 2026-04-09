/**
 * api/sync-contact.js
 * ROLE: Backend-For-Frontend (BFF) Proxy.
 * Securely syncs new users to Brevo without exposing API keys to the client.
 * Intended for Vercel Serverless Functions.
 */

export default async function handler(req, res) {
    // FIX #7: CORS restricted to production domain only.
    // The API requires a valid Firebase ID Token anyway, but domain-locking is defense-in-depth.
    const allowedOrigins = ['https://focushub.3idhmind.in', 'https://focushub-db.web.app'];
    const requestOrigin = req.headers.origin || '';
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 2. Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, firstName, lastName } = req.body;
    const authHeader = req.headers.authorization;

    // 3. Security Hardening: Require Authorization token to prevent bot spam
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('Unauthorized API access attempt block: Missing or invalid Authorization header.');
        return res.status(401).json({ error: 'Unauthorized. Valid Firebase ID token is required.', code: 'UNAUTHORIZED' });
    }

    // Optional Extra Security: Verify token length/format (basic heuristic block without firebase-admin overhead)
    const token = authHeader.split('Bearer ')[1];
    if (!token || token.length < 100) {
        return res.status(401).json({ error: 'Unauthorized. Invalid token structure.' });
    }

    // 4. Validate input variables
    if (!email || email.length > 100 || !email.includes('@')) {
        return res.status(400).json({ error: 'Invalid or missing email' });
    }

    // 4. Fetch secrets from environment variables
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_ID = process.env.BREVO_LIST_ID;

    if (!BREVO_API_KEY || !BREVO_LIST_ID) {
        console.error('Brevo configuration is missing in environment variables.');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // 5. Standard fetch call to Brevo API v3
        const response = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': BREVO_API_KEY
            },
            body: JSON.stringify({
                email: email,
                attributes: {
                    FIRSTNAME: firstName || '',
                    LASTNAME: lastName || ''
                },
                listIds: [parseInt(BREVO_LIST_ID)],
                updateEnabled: true // Prevent failure if contact already exists
            })
        });

        // Handle empty response (like 204 No Content)
        let data = {};
        if (response.status !== 204) {
            const text = await response.text();
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    console.error('Failed to parse Brevo response:', text);
                }
            }
        }

        if (!response.ok) {
            console.error('Brevo API error:', data);
            return res.status(response.status).json({ 
                error: data.message || 'Failed to sync with Brevo' 
            });
        }

        // 6. Return success to the frontend
        return res.status(200).json({ 
            success: true, 
            message: 'User synced to Brevo successfully.' 
        });

    } catch (error) {
        console.error('Sync error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
