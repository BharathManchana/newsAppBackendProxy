const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// For first deploy: allow all origins. After frontend is live, lock this down!
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*"
  })
);

app.get('/api/news', async (req, res) => {
  try {
    const { country, category, page, pageSize } = req.query;
    const url = `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${process.env.NEWS_API_KEY}&page=${page}&pageSize=${pageSize}`;
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('News Proxy Server is running!');
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});