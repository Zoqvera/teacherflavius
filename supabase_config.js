window.SUPABASE_CONFIG = {
  url: "https://wnigzpvgsbpjdxvjzugt.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduaWd6cHZnc2JwamR4dmp6dWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTk1NzUsImV4cCI6MjA5Mjc3NTU3NX0.q2Mp8bPD4WvOjifSuQFfrAM4ig1ViEa6sMfUNcES-X0"
};

(function installLessonSaveNetworkRetry() {
  if (window.__teacherFlaviusLessonSaveRetryInstalled || typeof window.fetch !== "function") return;
  window.__teacherFlaviusLessonSaveRetryInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const lessonSavePath = "/rest/v1/rpc/save_teacher_class_lesson_record_by_ref";
  const retryDelays = [0, 450, 1200, 2500];

  function getRequestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function getRequestMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && input.method) return String(input.method).toUpperCase();
    return "GET";
  }

  function isTransientNetworkError(error) {
    if (!error) return false;
    if (error.name === "AbortError") return false;
    const message = String(error.message || error);
    return error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed/i.test(message);
  }

  window.fetch = async function teacherFlaviusFetchWithLessonRetry(input, init) {
    const url = getRequestUrl(input);
    const method = getRequestMethod(input, init);
    const shouldRetry = method === "POST" && url.includes(lessonSavePath);

    if (!shouldRetry) return nativeFetch(input, init);

    const requestTemplate = (typeof Request !== "undefined" && input instanceof Request)
      ? input.clone()
      : null;
    let lastError = null;

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      if (retryDelays[attempt] > 0) {
        await new Promise(function (resolve) {
          setTimeout(resolve, retryDelays[attempt]);
        });
      }

      try {
        const requestInput = requestTemplate ? requestTemplate.clone() : input;
        return await nativeFetch(requestInput, init);
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === retryDelays.length - 1;
        if (!isTransientNetworkError(error) || isLastAttempt) throw error;
      }
    }

    throw lastError || new TypeError("Failed to fetch");
  };
})();
