require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for production and development
const allowedOrigins = [
  'https://news-app-jade-gamma.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// Environment variables
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const HF_API_KEY = process.env.HF_API_KEY;
const HF_API_URL = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';

// Original news proxy endpoint
app.get('/api/news', async (req, res) => {
  try {
    const { country, category, page, pageSize } = req.query;
    const url = `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${NEWS_API_KEY}&page=${page}&pageSize=${pageSize}`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('News API error:', error);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
});

// Summarization endpoint
app.post('/summarize', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Fetch article content
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    const html = response.data;
    
    // Extract main text content
    const text = extractMainText(html);
    
    // Summarize using Hugging Face API
    const summary = await summarizeWithHF(text);
    
    res.json({ summary });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Failed to generate summary. Please try another article.' });
  }
});

// Text extraction helper
function extractMainText(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1024);  // Limit to 1024 characters
}

// Hugging Face API helper
async function summarizeWithHF(text) {
  if (!text || text.length < 50) return 'Article content too short for summarization';
  
  try {
    const response = await axios.post(
      HF_API_URL,
      { inputs: text },
      {
        headers: { Authorization: `Bearer ${HF_API_KEY}` },
        timeout: 30000  // 30 seconds timeout
      }
    );
    
    return response.data[0]?.summary_text || 'Summary not available';
  } catch (error) {
    console.error('Hugging Face API error:', error);
    return 'Failed to generate summary. Please try again later.';
  }
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('News Proxy Server is running!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});