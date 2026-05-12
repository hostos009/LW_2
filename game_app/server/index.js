// підключаємо сервер, запити з іншого порту, 
// модуль http, веб-сокети, роботу з файлами
//  та стиснення відповідей

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const compression = require("compression");

// створюємо http сервер з використанням express 
// і socket.io (він потребує доступу до http серверу)

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

// масив варіантів та об'єкти кімнат та турнірів
const choices = ["rock", "paper", "scissors"];
const rooms = {};
const tournaments = {};

// оптимізація з 4 рівня, для 50 гравців сервер 
// не буде сортувати 50 разів статистику лідерборду, 
// він буде сортувати 1 раз на 2 секунди і відповідати 
// всім одним результатом


// створюємо змінні кешу
let leaderboardCache = null;
let cacheTimeout = null;

// скидаємо кеш, після гри, для нового підрахунку лідерборду
function invalidateCache() {
  leaderboardCache = null;
  // очищуємо таймаут
  if (cacheTimeout) {
    clearTimeout(cacheTimeout);
  }
}

// сорування лідерборду
function getCachedLboard() {
  // перевіряємо кеш, якщо він порожній, рахуємо
  if (!leaderboardCache) {
    // перетворюємо об'єкт в масив пар, 
    // сортуємо масив за кількістю перемог 
    // та перетворюємо його назад в об'єкт 
    // (на вході накопичений об'єкт, деструктуризований елемент масиву,
    // на виході новий об'єкт, який накопичує значення з акумулятору 
    // і додає нові записи з ключем і значенням)
    leaderboardCache = Object.entries(leaderboard)
      .sort((a, b) => b[1].wins - a[1].wins)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
    // таймер на 2 сек для скидання кешу
    cacheTimeout = setTimeout(() => { leaderboardCache = null; }, 2000);
  }
  // повертаємо результат
  return leaderboardCache;
}

// зчитування даних
function loadData() {
  try {
    // перевіряємо існування файлу
    if (fs.existsSync("data.json")) {
      // читаємо дані з файлу у форматі юнікоду
      //Sync це синхронна операція, 
      // сервер зачекає повне читання файлу, перед наступними діями
      // повертаємо об'єкт
      const raw = fs.readFileSync("data.json", "utf-8");
      return JSON.parse(raw);
    }
  }
  // при помилці поввідомляємо про це
  catch (e) {
    console.log("upload err", e.message);
  }
  // при відсутності файлу, повертаємо чистий лідерборд і історію
  return { leaderboard: {}, matchHistory: [] };
}

// збереження даних
function saveData() {
  try {
    // записуємо дані в файл, в синхронному форматі
    // записуємо дані, перше - що записувати, друге
    // - дозволяє фільтрувати всі поля, 
    // третє - табуляція форматування
    fs.writeFileSync("data.json", JSON.stringify({ leaderboard, matchHistory }, null, 2));
  }
  catch (e) {
    // повертаємо помилку
    console.log("save err", e.message);
  }
}

// завантажуємо дані
const { leaderboard, matchHistory } = loadData();

// вибір для пк
function getPCChoice() {
  // повертаємо елемент масиву з індексом 
  // (індекс - округлення вниз результату 
  // множення довжини масиву виборів на число від [0;1))
  return choices[Math.floor(choices.length * Math.random())];
}

// функція логіки гри
function Result(player, computer) {
  // порівнюємо обрані результати, 
  // для кожного повертаємо своє значення 
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

// оновлення лідерборду
function updateLeaderboard(username, result) {
  // якщо перше входження користувача 
  // - створюємо запис для користувача
  if (!leaderboard[username]) {
    leaderboard[username] = { wins: 0, losses: 0, draws: 0 };
  }
  // для кожного результату додаємо +1 в лічильник
  // 
  if (result === "win") leaderboard[username].wins++;
  if (result === "lose") leaderboard[username].losses++;
  if (result === "draw") leaderboard[username].draws++;
  // скидаємо кеш
  invalidateCache();
}

// зберігаємо результати матчу
function saveMatch(p1, p2, ch1, ch2, res) {
  // створюємо об'єкт матчу
  const match = {
    id: Date.now(),
    date: new Date().toLocaleDateString("uk-UA"),
    p1, p2, ch1, ch2,
    winner: res === "win" ? p1 : res === "lose" ? p2 : "draw",
  };
  // пушимо в історію матчів, зберігаємо дані та повертаємо об'єкт
  matchHistory.push(match);
  saveData();
  return match;
}

// створення турніру
function createTournament(players) {
  // створюємо номкр турніру
  const id = `tournament_${Date.now()}`;
  // записуємо в масив новий турнір
  // передаємо номер, за допомогою 
  // мап витягуємо ніки гравців з сокетів, 
  // порожні контейнери матчів та результатів, 
  // номер раунду, пари півфіналів, 
  // переможців ігор і статус турніру
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
  // повертаємо об'єкт турніру
  return tournaments[id];
}

// функція-менеджер турніру
function handleTournamentMatch(tournamentId, winner, loser) {
  // записуємо поточний турнір
  const tournament = tournaments[tournamentId];
  if (!tournament) return;

  //додаємо сокет поточного переможця 
  // до загального списку переможців турнірц
  //та записуємо ніки учасників матчу у 
  // локальну статистику турніру для демонстрації в кінці
  tournament.winners.push(winner);
  tournament.matches.push({ winner: winner.username, loser: loser.username });

  // перевіряємо на завершення півфіналів
  if (tournament.winners.length === 2 && tournament.status === "semifinal") {
    // змінюємо статус, розпаковуємо фіналістів
    tournament.status = "final";
    const [w1, w2] = tournament.winners;

    // проходимо циклом по півфіналах
    // зберігаємо матчі в файл, перераховуємо лідерборд
    tournament.matches.forEach((m) => {
      saveMatch(m.winner, m.loser, "semifinal", "semifinal", "win");
      updateLeaderboard(m.winner, "win");
      updateLeaderboard(m.loser, "lose");
    });

    // повідомляємо фіналістів про нового суперника
    w1.emit("tournamentFinal", { opponent: w2.username });
    w2.emit("tournamentFinal", { opponent: w1.username });

    // проходимось по всіх учасниках
    tournament.players.forEach((username) => {
      // відсіюємо програвших у півфіналах
      if (username !== w1.username && username !== w2.username) {
        // шукаємо серед всіх активних 
        // підключень конкретне підключення гравця за ніком
        const loserSocket = [...io.sockets.sockets.values()].find(
          (s) => s.username === username
        );
        // якщо гравець онлайн, надсилаємо йому повідомлення про програш
        if (loserSocket) loserSocket.emit("tournamentEliminated", "Ви вибули з турніру");
      }
    });

    // сповіщаємо гравців на сервері про оновлення лідерборду
    io.emit("leaderboard", getCachedLboard());
    // зберігаємо фіналістів 
    // та готуємо порожній об'єкт для виборів в фіналі
    tournament.finalPair = [w1, w2];
    tournament.finalChoices = {};
  }

  // перевірка на завершення фіналу
  if (tournament.winners.length === 3 && tournament.status === "final") {
    // const champion = tournament.winners[2];

    // змінюємо статус турніру
    tournament.status = "finished";

    // зберігаємо результат, оновлюємо рейтинги
    saveMatch(winner.username, loser.username, "final", "final", "win");
    updateLeaderboard(winner.username, "win");
    updateLeaderboard(loser.username, "lose");

    // перебираємо всіх учасників турніру
    tournament.players.forEach((username) => {
      // знаходимо їх з'єднання
      const playerSocket = [...io.sockets.sockets.values()].find(
        (s) => s.username === username
      );
      // надсилаємо йому результати турніру
      if (playerSocket) {
        playerSocket.emit("tournamentEnd", {
          champion: winner.username,
          matches: tournament.matches,
        });
        const userHistory = matchHistory.filter(
          (m) => m.p1 === username || m.p2 === username
        );
        // надсилаємоо оновлену історію ігор
        playerSocket.emit("matchHistory", userHistory);
      }
    });

    // розсилаємо оновлену статистику
    io.emit("leaderboard", getCachedLboard());
    // видаляємо всі дані турніру з пам'яті сервера
    delete tournaments[tournamentId];
  }
}

// обробка подій 
io.on("connection", (socket) => {
  console.log("Гравець підключився:", socket.id);

  // подія регістрації
  socket.on("register", (username) => {
    // прив'язуємо ім'я до сокета
    socket.username = username;
    // якщо такого гравця не існувало 
    // створюємо новий запис для лідерборду
    if (!leaderboard[username]) {
      leaderboard[username] = { wins: 0, losses: 0, draws: 0 };
    }
    // надсилаємо гравцю повідомлення про успішну реєстрацію
    socket.emit("registered", leaderboard[username]);
    // оновлюємо глобальну статистику
    io.emit("leaderboard", getCachedLboard());

    // формуємо історію ігор гравця, залишаємо матчі де був гравець 
    const userHistory = matchHistory.filter(
      (m) => m.p1 === username || m.p2 === username
    );
    //відправляємо гравцю його історію ігор
    socket.emit("matchHistory", userHistory);

    // перетворюємо об'єкт турнірів в масив
    // проходимось мапом, формуємо новий об'єкт 
    // з номером, списком учасників та поточним станом
    const activeTournaments = Object.values(tournaments).map((t) => ({
      id: t.id,
      players: t.players,
      status: t.status,
    }));

    // надсилаємо користувачу
    socket.emit("tournaments", activeTournaments);
  });

  // подія гри проти пк
  socket.on("playVsPC", (playerChoice) => {
    // отримуємо хід пк
    const computerChoice = getPCChoice();
    // викликаємо функцію результату гри для даних користувача і пк
    const result = Result(playerChoice, computerChoice);
    // оновлюємо лідерборд
    updateLeaderboard(socket.username, result);
    // фіксуємо матч в історії иа записуємо в файл
    const match = saveMatch(socket.username, "PC", playerChoice, computerChoice, result);
    // відправляємо результат гравцю
    socket.emit("gameResult", { playerChoice, computerChoice, result });

    //фільтруємо нову статистику та відправляємо користувачу
    // оновлюємо лідерборд
    const userHistory = matchHistory.filter(
      (m) => m.p1 === socket.username || m.p2 === socket.username
    );
    socket.emit("matchHistory", userHistory);
    io.emit("leaderboard", getCachedLboard());
  });


  // подія матчмейкінгу
  socket.on("findGame", () => {
    // при натисканні на кнопку пошуку гри 
    // сервер перетворює глобальний об'єкт кімнат
    // на масив і шукає кімнату, де 1 гравець
    const waitingRoom = Object.values(rooms).find(
      (r) => r.players.length === 1
    );

    //якщо знайдено
    if (waitingRoom) {
      // додаємо підключення гравця у масив гравців
      waitingRoom.players.push(socket);
      // зберігаємо айді кімнати в об'єкт сокета поточного гравця
      socket.roomId = waitingRoom.id;
      // підключаємо гравця до віртуальної кімнати
      socket.join(waitingRoom.id);
      // надсилаємо подію початку гри 
      // гравцям, що є в цій кімнаті
      io.to(waitingRoom.id).emit("gameStart", {
        opponent: waitingRoom.players[0].username,
      });
    }
    // якщо кімнати немає
    else {
      // створюємо айді нової кімнати
      const roomId = `room_${Date.now()}`;
      // створюємо новий об'єкт в пам'яті сервера 
      // і записуємо туди гравця
      rooms[roomId] = { id: roomId, players: [socket], choices: {} };
      // запам'ятовуємо нову кімнату 
      socket.roomId = roomId;
      socket.join(roomId);
      // надсилаємо повідомлення гравцю про очікування
      socket.emit("waiting", "чекаємо суперника");
    }
  });

  //обробка ходів в 1ч1
  socket.on("makeChoice", (choice) => {
    // перевірка на існування кімнати
    const room = rooms[socket.roomId];
    if (!room) return;

    // записуємо вибір гравця у словник об'єкта
    room.choices[socket.username] = choice;

    // якщо 2 зробили хід
    if (Object.keys(room.choices).length === 2) {
      // записуємо сокети обох гравців
      const [p1, p2] = room.players;

      // розраховуємо результати
      const result1 = Result(room.choices[p1.username], room.choices[p2.username]);
      const result2 = Result(room.choices[p2.username], room.choices[p1.username]);

      // оновлюємо лідерборд для гравців 
      // і записуємо матч в історію в файлі
      updateLeaderboard(p1.username, result1);
      updateLeaderboard(p2.username, result2);

      saveMatch(
        p1.username, p2.username,
        room.choices[p1.username],
        room.choices[p2.username],
        result1
      );

      // надсилаємо результати гравцям
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

      // оновлюємо історію ігор юзерів
      [p1, p2].forEach((p) => {
        const userHistory = matchHistory.filter(
          (m) => m.p1 === p.username || m.p2 === p.username
        );
        p.emit("matchHistory", userHistory);
      });

      //оновлюємо лідерборд для всіх
      io.emit("leaderboard", getCachedLboard());
      delete rooms[socket.roomId];
    }
  });

  // створення турніру
  socket.on("createTournament", () => {
    // при натисканні на кнопку турніру, 
    // перевіряємо існуючі турніри, шукаємо 
    // зі статусом чекаємо або півфінал
    const existingTournament = Object
      .values(tournaments)
      .find(
        (t) => t.status === "waiting" || t.status === "semifinal"
      );

    // якщо знайдено потрібну кімнату
    if (existingTournament && existingTournament.status === "waiting") {
      // перевіряємо чи не сидить гравець в цій кімнаті
      if (!existingTournament.waitingPlayers.includes(socket)) {
        // додаємо сокет гравця у масив, 
        // прив'язуємо айді турніру до сокетв гравця
        existingTournament.waitingPlayers.push(socket);
        socket.tournamentId = existingTournament.id;

        // повідомляємо всіх підключених про зміну кількості гравців
        io.emit("tournamentUpdate", {
          id: existingTournament.id,
          playersCount: existingTournament.waitingPlayers.length,
          needed: 4,
        });

        // якщо набралось 4 гравця
        if (existingTournament.waitingPlayers.length === 4) {
          // створюємо новий турнір з 4 гравців, формуємо пари
          // та видаляємо кімнату очікування
          const tournament = createTournament(existingTournament.waitingPlayers);
          delete tournaments[existingTournament.id];

          // проходимось по парах
          tournament.pairs.forEach(([pa, pb]) => {
            // оновлюємо айді турніру і 
            // надсилаємо подію початку турніру гравцям
            pa.tournamentId = tournament.id;
            pb.tournamentId = tournament.id;
            pa.emit("tournamentStart", { opponent: pb.username, tournamentId: tournament.id });
            pb.emit("tournamentStart", { opponent: pa.username, tournamentId: tournament.id });
          });
        }
      }
    }
    // якщо турніру немає 
    else {
      //створюємо нову кімнату очікування
      const waitId = `wait_${Date.now()}`;
      tournaments[waitId] = {
        id: waitId,
        status: "waiting",
        waitingPlayers: [socket],
      };
      socket.tournamentId = waitId;
      // повідомляємо гравця як першого учасника
      socket.emit("tournamentWaiting", { playersCount: 1, needed: 4 });
      // повідомлення для інших
      io.emit("tournamentUpdate", { id: waitId, playersCount: 1, needed: 4 });
    }
  });

  socket.on("tournamentChoice", (choice) => {
    // записуємо дані турніру, до якого підключено гравця
    const tournamentId = socket.tournamentId;
    const tournament = tournaments[tournamentId];
    if (!tournament) return;

    // при півфіналі
    if (tournament.status === "semifinal") {
      // шукаємо пару півфіналістів
      const pair = tournament.pairs.find(
        ([a, b]) => a.id === socket.id || b.id === socket.id
      );
      if (!pair) return;
      //створюємо об'єкт для вибору та записуємо в нього хід
      if (!tournament.semiChoices) tournament.semiChoices = {};
      tournament.semiChoices[socket.username] = { choice, socket };
      // записуємо пари
      const [pa, pb] = pair;
      //перевіряємо наявність ходів в парі
      if (
        tournament.semiChoices[pa.username] &&
        tournament.semiChoices[pb.username]
      ) {
        // записумо результати виборів та робимо перевірку переможця
        const choiceA = tournament.semiChoices[pa.username].choice;
        const choiceB = tournament.semiChoices[pb.username].choice;
        const res = Result(choiceA, choiceB);

        // якщо нічия гравець а переміг
        const winner = res === "win" ? pa : res === "lose" ? pb : pa;
        const loser = winner === pa ? pb : pa;
        // розсилаємо результати гравцям пари
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
        // передаємо переможця і програвшого в функцію менеджер
        handleTournamentMatch(tournamentId, winner, loser);
      }
    }
    // якщо вінал
    else if (tournament.status === "final") {
      // записуємо фінальні вибори в нову змінну 
      // далі аналогічно півфіналу
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

        handleTournamentMatch(tournamentId, winner, loser);
      }
    }
  });

  // перехоплення події
  socket.on("disconnect", () => {
    console.log("гравець відключився ", socket.id);
    // перевірка гравця в 1 на 1
    const room = rooms[socket.roomId];
    // якщо гравець був в кімнаті
    if (room) {
      // перевірка на онлайн противника
      const opponent = room.players.find((p) => p.id !== socket.id);
      if (opponent) opponent.emit("opponentLeft", "суперник відключився");
      // видаляємо кімнату
      delete rooms[socket.roomId];
    }
    // розсилаємо лідерборд
    io.emit("leaderboard", getCachedLboard());
  });
});

//маршрут для гри 
app.get("/play", (req, res) => {
  // зчитуємо вибір гравця з юрл адреси
  const playerChoice = req.query.choice;
  // валідація даних
  if (!choices.includes(playerChoice)) {
    return res.status(400).json({ error: "неправильний вибір" });
  }
  // хід комп'ютера
  const computerChoice = getPCChoice();
  const result = Result(playerChoice, computerChoice);
  res.json({ playerChoice, computerChoice, result });
});

// адмін ендпоінт для статистики
app.get("/stats", (req, res) => {
  res.json({
    totalPlayers: Object.keys(leaderboard).length,
    totalMatches: matchHistory.length,
    activeTournaments: Object.keys(tournaments).length,
  });
});

// запуск сервера
server.listen(3001, () => {
  console.log("started")
});