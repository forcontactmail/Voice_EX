const sourceForm = document.querySelector("#source-form");
const sourceUrl = document.querySelector("#source-url");
const phraseFile = document.querySelector("#phrase-file");
const phraseEditor = document.querySelector("#phrase-editor");
const savePhrasesButton = document.querySelector("#save-phrases-button");
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
let loadedSourceUrl = "";
let voices = [];
let savedVoiceSettings = { russian: "", english: "" };

const phraseStorageKey = "voice-ex.phrases";
const voiceStorageKey = "voice-ex.voices";

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

sourceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadPhrases();
});

sourceUrl.addEventListener("change", loadPhrases);
phraseFile.addEventListener("change", async () => {
  const file = phraseFile.files?.[0];
  if (!file) return;

  try {
    phraseEditor.value = await file.text();
    setLoadStatus(`Файл «${file.name}» загружен. Проверьте список и нажмите «Сохранить список».`, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadStatus(`Не удалось прочитать файл: ${message}`, true);
  }
});

savePhrasesButton.addEventListener("click", savePhrases);
russianVoiceSelect.addEventListener("change", () => saveVoicePreference("russian", russianVoiceSelect));
englishVoiceSelect.addEventListener("change", () => saveVoicePreference("english", englishVoiceSelect));

function savePhrases() {
  try {
    const content = phraseEditor.value;
    const savedPhrases = parsePhrases(content);
    if (savedPhrases.length === 0) {
      throw new Error("Список пуст. Добавьте хотя бы одну пару фраз.");
    }

    window.localStorage.setItem(phraseStorageKey, content);
    phrases = savedPhrases;
    currentIndex = 0;
    loadedSourceUrl = "";
    renderPhrase();
    setLoadStatus(`Сохранено фраз: ${phrases.length}. Список останется в этом браузере.`, false);
    isActive = true;
    updateControls();
    speakPrompt();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadStatus(`Не удалось сохранить список: ${message}`, true);
  }
}

function initializeVoices() {
  try {
    const saved = window.localStorage.getItem(voiceStorageKey);
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings && typeof settings === "object") {
        savedVoiceSettings = {
          russian: typeof settings.russian === "string" ? settings.russian : "",
          english: typeof settings.english === "string" ? settings.english : "",
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    voiceStatus.textContent = `Не удалось загрузить сохранённые настройки голосов: ${message}`;
  }

  refreshVoices();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  }
}

function refreshVoices() {
  if (!("speechSynthesis" in window)) {
    voiceStatus.textContent = "Синтез речи недоступен в этом браузере.";
    return;
  }

  voices = window.speechSynthesis.getVoices();
  populateVoiceSelect(russianVoiceSelect, "ru", savedVoiceSettings.russian);
  populateVoiceSelect(englishVoiceSelect, "en", savedVoiceSettings.english);
  if (voices.length === 0) {
    voiceStatus.textContent = "Браузер пока не предоставил список голосов.";
  } else {
    voiceStatus.textContent = "Выбранные голоса сохраняются в этом браузере.";
  }
}

function populateVoiceSelect(select, language, preferredVoice) {
  const availableVoices = voices.filter((voice) => {
    const voiceLanguage = voice.lang.toLowerCase();
    return voiceLanguage === language || voiceLanguage.startsWith(`${language}-`);
  });
  const selectedVoice = select.value;
  select.replaceChildren(new Option("Автоматический голос", ""));
  for (const voice of availableVoices) {
    const option = new Option(`${voice.name} (${voice.lang})`, getVoiceKey(voice));
    select.add(option);
  }

  const desiredVoice = preferredVoice || selectedVoice;
  if (availableVoices.some((voice) => getVoiceKey(voice) === desiredVoice)) {
    select.value = desiredVoice;
  } else {
    select.value = "";
  }

  if (availableVoices.length === 0) {
    select.options[0].textContent = `Нет голосов ${language === "ru" ? "на русском" : "на английском"}`;
  }
}

function saveVoicePreference(language, select) {
  savedVoiceSettings[language] = select.value;
  try {
    window.localStorage.setItem(voiceStorageKey, JSON.stringify(savedVoiceSettings));
    voiceStatus.textContent = "Настройки голосов сохранены в этом браузере.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    voiceStatus.textContent = `Не удалось сохранить настройки голосов: ${message}`;
  }
}

function getVoiceKey(voice) {
  return voice.voiceURI || `${voice.name}|${voice.lang}`;
}

function initializePhraseList() {
  try {
    const savedContent = window.localStorage.getItem(phraseStorageKey);
    if (savedContent) {
      const savedPhrases = parsePhrases(savedContent);
      if (savedPhrases.length === 0) {
        throw new Error("Сохранённый список пуст.");
      }
      phraseEditor.value = savedContent;
      phrases = savedPhrases;
      currentIndex = 0;
      renderPhrase();
      setLoadStatus(`Загружен ваш список: ${phrases.length} фраз.`, false);
      isActive = true;
      updateControls();
      speakPrompt();
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLoadStatus(`Не удалось прочитать сохранённый список: ${message}. Загружаю пример.`, true);
  }

  loadPhrases();
}

async function loadPhrases() {
  const rawUrl = sourceUrl.value.trim();
  if (!rawUrl || rawUrl === loadedSourceUrl) return;
  setLoadStatus("Загружаю фразы...", false);
  stopPractice();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 15000);
  try {
    const url = new URL(rawUrl, window.location.href);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Сервер ответил ${response.status}`);

    const content = await response.text();
    const loadedPhrases = parsePhrases(content);
    if (loadedPhrases.length === 0) {
      throw new Error("В файле не найдено ни одной пары фраз.");
    }

    phraseEditor.value = content;
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
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === "AbortError"
      ? "истекло время ожидания (15 секунд)"
      : message;
    phraseElement.textContent = "Не удалось загрузить фразы";
    setLoadStatus(`Ошибка загрузки: ${reason}. Проверьте URL, подключение и CORS.`, true);
  } finally {
    window.clearTimeout(timeoutId);
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

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 0.94;
    const voiceSelect = language.toLowerCase().startsWith("ru")
      ? russianVoiceSelect
      : englishVoiceSelect;
    const selectedVoice = voices.find((voice) => getVoiceKey(voice) === voiceSelect.value);
    if (selectedVoice) utterance.voice = selectedVoice;
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
initializeVoices();
initializePhraseList();