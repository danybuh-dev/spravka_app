const state = {
  sourceFiles: [],
  lastAiResult: null,
};

const API_BASE_URL = resolveApiBaseUrl();
const PUBLIC_GEMINI_API_KEY = resolvePublicGeminiApiKey();

const els = {
  openaiModel: document.getElementById("openaiModel"),
  reasoningEffort: document.getElementById("reasoningEffort"),
  caseNumber: document.getElementById("caseNumber"),
  courtName: document.getElementById("courtName"),
  judgeName: document.getElementById("judgeName"),
  presidingJudge: document.getElementById("presidingJudge"),
  instance: document.getElementById("instance"),
  disputeStatus: document.getElementById("disputeStatus"),
  claimant: document.getElementById("claimant"),
  respondent: document.getElementById("respondent"),
  caseSubject: document.getElementById("caseSubject"),
  hearingDate: document.getElementById("hearingDate"),
  hearingTime: document.getElementById("hearingTime"),
  situationSummary: document.getElementById("situationSummary"),
  desiredOutcome: document.getElementById("desiredOutcome"),
  prospectsReasoning: document.getElementById("prospectsReasoning"),
  sourceInput: document.getElementById("sourceInput"),
  sourceFiles: document.getElementById("sourceFiles"),
  reportOutput: document.getElementById("reportOutput"),
  aiDebugPanel: document.getElementById("aiDebugPanel"),
  aiDebugOutput: document.getElementById("aiDebugOutput"),
  outputMeta: document.getElementById("outputMeta"),
  ingestMeta: document.getElementById("ingestMeta"),
  aiMeta: document.getElementById("aiMeta"),
  aiProgressBlock: document.getElementById("aiProgressBlock"),
  aiProgressFill: document.getElementById("aiProgressFill"),
  progressStepUpload: document.getElementById("progressStepUpload"),
  progressStepAnalyze: document.getElementById("progressStepAnalyze"),
  progressStepFill: document.getElementById("progressStepFill"),
  gptStatus: document.getElementById("gptStatus"),
  gptStatusText: document.getElementById("gptStatusText"),
  processDocsBtn: document.getElementById("processDocsBtn"),
  generateBtn: document.getElementById("generateBtn"),
  exportBundleBtn: document.getElementById("exportBundleBtn"),
  fillDemoBtn: document.getElementById("fillDemoBtn"),
  clearBtn: document.getElementById("clearBtn"),
  copyBtn: document.getElementById("copyBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  downloadDocxBtn: document.getElementById("downloadDocxBtn"),
};

setupPdfJs();
bindEvents();
initializeAiStatus();

function setupPdfJs() {
  const pdfjs = window.pdfjsLib;
  if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}

function bindEvents() {
  els.sourceInput.addEventListener("change", async (event) => {
    state.sourceFiles = await readFiles(event.target.files, "source");
    renderFileList(els.sourceFiles, state.sourceFiles);
    setIngestMeta(buildReadSummary(state.sourceFiles));
    setAiMeta("");
  });

  els.processDocsBtn.addEventListener("click", processDocuments);
  els.generateBtn.addEventListener("click", () => {
    els.reportOutput.value = getPreferredReportText();
  });
  els.exportBundleBtn.addEventListener("click", exportBundle);
  els.fillDemoBtn.addEventListener("click", fillDemo);
  els.clearBtn.addEventListener("click", clearAll);
  els.copyBtn.addEventListener("click", copyReport);
  els.downloadBtn.addEventListener("click", downloadTxtReport);
  els.downloadPdfBtn.addEventListener("click", downloadPdfReport);
  els.downloadDocxBtn.addEventListener("click", downloadDocxReport);
}

async function initializeAiStatus() {
  if (isGitHubPages() && !API_BASE_URL && !PUBLIC_GEMINI_API_KEY) {
    setNeutralGptIndicator("Нужен backend");
    setAiMeta("Интерфейс открыт через GitHub Pages. Для AI-анализа укажите backend или публичный Gemini key в config.js.");
    return;
  }

  try {
    if (!API_BASE_URL && PUBLIC_GEMINI_API_KEY) {
      setGptIndicator(true, "AI работает");
      setAiMeta("");
      return;
    }

    const data = await checkBackendStatus({ silentSuccess: true, quietError: true });
    if (data?.provider === "gemini" || data?.ai_configured) {
      setGptIndicator(!!data.ai_configured, data.ai_configured ? "AI работает" : "AI офлайн");
      if (data.ai_configured) {
        setAiMeta("");
      }
    }
  } catch (_error) {
    setNeutralGptIndicator("AI офлайн");
  }
}

async function readFiles(fileList, bucket) {
  const files = Array.from(fileList || []);
  const results = [];

  for (const file of files) {
    const parsed = await parseFile(file);
    results.push({
      bucket,
      name: file.name,
      size: file.size,
      type: parsed.type,
      text: parsed.text,
      status: parsed.status,
      error: parsed.error || "",
    });
  }

  return results;
}

async function parseFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  try {
    if (extension === "pdf") {
      return {
        type: "pdf",
        text: await extractTextFromPdf(file),
        status: "ok",
      };
    }

    if (extension === "docx") {
      return {
        type: "docx",
        text: await extractTextFromDocx(file),
        status: "ok",
      };
    }

    if (["txt", "md", "html", "json"].includes(extension)) {
      return {
        type: extension,
        text: (await file.text()).trim(),
        status: "ok",
      };
    }

    if (extension === "doc") {
      return {
        type: "doc",
        text: "",
        status: "unsupported",
        error: "Формат DOC не поддерживается автоматически. Пересохраните файл в DOCX.",
      };
    }

    return {
      type: extension || "unknown",
      text: "",
      status: "unsupported",
      error: "Файл не поддерживается для автоматического разбора.",
    };
  } catch (error) {
    return {
      type: extension || "unknown",
      text: "",
      status: "error",
      error: error instanceof Error ? error.message : "Ошибка разбора файла.",
    };
  }
}

async function extractTextFromPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error("Библиотека PDF не загрузилась.");
  }

  const data = await file.arrayBuffer();
  let pdf;

  try {
    pdf = await window.pdfjsLib.getDocument({ data }).promise;
  } catch (error) {
    pdf = await window.pdfjsLib.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  }

  const pages = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      pages.push(text);
    }
  }

  if (!pages.length) {
    throw new Error("PDF загружен, но в нем не найден текстовый слой. Если это скан, нужен OCR.");
  }

  return pages.join("\n");
}

async function extractTextFromDocx(file) {
  if (!window.mammoth) {
    throw new Error("Библиотека DOCX не загрузилась.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value.replace(/\s+\n/g, "\n").trim();
}

function renderFileList(container, files) {
  container.innerHTML = "";

  if (!files.length) {
    return;
  }

  files.forEach((file) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.textContent = buildFileChipLabel(file);
    container.appendChild(chip);
  });
}

function buildFileChipLabel(file) {
  const statusLabel = file.status === "ok"
    ? "прочитан"
    : file.status === "unsupported"
      ? "не поддерживается"
      : "ошибка";

  const errorPart = file.error ? ` • ${trimText(file.error, 90)}` : "";
  return `${file.name} • ${formatBytes(file.size)} • ${statusLabel}${errorPart}`;
}

function buildReadSummary(files) {
  if (!files.length) {
    return "Документы ещё не загружены.";
  }

  const ok = files.filter((file) => file.status === "ok").length;
  const failed = files.filter((file) => file.status !== "ok");
  if (!failed.length) {
    return `Загружено документов: ${files.length}. Все файлы готовы к анализу.`;
  }

  const details = failed.map((file) => `${file.name}: ${file.error}`).join(" ");
  return `Загружено документов: ${files.length}. Успешно прочитано: ${ok}. ${details}`;
}

async function processDocuments() {
  try {
    await checkBackendStatus({ silentSuccess: true });
  } catch (error) {
    return;
  }
  const prepared = await prepareDocumentsForAi();
  if (!prepared) {
    return;
  }
  await analyzeWithOpenAI();
}

async function prepareDocumentsForAi() {
  const combined = getAllParsedSources();
  if (!combined.length) {
    setIngestMeta("Сначала загрузите документы дела.");
    return false;
  }

  setIngestMeta(`Документы подготовлены к отправке в AI. Обработано документов: ${combined.length}.`);
  return true;
}

async function analyzeWithOpenAI() {
  const combined = getAllParsedSources();
  if (!combined.length) {
    setAiMeta("Сначала загрузите документы.");
    return;
  }

  const payload = buildAnalysisPayload(combined);
  const instructions = buildOpenAIInstructions();
  startAiProgress();
  setAiProgressStep(1);
  setAiMeta(`Документы отправлены в AI. Объем текста для анализа: ${Math.round(payload.length / 1000)} тыс. символов. Ожидайте ответ модели.`);
  setProgressGptIndicator("AI анализирует документы");
  els.processDocsBtn.disabled = true;

  try {
    setAiProgressStep(2);
    let result = await requestOpenAIAnalysis({
      model: els.openaiModel.value.trim() || "gemini-2.5-flash",
      reasoningEffort: els.reasoningEffort.value,
      instructions,
      payload,
    });
    result = normalizeAiResult(result);

    if (!hasMeaningfulAiPrefill(result)) {
      setAiMeta("AI вернул слишком мало данных. Выполняется повторный запрос с усиленным режимом извлечения.");
      result = await requestOpenAIAnalysis({
        model: els.openaiModel.value.trim() || "gemini-2.5-flash",
        reasoningEffort: "high",
        instructions: `${instructions} Извлеки максимум доступных сведений даже из одного документа. Если в документе есть номер дела, суд, стороны, предмет спора или просительная часть, обязательно заполни соответствующие поля. Если поле нельзя определить уверенно, оставь его пустым. Не возвращай пустой шаблон, если из документа можно извлечь хотя бы часть данных.`,
        payload,
      });
      result = normalizeAiResult(result);
    }

    state.lastAiResult = result;
    applyAiResult(result);
    writeAiDebug(result);
    els.reportOutput.value = renderAiReport(result);
    setAiProgressStep(3);
    const provider = result.provider || "ai";
    setAiMeta(`AI-анализ завершен через ${provider}. Поля и готовая справка обновлены.`);
    setGptIndicator(true, `AI подключен и работает (${provider})`);
    els.outputMeta.textContent = "Справка сформирована на основе анализа GPT.";

    if (!hasMeaningfulAiPrefill(result)) {
      setAiMeta(`AI ответил через ${provider}, но почти не извлек заполняемых полей. Проверьте технический ответ AI ниже.`);
    }
  } catch (error) {
    failAiProgress();
    setAiMeta(error instanceof Error ? error.message : "Ошибка при обращении к OpenAI API.");
    writeAiDebug({ error: error instanceof Error ? error.message : String(error) });
    setGptIndicator(false, "AI не подключен");
  } finally {
    els.processDocsBtn.disabled = false;
  }
}

async function checkBackendStatus(options = {}) {
  const { silentSuccess = false, quietError = false } = options;

  if (!API_BASE_URL && PUBLIC_GEMINI_API_KEY) {
    setGptIndicator(true, "AI работает");
    if (!silentSuccess) {
      setAiMeta("Используется прямое подключение к Gemini из браузера.");
    }
    return {
      status: "ok",
      provider: "gemini",
      ai_configured: true,
    };
  }

  if (!silentSuccess) {
    setAiMeta("Проверка backend...");
  }

  try {
    const response = await fetch(buildApiUrl("/api/health"));
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "Backend недоступен.");
    }

    const provider = data.provider || "unknown";
    const keyStatus = data.ai_configured
      ? `ключ для ${provider} настроен`
      : `ключ для ${provider} не настроен`;
    if (!silentSuccess) {
      setAiMeta(`Backend доступен (${data.status}). Провайдер: ${provider}. ${keyStatus}.`);
    } else if (data.ai_configured) {
      setAiMeta("");
    }
    setGptIndicator(!!data.ai_configured, data.ai_configured ? "AI работает" : "AI недоступен");
    return data;
  } catch (error) {
    if (!quietError) {
      setAiMeta(buildBackendErrorMessage());
    }
    setGptIndicator(false, "AI не подключен");
    throw error;
  }
}

function getAllParsedSources() {
  return state.sourceFiles.filter((file) => file.status === "ok" && file.text);
}

function buildAnalysisPayload(files) {
  const sections = [];

  if (files.length) {
    sections.push("ЗАГРУЖЕННЫЕ ДОКУМЕНТЫ:");
    files.forEach((file, index) => {
      sections.push(`Документ ${index + 1}: ${file.name}`);
      sections.push(trimText(file.text, 120000));
      sections.push("");
    });
  }

  sections.push("ТРЕБОВАНИЯ К СПРАВКЕ:");
  sections.push(buildUserRequirementsBlock());

  return trimText(sections.join("\n"), 250000);
}

function buildUserRequirementsBlock() {
  const lines = [
    "Пользователь должен загружать свой процессуальный документ, а также определение суда о назначении дела к слушанию.",
    "Форма справки обязательно должна содержать разделы:",
    "1. Информация о деле.",
    "2. Перспектива рассмотрения спора.",
    "3. Описание ситуации.",
    "4. Обоснование позиции.",
    "В первом разделе нужно указать реквизиты спора, предмет спора, статус спора и стороны спора.",
    "Номер дела обычно имеет вид А40-1234/2025 и его нужно брать в таком формате.",
    "Стороны нужно брать из шапки процессуального документа или из начала судебного акта.",
    "Председательствующего, дату и время заседания нужно брать из определения суда о назначении дела к слушанию; если такого определения нет, пользователь заполнит эти поля вручную.",
    "Если жалоба подана и заседание назначено, нужно указать дату рассмотрения, время и председательствующего судью.",
    "Раздел 'Перспектива рассмотрения спора' должен содержать результат, который мы ожидаем от суда.",
    "Этот результат нужно брать прежде всего из просительной части нашего процессуального документа: жалобы, отзыва на жалобу, возражений или аналогичного документа.",
    "Раздел выводов о перспективах должен начинаться формулой: 'Правовая позиция заявителей (например, кассационной жалобы) - слабая / сильная, есть основания для принятия следующего ...'.",
    "Если спор против нас, указывай, что правовая позиция заявителей слабая.",
    "Если мы сами оспариваем судебный акт, указывай, что правовая позиция заявителей сильная.",
    "После слов 'есть основания для принятия следующего' нужно указывать вид ожидаемого судебного акта, например: постановления кассационным судом, определения Верховного Суда РФ, постановления апелляционного суда.",
    "Описание ситуации должно быть кратким, но понятным, чтобы из него была ясна суть спора.",
    "Обоснование позиции должно кратко раскрывать наши тезисы.",
    "Формат раздела 'Обоснование позиции': отдельный тезис и один абзац текста, раскрывающий этот тезис.",
    "Итоговая справка должна быть компактной, ориентировочно на 2-3 страницы.",
  ];

  return lines.join("\n");
}

function buildOpenAIInstructions() {
  return [
    "Ты юридический ассистент, который готовит справку о ходе рассмотрения дела по загруженным пользователем документам.",
    "После загрузки пользователем документов приложение передает тебе полный извлеченный текст процессуального документа пользователя, определения суда о назначении дела к слушанию, а также иных жалоб, отзывов, определений, решений, постановлений и судебных актов.",
    "Твоя задача: проанализировать весь переданный текст целиком; извлечь из него сведения для предзаполнения обязательных граф справки; сформировать черновые смысловые разделы справки; вернуть результат в структурированном виде, чтобы приложение могло автоматически подставить данные в форму и предложить пользователю их проверить и при необходимости исправить.",
    "Работай в два умственных шага: сначала найди и определи релевантные фрагменты текста для каждого поля, затем на основе этих фрагментов заполни поля.",
    "Для каждого значимого поля старайся указать короткий фрагмент-основание в блоке evidence.",
    "Даже если загружен только один документ, извлеки из него все возможные данные для формы.",
    "Если в документе есть номер дела, наименование суда, стороны, предмет спора, просительная часть или сведения о заседании, соответствующие поля должны быть заполнены.",
    "Если часть данных отсутствует, заполняй остальные поля, которые реально можно извлечь.",
    "Номер дела извлекай в формате вроде А40-1234/2025.",
    "Стороны спора извлекай прежде всего из шапки процессуального документа или из начала судебного акта.",
    "Председательствующего, дату и время заседания извлекай прежде всего из определения суда о назначении дела к слушанию.",
    "Если какие-либо сведения в документах отсутствуют или не читаются уверенно, не выдумывай их: возвращай пустую строку или пометку, что сведения требуют уточнения пользователем.",
    "Если определение суда о назначении дела к слушанию не загружено, поля о заседании должны остаться для ручного заполнения пользователем.",
    "Поле 'Перспектива рассмотрения спора' должно содержать тот результат, который мы ожидаем от суда.",
    "Этот результат нужно брать прежде всего из просительной части нашего процессуального документа: жалобы, отзыва на жалобу, возражений или аналогичного документа.",
    "Описание ситуации должно быть кратким, понятным и передавать суть спора.",
    "Обоснование позиции должно кратко и ясно отражать ключевые правовые и фактические доводы, на которых строится нужный нам результат.",
    "Оформляй обоснование позиции в формате набора тезисов: каждый тезис и один отдельный абзац текста, раскрывающий этот тезис.",
    "Если документ написан в транслитерации, смешанной раскладке или содержит русские и латинские символы вперемешку, все равно постарайся извлечь юридически значимые сведения.",
    "Текст должен быть деловым, точным, компактным, без лишних повторов.",
    "Не добавляй сведения, которых нет в документах.",
    "Если можно заполнить хотя бы часть полей, обязательно заполни эту часть и не возвращай полностью пустой объект.",
    "Верни JSON строго в плоском формате полей формы приложения. Не используй вложенные объекты для значений полей. Нельзя возвращать структуры вида { value: ..., evidence: ... } внутри основных полей.",
    "Каждое из следующих полей верхнего уровня должно быть строкой: caseNumber, courtName, judgeName, presidingJudge, instance, disputeStatus, claimant, respondent, caseSubject, hearingDate, hearingTime, situationSummary, desiredOutcome, prospectsReasoning, finalReport.",
    "Разрешен только один вложенный объект evidence, где значениями тоже являются строки: caseNumber, courtName, parties, hearing, desiredOutcome, prospectsReasoning.",
    "Используй именно эти имена ключей верхнего уровня: caseNumber, courtName, judgeName, presidingJudge, instance, disputeStatus, claimant, respondent, caseSubject, hearingDate, hearingTime, situationSummary, desiredOutcome, prospectsReasoning, finalReport, evidence.",
    "Не используй альтернативные ключи вроде case_info, case_information, expected_outcome, situation_description, position_justification, justification_of_position.",
    "Поле finalReport должно быть уже готовым итоговым текстом справки в 4 разделах: 1. Информация о деле, 2. Перспектива рассмотрения спора, 3. Описание ситуации, 4. Обоснование позиции. Оно должно совпадать по смыслу с остальными заполненными полями.",
    "Если hearingDate и hearingTime отсутствуют в загруженных документах, оставь их пустыми строками.",
    "Если instance нельзя уверенно определить, оставь пустую строку.",
    "Если judgeName отдельно не выделяется, но есть председательствующий, можно продублировать ту же фамилию в judgeName.",
    "Поле desiredOutcome всегда начинай с формулы: 'Правовая позиция заявителей (например, кассационной жалобы) - слабая / сильная, есть основания для принятия следующего ...:'.",
    "Если спор против нас, указывай в этой формуле 'слабая'. Если мы сами оспариваем судебный акт, указывай 'сильная'.",
    "После двоеточия в desiredOutcome кратко укажи, какой судебный акт должен быть принят и в какой части.",
    "Обоснование позиции в prospectsReasoning верни как обычную строку с нумерованными тезисами и абзацами, без массива и без вложенных объектов.",
    "Поле finalReport оформи по шаблону: 'I. КАРТОЧКА ДЕЛА', затем таблица/структурированный блок по делу; далее 'II. ВЫВОДЫ О ПЕРСПЕКТИВАХ'; далее 'III. ОПИСАНИЕ СИТУАЦИИ'; далее 'IV. ОБОСНОВАНИЕ ПОЗИЦИИ'.",
    "Верни только валидный JSON без markdown-оберток, без пояснений до и после JSON.",
    "Ты должен вернуть только структурированные данные для предзаполнения формы и итогового черновика справки. Не возвращай пояснений, комментариев, markdown-оберток или текста вне требуемой структуры.",
  ].join(" ");
}

async function requestOpenAIAnalysis({ model, reasoningEffort, instructions, payload }) {
  if (!API_BASE_URL && PUBLIC_GEMINI_API_KEY) {
    return requestGeminiDirectAnalysis({ model, instructions, payload, reasoningEffort });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(buildApiUrl("/api/analyze"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: reasoningEffort },
        instructions,
        input: payload,
        text: {
          format: {
            type: "json_schema",
            name: "case_brief",
            strict: true,
            schema: getCaseBriefSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("AI не ответил за 120 секунд. Попробуйте еще раз или уменьшите объем документов.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "OpenAI API вернул ошибку.";
    throw new Error(`Ошибка OpenAI API: ${message}`);
  }

  const raw = extractResponseText(data);
  if (!raw) {
    throw new Error("OpenAI API не вернул текст результата.");
  }

  try {
    const parsed = JSON.parse(raw);
    if (data.provider && typeof parsed === "object" && parsed !== null) {
      parsed.provider = data.provider;
    }
    return parsed;
  } catch (error) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (data.provider && typeof parsed === "object" && parsed !== null) {
          parsed.provider = data.provider;
        }
        return parsed;
      } catch (_ignored) {
      }
    }
    throw new Error("AI вернул ответ, но приложение не смогло разобрать его как JSON.");
  }
}

function resolveApiBaseUrl() {
  const configured = window.APP_CONFIG?.apiBaseUrl;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/+$/u, "");
  }
  return "";
}

function resolvePublicGeminiApiKey() {
  const configured = window.APP_CONFIG?.publicGeminiApiKey;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return "";
}

function buildApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function isGitHubPages() {
  return /\.github\.io$/iu.test(window.location.hostname);
}

function buildBackendErrorMessage() {
  if (isGitHubPages()) {
    return "Для версии на GitHub Pages нужен backend или публичный Gemini key в config.js.";
  }
  return "Backend недоступен. Откройте приложение через http://127.0.0.1:8000 и убедитесь, что сервер запущен.";
}

async function requestGeminiDirectAnalysis({ model, instructions, payload, reasoningEffort }) {
  const selectedModel = model && !model.startsWith("gpt-") ? model : "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(PUBLIC_GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: instructions
          ? { parts: [{ text: `${instructions} Уровень глубины анализа: ${reasoningEffort}.` }] }
          : undefined,
        contents: [
          {
            role: "user",
            parts: [{ text: payload }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || "Gemini API вернул ошибку.";
    throw new Error(`Ошибка Gemini API: ${message}`);
  }

  const raw = extractGeminiText(data);
  if (!raw) {
    throw new Error("Gemini API не вернул текст результата.");
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      parsed.provider = "gemini";
    }
    return parsed;
  } catch (_error) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === "object" && parsed !== null) {
        parsed.provider = "gemini";
      }
      return parsed;
    }
    throw new Error("Gemini вернул ответ, но приложение не смогло разобрать его как JSON.");
  }
}

function extractGeminiText(data) {
  let text = "";
  const candidates = data?.candidates || [];
  if (candidates.length) {
    const parts = candidates[0]?.content?.parts || [];
    parts.forEach((part) => {
      if (typeof part?.text === "string") {
        text += part.text;
      }
    });
  }
  return text.trim();
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const texts = [];
    data.output.forEach((item) => {
      if (Array.isArray(item.content)) {
        item.content.forEach((content) => {
          if (content.type === "output_text" && content.text) {
            texts.push(content.text);
          }
        });
      }
    });
    if (texts.length) {
      return texts.join("\n").trim();
    }
  }

  return "";
}

function normalizeAiResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const caseInfo = result.case_information || result.case_info || {};
  const justificationItems = readFieldValue(result.justification_of_position) || readFieldValue(result.position_justification) || [];
  const normalized = {
    ...result,
    evidence: result.evidence || buildEvidenceFromCaseInfo(caseInfo),
    caseNumber: firstNonEmpty(readFieldValue(result.caseNumber), readFieldValue(caseInfo.case_number)),
    courtName: firstNonEmpty(readFieldValue(result.courtName), readFieldValue(caseInfo.court_name)),
    judgeName: firstNonEmpty(readFieldValue(result.judgeName), readFieldValue(caseInfo.judge_name), readFieldValue(caseInfo.presiding_judge)),
    presidingJudge: firstNonEmpty(readFieldValue(result.presidingJudge), readFieldValue(caseInfo.presiding_judge)),
    instance: firstNonEmpty(
      readFieldValue(result.instance),
      readFieldValue(caseInfo.instance),
      inferInstanceFromText([
        readFieldValue(caseInfo.case_status),
        readFieldValue(caseInfo.subject_matter),
        readFieldValue(result.perspective_of_dispute),
        readFieldValue(result.dispute_outlook),
        readFieldValue(result.finalReport),
      ].filter(Boolean).join(" ")),
    ),
    disputeStatus: firstNonEmpty(readFieldValue(result.disputeStatus), readFieldValue(caseInfo.dispute_status), readFieldValue(caseInfo.case_status)),
    claimant: firstNonEmpty(readFieldValue(result.claimant), readFieldValue(caseInfo.plaintiff), readFieldValue(caseInfo.applicant)),
    respondent: firstNonEmpty(readFieldValue(result.respondent), readFieldValue(caseInfo.defendant), readFieldValue(caseInfo.debtor)),
    caseSubject: firstNonEmpty(readFieldValue(result.caseSubject), readFieldValue(caseInfo.subject_of_dispute), readFieldValue(caseInfo.subject_matter), readFieldValue(caseInfo.case_type)),
    hearingDate: firstNonEmpty(readFieldValue(result.hearingDate), readFieldValue(caseInfo.hearing_date), readFieldValue(caseInfo.session_date)),
    hearingTime: firstNonEmpty(readFieldValue(result.hearingTime), readFieldValue(caseInfo.hearing_time), readFieldValue(caseInfo.session_time)),
    situationSummary: firstNonEmpty(readFieldValue(result.situationSummary), readFieldValue(result.situation_description)),
    desiredOutcome: firstNonEmpty(readFieldValue(result.desiredOutcome), readFieldValue(result.expected_outcome), readFieldValue(result.perspective_of_dispute), readFieldValue(result.dispute_outlook)),
    prospectsReasoning: firstNonEmpty(readFieldValue(result.prospectsReasoning), formatPositionJustification(justificationItems)),
  };

  normalized.finalReport = firstNonEmpty(readFieldValue(result.finalReport), normalized.finalReport);

  if (!normalized.finalReport || !normalized.finalReport.trim() || /требует уточнения/iu.test(normalized.finalReport)) {
    normalized.finalReport = buildFinalReportFromNormalized(normalized);
  }

  return normalized;
}

function formatPositionJustification(items) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }

  return items
    .map((item, index) => {
      const thesis = readFieldValue(item?.thesis);
      const argument = firstNonEmpty(readFieldValue(item?.argument), readFieldValue(item?.paragraph));
      if (!thesis && !argument) {
        return "";
      }
      return `${index + 1}. ${thesis}\n${argument}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildFinalReportFromNormalized(result) {
  const meta = {
    caseNumber: result.caseNumber || "",
    courtName: result.courtName || "",
    judgeName: result.judgeName || "",
    presidingJudge: result.presidingJudge || "",
    instance: result.instance || "",
    disputeStatus: result.disputeStatus || "",
    claimant: result.claimant || "",
    respondent: result.respondent || "",
    caseSubject: result.caseSubject || "",
    hearingDate: result.hearingDate || "",
    hearingTime: result.hearingTime || "",
    situationSummary: result.situationSummary || "",
    desiredOutcome: result.desiredOutcome || "",
    prospectsReasoning: result.prospectsReasoning || "",
  };

  return trimReport(buildTemplatePreview(meta));
}

function getCaseBriefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      caseNumber: { type: "string" },
      courtName: { type: "string" },
      judgeName: { type: "string" },
      presidingJudge: { type: "string" },
      instance: { type: "string" },
      disputeStatus: { type: "string" },
      claimant: { type: "string" },
      respondent: { type: "string" },
      caseSubject: { type: "string" },
      hearingDate: { type: "string" },
      hearingTime: { type: "string" },
      situationSummary: { type: "string" },
      desiredOutcome: { type: "string" },
      prospectsReasoning: { type: "string" },
      finalReport: { type: "string" },
      evidence: {
        type: "object",
        additionalProperties: false,
        properties: {
          caseNumber: { type: "string" },
          courtName: { type: "string" },
          parties: { type: "string" },
          hearing: { type: "string" },
          desiredOutcome: { type: "string" },
          prospectsReasoning: { type: "string" }
        },
        required: [
          "caseNumber",
          "courtName",
          "parties",
          "hearing",
          "desiredOutcome",
          "prospectsReasoning"
        ]
      }
    },
    required: [
      "caseNumber",
      "courtName",
      "judgeName",
      "presidingJudge",
      "instance",
      "disputeStatus",
      "claimant",
      "respondent",
      "caseSubject",
      "hearingDate",
      "hearingTime",
      "situationSummary",
      "desiredOutcome",
      "prospectsReasoning",
      "finalReport",
      "evidence"
    ],
  };
}

function applyAiResult(result) {
  overwriteIfPresent(els.caseNumber, result.caseNumber);
  overwriteIfPresent(els.courtName, result.courtName);
  overwriteIfPresent(els.judgeName, result.judgeName);
  overwriteIfPresent(els.presidingJudge, result.presidingJudge);
  overwriteIfPresent(els.instance, result.instance);
  overwriteIfPresent(els.disputeStatus, result.disputeStatus);
  overwriteIfPresent(els.claimant, result.claimant);
  overwriteIfPresent(els.respondent, result.respondent);
  overwriteIfPresent(els.caseSubject, result.caseSubject);
  overwriteIfPresent(els.hearingDate, result.hearingDate);
  overwriteIfPresent(els.hearingTime, result.hearingTime);
  overwriteIfPresent(els.situationSummary, result.situationSummary);
  overwriteIfPresent(els.desiredOutcome, result.desiredOutcome);
  overwriteIfPresent(els.prospectsReasoning, result.prospectsReasoning);
}

function renderAiReport(result) {
  if (result.finalReport && result.finalReport.trim()) {
    return trimReport(result.finalReport.trim());
  }
  return buildReport(result);
}

function buildReport(aiOverride = null) {
  const aiMeta = aiOverride || state.lastAiResult || null;
  const meta = collectMeta(aiMeta);
  const sourceFallback = state.sourceFiles
    .filter((file) => file.status === "ok" && file.text)
    .map((file) => ({ origin: file.name, text: file.text }));
  const effectivePositions = sourceFallback;
  const effectiveActs = sourceFallback;
  const enrichedMeta = {
    ...meta,
    desiredOutcome: composeProspectsSection(meta, effectivePositions, effectiveActs),
    situationSummary: composeSituationSection(meta, effectivePositions, effectiveActs),
    prospectsReasoning: composeReasoningSection(meta, effectivePositions, effectiveActs),
  };

  const report = trimReport(buildTemplatePreview(enrichedMeta));

  const sourceCount = getAllParsedSources().length;
  els.outputMeta.textContent = `Справка сформирована. Использовано загруженных документов: ${sourceCount}.`;
  return report;
}

function getPreferredReportText() {
  const aiResult = state.lastAiResult;
  if (aiResult?.finalReport && aiResult.finalReport.trim()) {
    return trimReport(aiResult.finalReport.trim());
  }
  if (aiResult) {
    return buildReport(aiResult);
  }
  return buildReport();
}

function collectMeta(aiMeta = null) {
  return {
    caseNumber: preferAiValue(els.caseNumber.value, aiMeta?.caseNumber),
    courtName: preferAiValue(els.courtName.value, aiMeta?.courtName),
    judgeName: preferAiValue(els.judgeName.value, aiMeta?.judgeName),
    presidingJudge: preferAiValue(els.presidingJudge.value, aiMeta?.presidingJudge),
    instance: preferAiValue(els.instance.value, aiMeta?.instance),
    disputeStatus: preferAiValue(els.disputeStatus.value, aiMeta?.disputeStatus),
    claimant: preferAiValue(els.claimant.value, aiMeta?.claimant),
    respondent: preferAiValue(els.respondent.value, aiMeta?.respondent),
    caseSubject: preferAiValue(els.caseSubject.value, aiMeta?.caseSubject),
    hearingDate: preferAiValue(els.hearingDate.value, aiMeta?.hearingDate),
    hearingTime: preferAiValue(els.hearingTime.value, aiMeta?.hearingTime),
    situationSummary: preferAiValue(els.situationSummary.value, aiMeta?.situationSummary),
    desiredOutcome: preferAiValue(els.desiredOutcome.value, aiMeta?.desiredOutcome),
    prospectsReasoning: preferAiValue(els.prospectsReasoning.value, aiMeta?.prospectsReasoning),
  };
}

function mergeSources(manualText, files) {
  const chunks = [];

  if (manualText.trim()) {
    chunks.push({ origin: "manual", text: manualText.trim() });
  }

  files
    .filter((file) => file.status === "ok" && file.text)
    .forEach((file) => {
      chunks.push({ origin: file.name, text: file.text });
    });

  return chunks;
}

function composeInfoSection(meta) {
  const lines = [
    `Дело: ${meta.caseNumber || "номер не указан"}.`,
    `Суд: ${meta.courtName || "не указан"}.`,
    `Инстанция: ${meta.instance || "не указана"}.`,
    `Состав суда: ${meta.judgeName || "не указан"}.`,
    `Председательствующий: ${meta.presidingJudge || "не указан"}.`,
    `Предмет спора: ${meta.caseSubject ? ensurePeriod(cleanSentence(meta.caseSubject)) : "требует уточнения."}`,
    `Статус спора: ${meta.disputeStatus ? ensurePeriod(cleanSentence(meta.disputeStatus)) : "требует уточнения."}`,
    `Стороны спора: ${buildPartiesLine(meta)}.`,
  ];

  const hearingLine = buildHearingLine(meta);
  if (hearingLine) {
    lines.push(hearingLine);
  }

  return lines.join("\n");
}

function composeProspectsSection(meta, positionsSource, actsSource) {
  const extracted = pickDesiredPosition(positionsSource, actsSource);
  const conclusion = meta.desiredOutcome || extracted.conclusion;
  const normalizedConclusion = conclusion ? cleanSentence(conclusion) : "";
  const heading = buildProspectsLead(meta, normalizedConclusion);
  const body = normalizedConclusion
    ? stripProspectsLead(normalizedConclusion)
    : "требует уточнения.";
  return `${heading}\n${ensurePeriod(trimText(body, 900))}`;
}

function composeSituationSection(meta, positionsSource, actsSource) {
  if (meta.situationSummary) {
    return ensurePeriod(trimText(cleanSentence(meta.situationSummary), 800));
  }

  const summary = summarizeSituationFromSources(positionsSource, actsSource, meta);
  return ensurePeriod(trimText(summary, 800));
}

function composeReasoningSection(meta, positionsSource, actsSource) {
  if (meta.prospectsReasoning) {
    return trimText(meta.prospectsReasoning.trim(), 1400);
  }

  const merged = [...positionsSource, ...actsSource].map((item) => item.text).join("\n");
  const relevant = pickRelevantSentences(splitIntoSentences(merged), [
    "неправ",
    "наруш",
    "подлеж",
    "отмен",
    "остав",
    "законн",
    "обосн",
    "кассацион",
    "апелляцион",
    "суд первой инстанции",
  ]).slice(0, 4);

  if (!relevant.length) {
    return "Обоснование позиции следует дополнить тезисами из жалобы, отзыва либо судебного акта, который должен устоять.";
  }

  return relevant.map((line, index) => `${index + 1}. ${trimText(line, 260)}\n${trimText(line, 320)}`).join("\n\n");
}

function splitIntoSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 25);
}

function pickRelevantSentences(sentences, keywords) {
  return sentences.filter((sentence) =>
    keywords.some((keyword) => sentence.toLowerCase().includes(keyword))
  );
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[0].trim() : "";
}

function findCourtName(text) {
  const match = text.match(/((Арбитражн(?:ый|ого|ом)\s+суд[а-яё\s"«»\-]+)|(Верховн(?:ый|ого|ом)\s+Суд[а-яё\s"«»\-]+))/iu);
  return match ? normalizeSpaces(match[0]) : "";
}

function findJudgeName(text) {
  const match = text.match(/суд(?:ья|ьи)\s+([А-ЯЁ][а-яё-]+\s*[А-ЯЁ]\.[А-ЯЁ]\.)/u);
  return match ? `судья ${match[1]}` : "";
}

function findPresidingJudge(text) {
  const match = text.match(/председательствующ(?:ий|его|ая|его судьи)[^А-ЯЁ]{0,20}([А-ЯЁ][а-яё-]+\s*[А-ЯЁ]\.[А-ЯЁ]\.)/u);
  if (match) {
    return match[1];
  }
  return findJudgeName(text).replace(/^судья\s+/u, "");
}

function findInstance(lowerText) {
  if (lowerText.includes("кассацион")) {
    return "кассационная инстанция";
  }
  if (lowerText.includes("апелляцион")) {
    return "апелляционная инстанция";
  }
  if (lowerText.includes("верховный суд")) {
    return "Верховный Суд РФ";
  }
  return "";
}

function findDisputeStatus(sentences) {
  const target = sentences.find((sentence) =>
    /(назнач|принят|поступ|подана|рассмотрени|жалоб)/iu.test(sentence)
  );
  return target ? cleanSentence(target) : "";
}

function findPartyByRole(text, roles) {
  for (const role of roles) {
    const pattern = new RegExp(`${role}\\s*[:\\-]?\\s*([^\\n.;]{4,120})`, "iu");
    const match = text.match(pattern);
    if (match) {
      return normalizeSpaces(match[1]);
    }
  }
  return "";
}

function findCaseSubject(sentences) {
  const match = sentences.find((sentence) =>
    /\b(о взыскани|о привлечени|об оспаривани|о признани|о банкротств|субсидиар)/iu.test(sentence)
  );
  return match ? cleanSentence(match) : "";
}

function findHearingDate(text) {
  const hearingMatch = text.match(/(?:принят[а-я\s]{0,40}к производству|назначен[ао]?|рассмотрени[ея]\s+на)\D{0,80}(\d{2}\.\d{2}\.\d{4})/iu);
  if (hearingMatch) {
    return hearingMatch[1];
  }
  const dateMatch = text.match(/\b\d{2}\.\d{2}\.\d{4}\b/u);
  return dateMatch ? dateMatch[0] : "";
}

function findHearingTime(text) {
  const timeMatch = text.match(/(?:принят[а-я\s]{0,40}к производству|назначен[ао]?|рассмотрени[ея]\s+на)[^0-9]{0,80}\d{2}\.\d{2}\.\d{4}[^0-9]{0,40}(([01]?\d|2[0-3])[:.][0-5]\d)/iu);
  if (timeMatch) {
    return timeMatch[1];
  }
  return firstMatch(text, /\b([01]?\d|2[0-3])[:.][0-5]\d\b/u);
}

function findSituationSummary(sentences) {
  const summary = sentences
    .filter((sentence) => /\b(спор|дело|требован|задолженн|жалоб|суд)\b/iu.test(sentence))
    .slice(0, 3)
    .join(" ");
  return cleanSentence(summary);
}

function findDesiredOutcome(sentences) {
  const target = sentences.find((sentence) =>
    /(просит|просим|оставить|отменить|удовлетворить|отказать|направить)/iu.test(sentence)
  );
  return target ? cleanSentence(target) : "";
}

function findProspectsReasoning(sentences) {
  const target = sentences.find((sentence) =>
    /(поскольку|так как|в связи с|неправил|нарушен|обоснован|законен|подлежит)/iu.test(sentence)
  );
  return target ? cleanSentence(target) : "";
}

function overwriteIfPresent(element, value) {
  if (typeof value === "string" && value.trim()) {
    element.value = value.trim();
  }
}

function preferAiValue(fieldValue, aiValue) {
  const formValue = (fieldValue || "").trim();
  const modelValue = (aiValue || "").trim();
  return modelValue || formValue;
}

function pickDesiredPosition(positionsSource, actsSource) {
  const merged = [...positionsSource, ...actsSource].map((item) => item.text).join("\n");
  const sentences = splitIntoSentences(merged);
  return {
    conclusion: findDesiredOutcome(sentences),
    support: findProspectsReasoning(sentences),
  };
}

function summarizeSituationFromSources(positionsSource, actsSource, meta) {
  const parts = [];
  if (meta.caseSubject) {
    parts.push(`Спор касается ${cleanSentence(meta.caseSubject)}`);
  }

  const sentencePool = [...positionsSource, ...actsSource]
    .flatMap((item) => splitIntoSentences(item.text))
    .slice(0, 3);

  if (sentencePool.length) {
    parts.push(sentencePool.join(" "));
  }

  return parts.length ? parts.join(". ") : "Суть спора требует дополнительного заполнения по материалам дела";
}

function buildPartiesLine(meta) {
  const parts = [];
  if (meta.claimant) {
    parts.push(`заявитель/истец ${cleanSentence(meta.claimant)}`);
  }
  if (meta.respondent) {
    parts.push(`ответчик/иное лицо ${cleanSentence(meta.respondent)}`);
  }
  return parts.length ? parts.join("; ") : "не указаны";
}

function buildHearingLine(meta) {
  if (!meta.hearingDate && !meta.hearingTime && !meta.presidingJudge) {
    return "";
  }

  const pieces = [];
  if (meta.hearingDate) {
    pieces.push(`дата ${meta.hearingDate}`);
  }
  if (meta.hearingTime) {
    pieces.push(`время ${meta.hearingTime}`);
  }
  if (meta.presidingJudge) {
    pieces.push(`председательствующий ${meta.presidingJudge}`);
  }
  return `Сведения о заседании: ${pieces.join(", ")}.`;
}

function cleanSentence(text) {
  return text.trim().replace(/\s+/g, " ").replace(/[.。]+$/g, "");
}

function ensurePeriod(text) {
  const value = text.trim();
  return value && !/[.!?]$/u.test(value) ? `${value}.` : value;
}

function normalizeSpaces(text) {
  return text.replace(/\s+/g, " ").trim();
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function trimReport(text) {
  const maxLength = 7500;
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}\n\n[Текст сокращен автоматически для соблюдения объема справки.]`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setIngestMeta(text) {
  els.ingestMeta.textContent = text || "";
  els.ingestMeta.hidden = !text;
}

function setAiMeta(text) {
  els.aiMeta.textContent = text || "";
  els.aiMeta.hidden = !text;
}

function writeAiDebug(payload) {
  const filled = countFilledAiFields(payload);
  els.aiDebugPanel.hidden = false;
  els.aiDebugOutput.textContent = `Заполнено полей: ${filled}\n\n${JSON.stringify(payload, null, 2)}`;
}

function buildEvidenceFromCaseInfo(caseInfo) {
  if (!caseInfo || typeof caseInfo !== "object") {
    return {
      caseNumber: "",
      courtName: "",
      parties: "",
      hearing: "",
      desiredOutcome: "",
      prospectsReasoning: "",
    };
  }

  return {
    caseNumber: firstNonEmpty(readFieldValue(caseInfo.evidence_case_number), readFieldValue(caseInfo.case_number?.evidence)),
    courtName: firstNonEmpty(readFieldValue(caseInfo.evidence_court_name), readFieldValue(caseInfo.court_name?.evidence)),
    parties: [
      readFieldValue(caseInfo.evidence_plaintiff),
      readFieldValue(caseInfo.evidence_defendant),
      readFieldValue(caseInfo.evidence_third_parties),
      readFieldValue(caseInfo.plaintiff?.evidence),
      readFieldValue(caseInfo.applicant?.evidence),
      readFieldValue(caseInfo.defendant?.evidence),
      readFieldValue(caseInfo.debtor?.evidence),
      readFieldValue(caseInfo.other_parties?.evidence),
    ].filter(Boolean).join(" | "),
    hearing: [
      readFieldValue(caseInfo.evidence_presiding_judge),
      readFieldValue(caseInfo.evidence_hearing_date),
      readFieldValue(caseInfo.evidence_hearing_time),
      readFieldValue(caseInfo.presiding_judge?.evidence),
      readFieldValue(caseInfo.hearing_date?.evidence),
      readFieldValue(caseInfo.hearing_time?.evidence),
    ].filter(Boolean).join(" | "),
    desiredOutcome: "",
    prospectsReasoning: "",
  };
}

function inferInstanceFromText(text) {
  const value = (text || "").toLowerCase();
  if (!value) {
    return "";
  }
  if (value.includes("касса")) {
    return "кассация";
  }
  if (value.includes("апелляц")) {
    return "апелляция";
  }
  if (value.includes("первая инстанц")) {
    return "первая инстанция";
  }
  return "";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readFieldValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    if (typeof value.value === "string") {
      return value.value.trim();
    }
    if (Array.isArray(value.value)) {
      return value.value;
    }
  }
  return "";
}

function setGptIndicator(isConnected, label) {
  els.gptStatus.classList.remove("status-pill--on", "status-pill--off", "status-pill--neutral", "status-pill--progress");
  els.gptStatus.classList.add(isConnected ? "status-pill--on" : "status-pill--off");
  els.gptStatusText.textContent = label;
}

function setNeutralGptIndicator(label) {
  els.gptStatus.classList.remove("status-pill--on", "status-pill--off", "status-pill--neutral", "status-pill--progress");
  els.gptStatus.classList.add("status-pill--neutral");
  els.gptStatusText.textContent = label;
}

function setProgressGptIndicator(label) {
  els.gptStatus.classList.remove("status-pill--on", "status-pill--off", "status-pill--neutral", "status-pill--progress");
  els.gptStatus.classList.add("status-pill--progress");
  els.gptStatusText.textContent = label;
}

function startAiProgress() {
  els.aiProgressBlock.hidden = false;
  setAiProgressStep(0);
}

function setAiProgressStep(step) {
  const progressWidth = step === 0 ? "4%" : step === 1 ? "33%" : step === 2 ? "68%" : "100%";
  els.aiProgressFill.style.width = progressWidth;

  const steps = [
    els.progressStepUpload,
    els.progressStepAnalyze,
    els.progressStepFill,
  ];

  steps.forEach((element, index) => {
    element.classList.remove("progress-step--active", "progress-step--done");
    if (index + 1 < step) {
      element.classList.add("progress-step--done");
    } else if (index + 1 === step) {
      element.classList.add("progress-step--active");
    }
  });

  if (step === 3) {
    els.progressStepUpload.classList.add("progress-step--done");
    els.progressStepAnalyze.classList.add("progress-step--done");
    els.progressStepFill.classList.add("progress-step--done");
  }
}

function failAiProgress() {
  els.aiProgressFill.style.width = "0%";
  [
    els.progressStepUpload,
    els.progressStepAnalyze,
    els.progressStepFill,
  ].forEach((element) => {
    element.classList.remove("progress-step--active", "progress-step--done");
  });
}

function fillDemo() {
  els.caseNumber.value = "А40-12345/2026";
  els.courtName.value = "Арбитражный суд города Москвы";
  els.judgeName.value = "судья Иванова И.И.";
  els.presidingJudge.value = "Петров П.П.";
  els.instance.value = "кассационная инстанция";
  els.disputeStatus.value = "Кассационная жалоба подана и принята к производству, судебное заседание назначено.";
  els.claimant.value = "ООО «Альфа»";
  els.respondent.value = "АО «Бета»";
  els.caseSubject.value = "взыскание задолженности и неустойки по договору поставки";
  els.hearingDate.value = "21.04.2026";
  els.hearingTime.value = "10:15";
  els.situationSummary.value = "Спор возник из-за неоплаты поставленного товара. Первая инстанция частично удовлетворила иск. Ответчик подал жалобу и просит отменить судебные акты.";
  els.desiredOutcome.value = "Суд кассационной инстанции должен оставить ранее принятые судебные акты без изменения, а жалобу без удовлетворения";
  els.prospectsReasoning.value = "1. Выводы нижестоящих судов являются законными и обоснованными.\nСуды установили фактические обстоятельства на основании надлежащих письменных доказательств и правильно применили нормы материального права.\n\n2. Доводы жалобы не опровергают установленную задолженность.\nЗаявитель жалобы повторяет уже исследованные возражения, которые были мотивированно отклонены судами, и не приводит новых обстоятельств, способных изменить результат рассмотрения спора.";
}

function clearAll() {
  document.getElementById("case-form").reset();
  els.openaiModel.value = "gemini-2.5-flash";
  els.reasoningEffort.value = "medium";
  els.reportOutput.value = "";
  els.outputMeta.textContent = "Справка ещё не сформирована.";
  setIngestMeta("");
  setAiMeta("");
  els.aiDebugPanel.hidden = true;
  els.aiDebugOutput.textContent = "Ответ AI ещё не получен.";
  setNeutralGptIndicator("Статус AI");
  els.aiProgressBlock.hidden = true;
  els.aiProgressFill.style.width = "0%";
  els.sourceInput.value = "";
  state.sourceFiles = [];
  state.lastAiResult = null;
  renderFileList(els.sourceFiles, []);
  initializeAiStatus();
}

async function copyReport() {
  const report = els.reportOutput.value.trim();
  if (!report) {
    els.outputMeta.textContent = "Сначала сформируйте справку.";
    return;
  }

  await navigator.clipboard.writeText(report);
  els.outputMeta.textContent = "Текст справки скопирован в буфер обмена.";
}

function downloadTxtReport() {
  const content = els.reportOutput.value.trim();
  if (!content) {
    els.outputMeta.textContent = "Сначала сформируйте справку.";
    return;
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, `${buildSafeFileName()}.txt`);
}

function downloadPdfReport() {
  const content = els.reportOutput.value.trim();
  if (!content) {
    els.outputMeta.textContent = "Сначала сформируйте справку.";
    return;
  }
  if (!window.pdfMake) {
    els.outputMeta.textContent = "Библиотека PDF-экспорта не загрузилась.";
    return;
  }

  try {
    const docDefinition = buildPdfDefinition(content);
    window.pdfMake.createPdf(docDefinition).download(`${buildSafeFileName()}.pdf`);
    els.outputMeta.textContent = "PDF сформирован.";
  } catch (error) {
    els.outputMeta.textContent = "Не удалось сформировать PDF.";
  }
}

async function downloadDocxReport() {
  const content = els.reportOutput.value.trim();
  if (!content) {
    els.outputMeta.textContent = "Сначала сформируйте справку.";
    return;
  }
  if (!window.htmlDocx) {
    els.outputMeta.textContent = "Библиотека DOCX-экспорта не загрузилась.";
    return;
  }

  try {
    const html = buildDocxHtml(content);
    const blob = window.htmlDocx.asBlob(html, {
      orientation: "portrait",
      margins: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720,
      },
    });
    triggerDownload(blob, `${buildSafeFileName()}.docx`);
    els.outputMeta.textContent = "DOCX сформирован.";
  } catch (error) {
    els.outputMeta.textContent = "Не удалось сформировать DOCX.";
  }
}

async function exportBundle() {
  if (!els.reportOutput.value.trim()) {
    els.reportOutput.value = getPreferredReportText();
  }

  downloadPdfReport();
  await downloadDocxReport();
  els.outputMeta.textContent = "Выгрузка PDF и DOCX запущена.";
}

function triggerDownload(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function buildSafeFileName() {
  return (els.caseNumber.value || "spravka-po-delu").replace(/[^\wа-яА-Я.-]+/gu, "_");
}

function hasMeaningfulAiPrefill(result) {
  const keys = [
    "caseNumber",
    "courtName",
    "judgeName",
    "presidingJudge",
    "instance",
    "disputeStatus",
    "claimant",
    "respondent",
    "caseSubject",
    "hearingDate",
    "hearingTime",
    "situationSummary",
    "desiredOutcome",
    "prospectsReasoning",
  ];

  const filled = keys.filter((key) => typeof result?.[key] === "string" && result[key].trim()).length;
  return filled >= 3;
}

function countFilledAiFields(result) {
  const keys = [
    "caseNumber",
    "courtName",
    "judgeName",
    "presidingJudge",
    "instance",
    "disputeStatus",
    "claimant",
    "respondent",
    "caseSubject",
    "hearingDate",
    "hearingTime",
    "situationSummary",
    "desiredOutcome",
    "prospectsReasoning",
  ];

  return keys.filter((key) => typeof result?.[key] === "string" && result[key].trim()).length;
}

function buildPdfDefinition() {
  const meta = collectMeta(state.lastAiResult);
  const infoRows = buildCaseCardRows(meta).map(([label, value]) => ([
    { text: label, style: "cellLabel" },
    { text: formatRichMultilinePdf(value), style: "cellValue" },
  ]));
  const reasoningBlocks = splitReasoningBlocks(meta.prospectsReasoning);
  return {
    pageSize: "A4",
    pageMargins: [72, 72, 72, 72],
    content: [
      { text: "I. КАРТОЧКА ДЕЛА", style: "sectionLead", margin: [0, 0, 0, 8] },
      {
        table: {
          widths: [118, "*"],
          body: infoRows,
        },
        layout: {
          hLineWidth: () => 0.8,
          vLineWidth: () => 0.8,
          hLineColor: () => "#000000",
          vLineColor: () => "#000000",
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
      { text: "II. ВЫВОДЫ О ПЕРСПЕКТИВАХ", style: "sectionLead", pageBreak: "before", margin: [0, 0, 0, 8] },
      { text: formatRichMultilinePdf(formatProspectsForDisplay(meta)), style: "body" },
      { text: "III. ОПИСАНИЕ СИТУАЦИИ", style: "sectionLead", margin: [0, 12, 0, 6] },
      { text: formatRichMultilinePdf(meta.situationSummary || "Требует уточнения."), style: "body" },
      { text: "IV. ОБОСНОВАНИЕ ПОЗИЦИИ", style: "sectionLead", margin: [0, 12, 0, 6] },
      ...reasoningBlocks.map((block) => ({ text: formatRichMultilinePdf(block), style: "body", margin: [0, 0, 0, 6] })),
    ],
    defaultStyle: {
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.15,
    },
    styles: {
      sectionLead: {
        fontSize: 11,
        bold: true,
        alignment: "left",
      },
      cellLabel: {
        fontSize: 11,
        bold: false,
        alignment: "left",
        lineHeight: 1.15,
      },
      cellValue: {
        fontSize: 11,
        alignment: "justify",
        lineHeight: 1.15,
      },
      body: {
        fontSize: 11,
        alignment: "justify",
        lineHeight: 1.15,
      },
    },
  };
}

function buildDocxHtml() {
  const meta = collectMeta(state.lastAiResult);
  const rows = buildCaseCardRows(meta)
    .map(([label, value]) => `<tr><td class="label">${escapeHtml(label)}</td><td class="value">${formatRichMultilineHtml(value)}</td></tr>`)
    .join("");
  const reasoningBlocks = splitReasoningBlocks(meta.prospectsReasoning)
    .map((block) => `<p class="body">${formatRichMultilineHtml(block)}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 2.54cm; }
    body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.15; color: #000; }
    p { margin: 0 0 6pt 0; }
    .section { font-weight: 700; text-transform: uppercase; margin: 0 0 8pt 0; }
    .section.page-break { page-break-before: always; }
    .body { text-align: justify; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 12pt 0; }
    td { border: 1pt solid #000; vertical-align: top; padding: 5pt 8pt; text-align: justify; }
    td.label { width: 22.8%; text-align: left; }
    td.value { width: 77.2%; }
    .line { display: block; margin: 0 0 4pt 0; }
    .line:last-child { margin-bottom: 0; }
  </style>
</head>
<body>
  <p class="section">I. КАРТОЧКА ДЕЛА</p>
  <table>${rows}</table>
  <p class="section page-break">II. ВЫВОДЫ О ПЕРСПЕКТИВАХ</p>
  <p class="body">${formatRichMultilineHtml(formatProspectsForDisplay(meta))}</p>
  <p class="section">III. ОПИСАНИЕ СИТУАЦИИ</p>
  <p class="body">${formatRichMultilineHtml(meta.situationSummary || "Требует уточнения.")}</p>
  <p class="section">IV. ОБОСНОВАНИЕ ПОЗИЦИИ</p>
  ${reasoningBlocks || '<p class="body">Требует уточнения.</p>'}
</body>
</html>`;
}

function buildTemplatePreview(meta) {
  const rows = buildCaseCardRows(meta)
    .map(([label, value]) => `${label} ${value}`)
    .join("\n");

  return [
    "I. КАРТОЧКА ДЕЛА",
    rows,
    "",
    "II. ВЫВОДЫ О ПЕРСПЕКТИВАХ",
    formatProspectsForDisplay(meta),
    "",
    "III. ОПИСАНИЕ СИТУАЦИИ",
    meta.situationSummary || "Требует уточнения.",
    "",
    "IV. ОБОСНОВАНИЕ ПОЗИЦИИ",
    meta.prospectsReasoning || "Требует уточнения.",
  ].join("\n");
}

function buildCaseCardRows(meta) {
  return [
    ["Реквизиты спора:", buildDisputeDetails(meta)],
    ["Предмет спора:", meta.caseSubject || "Требует уточнения."],
    ["Статус спора:", buildStatusDetails(meta)],
    ["Стороны спора:", buildPartiesDetails(meta)],
  ];
}

function buildDisputeDetails(meta) {
  const details = [
    meta.caseNumber ? `Дело № ${meta.caseNumber}` : "Дело: требует уточнения",
    meta.courtName || "",
    meta.instance || "",
  ].filter(Boolean);
  return ensurePeriod(details.join(" • "));
}

function buildStatusDetails(meta) {
  const parts = [meta.disputeStatus || "Требует уточнения."];
  if (meta.hearingDate || meta.hearingTime || meta.presidingJudge) {
    parts.push(buildHearingLine(meta));
  }
  return parts.filter(Boolean).join("\n");
}

function buildPartiesDetails(meta) {
  const parts = [];
  if (meta.claimant) {
    parts.push(`Заявитель: ${ensurePeriod(cleanSentence(meta.claimant))}`);
  }
  if (meta.respondent) {
    parts.push(`Ответчик / иное лицо: ${ensurePeriod(cleanSentence(meta.respondent))}`);
  }
  return parts.length ? parts.join("\n") : "Требует уточнения.";
}

function buildProspectsLead(meta, desiredOutcome) {
  const strength = inferProspectsStrength(meta, desiredOutcome);
  const actLabel = inferJudicialActLabel(meta, desiredOutcome);
  return `Правовая позиция заявителей (например, кассационной жалобы) - ${strength}, есть основания для принятия следующего ${actLabel}:`;
}

function inferProspectsStrength(meta, desiredOutcome) {
  const text = `${meta.instance || ""} ${meta.disputeStatus || ""} ${desiredOutcome || ""}`.toLowerCase();
  if (/(отменить|направить на новое рассмотрение|удовлетворить жалоб|удовлетворить заявление|изменить судебный акт)/u.test(text)) {
    return "сильная";
  }
  return "слабая";
}

function inferJudicialActLabel(meta, desiredOutcome) {
  const text = `${meta.instance || ""} ${desiredOutcome || ""}`.toLowerCase();
  if (text.includes("верхов")) {
    return "определения Верховного Суда РФ";
  }
  if (text.includes("касса")) {
    return "постановления кассационным судом";
  }
  if (text.includes("апелляц")) {
    return "постановления апелляционным судом";
  }
  return "судебного акта";
}

function stripProspectsLead(text) {
  return text.replace(/^Правовая позиция заявителей[\s\S]*?:\s*/u, "").trim() || text;
}

function formatProspectsForDisplay(meta) {
  const text = meta.desiredOutcome || "";
  if (!text) {
    return `${buildProspectsLead(meta, "")}\nтребует уточнения.`;
  }
  if (/^Правовая позиция заявителей/u.test(text.trim())) {
    return text.trim();
  }
  return `${buildProspectsLead(meta, text)}\n${ensurePeriod(cleanSentence(text))}`;
}

function splitReasoningBlocks(text) {
  const value = (text || "").trim();
  if (!value) {
    return [];
  }
  return value
    .split(/\n\s*\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatRichMultilineHtml(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<span class="line">${escapeHtml(line)}</span>`)
    .join("") || escapeHtml(String(text || ""));
}

function formatRichMultilinePdf(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return String(text || "");
  }

  return lines.flatMap((line, index) => (
    index === lines.length - 1
      ? [line]
      : [line, "\n"]
  ));
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getLeadText(files) {
  return files
    .map((file) => file.text.slice(0, 3000))
    .join("\n");
}

function getAcceptanceOrderText(files, fallbackText) {
  const selected = files
    .filter((file) => /(определени|жалоб|производств|принят)/iu.test(file.text))
    .map((file) => file.text)
    .join("\n");

  return selected || fallbackText;
}
