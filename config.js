// Site settings.
window.HebrewClass = window.HebrewClass || {};
window.HebrewClass.config = {
  // Web app URL of the Google Apps Script that keeps the class's data in your
  // Google Sheet (see README.md). Leave empty and nothing is sent.
  resultsUrl: "https://script.google.com/macros/s/AKfycbwhf3InxFbsTloR8YKJNBosBw43irmI8w3DIkG9rU3l-AGL176Ap2_IOxsTemSZoYAd/exec",

  // The same script deployed from a test copy of the sheet. The site uses it
  // only when it is opened on this computer (localhost), so trying things out
  // never touches the students' real data.
  testResultsUrl: "https://script.google.com/macros/s/AKfycbwNU9sLRcbLCF7s51X-bvH5f4lBYrD0JTAnB83PdRdZjuvCs70yzGOM9Yagq0PthXH7gA/exec"
};

(function (config) {
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && config.testResultsUrl) {
    config.resultsUrl = config.testResultsUrl;
    config.testing = true;
  }
})(window.HebrewClass.config);
