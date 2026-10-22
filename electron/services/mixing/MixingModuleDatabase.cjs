const { MODULE_DATABASE_VOICE } = require("./MixingModuleDatabaseVoice.cjs");
const { MODULE_DATABASE_DSP } = require("./MixingModuleDatabaseDsp.cjs");

const MODULE_DATABASE = [
  ...MODULE_DATABASE_VOICE,
  ...MODULE_DATABASE_DSP
];

/**
 * Default starting pipeline order
 */
function createDefaultPipeline() {
  return [
    {
      stepId: 'step_1_timbre_match',
      moduleId: 'voice_timbre_match',
      prefix: '01_timbre_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'voice_timbre_match').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_2_gate',
      moduleId: 'silence_gate',
      prefix: '02_gate_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'silence_gate').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_3_norm',
      moduleId: 'phrase_norm',
      prefix: '03_norm_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'phrase_norm').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_4_glue',
      moduleId: 'glue_compress',
      prefix: '04_glue_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'glue_compress').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_5_ducking',
      moduleId: 'ducking',
      prefix: '05_ducking_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'ducking').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_6_master_mix',
      moduleId: 'master_audio_mix',
      prefix: '06_master_mix_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'master_audio_mix').defaultParams },
      status: 'idle',
      outputFiles: []
    },
    {
      stepId: 'step_7_video_mux',
      moduleId: 'video_mux',
      prefix: '07_video_mux_',
      enabled: true,
      params: { ...MODULE_DATABASE.find(m => m.id === 'video_mux').defaultParams },
      status: 'idle',
      outputFiles: []
    }
  ];
}

module.exports = { MODULE_DATABASE, createDefaultPipeline };
