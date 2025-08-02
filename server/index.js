// Express server for QA Management Tool
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const recentSubmissions = new Map(); // ✅ Declare early to avoid ReferenceError

const app = express();
const port = process.env.PORT || 5000;

// PostgreSQL connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());



// Storage for image uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${file.originalname}`;
    cb(null, unique);
  },
});
const upload = multer({ storage });

// Serve static files
app.use('/uploads', express.static(uploadDir));

// --- ROUTES --- //

// 🔐 Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });
    delete user.password_hash;
    res.json(user);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🐞 Get all issues
app.get('/api/issues', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM issues ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ➕ Create new issue
app.post('/api/issues', async (req, res) => {
  const {
    summary,
    description,
    type,
    priority,
    tags,
    assignee,
    created_by,
    status = 'Open',
    image_urls = []
  } = req.body;

  const key = `${created_by}:${summary.trim().toLowerCase()}`;
  const now = Date.now();
  const prev = recentSubmissions.get(key);
  const currentDesc = (description || '').trim();

  if (prev && (now - prev.timestamp < 3000)) {
    const previousDesc = prev.description || '';

    // 🧠 Block only if the previous one had more or equal content
    if (
      previousDesc.length >= currentDesc.length ||
      currentDesc.length < 10 // optional minimum quality threshold
    ) {
      console.warn("⏱️ Duplicate submission blocked:", key);
      return res.status(429).json({ error: 'Duplicate submission blocked. Please wait a moment.' });
    }
  }

  // ✅ Save this attempt
  recentSubmissions.set(key, {
    timestamp: now,
    description: currentDesc
  });

  try {
    const numberResult = await pool.query(
      `UPDATE issues_counter SET last_number = last_number + 1 RETURNING last_number`
    );
    const next = numberResult.rows[0].last_number;
    const issue_number = `MT-${next.toString().padStart(7, '0')}`;
    console.log('🆕 New issue_number generated:', issue_number);

    const result = await pool.query(
      `INSERT INTO issues 
        (summary, description, type, priority, tags, assignee, created_by, status, image_urls, issue_number)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        summary,
        description,
        type,
        priority,
        tags,
        assignee || null,
        created_by,
        status,
        image_urls,
        issue_number
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      console.error('❗ Duplicate issue_number detected by DB');
      return res.status(409).json({ error: 'Duplicate issue_number, try again.' });
    }
    console.error('❌ Error creating issue:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/issues/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error fetching issue by ID:', err);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
});

// ✏️ Update existing issue
app.put('/api/issues/:id', async (req, res) => {
  const { id } = req.params;
  const {
    summary,
    description,
    type,
    priority,
    status,
    tags,
    assignee,
    image_urls = []
  } = req.body;

  try {
    await pool.query(
      `UPDATE issues SET 
        summary = $1,
        description = $2,
        type = $3,
        priority = $4,
        status = $5,
        tags = $6,
        assignee = $7,
        image_urls = $8
       WHERE id = $9`,
      [
        summary,
        description,
        type,
        priority,
        status,
        tags,
        assignee || null,
        image_urls, // ✅ send as array, not JSON string
        id
      ]
    );

    res.json({ message: 'Issue updated successfully' });
  } catch (err) {
    console.error('❌ Error updating issue:', err);
    res.status(500).json({ error: 'Internal server error while updating issue' });
  }
});


// 📤 Upload Image
app.post('/api/upload', upload.single('file'), (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url });
});

// 💬 Get Comments for Issue
app.get('/api/comments', async (req, res) => {
  const { issue_id } = req.query;
  try {
    const result = await pool.query('SELECT * FROM comments WHERE issue_id = $1 ORDER BY created_at ASC', [issue_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch comments error:', err);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// 💬 Add Comment
app.post('/api/comments', async (req, res) => {
  const { issue_id, parent_id = null, text, created_by } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO comments (issue_id, parent_id, text, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [issue_id, parent_id, text, created_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Insert comment error:', err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ✏️ Update Comment
app.put('/api/comments/:id', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  try {
    await pool.query('UPDATE comments SET text = $1 WHERE id = $2', [text, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update comment error:', err);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// ❌ Delete Comment
app.delete('/api/comments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM comments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// 🎨 Get tag-color map
app.get('/api/tag-colors', async (req, res) => {
  try {
    const result = await pool.query('SELECT tag, color FROM tag_colors');
    const tagColorMap = {};
    result.rows.forEach(row => {
      tagColorMap[row.tag.toLowerCase()] = row.color;
    });
    res.json(tagColorMap);
  } catch (err) {
    console.error('Tag color fetch error:', err);
    res.status(500).json({ error: 'Failed to load tag colors' });
  }
});

// ✅ Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});