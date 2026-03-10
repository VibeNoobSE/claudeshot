const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function createRoom(hostId, hostName, game) {
  const code = generateCode();
  rooms.set(code, {
    code,
    host: hostId,
    game: game || "snake",
    players: [{ id: hostId, name: hostName }],
    gameStarted: false
  });
  return rooms.get(code);
}

function joinRoom(code, playerId, playerName) {
  const room = rooms.get(code);
  if (!room) return { error: "Room not found." };
  if (room.gameStarted) return { error: "Game already in progress." };
  if (room.players.find((p) => p.id === playerId)) return room;
  room.players.push({ id: playerId, name: playerName });
  return room;
}

function rejoinRoom(code, newSocketId, playerName) {
  const room = rooms.get(code);
  if (!room) return { error: "Room not found." };

  const existing = room.players.find((p) => p.name === playerName);
  if (existing) {
    const wasHost = room.host === existing.id;
    existing.id = newSocketId;
    if (wasHost) room.host = newSocketId;
  } else {
    room.players.push({ id: newSocketId, name: playerName });
  }

  return room;
}

function leaveRoom(playerId) {
  for (const [code, room] of rooms) {
    const index = room.players.findIndex((p) => p.id === playerId);
    if (index === -1) continue;

    room.players.splice(index, 1);

    if (room.players.length === 0) {
      rooms.delete(code);
      return { code, disbanded: true };
    }

    if (room.host === playerId) {
      room.host = room.players[0].id;
    }

    return { code, room, disbanded: false };
  }
  return null;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function getRooms() {
  return rooms;
}

module.exports = { createRoom, joinRoom, rejoinRoom, leaveRoom, getRoom, getRooms };
