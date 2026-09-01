(function () {
  "use strict";

  var footer = document.querySelector("footer");
  if (!footer) return;

  var currentYear = new Date().getFullYear();
  var whatsappMessage = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";
  var whatsappUrl = "https://wa.me/5534998349756?text=" + encodeURIComponent(whatsappMessage);

  footer.innerHTML = [
    '<div class="tf-footer-inner">',
      '<div class="tf-footer-brand">',
        '<strong>Teacher Flávio</strong>',
        '<span>Aulas de inglês online e ao vivo.</span>',
      '</div>',
      '<nav class="tf-footer-nav" aria-label="Links do rodapé">',
        '<a href="/sobre/">Sobre</a>',
        '<a href="/curso-de-ingles-online/">Curso de inglês</a>',
        '<a href="/recursos/">Recursos</a>',
        '<a href="' + whatsappUrl + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>',
        '<a href="/privacidade/">Privacidade</a>',
        '<a href="/cookies/">Cookies</a>',
        '<a href="/termos/">Termos</a>',
      '</nav>',
      '<div class="tf-footer-meta">© ' + currentYear + ' Teacher Flávio</div>',
    '</div>'
  ].join("");
})();