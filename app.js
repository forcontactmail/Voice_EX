const sourceForm = document.querySelector("#source-form");
const sourceUrl = document.querySelector("#source-url");
const loadStatus = document.querySelector("#load-status");
const browserStatus = document.querySelector("#browser-status");
const statusDot = document.querySelector(".status-dot");
const phraseElement = document.querySelector("#phrase");
const progressLabel = document.querySelector("#progress-label");
const progressTrack = document.querySelector(".progress-track");
const progressFill = document.querySelector("#progress-fill");
const answerReveal = document.querySelector("#answer-reveal");
const expectedAnswer = document.querySelector("#expected-answer");
const feedback = document.querySelector("#feedback");
const recognitionStatus = document.querySelector("#recognition-status");
const stopButton = document.querySelector("#stop-button");
const recognizedAnswer = document.querySelector("#recognized-answer");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

let phrases = [];
let currentIndex = 0;
let isActive = false;
let isListening = false;
let recognitionMode = "answer";
let answerAlternatives = [];
let retryListening = false;
let loadedSourceUrl = "";

if (recognition) {
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;

  recognition.addEventListener("start", () => {
    isListening = true;
    recognitionStatus.textContent = recognitionMode === "keyword"
      ? "Перевод распознан. Скажите «Готово» для проверки или «Повтори фразу» для повтора."
      : "Слушаю перевод по-английски...";
  });

  recognition.addEventListener("result", (event) => {
    const alternatives = Array.from(event.results[0], (result) => result.transcript);
    if (alternatives.some(isRepeatCommand)) {
      retryListening = false;
      recognition.stop();
      speakPrompt();
      return;
    }

    if (recognitionMode === "keyword") {
      if (alternatives.some((answer) => normalize(answer) === normalize("Готово"))) {
        retryListening = false;
        recognition.stop();
        checkAnswer(answerAlternatives);
      } else {
        recognitionStatus.textContent = "Скажите «Готово» для проверки или «Повтори фразу» для повтора.";
        retryListening = true;
        recognition.stop();
      }
      return;
    }

    answerAlternatives = alternatives;
    recognitionMode = "keyword";
    recognition.lang = "ru-RU";
    retryListening = true;
    recognition.stop();
  });

  recognition.addEventListener("error", (event) => {
    const messages = {
      "not-allowed": "Разрешите доступ к микрофону в настройках браузера.",
      "service-not-allowed": "Распознавание речи недоступно в этом браузере.",
      "no-speech": recognitionMode === "keyword"
        ? "Скажите «Готово» для проверки или «Повтори фразу» для повтора."
        : "Речь не распознана. Скажите перевод по-английски или “Repeat phrase”, чтобы повторить исходную фразу.",
      network: "Нет соединения с сервисом распознавания речи.",
    };
    recognitionStatus.textContent = messages[event.error] || "Не удалось распознать речь. Попробуйте ещё раз.";
    if (event.error === "no-speech") {
      retryListening = true;
    }
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    if (isActive && retryListening) {
      retryListening = false;
      startListening();
    }
  });
}

if (recognition && "speechSynthesis" in window) {
  browserStatus.textContent = "Голосовые функции готовы";
  statusDot.classList.add("is-ready");
} else {
  browserStatus.textContent = "Распознавание недоступно";
  statusDot.classList.add("is-unavailable");
  recognitionStatus.textContent = "Для голосовой практики откройте страницу в Chrome или Edge.";
}

sourceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadPhrases();
});

sourceUrl.addEventListener("change", loadPhrases);

async function loadPhrases() {
  const rawUrl = sourceUrl.value.trim();
  if (!rawUrl || rawUrl === loadedSourceUrl) return;
  setLoadStatus("Загружаю фразы...", false);
  stopPractice();

  try {
    const url = new URL(rawUrl, window.location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);

    const content = await response.text();
    const loadedPhrases = parsePhrases(content);
    if (loadedPhrases.length === 0) {
      throw new Error("В файле не найдено ни одной пары фраз.");
    }

    phrases = loadedPhrases;
    currentIndex = 0;
    loadedSourceUrl = rawUrl;
    renderPhrase();
    setLoadStatus(`Загружено фраз: ${phrases.length}.`, false);
    isActive = true;
    updateControls();
    speakPrompt();
  } catch (error) {
    phrases = [];
    renderPhrase();
    loadedSourceUrl = "";
    setLoadStatus(`Не удалось загрузить файл: ${error.message}. Проверьте URL и CORS.`, true);
  }
}

stopButton.addEventListener("click", stopPractice);

function parsePhrases(content) {
  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => {
      const tabIndex = line.indexOf("\t");
      const pipeIndex = line.indexOf("|");
      const separatorIndex = tabIndex >= 0 ? tabIndex : pipeIndex;
      if (separatorIndex < 0 && line.trim()) {
        throw new Error(`В строке ${index + 1} нет разделителя | или Tab`);
      }
      if (separatorIndex < 0) return null;

      const prompt = line.slice(0, separatorIndex).trim();
      const translation = line.slice(separatorIndex + 1).trim();
      if (!prompt || !translation) {
        throw new Error(`Проверьте исходную фразу и перевод в строке ${index + 1}`);
      }
      return { prompt, translation };
    })
    .filter(Boolean);
}

function renderPhrase() {
  if (!phrases.length) {
    phraseElement.textContent = "Проверьте URL текстового файла";
    progressLabel.textContent = "Нет фраз";
    progressFill.style.width = "0%";
    progressTrack.setAttribute("aria-valuemax", "0");
    progressTrack.setAttribute("aria-valuenow", "0");
    answerReveal.hidden = true;
    updateControls();
    return;
  }

  if (currentIndex >= phrases.length) {
    phraseElement.textContent = "Тренировка завершена";
    progressLabel.textContent = `${phrases.length} из ${phrases.length}`;
    progressFill.style.width = "100%";
    progressTrack.setAttribute("aria-valuemax", String(phrases.length));
    progressTrack.setAttribute("aria-valuenow", String(phrases.length));
    answerReveal.hidden = true;
    recognizedAnswer.textContent = "";
    expectedAnswer.textContent = "";
    updateControls();
    return;
  }

  phraseElement.textContent = phrases[currentIndex].prompt;
  progressLabel.textContent = `${currentIndex + 1} из ${phrases.length}`;
  progressFill.style.width = `${(currentIndex / phrases.length) * 100}%`;
  progressTrack.setAttribute("aria-valuemax", String(phrases.length));
  progressTrack.setAttribute("aria-valuenow", String(currentIndex));
  answerReveal.hidden = true;
  recognizedAnswer.textContent = "";
  expectedAnswer.textContent = "";
}

function speakPrompt() {
  if (!isActive || !phrases[currentIndex]) return;
  stopListening();
  answerReveal.hidden = true;
  feedback.className = "feedback";
  feedback.textContent = "Скажите перевод по-английски. Чтобы сразу повторить исходную фразу, скажите “Repeat phrase”.";
  recognitionStatus.textContent = "";
  recognitionMode = "answer";
  answerAlternatives = [];
  retryListening = false;
  if (recognition) recognition.lang = "en-US";
  speak(phrases[currentIndex].prompt, "ru-RU", startListening);
}

function startListening() {
  if (!isActive) return;
  if (!recognition) {
    recognitionStatus.textContent = "Распознавание речи не поддерживается. Откройте страницу в Chrome или Edge.";
    return;
  }
  if (isListening) return;

  try {
    recognition.start();
  } catch {
    recognitionStatus.textContent = "Микрофон уже активен. Говорите или нажмите «Остановить».";
  }
}

function checkAnswer(alternatives) {
  if (!isActive || !phrases[currentIndex]) return;
  const expected = normalize(phrases[currentIndex].translation);
  const matched = alternatives.some((answer) => normalize(answer) === expected);

  if (matched) {
    feedback.className = "feedback is-success";
    feedback.textContent = "Правильно.";
    recognitionStatus.textContent = "";
    speak("Правильно.", "ru-RU", () => {
      currentIndex += 1;
      if (currentIndex >= phrases.length) {
        isActive = false;
        renderPhrase();
        feedback.textContent = "Вы прошли все фразы. Отличная работа!";
        feedback.className = "feedback is-success";
        speak("Тренировка завершена.", "ru-RU");
        return;
      }
      renderPhrase();
      speakPrompt();
    });
    return;
  }

  const translation = phrases[currentIndex].translation;
  const recognized = alternatives[0] || "";
  recognizedAnswer.textContent = recognized;
  expectedAnswer.textContent = translation;
  answerReveal.hidden = false;
  feedback.className = "feedback is-error";
  feedback.textContent = "Ошибка. Послушайте правильный перевод и повторите.";
  recognitionMode = "answer";
  answerAlternatives = [];
  recognition.lang = "en-US";
  speak(recognized, "en-US", () => speak(translation, "en-US", startListening));
}

function isRepeatCommand(value) {
  const command = normalize(value);
  return ["повтори фразу", "повтори", "повторить фразу", "повторить", "repeat phrase", "repeat"].includes(command);
}

function normalize(value) {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function speak(text, language, onEnd) {
  if (!("speechSynthesis" in window)) {
    recognitionStatus.textContent = "Озвучивание не поддерживается этим браузером.";
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = 0.94;
  utterance.onend = () => {
    if (isActive && onEnd) onEnd();
  };
  window.speechSynthesis.speak(utterance);
}

function stopListening() {
  if (recognition && isListening) recognition.stop();
  isListening = false;
}

function stopPractice() {
  isActive = false;
  retryListening = false;
  stopListening();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  recognitionStatus.textContent = "Практика остановлена.";
  loadedSourceUrl = "";
  updateControls();
}

function updateControls() {
  stopButton.disabled = !isActive;
}

function setLoadStatus(message, isError) {
  loadStatus.textContent = message;
  loadStatus.classList.toggle("is-error", isError);
}

updateControls();
loadPhrases();