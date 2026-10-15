(function (root) {
  "use strict";

  const INVITATION_ID = "studentReviewInvitation";
  const SNOOZE_KEY_PREFIX = "teacherflavius:student-review-invitation:";
  const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
  const SCHOOL_TIME_ZONE = "America/Sao_Paulo";

  function calendarDateParts(value) {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: SCHOOL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type === "year" || part.type === "month" || part.type === "day") {
        parts[part.type] = Number(part.value);
      }
    }
    return parts;
  }

  function addCalendarMonths(dateParts, months) {
    const monthIndex = dateParts.year * 12 + dateParts.month - 1 + months;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
      year: year,
      month: month,
      day: Math.min(dateParts.day, lastDay)
    };
  }

  function sortableDate(dateParts) {
    return dateParts.year * 10000 + dateParts.month * 100 + dateParts.day;
  }

  function hasCompletedTwoMonths(enrolledAt, referenceDate) {
    const enrollmentDate = calendarDateParts(enrolledAt);
    const today = calendarDateParts(referenceDate || new Date());
    if (!enrollmentDate || !today) return false;

    return sortableDate(today) >= sortableDate(addCalendarMonths(enrollmentDate, 2));
  }

  function snoozeKey(studentId) {
    return SNOOZE_KEY_PREFIX + studentId;
  }

  function isSnoozed(storage, studentId, now) {
    if (!storage) return false;
    try {
      const dismissedAt = Number(storage.getItem(snoozeKey(studentId)));
      return Number.isFinite(dismissedAt) &&
        dismissedAt > 0 &&
        now - dismissedAt < SNOOZE_DURATION_MS &&
        now >= dismissedAt;
    } catch (_error) {
      return false;
    }
  }

  function recordDismissal(storage, studentId) {
    if (!storage) return;
    try {
      storage.setItem(snoozeKey(studentId), String(Date.now()));
    } catch (_error) {
      // Private browsing may disable storage; the invitation still works.
    }
  }

  function recordInvitationEvent(client, action) {
    try {
      return Promise.resolve(client.rpc("record_my_student_review_invitation", {
        target_action: action
      })).then(function (result) {
        return Boolean(result && !result.error && result.data === true);
      }).catch(function () {
        return false;
      });
    } catch (_error) {
      // Analytics must not interfere with the optional review invitation.
      return Promise.resolve(false);
    }
  }

  function attachInvitationHandlers(dialog, studentId, storage, client) {
    const dismissButton = dialog.querySelector("[data-review-invitation-close]");
    const reviewLink = dialog.querySelector("[data-review-invitation-link]");

    if (dismissButton) {
      dismissButton.addEventListener("click", function () {
        dialog.close();
      }, { once: true });
    }

    if (reviewLink) {
      reviewLink.addEventListener("click", async function (event) {
        recordDismissal(storage, studentId);

        // Modified clicks may open a second tab and must not be intercepted.
        if (event.defaultPrevented || event.button !== 0 ||
            event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          void recordInvitationEvent(client, "clicked");
          return;
        }

        event.preventDefault();
        // Give the RPC a short opportunity to finish before navigation.
        await Promise.race([
          recordInvitationEvent(client, "clicked"),
          new Promise(function (resolve) { root.setTimeout(resolve, 650); })
        ]);
        root.location.assign(reviewLink.href);
      }, { once: true });
    }

    dialog.addEventListener("close", function () {
      recordDismissal(storage, studentId);
      void recordInvitationEvent(client, "dismissed");
    }, { once: true });
  }

  function resolveStorage(settings) {
    if (Object.prototype.hasOwnProperty.call(settings, "storage")) {
      return settings.storage;
    }
    try {
      return root ? root.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  async function initialize(options) {
    const settings = options || {};
    const studentId = settings.studentId;
    const client = settings.client;
    const dialog = settings.dialog ||
      (root && root.document && root.document.getElementById(INVITATION_ID));
    const storage = resolveStorage(settings);
    const now = settings.now || new Date();

    if (settings.isProfessor || !studentId || !client ||
        !dialog || typeof dialog.showModal !== "function") {
      return false;
    }

    try {
      const profileResponse = await client.from("profiles")
        .select("enrolled,archived,enrolled_at,created_at")
        .eq("id", studentId)
        .maybeSingle();
      const profile = profileResponse.data;

      if (profileResponse.error || !profile ||
          profile.enrolled !== true || profile.archived === true) {
        return false;
      }

      const enrolledAt = profile.enrolled_at || profile.created_at;
      if (!hasCompletedTwoMonths(enrolledAt, now)) return false;

      // A private authenticated RPC is the source of truth: pending,
      // approved and rejected reviews all count as already submitted.
      const reviewResponse = await client.rpc("get_my_student_review");
      if (reviewResponse.error || !reviewResponse.data ||
          reviewResponse.data.review) {
        return false;
      }

      if (isSnoozed(storage, studentId, now.getTime())) return false;

      attachInvitationHandlers(dialog, studentId, storage, client);
      if (!dialog.open) {
        dialog.showModal();
        void recordInvitationEvent(client, "shown");
      }
      return true;
    } catch (_error) {
      // Never display a potentially incorrect invitation on failed queries.
      return false;
    }
  }

  const api = Object.freeze({
    hasCompletedTwoMonths: hasCompletedTwoMonths,
    initialize: initialize
  });

  if (root) root.StudentReviewInvitation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? null : window);
