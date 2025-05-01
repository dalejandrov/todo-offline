import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT;

// MongoDB connection URI
const mongoURI = process.env.MONGO_URI;

// Connect to MongoDB
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Middleware
app.use(helmet());       // Security headers
app.use(cors());         // Enable CORS
app.use(express.json()); // Parse JSON bodies

// Define Todo schema and model
const todoSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  clientId: { type: String, index: true }
}, {
  timestamps: true
});

todoSchema.pre('save', function (next) {
  if (this.isModified('completed')) {
    this.completedAt = this.completed ? Date.now() : null;
  }
  next();
});

const Todo = mongoose.model('Todo', todoSchema);


app.get('/health', (req, res) => {
  res.status(200).json({
    message: 'UP'
  })
});

// --- CRUD Endpoints ---

// GET /todos
app.get('/todos', async (req, res) => {
  try {
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const total = await Todo.countDocuments();
    const data = await Todo.find()
      .select('-clientId')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ total, limit, skip, data });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: { code: 'FETCH_ERROR', message: err.message }
    });
  }
});


// POST /todos
app.post('/todos', async (req, res) => {
  const { text, completed } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({
      status: 'error',
      error: { code: 'VALIDATION_ERROR', message: 'text is required' }
    });
  }
  try {
    const todo = new Todo({
      text: text.trim(),
      completed: !!completed,
      completedAt: completed ? Date.now() : null
    });
    const saved = await todo.save();
    res.status(201).json({ status: 'success', todo: saved });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: { code: 'CREATE_ERROR', message: err.message }
    });
  }
});

// GET /todos/:id
app.get('/todos/:id', async (req, res) => {
  try {
    const todo = await Todo.findById(req.params.id);
    if (!todo) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Todo not found' }
      });
    }
    res.json({ status: 'success', todo });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: { code: 'FETCH_ERROR', message: err.message }
    });
  }
});

// PUT /todos/:id
app.put('/todos/:id', async (req, res) => {
  const { text, completed } = req.body;
  try {
    const todo = await Todo.findById(req.params.id);
    if (!todo) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Todo not found' }
      });
    }
    if (typeof text === 'string' && text.trim()) todo.text = text.trim();
    if (typeof completed === 'boolean') {
      todo.completed = completed;
      todo.completedAt = completed ? Date.now() : null;
    }
    const updated = await todo.save();
    res.json({ status: 'success', todo: updated });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: { code: 'UPDATE_ERROR', message: err.message }
    });
  }
});

// DELETE /todos/:id
app.delete('/todos/:id', async (req, res) => {
  try {
    const result = await Todo.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Todo not found' }
      });
    }
    res.json({ status: 'success', message: 'Todo deleted' });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: { code: 'DELETE_ERROR', message: err.message }
    });
  }
});

// --- POST /sync with partial_success logic ---
app.post('/sync', async (req, res) => {
  const { todos } = req.body;
  if (!Array.isArray(todos)) {
    return res.status(400).json({
      status: 'error',
      error: { code: 'INVALID_PAYLOAD', message: '`todos` must be an array' }
    });
  }

  const upsertPromises = todos.map(item => {
    if (
      typeof item.clientId !== 'string' || !item.clientId.trim() ||
      typeof item.text !== 'string' || !item.text.trim()
    ) {
      return Promise.resolve({
        clientId: item.clientId,
        operation: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'clientId and text are required'
        }
      });
    }
    return Todo.updateOne(
      { clientId: item.clientId },
      {
        text: item.text.trim(),
        completed: !!item.completed,
        completedAt: item.completed ? Date.now() : null,
        clientId: item.clientId
      },
      { upsert: true }
    )
      .then(async result => {
        let serverId, operation;
        if (result.upsertedCount > 0 && result.upsertedId) {
          serverId = result.upsertedId._id;
          operation = 'created';
        } else {
          const doc = await Todo.findOne({ clientId: item.clientId }).select('_id');
          serverId = doc ? doc._id : null;
          operation = 'updated';
        }
        return { clientId: item.clientId, operation, serverId };
      })
      .catch(err => ({
        clientId: item.clientId,
        operation: 'failed',
        error: {
          code: 'UPSERT_ERROR',
          message: err.message
        }
      }));
  });

  const results = await Promise.all(upsertPromises);

  const summary = {
    totalReceived: results.length,
    created: results.filter(r => r.operation === 'created').length,
    updated: results.filter(r => r.operation === 'updated').length,
    failed: results.filter(r => r.operation === 'failed').length
  };

  const allFailed = summary.failed === summary.totalReceived;
  const someFailed = summary.failed > 0 && !allFailed;

  let statusCode, statusText;
  if (allFailed) {
    statusCode = 400;
    statusText = 'error';
  } else if (someFailed) {
    statusCode = 207;
    statusText = 'partial_success';
  } else {
    statusCode = 200;
    statusText = 'success';
  }

  return res.status(statusCode).json({
    status: statusText,
    summary,
    results
  });
});

// Graceful shutdown
const server = app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));

async function gracefulShutdown(signal) {
  console.log(`\n🔒 Received ${signal}, shutting down...`);
  server.close();
  await mongoose.connection.close();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
