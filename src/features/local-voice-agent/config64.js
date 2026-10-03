/* PRENEURA 6.4 — local Egyptian voice quality defaults. */
(function(){
  window.PRENEURA_LOCAL_VOICE_CONFIG=Object.assign({
    speaker:'egyptian_speaker',
    voiceProfile:'qwen3-egyptian',
    autoTour:true,
    autoAdvanceSafeChoices:true,
    maxContextUnits:16,
    vadThreshold:.023,
    bargeInThreshold:.045,
    silenceMs:680
  },window.PRENEURA_LOCAL_VOICE_CONFIG||{});
})();
