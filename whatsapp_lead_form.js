(function () {
  "use strict";

  if (window.__teacherWhatsappLeadFormBootstrapLoaded) return;
  window.__teacherWhatsappLeadFormBootstrapLoaded = true;

  // Compatibility shim: the former lead form was removed intentionally.
  // WhatsApp links are standardized globally by site_footer.js and now open
  // directly with the site's initial message, without collecting lead data.
  window.TeacherWhatsappLeadFormBootstrap = {
    manages: function () {
      return false;
    }
  };
})();
