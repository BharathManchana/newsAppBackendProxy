require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const app = express();
const PORT = process.env.PORT || 5000;

// Create a cache for summaries with a TTL of 1 hour
const summaryCache = new NodeCache({ stdTTL: 60 * 60 });

// CORS configuration for production and development
const allowedOrigins = [
  'https://news-app-jade-gamma.vercel.app',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
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

// Track if Hugging Face model is ready
let hfReady = false;

// Rate limiter for summarization endpoint
const summarizationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many summarization requests, please try again later'
    });
  }
});

// Health check endpoint to warm up the model
app.get('/health', async (req, res) => {
  try {
    const testSummary = await summarizeWithHF("This is a test text to warm up the model.");
    hfReady = true;
    res.json({ status: 'ok', summary: testSummary });
  } catch (error) {
    hfReady = false;
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Original news proxy endpoint
app.get('/api/news', async (req, res) => {
  try {
    const { country, category, page, pageSize } = req.query;
    const url = `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${NEWS_API_KEY}&page=${page}&pageSize=${pageSize}`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('News API error:', error.message);
    res.status(500).json({ 
      error: 'Proxy error',
      details: error.message
    });
  }
});

// Summarization endpoint with rate limiting
app.post('/summarize', summarizationLimiter, async (req, res) => {
  try {
    const { url } = req.body;
    console.log(`Received summarization request for: ${url}`);
    
    // Check if we have a cached summary
    const cachedSummary = summaryCache.get(url);
    if (cachedSummary) {
      console.log(`Serving cached summary for: ${url}`);
      return res.json({ summary: cachedSummary });
    }

    // Check if model is ready
    if (!hfReady) {
      return res.status(503).json({ 
        error: 'AI model is still loading. Please try again in 30 seconds.' 
      });
    }

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
    
    // Summarize using Hugging Face API or fallback
    let summary;
    try {
      summary = await summarizeWithHF(text);
    } catch (hfError) {
      console.error('Hugging Face summarization failed, using fallback:', hfError);
      summary = fallbackSummary(text);
    }
    
    // Cache the summary
    summaryCache.set(url, summary);
    res.json({ summary });
  } catch (error) {
    console.error('Summary error details:', {
      message: error.message,
      stack: error.stack,
      url: req.body.url,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ 
      error: 'Failed to generate summary. Please try another article.',
      details: error.message
    });
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
  if (!text || text.length < 50) {
    return 'Article content too short for summarization';
  }
  
  try {
    const response = await axios.post(
      HF_API_URL,
      { inputs: text },
      {
        headers: { Authorization: `Bearer ${HF_API_KEY}` },
        timeout: 30000  // 30 seconds timeout
      }
    );
    
    if (response.data && response.data[0] && response.data[0].summary_text) {
      return response.data[0].summary_text;
    } else {
      throw new Error('Summary not available from Hugging Face');
    }
  } catch (error) {
    console.error('Hugging Face API error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      textSnippet: text?.substring(0, 100)
    });
    
    // Instead of returning a string, throw to trigger fallback
    throw error;
  }
}

// Fallback summarization using extractive method
function fallbackSummary(text, sentences = 3) {
  if (!text) return 'No content available for summarization.';
  
  const sentenceList = text.split(/(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|\!)\s/g);
  
  if (sentenceList.length <= sentences) return text;
  
  return sentenceList.slice(0, sentences).join(' ');
}

// Root endpoint
app.get('/', (req, res) => {
  res.send('News Proxy Server is running!');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  
  // Attempt to warm up the model on startup
  setTimeout(() => {
    axios.get(`http://localhost:${PORT}/health`)
      .then(response => console.log('Model warmup:', response.data))
      .catch(error => console.error('Model warmup failed:', error.message));
  }, 5000);
});
