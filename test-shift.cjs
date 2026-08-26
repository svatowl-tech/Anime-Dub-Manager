const { shiftSubtitlesTime } = require('./electron/services/subtitleService.cjs');
(async () => {
  const result = await shiftSubtitlesTime('./test.ass', 1000, null);
  console.log(result);
})();
