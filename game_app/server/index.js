const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const compression = require("compression");

const app = express();
app.use(compression());
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const choices = ["rock", "paper", "scissors"];
const rooms = {};
const tournaments = {};

let leaderboardCache = null;
let cacheTimeout = null;

function invalidateCache() {
  leaderboardCache = null;
  if (cacheTimeout) {
    clearTimeout(cacheTimeout);
  }
}

function getCachedLboard() {
  if (!leaderboardCache) {
    leaderboardCache = Object.entries(leaderboard)
      .sort((a, b) => b[1].wins - a[1].wins)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
    cacheTimeout = setTimeout(() => { leaderboardCache = null; }, 2000);
  }
  return leaderboardCache;
}

function loadData() {
  try {
    if (fs.existsSync("data.json")) {
      const raw = fs.readFileSync("data.json", "utf-8");
      return JSON.parse(raw);
    }
  }
  catch (e) {
    console.log("upload err", e.message);
  }
  return { leaderboard: {}, matchHistory: [] };
}

function saveData() {
  try {
    fs.writeFileSync("data.json", JSON.stringify({ leaderboard, matchHistory }, null, 2));
  }
  catch (e) {
    console.log("save err", e.message);
  }
}

const { leaderboard, matchHistory } = loadData();

function getPCChoice() {
  return choices[Math.floor(choices.length * Math.random())];
}

function Result(player, computer) {
  if (player === computer) {
    return "draw";
  }
  if (
    (player === "rock" && computer === "scissors") ||
    (player === "scissors" && computer === "paper") ||
    (player === "paper" && computer === "rock")) {
    return "win";
  }
  return "lose";
}

function updateLeaderboard(username, result) {
  if (!leaderboard[username]) {
    leaderboard[username] = { wins: 0, losses: 0, draws: 0 };
  }
  if (result === "win") leaderboard[username].wins++;
  if (result === "lose") leaderboard[username].losses++;
  if (result === "draw") leaderboard[username].draws++;
  invalidateCache();
}

function saveMatch(p1, p2, ch1, ch2, res) {
  const match = {
    id: Date.now(),
    date: new Date().toLocaleDateString("uk-UA"),
    p1, p2, ch1, ch2,
    winner: res === "win" ? p1 : res === "lose" ? p2 : "draw",
  };
  matchHistory.push(match);
  saveData();
  return match;
}

function createTournament(players) {
  const id = `tournament_${Date.now()}`;
  tournaments[id] = {
    id,
    players: players.map((p) => p.username),
    matches: [],
    results: {},
    round: 1,
    pairs: [
      [players[0], players[1]],
      [players[2], players[3]],
    ],
    winners: [],
    status: "semifinal",
  };
  return tournaments[id];
}

function handleTournamentMatch(tournamentId, winner, loser) {
  const tournament = tournaments[tournamentId];
  if (!tournament) return;

  tournament.winners.push(winner);
  tournament.matches.push({ winner: winner.username, loser: loser.username });

  if (tournament.winners.length === 2 && tournament.status === "semifinal") {
    tournament.status = "final";
    const [w1, w2] = tournament.winners;

    tournament.matches.forEach((m) => {
      saveMatch(m.winner, m.loser, "semifinal", "semifinal", "win");
      updateLeaderboard(m.winner, "win");
      updateLeaderboard(m.loser, "lose");
    });

    w1.emit("tournamentFinal", { opponent: w2.username });
    w2.emit("tournamentFinal", { opponent: w1.username });

    tournament.players.forEach((username) => {
      if (username !== w1.username && username !== w2.username) {
        const loserSocket = [...io.sockets.sockets.values()].find(
          (s) => s.username === username
        );
        if (loserSocket) loserSocket.emit("tournamentEliminated", "Ви вибули з турніру");
      }
    });

    io.emit("leaderboard", getCachedLboard());
    tournament.finalPair = [w1, w2];
    tournament.finalChoices = {};
  }

  if (tournament.winners.length === 3 && tournament.status === "final") {
    // const champion = tournament.winners[2];
    tournament.status = "finished";

    saveMatch(winner.username, loser.username, "final", "final", "win");
    updateLeaderboard(winner.username, "win");
    updateLeaderboard(loser.username, "lose");

    tournament.players.forEach((username) => {
      const playerSocket = [...io.sockets.sockets.values()].find(
        (s) => s.username === username
      );
      if (playerSocket) {
        playerSocket.emit("tournamentEnd", {
          champion: winner.username,
          matches: tournament.matches,
        });
        const userHistory = matchHistory.filter(
          (m) => m.p1 === username || m.p2 === username
        );
        playerSocket.emit("matchHistory", userHistory);
      }
    });

    io.emit("leaderboard", getCachedLboard());
    delete tournaments[tournamentId];
  }
}

io.on("connection", (socket) => {
  console.log("Гравець підключився:", socket.id);

  socket.on("register", (username) => {
    socket.username = username;
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, draws: 0 };
    }
    socket.emit("registered", leaderboard[username]);
    io.emit("leaderboard", getCachedLboard());

    const userHistory = matchHistory.filter(
      (m) => m.p1 === username || m.p2 === username
    );
    socket.emit("matchHistory", userHistory);

    const activeTournaments = Object.values(tournaments).map((t) => ({
      id: t.id,
      players: t.players,
      status: t.status,
    }));

    socket.emit("tournaments", activeTournaments);
  });

  socket.on("playVsPC", (playerChoice) => {
    const computerChoice = getPCChoice();
    const result = Result(playerChoice, computerChoice);
    updateLeaderboard(socket.username, result);
    const match = saveMatch(socket.username, "PC", playerChoice, computerChoice, result);
    socket.emit("gameResult", { playerChoice, computerChoice, result });

    const userHistory = matchHistory.filter(
      (m) => m.p1 === socket.username || m.p2 === socket.username
    );
    socket.emit("matchHistory", userHistory);
    io.emit("leaderboard", getCachedLboard());
  });

  socket.on("findGame", () => {
    const waitingRoom = Object.values(rooms).find(
      (r) => r.players.length === 1
    );

    if (waitingRoom) {
      waitingRoom.players.push(socket);
      socket.roomId = waitingRoom.id;
      socket.join(waitingRoom.id);
      io.to(waitingRoom.id).emit("gameStart", {
        opponent: waitingRoom.players[0].username,
      });
    } else {
      const roomId = `room_${Date.now()}`;
      rooms[roomId] = { id: roomId, players: [socket], choices: {} };
      socket.roomId = roomId;
      socket.join(roomId);
      socket.emit("waiting", "чекаємо суперника");
    }
  });

  socket.on("makeChoice", (choice) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    room.choices[socket.username] = choice;

    if (Object.keys(room.choices).length === 2) {
      const [p1, p2] = room.players;
      const result1 = Result(room.choices[p1.username], room.choices[p2.username]);
      const result2 = Result(room.choices[p2.username], room.choices[p1.username]);

      updateLeaderboard(p1.username, result1);
      updateLeaderboard(p2.username, result2);

      saveMatch(
        p1.username, p2.username,
        room.choices[p1.username],
        room.choices[p2.username],
        result1
      );

      p1.emit("gameResult", {
        playerChoice: room.choices[p1.username],
        computerChoice: room.choices[p2.username],
        result: result1,
        opponent: p2.username,
      });
      p2.emit("gameResult", {
        playerChoice: room.choices[p2.username],
        computerChoice: room.choices[p1.username],
        result: result2,
        opponent: p1.username,
      });

      [p1, p2].forEach((p) => {
        const userHistory = matchHistory.filter(
          (m) => m.p1 === p.username || m.p2 === p.username
        );
        p.emit("matchHistory", userHistory);
      });

      io.emit("leaderboard", getCachedLboard());
      delete rooms[socket.roomId];
    }
  });

  socket.on("createTournament", () => {
    const existingTournament = Object
      .values(tournaments)
      .find(
        (t) => t.status === "waiting" || t.status === "semifinal"
      );

    if (existingTournament && existingTournament.status === "waiting") {
      if (!existingTournament.waitingPlayers.includes(socket)) {
        existingTournament.waitingPlayers.push(socket);
        socket.tournamentId = existingTournament.id;

        io.emit("tournamentUpdate", {
          id: existingTournament.id,
          playersCount: existingTournament.waitingPlayers.length,
          needed: 4,
        });

        if (existingTournament.waitingPlayers.length === 4) {
          const tournament = createTournament(existingTournament.waitingPlayers);
          delete tournaments[existingTournament.id];

          tournament.pairs.forEach(([pa, pb]) => {
            pa.tournamentId = tournament.id;
            pb.tournamentId = tournament.id;
            pa.emit("tournamentStart", { opponent: pb.username, tournamentId: tournament.id });
            pb.emit("tournamentStart", { opponent: pa.username, tournamentId: tournament.id });
          });
        }
      }
    }

    else {
      const waitId = `wait_${Date.now()}`;
      tournaments[waitId] = {
        id: waitId,
        status: "waiting",
        waitingPlayers: [socket],
      };
      socket.tournamentId = waitId;

      socket.emit("tournamentWaiting", { playersCount: 1, needed: 4 });
      io.emit("tournamentUpdate", { id: waitId, playersCount: 1, needed: 4 });
    }
  });

  socket.on("tournamentChoice", (choice) => {
    const tournamentId = socket.tournamentId;
    const tournament = tournaments[tournamentId];
    if (!tournament) return;

    if (tournament.status === "semifinal") {
      const pair = tournament.pairs.find(
        ([a, b]) => a.id === socket.id || b.id === socket.id
      );
      if (!pair) return;

      if (!tournament.semiChoices) tournament.semiChoices = {};
      tournament.semiChoices[socket.username] = { choice, socket };

      const [pa, pb] = pair;
      if (
        tournament.semiChoices[pa.username] &&
        tournament.semiChoices[pb.username]
      ) {
        const choiceA = tournament.semiChoices[pa.username].choice;
        const choiceB = tournament.semiChoices[pb.username].choice;
        const res = Result(choiceA, choiceB);

        const winner = res === "win" ? pa : res === "lose" ? pb : pa;
        const loser = winner === pa ? pb : pa;

        pa.emit("tournamentMatchResult", {
          result: res,
          playerChoice: choiceA,
          opponentChoice: choiceB,
          advancing: winner.username === pa.username,
        });
        pb.emit("tournamentMatchResult", {
          result: res === "win" ? "lose" : res === "lose" ? "win" : "draw",
          playerChoice: choiceB,
          opponentChoice: choiceA,
          advancing: winner.username === pb.username,
        });

        handleTournamentMatch(tournamentId, winner, loser);
      }
    } else if (tournament.status === "final") {
      if (!tournament.finalChoices) tournament.finalChoices = {};
      tournament.finalChoices[socket.username] = choice;

      const [fw1, fw2] = tournament.finalPair;
      if (tournament.finalChoices[fw1.username] && tournament.finalChoices[fw2.username]) {
        const choiceA = tournament.finalChoices[fw1.username];
        const choiceB = tournament.finalChoices[fw2.username];
        const res = Result(choiceA, choiceB);

        const winner = res === "win" ? fw1 : res === "lose" ? fw2 : fw1;
        const loser = winner === fw1 ? fw2 : fw1;

        fw1.emit("tournamentMatchResult", {
          result: res,
          playerChoice: choiceA,
          opponentChoice: choiceB,
          advancing: winner.username === fw1.username,
          isFinal: true,
        });
        fw2.emit("tournamentMatchResult", {
          result: res === "win" ? "lose" : res === "lose" ? "win" : "draw",
          playerChoice: choiceB,
          opponentChoice: choiceA,
          advancing: winner.username === fw2.username,
          isFinal: true,
        });

        // tournament.winners.push(winner);
        handleTournamentMatch(tournamentId, winner, loser);
      }
    }
  });


  socket.on("disconnect", () => {
    console.log("гравець відключився ", socket.id);
    const room = rooms[socket.roomId];
    if (room) {
      const opponent = room.players.find((p) => p.id !== socket.id);
      if (opponent) opponent.emit("opponentLeft", "суперник відключився");
      delete rooms[socket.roomId];
    }
    io.emit("leaderboard", getCachedLboard());
  });
});

app.get("/play", (req, res) => {
  const playerChoice = req.query.choice;
  if (!choices.includes(playerChoice)) {
    return res.status(400).json({ error: "неправильний вибір" });
  }

  const computerChoice = getPCChoice();
  const result = Result(playerChoice, computerChoice);
  res.json({ playerChoice, computerChoice, result });
});

app.get("/stats", (req, res) => {
  res.json({
    totalPlayers: Object.keys(leaderboard).length,
    totalMatches: matchHistory.length,
    activeTournaments: Object.keys(tournaments).length,
  });
});

server.listen(3001, () => {
  console.log("started")
});