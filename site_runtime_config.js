(function () {
  "use strict";

  function freezeAsset(asset) {
    return Object.freeze(asset);
  }

  const scriptAssets = Object.freeze({
    whatsappLeadForm: freezeAsset({
      id: "teacher-flavius-whatsapp-lead-form",
      src: "/whatsapp_lead_form.js?v=20260902-direct-2"
    }),
    siteWhatsapp: freezeAsset({
      id: "teacher-flavius-site-whatsapp",
      src: "/site_whatsapp.js?v=20260902-1"
    }),
    accessibility: freezeAsset({
      id: "teacher-flavius-accessibility",
      src: "/accessibility.js?v=20260820-1"
    }),
    cro: freezeAsset({
      id: "teacher-flavius-cro",
      src: "/cro.js?v=20260820-1"
    }),
    analytics: freezeAsset({
      id: "teacher-flavius-analytics",
      src: "/analytics.js?v=20260820-1"
    }),
    analyticsAttribution: freezeAsset({
      id: "teacher-flavius-analytics-attribution",
      src: "/analytics_attribution.js?v=20260902-leadfix-1"
    }),
    privacyConsent: freezeAsset({
      id: "teacher-flavius-privacy-consent",
      src: "/privacy_consent.js?v=20260820-2"
    }),
    sitePrivacyAnalytics: freezeAsset({
      id: "teacher-flavius-site-privacy-analytics",
      src: "/site_privacy_analytics.js?v=20260902-1"
    }),
    sitePageRuntime: freezeAsset({
      id: "teacher-flavius-site-page-runtime",
      src: "/site_page_runtime.js?v=20260904-whatsapp-tracking-1"
    }),
    mobileTopNavigation: freezeAsset({
      id: "teacher-flavius-mobile-top-navigation",
      src: "/mobile_top_navigation.js?v=20260820-desktop-menu-1"
    }),
    footerCore: freezeAsset({
      id: "teacher-flavius-site-footer-core",
      src: "/site_footer_core.js?v=20260820-privacy-1"
    }),
    cleanUrls: freezeAsset({
      id: "teacher-flavius-clean-urls",
      src: "/clean_urls.js?v=20260819-1"
    }),
    googleOnlyAccess: freezeAsset({
      id: "teacher-flavius-google-only-access",
      src: "/google_only_access.js?v=20260819-1"
    }),
    studentBirthdays: freezeAsset({
      id: "teacher-flavius-student-birthdays",
      src: "/student_birthdays.js?v=20260819-1"
    }),
    sitePageContext: freezeAsset({
      id: "teacher-flavius-site-page-context",
      src: "/site_page_context.js?v=20260902-1"
    }),
    siteBranding: freezeAsset({
      id: "teacher-flavius-site-branding",
      src: "/site_branding.js?v=20260902-1"
    }),
    siteEnrollmentGuard: freezeAsset({
      id: "teacher-flavius-site-enrollment-guard",
      src: "/site_enrollment_guard.js?v=20260902-1"
    }),
    marketingTrackingControl: freezeAsset({
      id: "teacher-flavius-marketing-tracking-control",
      src: "/marketing_tracking_control.js?v=20260904-1"
    }),
    marketingWhatsappTracker: freezeAsset({
      id: "teacher-flavius-marketing-whatsapp-tracker",
      src: "/marketing_whatsapp_tracker.js?v=20260904-1"
    })
  });

  const stylesheetAssets = Object.freeze({
    accessibility: freezeAsset({
      id: "teacher-flavius-accessibility-styles",
      href: "/accessibility.css?v=20260820-1"
    })
  });

  const privacyAnalyticsAssets = Object.freeze({
    privacyConsent: scriptAssets.privacyConsent,
    analyticsAttribution: scriptAssets.analyticsAttribution,
    analytics: scriptAssets.analytics,
    cro: scriptAssets.cro
  });

  window.SiteRuntimeConfig = Object.freeze({
    googleMeasurementId: "G-11V3W5B6TG",
    publicScriptsIdleTimeoutMs: 1200,
    scriptAssets: scriptAssets,
    stylesheetAssets: stylesheetAssets,
    privacyAnalyticsAssets: privacyAnalyticsAssets
  });
})();
