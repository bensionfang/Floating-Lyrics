const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-npm-test-'));
const testEnv = {
  ...process.env,
  DATA_DIR: tempRoot,
  DB_PATH: path.join(tempRoot, 'lyrics_data.db'),
  LYRICS_DB_PATH: path.join(tempRoot, 'lyrics_data.db')
};

const testFiles = [
  'tests/test_pitch_analysis.js',
  'tests/test_karaoke_queue.js',
  'tests/test_karaoke_session.js',
  'tests/test_karaoke_stage.js',
  'tests/test_karaoke_host.js',
  'tests/test_karaoke_diagnostics.js',
  'tests/test_karaoke_remote.js',
  'tests/test_karaoke_microphone.js',
  'tests/test_karaoke_player.js',
  'tests/test_mpv_karaoke_player.js',
  'tests/test_karaoke_player_service.js',
  'tests/test_karaoke_stage_mpv.js',
  'tests/test_karaoke_server_mpv_contract.js',
  'tests/test_karaoke_clock.js',
  'tests/test_media_timing.js',
  'tests/test_karaoke_mode.js',
  'tests/test_origin_guard.js',
  'tests/test_timing_harness.js',
  'tests/test_song_library.js',
  'tests/test_s2t.js',
  'tests/test_lyric_quality.js',
  'tests/test_search_query.js',
  'tests/test_title_lines.js',
  'tests/test_translations.js',
  'tests/test_romaji.js',
  'tests/test_itunes_resolving.js',
  'tests/test_history_toggle.js',
  'tests/test_backup_restore.js',
  'tests/test_scroll_zone.js',
  'tests/test_game.js',
  'tests/test_island_position.js',
  'tests/test_word_times.js',
  'tests/test_loop_end.js',
  'tests/test_lrclib_duration.js',
  'tests/test_lyrics_delete.js',
  'tests/test_no_lyrics.js',
  'tests/test_cloud_guard.js',
  'tests/test_pkce.js',
  'tests/test_mobile_playback.js',
  'tests/test_mobile_lyrics.js',
  'tests/test_mobile_color.js',
  'tests/test_offset_sync.js',
  'tests/test_lrc_time.js',
  'tests/test_win_corners.js',
  'tests/test_karaoke_library_scan.js',
  'tests/test_karaoke_catalog.js',
  'tests/test_karaoke_online_catalog.js'
];

const failures = [];
for (const relativePath of testFiles) {
  const testPath = path.join(repoRoot, relativePath);
  console.log(`\n[run] ${relativePath}`);
  const result = spawnSync(process.execPath, [testPath], {
    cwd: repoRoot,
    env: testEnv,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    const detail = result.error ? result.error.message : (result.signal || `exit ${result.status}`);
    failures.push(`${relativePath} (${detail})`);
  }
}

console.log(`\n[summary] ${testFiles.length - failures.length}/${testFiles.length} Node tests passed`);
if (failures.length) {
  console.error('[summary] failed tests:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
