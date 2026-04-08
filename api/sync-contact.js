/**
 * api/sync-contact.js
 * ROLE: Backend-For-Frontend (BFF) Proxy.
 * Securely syncs new users to Brevo without exposing API keys to the client.
 * Intended for Vercel Serverless Functions.
 */

export default async function handler(req, res) {
    // 1. Basic CORS headers for the frontend
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
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

    // 3. Validate input
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
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
