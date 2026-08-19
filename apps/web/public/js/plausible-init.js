window.plausible =
  window.plausible ||
  ((...queueArguments) => {
    (window.plausible.q = window.plausible.q || []).push(queueArguments);
  });
window.plausible.init =
  window.plausible.init ||
  ((options) => {
    window.plausible.o = options || {};
  });
window.plausible.init();
