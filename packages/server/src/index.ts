import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { Pool } from 'pg';
import { RoomManager } from './rooms/RoomManager.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { InMemoryCampaignStore, PostgresCampaignStore, type CampaignStore } from './db/campaigns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: '*' },
});

let campaignStore: CampaignStore;
if (process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  campaignStore = new PostgresCampaignStore(pool);
  console.log('Regicide Legacy: using Postgres for campaign persistence.');
} else {
  campaignStore = new InMemoryCampaignStore();
  console.warn('Regicide Legacy: no DATABASE_URL set — campaign progress will NOT survive a server restart.');
}

const rooms = new RoomManager(campaignStore);

io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, rooms);
});

const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Regicide server listening on port ${PORT}`);
});
