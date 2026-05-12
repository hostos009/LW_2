import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

// підключення клієнта до бекенду
const socket = io("http://localhost:3001");

//варіанти 
const choices = [
  { id: "rock", label: "камінь" },
  { id: "paper", label: "папір" },
  { id: "scissors", label: "ножиці" },
];

function App() {
  // змінні та функції їх зміни
  const [username, setUsername] = useState("");
  const [registered, setRegistered] = useState(false);
  const [mode, setMode] = useState(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState({});
  const [gameActive, setGameActive] = useState(false);
  const [matchHistory, setMatchHistory] = useState([]);
  const [view, setView] = useState("game");

  const [tournamentStatus, setTournamentStatus] = useState(null);
  const [tournamentResult, setTournamentResult] = useState(null);
  const [tournamentUpdate, setTournamentUpdate] = useState(null);


  useEffect(() => {
    // запам'ятовуємо користувача та змінюємо меню
    socket.on("registered", () => {
      setRegistered(true);
    });
    // кладемо дані лідерборду і історії 
    // ігор для оновлення даних на екрані
    socket.on("leaderboard", (data) => {
      setLeaderboard(data);
    });

    socket.on("matchHistory", (data) => {
      setMatchHistory(data);
    });
    // при свторенні нової гри надсилаємо подію чекання,
    // виводимо текст-підказку
    socket.on("waiting", (msg) => {
      setStatus(msg);
    });
    // після знаходження суперника виводимо повідомлення
    // та вмикаємо кнопки фігур і очищуємо старі результати
    socket.on("gameStart", ({ opponent }) => {
      setStatus(`суперник знайдено: ${opponent}, зробіть вибір:`);
      setGameActive(true);
      setResult(null);
    });
    // після завершення гри, отримуємо результат
    // записуємо його для відображення переможця
    //вимикаємо кнопки гри і прибираємо підказки
    socket.on("gameResult", (data) => {
      setResult(data);
      setGameActive(false);
      setStatus("");
    });
    // якщо суперник закрив вкладку, отримуємо результат
    // і вимикаємо кнопки гри
    socket.on("opponentLeft", (msg) => {
      setStatus(msg);
      setGameActive(false);
    });
    // при створенні лобі створюємо об'єкт, вказуємо поточну фазу
    // кількість людей і потрібну кількість
    socket.on("tournamentWaiting", ({ playersCount, needed }) => {
      setTournamentStatus({ phase: "waiting", playersCount, needed });
    });
    // при вході нових гравців перезаписуємо 
    // кількість уасників без інших змін
    socket.on("tournamentUpdate", ({ playersCount, needed }) => {
      setTournamentStatus((prev) =>
        prev ? { ...prev, playersCount } : { phase: "waiting", playersCount, needed }
      );
    });
    // повідомляємо про старт гри, перемикаємо інтерфейс у стан півфіналу
    // та запам'ятовуємо нік противника, відмальовуємо кнопки гри
    socket.on("tournamentStart", ({ opponent, tournamentId }) => {
      setTournamentStatus({ phase: "semifinal", opponent, tournamentId });
      setGameActive(true);
      setTournamentResult(null);
    });
    // повідомляємо фіналістів, оновлюємо статус до фіналу
    // відмальовуємо кнопки та виводимо повідомлення
    socket.on("tournamentFinal", ({ opponent }) => {
      setTournamentStatus((prev) => ({ ...prev, phase: "final", opponent }));
      setGameActive(true);
      setTournamentResult(null);
      setStatus("ви в фіналі");
    });
    // подія після кожного матчу турніру
    // зберігаємо деталі гри
    // виводимо повідомлення залежно від стадії та результату
    socket.on("tournamentMatchResult", ({ result, playerChoice, opponentChoice, advancing, isFinal }) => {
      setTournamentResult({ result, playerChoice, opponentChoice, advancing, isFinal });
      setGameActive(false);
      if (advancing) {
        setStatus(isFinal ? "очікуємо результат фіналу" : "ви пройшли в фінал");
      } else {
        setStatus("ви вибули");
      }
    });
    // надсилаємо повідомлення програвшим півфіналістам
    socket.on("tournamentEliminated", (msg) => {
      setStatus(msg);
      setGameActive(false);
    });
    // надсилаємо результати після завершення фіналу
    // перемикаємо на екран підсумків
    socket.on("tournamentEnd", ({ champion, matches }) => {
      setTournamentStatus({ phase: "finished", champion, matches });
      setGameActive(false);
    });
    //функція очищення, відписуємось від всіх подій сервера
    return () => socket.removeAllListeners();
  }, []);
  // реєстрація, якщо ім'я введено, відправляємо на сервер
  const register = () => {
    if (username.trim()) {
      socket.emit("register", username.trim());
    }
  };

  // функції, які встановлюють режим, очищують попередні результати
  // та відправляють команду на сервер
  const findGame = () => {
    setMode("player");
    setResult(null);
    socket.emit("findGame");
  };

  const playVsPC = () => {
    setMode("pc");
    setResult(null);
    setGameActive(true);
    setStatus("зробіть вибірЖ");
  };

  const joinTournament = () => {
    setMode("tournament");
    setResult(null);
    setTournamentResult(null);
    setTournamentStatus(null);
    socket.emit("createTournament");
  };


  // функція обрання в грі
  // перевіряємо режим та активність, 
  // викликаємо функції для опрацювання результату,
  // та виводимо повідомлення
  const makeChoice = (choice) => {
    if (mode === "pc") {
      socket.emit("playVsPC", choice);
      setGameActive(false);
    }
    else if (mode === "player" && gameActive) {
      socket.emit("makeChoice", choice);
      setGameActive(false);
      setStatus("очикуємо хід суперника");
    }
    else if (mode === "tournament" && gameActive) {
      socket.emit("tournamentChoice", choice);
      setGameActive(false);
      setStatus("Очікуємо хід суперника...");
    }
  };
  // функція перетворення об'єкту в повідомлення результату
  const getResTxt = () => {
    if (!result) {
      return "";
    }
    if (result.result === "win") {
      return "win";
    }
    if (result.result === "lose") {
      return "lose";
    }
    return "draw";
  };
  // повертаємо повідомлення на українській
  const getLabel = (id) =>
    choices.find((c) => c.id === id)?.label || id;
  // перетворює словник на масив і сортує за кількістю перемог
  const getSortedLboard = () =>
    Object.entries(leaderboard).sort((a, b) => b[1].wins - a[1].wins);

  // сторінка реєстрації
  if (!registered) {
    return (
      <div className="app">
        <h1>Камінь — Ножиці — Папір</h1>
        <div className="register">
          <input
            type="text"
            placeholder="Введи своє ім'я"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && register()}
          />
          <button onClick={register}>Увійти</button>
        </div>
      </div>
    );
  }

  // функція ресету сторінки
  const resetMode = () => {
    setMode(null);
    setResult(null);
    setStatus("");
    setGameActive(false);
    setTournamentStatus(null);
    setTournamentResult(null);
  };

  // основна сторінка
  return (
    <div className="app">
      <h1>Камінь — Ножиці — Папір</h1>
      <p className="welcome">Привіт, {username}!</p>

      <div className="tabs">
        <button
          className={view === "game" ? "tab active" : "tab"}
          onClick={() => setView("game")}
        >
          Гра
        </button>
        <button
          className={view === "history" ? "tab active" : "tab"}
          onClick={() => setView("history")}
        >
          Історія
        </button>
      </div>

      {view === "game" && (
        <>
          {!mode && (
            <div className="modes">
              <button onClick={playVsPC}>проти комп'ютера</button>
              <button onClick={findGame}>проти гравця</button>
              <button onClick={joinTournament}>турнір</button>
            </div>
          )}

          {mode && (
            <>
              <button className="back" onClick={resetMode}>← Назад</button>

              {mode !== "tournament" && (
                <>
                  {status && <p className="status">{status}</p>}
                  {gameActive && (
                    <div className="choices">
                      {choices.map((c) => (
                        <button key={c.id} onClick={() => makeChoice(c.id)}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {result && (
                    <div className="result">
                      <p>Твій вибір: {getLabel(result.playerChoice)}</p>
                      <p>
                        {mode === "pc" ? "Комп'ютер" : `Суперник (${result.opponent})`}:{" "}
                        {getLabel(result.computerChoice)}
                      </p>
                      <h2>{getResTxt()}</h2>
                      <button onClick={mode === "pc" ? playVsPC : findGame}>
                        Грати ще
                      </button>
                    </div>
                  )}
                </>
              )}

              {mode === "tournament" && (
                <div className="tournament">
                  {tournamentStatus?.phase === "waiting" && (
                    <div className="tournament-waiting">
                      <h3>Очікування турніру</h3>
                      <p>Гравців зібрано: {tournamentStatus.playersCount} / {tournamentStatus.needed}</p>
                      <div className="players-dots">
                        {Array.from({ length: tournamentStatus.needed }).map((_, i) => (
                          <span
                            key={i}
                            className={i < tournamentStatus.playersCount ? "dot filled" : "dot"}
                          />
                        ))}
                      </div>
                      <p className="status">Чекаємо інших гравців</p>
                    </div>
                  )}

                  {(tournamentStatus?.phase === "semifinal" || tournamentStatus?.phase === "final") && (
                    <div>
                      <h3>
                        {tournamentStatus.phase === "final" ? "Фінал" : "Півфінал"}
                      </h3>
                      <p className="status">Суперник: {tournamentStatus.opponent}</p>

                      {gameActive && (
                        <div className="choices">
                          {choices.map((c) => (
                            <button key={c.id} onClick={() => makeChoice(c.id)}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {!gameActive && status && <p className="status">{status}</p>}

                      {tournamentResult && (
                        <div className="result">
                          <p>Твій вибір: {getLabel(tournamentResult.playerChoice)}</p>
                          <p>Суперник: {getLabel(tournamentResult.opponentChoice)}</p>
                          <h2>
                            {tournamentResult.advancing
                              ? tournamentResult.isFinal ? "Ти чемпіон!" : "Ти у фіналіст"
                              : "Ти вибув"}
                          </h2>
                        </div>
                      )}
                    </div>
                  )}

                  {tournamentStatus?.phase === "finished" && (
                    <div className="tournament-end">
                      <h3>Турнір завершено</h3>
                      <p>Чемпіон: <strong>{tournamentStatus.champion}</strong></p>
                      <h4>результати матчів:</h4>
                      {tournamentStatus.matches.map((m, i) => (
                        <p key={i}>
                          {m.winner} переміг {m.loser}
                        </p>
                      ))}
                      <button onClick={joinTournament}>новий турнір</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="leaderboard">
            <h3>лідерборд</h3>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Гравець</th>
                  <th>Перемоги</th>
                  <th>Поразки</th>
                  <th>Нічиї</th>
                </tr>
              </thead>
              <tbody>
                {getSortedLboard().map(([name, stats], i) => (
                  <tr key={name} className={name === username ? "me" : ""}>
                    <td>{i + 1}</td>
                    <td>{name}</td>
                    <td>{stats.wins}</td>
                    <td>{stats.losses}</td>
                    <td>{stats.draws}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "history" && (
        <div className="history">
          <h3>Історія матчів</h3>
          {matchHistory.length === 0 ? (
            <p className="status">Ще немає зіграних матчів</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Суперник</th>
                  <th>Твій вибір</th>
                  <th>Вибір суперника</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {[...matchHistory].reverse().map((m) => {
                  const isP1 = m.p1 === username;
                  const opponent = isP1 ? m.p2 : m.p1;
                  const myChoice = isP1 ? m.ch1 : m.ch2;
                  const opChoice = isP1 ? m.ch2 : m.ch1;
                  const won = m.winner === username;
                  const draw = m.winner === "draw";
                  return (
                    <tr key={m.id} className={won ? "win-row" : draw ? "" : "lose-row"}>
                      <td>{m.date}</td>
                      <td>{opponent}</td>
                      <td>{getLabel(myChoice)}</td>
                      <td>{getLabel(opChoice)}</td>
                      <td>{won ? "перемога" : draw ? "нічия" : "поразка"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default App;