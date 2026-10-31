const phraseFile = document.querySelector("#phrase-file");
const phraseEditor = document.querySelector("#phrase-editor");
const savePhrasesButton = document.querySelector("#save-phrases");
const loadStatus = document.querySelector("#load-status");
const voiceStatus = document.querySelector("#voice-status");
const russianVoiceSelect = document.querySelector("#russian-voice");
const englishVoiceSelect = document.querySelector("#english-voice");
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
let recognition = null;
let recognitionInitializationError = "";
if (SpeechRecognition) {
  try {
    recognition = new SpeechRecognition();
  } catch (error) {
    recognitionInitializationError = error instanceof Error ? error.message : String(error);
  }
}

let phrases = [];
let currentIndex = 0;
let isActive = false;
let isListening = false;
let recognitionMode = "answer";
let answerAlternatives = [];
let retryListening = false;

const phraseStorageKey = "voicePractice.phrases";
const russianVoiceStorageKey = "voicePractice.russianVoice";
const englishVoiceStorageKey = "voicePractice.englishVoice";

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
  recognitionStatus.textContent = recognitionInitializationError
    ? `Не удалось запустить распознавание речи: ${recognitionInitializationError}`
    : "Для голосовой практики откройте страницу в Chrome или Edge.";
}

phraseFile.addEventListener("change", async () => {
  const file = phraseFile.files[0];
  if (!file) return;

  try {
    const content = await file.text();
    phraseEditor.value = content;
    const loadedPhrases = parsePhrases(content);
    if (!loadedPhrases.length) throw new Error("В файле нет ни одной пары фраз.");
    startPractice(loadedPhrases);
    setLoadStatus(`Файл «${file.name}» загружен. Нажмите «Сохранить список», чтобы сохранить его в браузере.`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadStatus(`Не удалось загрузить список: ${message}`, true);
  }
});

savePhrasesButton.addEventListener("click", () => {
  try {
    const parsedPhrases = parsePhrases(phraseEditor.value);
    if (!parsedPhrases.length) throw new Error("Добавьте хотя бы одну пару фраз.");
    window.localStorage.setItem(phraseStorageKey, phraseEditor.value);
    startPractice(parsedPhrases);
    setLoadStatus(`Список сохранён в этом браузере. Фраз: ${phrases.length}.`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadStatus(`Не удалось сохранить список: ${message}`, true);
  }
});

for (const [select, storageKey] of [
  [russianVoiceSelect, russianVoiceStorageKey],
  [englishVoiceSelect, englishVoiceStorageKey],
]) {
  select.addEventListener("change", () => {
    try {
      window.localStorage.setItem(storageKey, select.value);
      voiceStatus.textContent = "Выбор голосов сохранён в этом браузере.";
      voiceStatus.classList.remove("is-error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      voiceStatus.textContent = `Не удалось сохранить голос: ${message}`;
      voiceStatus.classList.add("is-error");
    }
  });
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

function startPractice(loadedPhrases) {
  stopPractice();
  phrases = loadedPhrases;
  currentIndex = 0;
  renderPhrase();
  isActive = true;
  updateControls();
  speakPrompt();
}

async function initialize() {
  initializeVoiceOptions();

  let savedPhrases = null;
  let storageReadError = "";
  try {
    savedPhrases = window.localStorage.getItem(phraseStorageKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    storageReadError = message;
  }

  if (savedPhrases !== null && savedPhrases !== undefined) {
    phraseEditor.value = savedPhrases;
    try {
      const saved = parsePhrases(savedPhrases);
      if (!saved.length) throw new Error("Сохранённый список пуст.");
      startPractice(saved);
      setLoadStatus(`Загружен сохранённый список. Фраз: ${phrases.length}.`, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadStatus(`Сохранённый список содержит ошибку: ${message}`, true);
    }
    return;
  }

  setLoadStatus("Загружаю пример...", false);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(new URL("./phrases.txt", window.location.href), { signal: controller.signal });
    if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);
    const content = await response.text();
    const loadedPhrases = parsePhrases(content);
    if (!loadedPhrases.length) throw new Error("В примере нет ни одной пары фраз.");
    phraseEditor.value = content;
    startPractice(loadedPhrases);
    if (storageReadError) {
      setLoadStatus(`Загружен пример. Фраз: ${phrases.length}. Не удалось прочитать сохранённый список: ${storageReadError}`, true);
    } else {
      setLoadStatus(`Загружен пример. Фраз: ${phrases.length}.`, false);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === "AbortError"
      ? "истекло время ожидания (15 секунд)"
      : message;
    phraseElement.textContent = "Не удалось загрузить фразы";
    setLoadStatus(`Ошибка загрузки примера: ${reason}.`, true);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function initializeVoiceOptions() {
  if (!("speechSynthesis" in window)) {
    voiceStatus.textContent = "Озвучивание не поддерживается этим браузером.";
    voiceStatus.classList.add("is-error");
    return;
  }

  let attempts = 0;
  let retryTimer;
  const populate = () => {
    window.clearTimeout(retryTimer);
    const voices = window.speechSynthesis.getVoices();
    const hasRussianVoices = populateVoiceSelect(
      russianVoiceSelect,
      voices,
      "ru",
      russianVoiceStorageKey,
      "Русский голос браузера по умолчанию",
    );
    const hasEnglishVoices = populateVoiceSelect(
      englishVoiceSelect,
      voices,
      "en",
      englishVoiceStorageKey,
      "Английский голос браузера по умолчанию",
    );
    if (hasRussianVoices && hasEnglishVoices) {
      voiceStatus.textContent = "Выберите голоса озвучивания.";
      voiceStatus.classList.remove("is-error");
      window.clearTimeout(retryTimer);
      return;
    }

    attempts += 1;
    if (attempts < 20) {
      voiceStatus.textContent = "Ожидаю список голосов от браузера...";
      voiceStatus.classList.remove("is-error");
      retryTimer = window.setTimeout(populate, 250);
    } else {
      const missingLanguages = [
        ...(!hasRussianVoices ? ["русские"] : []),
        ...(!hasEnglishVoices ? ["английские"] : []),
      ];
      voiceStatus.textContent = `Браузер не предоставил ${missingLanguages.join(" и ")} голоса. Выбран голос браузера по умолчанию; установите нужные голоса в системе, чтобы выбирать их отдельно.`;
      voiceStatus.classList.add("is-error");
    }
  };

  window.speechSynthesis.addEventListener("voiceschanged", populate);
  populate();
}

function populateVoiceSelect(select, voices, language, storageKey, emptyMessage) {
  const matchingVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language));
  let savedVoice = "";
  try {
    savedVoice = window.localStorage.getItem(storageKey) || "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    voiceStatus.textContent = `Не удалось загрузить настройки голоса: ${message}`;
    voiceStatus.classList.add("is-error");
  }

  select.replaceChildren();
  if (!matchingVoices.length) {
    const option = document.createElement("option");
    option.textContent = `${emptyMessage} (установите голос ${language === "ru" ? "ru-RU" : "en-US"} в системе для выбора)`;
    option.value = "";
    select.add(option);
    select.disabled = false;
    return false;
  }

  for (const voice of matchingVoices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${voice.default ? " — по умолчанию" : ""}`;
    select.add(option);
  }
  select.disabled = false;
  select.value = matchingVoices.some((voice) => voice.voiceURI === savedVoice)
    ? savedVoice
    : matchingVoices[0].voiceURI;
  return true;
}

function selectedVoice(language) {
  const select = language === "ru" ? russianVoiceSelect : englishVoiceSelect;
  return window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === select.value);
}

function renderPhrase() {
  if (!phrases.length) {
    phraseElement.textContent = "Загрузите файл или добавьте фразы в список";
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

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    const voice = selectedVoice(language.startsWith("ru") ? "ru" : "en");
    if (voice) utterance.voice = voice;
    utterance.rate = 0.94;
    utterance.onend = () => {
      if (isActive && onEnd) onEnd();
    };
    utterance.onerror = (event) => {
      recognitionStatus.textContent = `Не удалось озвучить фразу: ${event.error || "ошибка синтеза речи"}.`;
    };
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recognitionStatus.textContent = `Не удалось запустить озвучивание: ${message}`;
  }
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
initialize();